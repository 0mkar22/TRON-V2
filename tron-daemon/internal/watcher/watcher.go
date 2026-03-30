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

				isCreate := event.Op&fsnotify.Create == fsnotify.Create
				isWrite := event.Op&fsnotify.Write == fsnotify.Write
				isRemove := event.Op&fsnotify.Remove == fsnotify.Remove
				isRename := event.Op&fsnotify.Rename == fsnotify.Rename

				if isCreate || isWrite || isRemove || isRename {
					action := "UPDATED"
					if isCreate {
						action = "CREATED"
					} else if isRemove || isRename {
						action = "DELETED/MOVED"
					}
					triggerIntent(event.Name, action)
				}

			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Println("Watcher error:", err)
			}
		}
	}()

	gitHeadPath := filepath.Join(targetDir, ".git", "HEAD")
	err = watcher.Add(gitHeadPath)
	if err != nil {
		log.Printf("Note: Could not attach to .git/HEAD. Is this a git repo? Error: %v", err)
	}

	err = filepath.Walk(targetDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if info.Name() == ".git" || info.Name() == "node_modules" || info.Name() == "vendor" {
				return filepath.SkipDir
			}
			err = watcher.Add(path)
			if err != nil {
				log.Printf("Failed to watch directory %s: %v", path, err)
			}
		}
		return nil
	})

	if err != nil {
		watcher.Close()
		return nil, err
	}

	return watcher, nil
}
