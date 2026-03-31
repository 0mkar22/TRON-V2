package githook

import (
	"log"
	"os"
	"path/filepath"
)

func InstallHook(repoRoot string) {
	hookPath := filepath.Join(repoRoot, ".git", "hooks", "prepare-commit-msg")
	if _, err := os.Stat(hookPath); err == nil {
		return
	}

	hookScript := `#!/bin/bash
TASK_FILE=".git/tron_task"
COMMIT_MSG_FILE=$1

if [ -f "$TASK_FILE" ]; then
    TASK_ID=$(cat "$TASK_FILE")
    if [ -n "$TASK_ID" ]; then
        if ! grep -q "\[$TASK_ID\]" "$COMMIT_MSG_FILE"; then
            echo "[$TASK_ID] $(cat $COMMIT_MSG_FILE)" > "$COMMIT_MSG_FILE"
        fi
    fi
fi
`
	err := os.WriteFile(hookPath, []byte(hookScript), 0755)
	if err != nil {
		log.Printf("Warning: Failed to install Git hook in %s: %v", repoRoot, err)
	} else {
		log.Printf("SYSTEM: Hook installed in %s", repoRoot)
	}
}

func WriteTaskState(repoRoot string, taskID string) {
	stateFile := filepath.Join(repoRoot, ".git", "tron_task")
	_ = os.WriteFile(stateFile, []byte(taskID), 0644)
}

func ClearTaskState(repoRoot string) {
	stateFile := filepath.Join(repoRoot, ".git", "tron_task")
	_ = os.Remove(stateFile)
}
