#!/bin/bash
# SessionStart hook — gathers project status for Claude's greeting
# Output is injected as context at the start of a new conversation

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

echo "=== BUSINESSLOGIC PROJECT STATUS ==="

# Git info
BRANCH=$(git branch --show-current 2>/dev/null)
LAST_COMMIT=$(git log --oneline -1 2>/dev/null)
echo "Branch: ${BRANCH:-unknown}"
echo "Last commit: ${LAST_COMMIT:-none}"

# Improvements status from README
if [ -f "docs/tasks/README.md" ]; then
  COMPLETED=$(grep -c '| completed |' docs/tasks/README.md 2>/dev/null) || COMPLETED=0
  IN_PROGRESS=$(grep -c '| in-progress |' docs/tasks/README.md 2>/dev/null) || IN_PROGRESS=0
  PLANNED=$(grep -c '| planned |' docs/tasks/README.md 2>/dev/null) || PLANNED=0
  BLOCKED=$(grep -c '| blocked |' docs/tasks/README.md 2>/dev/null) || BLOCKED=0
  TOTAL=$((COMPLETED + IN_PROGRESS + PLANNED + BLOCKED))
  echo "Tasks: ${COMPLETED}/${TOTAL} completed | ${IN_PROGRESS} in-progress | ${PLANNED} planned | ${BLOCKED} blocked"

  # Highlight in-progress items
  if [ "$IN_PROGRESS" -gt 0 ]; then
    echo ""
    echo "IN-PROGRESS:"
    grep '| in-progress |' docs/tasks/README.md 2>/dev/null | sed 's/^/  /'
  fi

  # Flag blocked items
  if [ "$BLOCKED" -gt 0 ]; then
    echo ""
    echo "BLOCKED:"
    grep '| blocked |' docs/tasks/README.md 2>/dev/null | sed 's/^/  /'
  fi
fi

echo ""
echo "Use this data to greet the user following the instructions in CLAUDE.md."
