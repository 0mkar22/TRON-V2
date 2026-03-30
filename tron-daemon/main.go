package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"

	"tron-daemon/internal/githook"
	"tron-daemon/internal/watcher"

	"github.com/gen2brain/beeep"
)

var (
	activeTaskID    string
	isPrompting     bool
	sessionMutex    sync.Mutex
	lastTrackedFile string
)

func main() {
	logFile, err := os.OpenFile("tron.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	if err != nil {
		log.Fatalf("Failed to open log file: %v", err)
	}
	defer logFile.Close()

	log.SetOutput(logFile)
	log.SetFlags(log.Ldate | log.Ltime)

	fmt.Println("👁️  T.R.O.N. Daemon initializing...")
	log.Println("SYSTEM: T.R.O.N. Daemon Boot Sequence Initiated")

	githook.InstallHook()

	onFileChange := func(fileName string, action string) {
		if strings.HasSuffix(fileName, "HEAD") {
			sessionMutex.Lock()
			if activeTaskID != "" {
				log.Printf("SYSTEM: Branch change detected. Clearing session [%s]", activeTaskID)
				fmt.Printf("\n🔄 Branch change detected! T.R.O.N. has cleared task %s.\n", activeTaskID)
				_ = beeep.Notify("T.R.O.N. Status", "Branch changed. Task cleared.", "")

				activeTaskID = ""
				lastTrackedFile = ""
				githook.ClearTaskState()
			}
			sessionMutex.Unlock()
			return
		}

		sessionMutex.Lock()

		if activeTaskID != "" {
			if fileName != lastTrackedFile {
				if !strings.HasSuffix(fileName, "tron_task") {
					log.Printf("TRACKED: Attached modification of [%s] to Task=[%s]", fileName, activeTaskID)
					lastTrackedFile = fileName
				}
			}
			sessionMutex.Unlock()
			return
		}

		if isPrompting {
			sessionMutex.Unlock()
			return
		}

		isPrompting = true
		sessionMutex.Unlock()

		go func(triggerFile string, triggerAction string) {
			notifyMsg := fmt.Sprintf("You %s '%s'. Check terminal to link task.", triggerAction, triggerFile)
			_ = beeep.Notify("T.R.O.N. Intent Detected", notifyMsg, "")

			fmt.Printf("\n⚡ Intent Detected: You %s '%s'\n", triggerAction, triggerFile)

			reader := bufio.NewReader(os.Stdin)
			var taskID string

			for {
				fmt.Print("🛠️  What task/ticket are you working on? (Type 'IGNORE' to skip): ")
				input, err := reader.ReadString('\n')
				if err != nil {
					log.Println("ERROR: Failed reading input:", err)
				}

				taskID = strings.TrimSpace(input)
				if taskID != "" {
					break
				}
				fmt.Println("⚠️  Task ID cannot be empty. Please enter a valid ID or type 'IGNORE'.")
			}

			sessionMutex.Lock()
			activeTaskID = taskID
			lastTrackedFile = triggerFile
			isPrompting = false

			if strings.ToUpper(activeTaskID) != "IGNORE" {
				githook.WriteTaskState(activeTaskID)

				go func(tID string) {
					cmd := exec.Command("git", "config", "--get", "remote.origin.url")
					out, err := cmd.Output()
					repoName := "unknown/repo"

					if err == nil {
						url := strings.TrimSpace(string(out))
						url = strings.TrimSuffix(url, ".git")
						parts := strings.Split(url, "/")
						if len(parts) >= 2 {
							repoName = parts[len(parts)-2] + "/" + parts[len(parts)-1]
						}
					}

					payload := map[string]string{
						"taskId":   tID,
						"repoName": repoName,
					}
					jsonPayload, _ := json.Marshal(payload)

					req, _ := http.NewRequest("POST", "http://localhost:3000/api/start-task", bytes.NewBuffer(jsonPayload))
					req.Header.Set("Content-Type", "application/json")
					req.Header.Set("x-api-key", "super_secret_daemon_key_2026")

					client := &http.Client{}
					resp, err := client.Do(req)
					if err != nil || resp.StatusCode != 200 {
						log.Printf("Warning: Could not sync task start to cloud. Status: %v", err)
					} else {
						log.Printf("SYNC: Successfully notified Cloud Router that %s started in %s.", tID, repoName)
					}
				}(activeTaskID)
			}

			sessionMutex.Unlock()

			log.Printf("SESSION LOCKED: Developer bound session to Task=[%s]", activeTaskID)
			log.Printf("TRACKED: Attached triggering modification of [%s] to Task=[%s]", triggerFile, activeTaskID)

			if strings.ToUpper(activeTaskID) == "IGNORE" {
				fmt.Println("🔇 Session ignored. I will stop tracking until you change branches.")
			} else {
				fmt.Printf("✅ Session linked to %s. I will track your commits in the background.\n", activeTaskID)
			}

		}(fileName, action)
	}

	w, err := watcher.Start(".", onFileChange)
	if err != nil {
		fmt.Printf("FATAL ERROR: Failed to start T.R.O.N. watcher: %v\n", err)
		os.Exit(1)
	}
	defer w.Close()

	fmt.Println("✅ T.R.O.N. is actively watching for Create, Update, and Delete changes.")

	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)

	<-done
	log.Println("SYSTEM: Received interrupt signal. Shutting down gracefully.")
	fmt.Println("\n🛑 Shutting down T.R.O.N. watcher safely.")
}
