package githook

import (
	"log"
	"os"
	"path/filepath"
	"strings"
)

func InstallHook(repoRoot string) {
	hookPath := filepath.Join(repoRoot, ".git", "hooks", "prepare-commit-msg")

	// Our payload, clearly marked so we don't inject it twice
	hookPayload := `
# --- T.R.O.N. AUTOMATED TASK TRACKER ---
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
# ---------------------------------------
`
	content, err := os.ReadFile(hookPath)
	if err == nil {
		// File already exists! Check if we already injected our code.
		if strings.Contains(string(content), "T.R.O.N. AUTOMATED TASK TRACKER") {
			return
		}
		// Safely append to the existing hook
		f, err := os.OpenFile(hookPath, os.O_APPEND|os.O_WRONLY, 0755)
		if err == nil {
			defer f.Close()
			f.WriteString("\n" + hookPayload)
			log.Printf("SYSTEM: Safely appended hook alongside existing hooks in %s", repoRoot)
		}
	} else {
		// File doesn't exist, create it from scratch
		fullScript := "#!/bin/bash\n" + hookPayload

		// 🛡️ QoL FIX: Force Linux line-endings (LF) so Git Bash on Windows doesn't crash!
		safeScript := strings.ReplaceAll(fullScript, "\r\n", "\n")

		err := os.WriteFile(hookPath, []byte(safeScript), 0755)
		if err != nil {
			log.Printf("Warning: Failed to install Git hook: %v", err)
		} else {
			log.Printf("SYSTEM: Hook created from scratch in %s", repoRoot)
		}
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
