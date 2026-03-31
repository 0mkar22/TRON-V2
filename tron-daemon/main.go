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
	"strings"
	"sync"
	"syscall"

	"tron-daemon/internal/githook"
	"tron-daemon/internal/watcher"

	"github.com/gen2brain/beeep"
)

var (
	activeTaskID   string
	activeRepoRoot string
	isPrompting    bool
	sessionMutex   sync.Mutex
)

// Helper function to dynamically find the repository root of any modified file
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

func main() {
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

	log.Printf("SYSTEM: T.R.O.N. booting. Watching Workspace: %s", targetDir)

	onFileChange := func(fileName string, action string) {
		repoRoot := getRepoRoot(fileName)
		if repoRoot == "" {
			return
		} // Ignore files that aren't inside a Git repository

		if strings.HasSuffix(fileName, "HEAD") {
			sessionMutex.Lock()
			if activeTaskID != "" && activeRepoRoot == repoRoot {
				// 🛡️ THE FIX: Check if the new branch is the one T.R.O.N. just created!
				headContent, err := os.ReadFile(fileName)
				if err == nil && strings.Contains(string(headContent), activeTaskID) {
					sessionMutex.Unlock()
					return // Ignore the branch change, it was us!
				}

				_ = beeep.Notify("T.R.O.N. Status", "Branch changed. Task cleared.", "")
				activeTaskID = ""
				activeRepoRoot = ""
				githook.ClearTaskState(repoRoot)
			}
			sessionMutex.Unlock()
			return
		}

		sessionMutex.Lock()
		if activeTaskID != "" {
			sessionMutex.Unlock()
			return
		}

		if isPrompting {
			sessionMutex.Unlock()
			return
		}
		isPrompting = true
		sessionMutex.Unlock()

		go func(rRoot string, tFile string) {
			_ = beeep.Notify("T.R.O.N. Intent Detected", "File modified. Please link a task.", "")

			psCommand := `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox('File modified! What task/ticket are you working on? (Type IGNORE to skip)', 'T.R.O.N. Watcher', '')`

			var taskID string
			cmd := exec.Command("powershell", "-Command", psCommand)
			out, err := cmd.Output()

			// 🛡️ THE FIX: If they hit Cancel or submit nothing, just treat it as IGNORE. No loops!
			if err != nil {
				taskID = "IGNORE"
			} else {
				taskID = strings.TrimSpace(string(out))
				if taskID == "" {
					taskID = "IGNORE"
				}
			}

			sessionMutex.Lock()
			activeTaskID = taskID
			activeRepoRoot = rRoot
			isPrompting = false

			if strings.ToUpper(activeTaskID) != "IGNORE" {
				// 1. Notify user that we are talking to the cloud
				fmt.Printf("☁️  Sending '%s' to T.R.O.N. Cloud Router to resolve ID...\n", activeTaskID)

				// Calculate Repo Name
				cmd := exec.Command("git", "-C", rRoot, "config", "--get", "remote.origin.url")
				out, _ := cmd.Output()
				repoName := "unknown/repo"
				url := strings.TrimSpace(string(out))
				url = strings.TrimSuffix(url, ".git")
				parts := strings.Split(url, "/")
				if len(parts) >= 2 {
					repoName = parts[len(parts)-2] + "/" + parts[len(parts)-1]
				}

				// 2. HTTP POST Request (Synchronous - we wait for the reply!)
				payload, _ := json.Marshal(map[string]string{"taskInput": activeTaskID, "repoName": repoName})
				req, _ := http.NewRequest("POST", "http://localhost:3000/api/start-task", bytes.NewBuffer(payload))
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("x-api-key", "super_secret_daemon_key_2026")

				client := &http.Client{}
				resp, err := client.Do(req)

				if err == nil && resp.StatusCode == 200 {
					// Parse the resolved ID from the Cloud
					var result map[string]string
					json.NewDecoder(resp.Body).Decode(&result)
					resolvedID := result["resolvedId"]

					fmt.Printf("✅ Cloud resolved task to ID: %s\n", resolvedID)
					activeTaskID = resolvedID // Overwrite their text with the real ID!

					// 3. Install Hooks and Write State using the REAL ID
					githook.InstallHook(rRoot)
					githook.WriteTaskState(rRoot, activeTaskID)

					// 4. ZERO-TOUCH BRANCHING
					branchName := fmt.Sprintf("feature/TASK-%s", activeTaskID)
					gitCmd := exec.Command("git", "-C", rRoot, "checkout", "-b", branchName)
					if err := gitCmd.Run(); err != nil {
						gitCmd = exec.Command("git", "-C", rRoot, "checkout", branchName)
						_ = gitCmd.Run()
					}
					fmt.Printf("🌿 Zero-Touch Branching: Switched to %s\n", branchName)
				} else {
					log.Printf("ERROR: Cloud sync failed. Falling back to manual ID tracking.")

					// 🛡️ QoL UPDATE: Make sure the raw input is Git-safe!
					safeBranchName := strings.ReplaceAll(strings.TrimSpace(activeTaskID), " ", "-")

					// Install Hooks and Write State
					githook.InstallHook(rRoot)
					githook.WriteTaskState(rRoot, safeBranchName)

					// ZERO-TOUCH BRANCHING (Safe Fallback)
					branchName := fmt.Sprintf("feature/%s", safeBranchName)
					gitCmd := exec.Command("git", "-C", rRoot, "checkout", "-b", branchName)
					if err := gitCmd.Run(); err != nil {
						gitCmd = exec.Command("git", "-C", rRoot, "checkout", branchName)
						_ = gitCmd.Run()
					}
					fmt.Printf("🌿 Zero-Touch Branching (Offline Mode): Switched to %s\n", branchName)
				}
			}
			sessionMutex.Unlock()
		}(repoRoot, fileName)
	}

	w, err := watcher.Start(targetDir, onFileChange)
	if err != nil {
		os.Exit(1)
	}
	defer w.Close()

	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)
	<-done

	log.Println("SYSTEM: Received interrupt signal. Shutting down gracefully.")
	fmt.Println("\n🛑 Shutting down T.R.O.N. watcher safely.")

}
