package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"tron-daemon/internal/githook"
	"tron-daemon/internal/watcher"

	"github.com/gen2brain/beeep"
)

// 🛡️ QoL UPGRADE: Multi-Repo State Management
var (
	activeTasks  = make(map[string]string)
	isPrompting  = make(map[string]bool)
	ignoredRepos = make(map[string]int64)
	lastWrite    = make(map[string]time.Time)
	sessionMutex sync.Mutex
	// 🛡️ QoL FIX: Hold the list of connected projects
	connectedProjectsList string
	isFetchingProjects    bool

	// 🛡️ ARCHITECTURE FIX: Global Config
	daemonConfig Config
)

type Config struct {
	CloudURL string `json:"cloud_url"`
	APIKey   string `json:"api_key"`
}

// 🛡️ ARCHITECTURE FIX: Load or Create ~/.tron/config.json
func loadConfig() {
	homeDir, _ := os.UserHomeDir()
	configDir := filepath.Join(homeDir, ".tron")
	configPath := filepath.Join(configDir, "config.json")

	// If config doesn't exist, create a default one
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		os.MkdirAll(configDir, 0755)
		defaultConfig := Config{
			CloudURL: "http://localhost:3000",
			APIKey:   "super_secret_daemon_key_2026",
		}
		file, _ := json.MarshalIndent(defaultConfig, "", "  ")
		os.WriteFile(configPath, file, 0644)
		daemonConfig = defaultConfig
		return
	}

	// Read existing config
	file, err := os.ReadFile(configPath)
	if err == nil {
		json.Unmarshal(file, &daemonConfig)
	}
}

// 🛡️ ARCHITECTURE FIX: The Immutable Repository ID (First Commit Hash)
func getImmutableRepoID(repoRoot string) string {
	cmd := exec.Command("git", "-C", repoRoot, "rev-list", "--max-parents=0", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return "unknown_repo_id"
	}
	return strings.TrimSpace(string(out))
}

// Helper: Dynamically find the repository root
func getRepoRoot(path string) string {
	dir := filepath.Dir(path)
	for {
		if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// 🛡️ QoL UPGRADE: Branch Sniffer to cure Context Amnesia
func getCurrentBranch(repoRoot string) string {
	cmd := exec.Command("git", "-C", repoRoot, "branch", "--show-current")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// 🛡️ QoL FIX: Detect if the developer is trapped in a Merge Conflict or Rebase
func isResolvingMerge(repoRoot string) bool {
	gitDir := filepath.Join(repoRoot, ".git")
	if _, err := os.Stat(filepath.Join(gitDir, "MERGE_HEAD")); err == nil {
		return true
	}
	if _, err := os.Stat(filepath.Join(gitDir, "REBASE_HEAD")); err == nil {
		return true
	}
	if _, err := os.Stat(filepath.Join(gitDir, "rebase-merge")); err == nil {
		return true
	}
	if _, err := os.Stat(filepath.Join(gitDir, "rebase-apply")); err == nil {
		return true
	}
	return false
}

// 🛡️ QoL FIX: Fetch connected projects from the Cloud Router
func fetchConnectedProjects() {
	if isFetchingProjects {
		return
	}
	isFetchingProjects = true
	defer func() { isFetchingProjects = false }()

	endpoint := fmt.Sprintf("%s/api/projects", strings.TrimSuffix(daemonConfig.CloudURL, "/"))
	req, _ := http.NewRequest("GET", endpoint, nil)
	req.Header.Set("x-api-key", daemonConfig.APIKey) // 🛡️ SECURITY FIX: Send the key

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)

	if err != nil || resp.StatusCode != 200 {
		connectedProjectsList = "Fetch failed (Offline?)"
		return
	}
	defer resp.Body.Close()

	var result struct {
		Projects []string `json:"projects"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
		// 🛡️ UX FIX: Protect the dialog box from overflowing!
		if len(result.Projects) > 4 {
			displayList := strings.Join(result.Projects[:4], ", ")
			connectedProjectsList = fmt.Sprintf("%s ...and %d more", displayList, len(result.Projects)-4)
		} else {
			connectedProjectsList = strings.Join(result.Projects, ", ")
		}
	}
}

func main() {
	loadConfig() // 🛡️ Load ~/.tron/config.json on boot!

	// 🛡️ QoL FIX: Grab the project list in the background
	go fetchConnectedProjects()

	logFile, err := os.OpenFile("tron.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	if err != nil {
		log.Fatalf("Failed to open log: %v", err)
	}
	defer logFile.Close()
	log.SetOutput(logFile)

	targetDir := "."
	if len(os.Args) > 1 {
		targetDir = os.Args[1]
	}

	log.Printf("SYSTEM: T.R.O.N. V2 booting. Watching Workspace: %s", targetDir)

	onFileChange := func(fileName string, action string) {
		repoRoot := getRepoRoot(fileName)
		if repoRoot == "" {
			return
		}

		// 🛡️ QoL FIX: Stay completely silent if they are resolving conflicts!
		if isResolvingMerge(repoRoot) {
			return
		}

		currentBranch := getCurrentBranch(repoRoot)

		sessionMutex.Lock()

		// 🧠 CURE AMNESIA: Are we already on a T.R.O.N. branch?
		if strings.HasPrefix(currentBranch, "feature/TASK-") {
			taskID := strings.TrimPrefix(currentBranch, "feature/TASK-")
			activeTasks[repoRoot] = taskID

			// 🛡️ QoL FIX: Throttle the "Save All" bombardment!
			if time.Since(lastWrite[repoRoot]) > 2*time.Second {
				lastWrite[repoRoot] = time.Now()
				// Silently ensure the hook and state file exist so commits work
				go func() {
					githook.InstallHook(repoRoot)
					githook.WriteTaskState(repoRoot, taskID)
				}()
			}
			sessionMutex.Unlock()
			return
		}
		// 🛡️ QoL FIX: The 1-Hour Snooze Button
		if snoozeTime, exists := ignoredRepos[repoRoot]; exists {
			if time.Now().Unix()-snoozeTime < 3600 { // 3600 seconds = 1 hour
				sessionMutex.Unlock()
				return
			} else {
				// Snooze expired!
				delete(ignoredRepos, repoRoot)
			}
		}

		// 🧹 CLEANUP: Did we just check out 'main' or a non-task branch?
		if strings.HasSuffix(fileName, "HEAD") {
			if activeTasks[repoRoot] != "" && !strings.HasPrefix(currentBranch, "feature/TASK-") {
				_ = beeep.Notify("T.R.O.N. Status", "Switched off task branch. Task tracking suspended.", "")
				delete(activeTasks, repoRoot)
				githook.ClearTaskState(repoRoot)
			}
			sessionMutex.Unlock()
			return
		}

		// 🛡️ MULTI-REPO FIX: Check if we are already tracking THIS specific repo
		if activeTasks[repoRoot] != "" {
			sessionMutex.Unlock()
			return
		}

		if isPrompting[repoRoot] {
			sessionMutex.Unlock()
			return
		}
		isPrompting[repoRoot] = true
		sessionMutex.Unlock()

		// 🛡️ STATE FIX: Just-In-Time refresh if data is missing or stale
		if connectedProjectsList == "" || connectedProjectsList == "Fetch failed (Offline?)" {
			fetchConnectedProjects()
		}

		// 🚀 TRIGGER PROMPT
		_ = beeep.Notify("T.R.O.N. Intent Detected", "File modified on untracked branch. Please link a task.", "")

		// 🛡️ QoL UPGRADE: Contextual Dialog Message
		// We calculate the current repo name to show the developer exactly where they are
		repoNameOnly := filepath.Base(repoRoot)

		var cmd *exec.Cmd
		var rawInput string

		switch runtime.GOOS {
		case "windows":
			// Windows VB InputBox requires specific formatting for newlines
			msg := fmt.Sprintf("Triggered by: %s`r`n`r`nConnected Projects: %s`r`n`r`nWhat task/ticket are you working on? (Type IGNORE to skip)", repoNameOnly, connectedProjectsList)
			psCommand := fmt.Sprintf(`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox('%s', 'T.R.O.N. Watcher', '')`, msg)
			cmd = exec.Command("powershell", "-Command", psCommand)

		case "darwin":
			// macOS AppleScript
			msg := fmt.Sprintf("Triggered by: %s\\n\\nConnected Projects: %s\\n\\nWhat task/ticket are you working on? (Type IGNORE to skip)", repoNameOnly, connectedProjectsList)
			asCommand := fmt.Sprintf(`set T to text returned of (display dialog "%s" default answer "" with title "T.R.O.N. Watcher")`, msg)
			cmd = exec.Command("osascript", "-e", asCommand)

		case "linux":
			// Linux Zenity
			msg := fmt.Sprintf("Triggered by: %s\n\nConnected Projects: %s\n\nWhat task/ticket are you working on? (Type IGNORE to skip)", repoNameOnly, connectedProjectsList)
			cmd = exec.Command("zenity", "--entry", "--title=T.R.O.N. Watcher", fmt.Sprintf("--text=%s", msg))

		default:
			rawInput = "IGNORE"
		}

		if cmd != nil {
			out, err := cmd.Output()
			if err != nil {
				rawInput = "IGNORE"
			} else {
				rawInput = strings.TrimSpace(string(out))
				if rawInput == "" {
					rawInput = "IGNORE"
				}
			}
		}

		if strings.ToUpper(rawInput) == "IGNORE" {
			sessionMutex.Lock()
			isPrompting[repoRoot] = false
			ignoredRepos[repoRoot] = time.Now().Unix()
			sessionMutex.Unlock()
			return
		}

		fmt.Printf("☁️  Sending '%s' to T.R.O.N. Cloud Router to resolve ID...\n", rawInput)

		// Calculate Repo Name
		cmd = exec.Command("git", "-C", repoRoot, "config", "--get", "remote.origin.url")
		out, _ := cmd.Output()
		repoName := "unknown/repo"
		url := strings.TrimSpace(string(out))
		url = strings.TrimSuffix(url, ".git")
		parts := strings.Split(url, "/")
		if len(parts) >= 2 {
			repoName = parts[len(parts)-2] + "/" + parts[len(parts)-1]
		}

		// Cloud Resolution
		// 🛡️ ARCHITECTURE FIX: Fetch the Immutable ID
		immutableID := getImmutableRepoID(repoRoot)

		// Cloud Resolution
		payload, _ := json.Marshal(map[string]string{
			"taskInput": rawInput,
			"repoName":  repoName,
			"repoId":    immutableID, // Safe from repository renames!
		})

		// 🛡️ ARCHITECTURE FIX: Use dynamic Config URL and Key
		endpoint := fmt.Sprintf("%s/api/start-task", strings.TrimSuffix(daemonConfig.CloudURL, "/"))
		req, _ := http.NewRequest("POST", endpoint, bytes.NewBuffer(payload))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-api-key", daemonConfig.APIKey)

		client := &http.Client{
			Timeout: 10 * time.Second,
		}
		resp, err := client.Do(req)

		var finalTaskID string

		if err == nil && resp.StatusCode == 200 {
			var result map[string]string
			json.NewDecoder(resp.Body).Decode(&result)
			finalTaskID = result["resolvedId"]
			fmt.Printf("✅ Cloud resolved task to ID: %s\n", finalTaskID)
		} else {
			log.Printf("ERROR: Cloud sync failed. Falling back to manual formatting.")
			finalTaskID = strings.ReplaceAll(strings.TrimSpace(rawInput), " ", "-")
		}

		sessionMutex.Lock()
		activeTasks[repoRoot] = finalTaskID
		isPrompting[repoRoot] = false
		sessionMutex.Unlock()

		// Write state & Zero-Touch Branching
		githook.InstallHook(repoRoot)
		githook.WriteTaskState(repoRoot, finalTaskID)

		branchName := fmt.Sprintf("feature/TASK-%s", finalTaskID)
		gitCmd := exec.Command("git", "-C", repoRoot, "checkout", "-b", branchName)
		if err := gitCmd.Run(); err != nil {
			gitCmd = exec.Command("git", "-C", repoRoot, "checkout", branchName)
			_ = gitCmd.Run()
		}
		fmt.Printf("🌿 Switched to %s\n", branchName)
	}

	w, err := watcher.Start(targetDir, onFileChange)
	if err != nil {
		os.Exit(1)
	}
	defer w.Close()

	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)
	<-done
}
