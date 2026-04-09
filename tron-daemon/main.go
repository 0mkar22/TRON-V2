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
	lastGitOperation = make(map[string]time.Time) // Tracks internal Git operations
	sessionMutex     sync.Mutex

	// Ticket storage for the active repo
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

// Fetch real-time PM tickets for the specific repository
func fetchProjectTickets(repoName string) string {

	encodedRepo := strings.ReplaceAll(repoName, "/", "%2F")

	baseURL := strings.TrimSuffix(daemonConfig.CloudURL, "/")
	endpoint := fmt.Sprintf("%s/api/project/%s/tickets", baseURL, encodedRepo)

	log.Printf("DEBUG: Fetching tickets from: %s", endpoint)

	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return "⚠️  Internal Daemon Error"
	}

	req.Header.Set("x-api-key", daemonConfig.APIKey)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)

	if err != nil {
		log.Printf("❌ Network Error: %v", err)
		return "⚠️  Unable to fetch tickets (Network Error)"
	}
	defer resp.Body.Close()

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
		return "No active tickets found."
	}

	var builder strings.Builder
	builder.WriteString("--- ACTIVE TICKETS ---\n")
	for i, t := range result.Tickets {
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
		if strings.Contains(fileName, ".git") {
			lastGitOperation[repoRoot] = time.Now()
			sessionMutex.Unlock()
			return
		}

		if time.Since(lastGitOperation[repoRoot]) < 5*time.Second {
			sessionMutex.Unlock()
			return
		}

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

		if strings.HasPrefix(currentBranch, "feature/TASK-") || strings.HasPrefix(currentBranch, "feature/") {
			// Extracting task ID more broadly to catch Basecamp and Jira
			parts := strings.SplitN(currentBranch, "/", 2)
			if len(parts) > 1 {
				taskID := strings.TrimPrefix(parts[1], "TASK-")
				activeTasks[repoRoot] = taskID
				if time.Since(lastWrite[repoRoot]) > 2*time.Second {
					lastWrite[repoRoot] = time.Now()
					go func() {
						githook.InstallHook(repoRoot)
						githook.WriteTaskState(repoRoot, taskID)
					}()
				}
			}
			sessionMutex.Unlock()
			return
		}

		if activeTasks[repoRoot] != "" {
			fmt.Println("🧹 Switched off task branch. Clearing T.R.O.N. memory.")
			delete(activeTasks, repoRoot)
			githook.ClearTaskState(repoRoot)
		}

		if snoozeTime, exists := ignoredRepos[repoRoot]; exists {
			if time.Now().Unix()-snoozeTime < 120 {
				sessionMutex.Unlock()
				return
			}
			delete(ignoredRepos, repoRoot)
		}

		if isPrompting[repoRoot] {
			sessionMutex.Unlock()
			return
		}

		isPrompting[repoRoot] = true
		sessionMutex.Unlock()

		_ = beeep.Notify("T.R.O.N. Intent Detected", "Syncing tickets with Project Manager...", "")

		repoName := getRepoNameFromGit(repoRoot)
		ticketList := fetchProjectTickets(repoName)
		repoNameOnly := filepath.Base(repoRoot)

		var cmd *exec.Cmd
		var rawInput string

		// 🛡️ CROSS-PLATFORM UI PROMPT
		switch runtime.GOOS {
		case "windows":
			cleanRepo := strings.ReplaceAll(repoNameOnly, "'", "")
			psCommand := fmt.Sprintf(`
				[System.Reflection.Assembly]::LoadWithPartialName('Microsoft.VisualBasic') | Out-Null;
				$menu = @'
%s
'@;
				$msg = "Repo: %s" + [Environment]::NewLine + [Environment]::NewLine + $menu + [Environment]::NewLine + "Enter Ticket ID or New Task Name:";
				$result = [Microsoft.VisualBasic.Interaction]::InputBox($msg, 'T.R.O.N. Task Intelligence', '');
				if ([string]::IsNullOrWhiteSpace($result)) { Write-Output "IGNORE" } else { Write-Output $result }
			`, ticketList, cleanRepo)

			cmd = exec.Command("powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", psCommand)

		case "darwin":
			// Safely escape strings to prevent AppleScript from breaking on quotes
			safeRepo := strings.ReplaceAll(repoNameOnly, `"`, `\"`)
			safeTickets := strings.ReplaceAll(ticketList, `"`, `\"`)

			// We pass the script via stdin to avoid command line argument limits and escaping bugs
			appleScript := fmt.Sprintf(`
				set repoName to "%s"
				set ticketList to "%s"
				set dialogMsg to "Repo: " & repoName & return & return & ticketList & return & return & "Enter Ticket ID or New Task:"
				try
					set dialogResult to display dialog dialogMsg default answer "" with title "T.R.O.N. Watcher"
					return text returned of dialogResult
				on error number -128
					return "IGNORE"
				end try
			`, safeRepo, safeTickets)

			cmd = exec.Command("osascript", "-")
			cmd.Stdin = strings.NewReader(appleScript)

		default:
			// Fallback for Linux (could implement Zenity here if needed later)
			rawInput = "IGNORE"
		}

		if cmd != nil {
			out, err := cmd.Output()
			if err != nil {
				fmt.Printf("❌ UI Prompt failed/canceled: %v\n", err)
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
