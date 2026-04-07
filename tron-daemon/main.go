package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
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

var (
	activeTasks      = make(map[string]string)
	isPrompting      = make(map[string]bool)
	ignoredRepos     = make(map[string]int64)
	lastWrite        = make(map[string]time.Time)
	lastEventTime    = make(map[string]time.Time)
	lastGitOperation = make(map[string]time.Time) // 🛡️ NEW: Tracks internal Git operations
	sessionMutex     sync.Mutex

	// 🛡️ NEW: Ticket storage for the active repo
	activeTicketList string

	daemonConfig Config
)

type Config struct {
	CloudURL string `json:"cloud_url"`
	APIKey   string `json:"api_key"`
}

type Ticket struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type TicketResponse struct {
	Tickets []Ticket `json:"tickets"`
}

func loadConfig() {
	homeDir, _ := os.UserHomeDir()
	configDir := filepath.Join(homeDir, ".tron")
	configPath := filepath.Join(configDir, "config.json")

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

	file, err := os.ReadFile(configPath)
	if err == nil {
		json.Unmarshal(file, &daemonConfig)
	}
}

// 🛡️ NEW: Fetch real-time Basecamp tickets for the specific repository
func fetchProjectTickets(repoName string) string {

	// 🛡️ FIX 1: Ensure we URL-encode the repo name (replaces / with %2F)
	encodedRepo := strings.ReplaceAll(repoName, "/", "%2F")

	// 🛡️ FIX 2: Construct the exact URL that worked in Postman
	baseURL := strings.TrimSuffix(daemonConfig.CloudURL, "/")
	endpoint := fmt.Sprintf("%s/api/project/%s/tickets", baseURL, encodedRepo)

	log.Printf("DEBUG: Fetching tickets from: %s", endpoint)

	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return "⚠️  Internal Daemon Error"
	}

	// 🛡️ FIX 3: Ensure the API Key header is EXACTLY what Postman used
	req.Header.Set("x-api-key", daemonConfig.APIKey)

	client := &http.Client{Timeout: 60 * time.Second} // Increased for Render Cold Starts
	resp, err := client.Do(req)

	if err != nil {
		log.Printf("❌ Network Error: %v", err)
		return "⚠️  Unable to fetch tickets (Network Error)"
	}
	defer resp.Body.Close()

	// 🛡️ FIX 4: Handle Unauthorized or Not Found errors specifically
	if resp.StatusCode == 401 {
		return "⚠️  Invalid API Key (Unauthorized)"
	}
	if resp.StatusCode == 404 {
		return "⚠️  Repo not found in tron.yaml"
	}
	if resp.StatusCode != 200 {
		return fmt.Sprintf("⚠️  Cloud Error (Status: %d)", resp.StatusCode)
	}

	var result TicketResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "⚠️  Error parsing ticket list."
	}

	if len(result.Tickets) == 0 {
		return "No active tickets found in To-Do column."
	}

	var builder strings.Builder
	builder.WriteString("--- ACTIVE BASECAMP TICKETS ---\n")
	for i, t := range result.Tickets {
		// Use a single \n here
		builder.WriteString(fmt.Sprintf("%d. [%s] %s\n", i+1, t.ID, t.Title))
	}
	builder.WriteString("------------------------------------------\n")
	return builder.String()
}

func getImmutableRepoID(repoRoot string) string {
	cmd := exec.Command("git", "-C", repoRoot, "rev-list", "--max-parents=0", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return "unknown_repo_id"
	}
	return strings.TrimSpace(string(out))
}

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

func getRepoNameFromGit(repoRoot string) string {
	cmd := exec.Command("git", "-C", repoRoot, "config", "--get", "remote.origin.url")
	out, _ := cmd.Output()
	url := strings.TrimSpace(string(out))
	url = strings.TrimSuffix(url, ".git")
	parts := strings.Split(url, "/")
	if len(parts) >= 2 {
		return parts[len(parts)-2] + "/" + parts[len(parts)-1]
	}
	return "unknown/repo"
}

func getCurrentBranch(repoRoot string) string {
	cmd := exec.Command("git", "-C", repoRoot, "branch", "--show-current")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func isResolvingMerge(repoRoot string) bool {
	gitDir := filepath.Join(repoRoot, ".git")
	files := []string{"MERGE_HEAD", "REBASE_HEAD", "rebase-merge", "rebase-apply"}
	for _, f := range files {
		if _, err := os.Stat(filepath.Join(gitDir, f)); err == nil {
			return true
		}
	}
	return false
}

func main() {
	loadConfig()

	logFile, err := os.OpenFile("tron.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	if err != nil {
		log.Fatalf("Failed to open log: %v", err)
	}
	defer logFile.Close()

	multiWriter := io.MultiWriter(os.Stdout, logFile)
	log.SetOutput(multiWriter)

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

		sessionMutex.Lock()
		// 🛡️ THE GHOST TRIGGER FIX (Part 1): If Git modifies a .git file, record the exact time.
		if strings.Contains(fileName, ".git") {
			lastGitOperation[repoRoot] = time.Now()
			sessionMutex.Unlock()
			return
		}

		// 🛡️ THE GHOST TRIGGER FIX (Part 2): The 5-Second Shield
		// If a Git command (like checkout/pull) ran in the last 5 seconds,
		// assume this file change is from Git, NOT a human typing. Ignore it!
		if time.Since(lastGitOperation[repoRoot]) < 5*time.Second {
			sessionMutex.Unlock()
			return
		}

		// Standard event debounce
		if time.Since(lastEventTime[repoRoot]) < 3*time.Second {
			sessionMutex.Unlock()
			return
		}
		lastEventTime[repoRoot] = time.Now()
		sessionMutex.Unlock()

		if isResolvingMerge(repoRoot) {
			return
		}

		currentBranch := getCurrentBranch(repoRoot)
		sessionMutex.Lock()

		// 1. Are we on a task branch? (Business as usual)
		if strings.HasPrefix(currentBranch, "feature/TASK-") {
			taskID := strings.TrimPrefix(currentBranch, "feature/TASK-")
			activeTasks[repoRoot] = taskID
			if time.Since(lastWrite[repoRoot]) > 2*time.Second {
				lastWrite[repoRoot] = time.Now()
				go func() {
					githook.InstallHook(repoRoot)
					githook.WriteTaskState(repoRoot, taskID)
				}()
			}
			sessionMutex.Unlock()
			return
		}

		// 2. 🧹 NEW: We are NOT on a task branch!
		// If memory still thinks we are, we just checked out 'main'. Clear it!
		if activeTasks[repoRoot] != "" {
			fmt.Println("🧹 Switched off task branch. Clearing T.R.O.N. memory.")
			delete(activeTasks, repoRoot)
			githook.ClearTaskState(repoRoot)
		}

		// 3. Check the Snooze Button
		if snoozeTime, exists := ignoredRepos[repoRoot]; exists {
			// Changed from 3600 (1 hour) to 120 (2 minutes)
			if time.Now().Unix()-snoozeTime < 120 {
				sessionMutex.Unlock()
				return
			}
			delete(ignoredRepos, repoRoot)
		}

		// 4. Ensure we only show one pop-up at a time
		if isPrompting[repoRoot] {
			sessionMutex.Unlock()
			return
		}

		isPrompting[repoRoot] = true
		sessionMutex.Unlock()

		_ = beeep.Notify("T.R.O.N. Intent Detected", "Syncing tickets with Basecamp...", "")

		// 🚀 FETCH TICKETS LIVE
		repoName := getRepoNameFromGit(repoRoot)
		ticketList := fetchProjectTickets(repoName)

		repoNameOnly := filepath.Base(repoRoot)
		var cmd *exec.Cmd
		var rawInput string

		switch runtime.GOOS {
		case "windows":
			cleanRepo := strings.ReplaceAll(repoNameOnly, "'", "")
			// We use @' '@ (Here-String) to preserve the structure of the ticketList
			psCommand := fmt.Sprintf(`
				[System.Reflection.Assembly]::LoadWithPartialName('Microsoft.VisualBasic') | Out-Null;
				$menu = @'
%s
'@;
				$msg = "Repo: %s" + [Environment]::NewLine + [Environment]::NewLine + $menu + [Environment]::NewLine + "Enter Ticket ID or New Task Name:";
				[Microsoft.VisualBasic.Interaction]::InputBox($msg, 'T.R.O.N. Task Intelligence', '');
			`, ticketList, cleanRepo)

			cmd = exec.Command("powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", psCommand)

		case "darwin":
			msg := fmt.Sprintf("Repo: %s\\n\\n%s\\n\\nEnter Ticket ID or New Task:", repoNameOnly, ticketList)
			asCommand := fmt.Sprintf(`set T to text returned of (display dialog "%s" default answer "" with title "T.R.O.N. Watcher")`, msg)
			cmd = exec.Command("osascript", "-e", asCommand)

		default:
			rawInput = "IGNORE"
		}

		if cmd != nil {
			out, err := cmd.Output()
			if err != nil {
				fmt.Printf("❌ UI Prompt crashed: %v\n", err)
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

		// RESOLVE VIA CLOUD
		fmt.Printf("☁️  Resolving '%s' via T.R.O.N. Cloud...\n", rawInput)
		immutableID := getImmutableRepoID(repoRoot)
		payload, _ := json.Marshal(map[string]string{
			"taskInput": rawInput,
			"repoName":  repoName,
			"repoId":    immutableID,
		})

		endpoint := fmt.Sprintf("%s/api/start-task", strings.TrimSuffix(daemonConfig.CloudURL, "/"))
		req, _ := http.NewRequest("POST", endpoint, bytes.NewBuffer(payload))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-api-key", daemonConfig.APIKey)

		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Do(req)

		var finalTaskID string
		if err == nil && resp.StatusCode == 200 {
			var result map[string]string
			json.NewDecoder(resp.Body).Decode(&result)
			finalTaskID = result["resolvedId"]
			fmt.Printf("✅ Cloud resolved to ID: %s\n", finalTaskID)
		} else {
			finalTaskID = strings.ReplaceAll(strings.TrimSpace(rawInput), " ", "-")
		}

		sessionMutex.Lock()
		activeTasks[repoRoot] = finalTaskID
		isPrompting[repoRoot] = false
		sessionMutex.Unlock()

		githook.InstallHook(repoRoot)
		githook.WriteTaskState(repoRoot, finalTaskID)

		branchName := fmt.Sprintf("feature/TASK-%s", finalTaskID)
		gitCmd := exec.Command("git", "-C", repoRoot, "checkout", "-b", branchName)
		if err := gitCmd.Run(); err != nil {
			exec.Command("git", "-C", repoRoot, "checkout", branchName).Run()
		}
		fmt.Printf("🌿 Switched to %s\n", branchName)
	}

	w, err := watcher.Start(targetDir, onFileChange)
	if err != nil {
		log.Fatalf("❌ FATAL: Failed to start file watcher: %v", err)
	}
	defer w.Close()

	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)
	<-done
}
