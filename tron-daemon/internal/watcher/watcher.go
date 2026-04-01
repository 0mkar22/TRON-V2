package watcher

import (
	"log"
	"os"
	"path/filepath"

	"github.com/fsnotify/fsnotify"
)

func Start(targetDir string, triggerIntent func(fileName string, action string)) (*fsnotify.Watcher, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	go func() {
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}

				// 🛡️ QoL FIX: If a new folder is created (like git clone), watch it dynamically!
				if event.Op&fsnotify.Create == fsnotify.Create {
					info, err := os.Stat(event.Name)
					if err == nil && info.IsDir() {
						if info.Name() != "node_modules" && info.Name() != ".git" {
							watcher.Add(event.Name) // Track the new subfolder
						}
					}
				}

				if event.Op&(fsnotify.Create|fsnotify.Write|fsnotify.Remove|fsnotify.Rename) != 0 {
					// Ignore directory events for the intent trigger to reduce noise
					info, err := os.Stat(event.Name)
					if err == nil && !info.IsDir() {
						triggerIntent(event.Name, "MODIFIED")
					}
				}
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Println("Watcher error:", err)
			}
		}
	}()

	// 🛡️ QoL FIX: Ignore massive auto-generated folders
	ignoreDirs := map[string]bool{
		".git": true, "node_modules": true, "vendor": true,
		"dist": true, "build": true, ".next": true, "out": true,
		"coverage": true, "bin": true, "obj": true, ".idea": true, ".vscode": true,
	}

	// 🛡️ ARCHITECTURE FIX: Linux inotify Circuit Breaker
	watchCount := 0
	maxWatches := 8000

	err = filepath.Walk(targetDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if ignoreDirs[info.Name()] {
				if info.Name() == ".git" {
					watcher.Add(filepath.Join(path, "HEAD"))
				}
				return filepath.SkipDir
			}

			if watchCount >= maxWatches {
				log.Printf("⚠️ WARNING: Watch limit reached (%d). Skipping deeper directories to prevent OS crash.", maxWatches)
				return filepath.SkipDir // Circuit breaker tripped!
			}

			watcher.Add(path)
			watchCount++
		}
		return nil
	})

	log.Printf("SYSTEM: Successfully attached %d file watchers.", watchCount)
	return watcher, err
}
