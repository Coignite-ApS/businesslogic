#!/bin/bash
# =============================================================================
# Claude Code Hook: Post-Commit Task Evaluation
# =============================================================================
# After a successful git commit, checks if any in-progress tasks are now done
# by evaluating checked/unchecked boxes in the task doc.
# Outputs guidance for Claude to update task status.
# =============================================================================

set -euo pipefail

if ! command -v jq &>/dev/null; then
  exit 0
fi

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Only run after git commit (not push, not other git commands)
if ! echo "$COMMAND" | grep -qE '^\s*git\s+commit'; then
  exit 0
fi

TASKS_README="$CWD/docs/tasks/README.md"
if [ ! -f "$TASKS_README" ]; then
  exit 0
fi

# Find in-progress tasks
IN_PROGRESS=$(grep '| in-progress |' "$TASKS_README" 2>/dev/null || true)
if [ -z "$IN_PROGRESS" ]; then
  exit 0
fi

UPDATES_NEEDED=false

while IFS= read -r line; do
  # Extract doc path from markdown link: [path](path)
  DOC_REL=$(echo "$line" | sed -n 's/.*(\([^)]*\.md\)).*/\1/p' | head -1)
  if [ -z "$DOC_REL" ]; then
    continue
  fi

  DOC_PATH="$CWD/docs/tasks/$DOC_REL"
  if [ ! -f "$DOC_PATH" ]; then
    continue
  fi

  # Count checkboxes in Key Tasks section
  IN_KEY_TASKS=false
  TOTAL=0
  CHECKED=0

  while IFS= read -r docline; do
    # Detect Key Tasks section
    if echo "$docline" | grep -qE '^## Key Tasks'; then
      IN_KEY_TASKS=true
      continue
    fi
    # Stop at next section
    if $IN_KEY_TASKS && echo "$docline" | grep -qE '^## '; then
      break
    fi
    if $IN_KEY_TASKS; then
      if echo "$docline" | grep -qE '^[[:space:]]*- \['; then
        TOTAL=$((TOTAL + 1))
        if echo "$docline" | grep -qE '^[[:space:]]*- \[x\]'; then
          CHECKED=$((CHECKED + 1))
        fi
      fi
    fi
  done < "$DOC_PATH"

  if [ "$TOTAL" -gt 0 ] && [ "$CHECKED" -eq "$TOTAL" ]; then
    # Extract task name from the table row
    TASK_NAME=$(echo "$line" | sed 's/.*| \([^|]*\) | in-progress.*/\1/' | xargs)
    echo "TASK COMPLETED: $DOC_REL — all $TOTAL/$TOTAL key tasks checked."
    echo "→ Update status to 'completed' in both $DOC_REL and docs/tasks/README.md"
    echo "→ Update the totals table in README.md"
    UPDATES_NEEDED=true
  elif [ "$TOTAL" -gt 0 ]; then
    TASK_NAME=$(echo "$line" | sed 's/.*| \([^|]*\) | in-progress.*/\1/' | xargs)
    echo "TASK PROGRESS: $DOC_REL — $CHECKED/$TOTAL key tasks checked."
  fi
done <<< "$IN_PROGRESS"

if $UPDATES_NEEDED; then
  echo ""
  echo "ACTION REQUIRED: Update the task statuses above. Mark completed tasks as 'completed' in the task doc and README."
fi

exit 0
