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
				if event.Op&(fsnotify.Create|fsnotify.Write|fsnotify.Remove|fsnotify.Rename) != 0 {
					action := "MODIFIED"
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

	err = filepath.Walk(targetDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if info.Name() == ".git" {
				// Watch HEAD for branch changes, but ignore the rest of the noisy .git folder
				watcher.Add(filepath.Join(path, "HEAD"))
				return filepath.SkipDir
			}
			if info.Name() == "node_modules" || info.Name() == "vendor" {
				return filepath.SkipDir
			}
			watcher.Add(path)
		}
		return nil
	})

	return watcher, err
}
