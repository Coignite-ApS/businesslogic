#!/bin/bash
# =============================================================================
# Claude Code Hook: Pre-Commit Documentation Check
# =============================================================================
# Intercepts git commit and warns if service code changed but no task doc
# was updated in the same commit. This ensures functionality changes are
# documented before they're committed.
# Exit 0 = allow (with warning), Exit 2 = block.
# =============================================================================

set -euo pipefail

if ! command -v jq &>/dev/null; then
  exit 0
fi

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Only intercept git commit (not push, not other git commands)
if ! echo "$COMMAND" | grep -qE '^\s*git\s+commit'; then
  exit 0
fi

# Skip if commit message indicates docs/chore-only change
if echo "$COMMAND" | grep -qE '(docs|chore|style|ci|refactor)\('; then
  exit 0
fi

STAGED_FILES=$(cd "$CWD" && git diff --cached --name-only 2>/dev/null || true)
if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# Check if service code is being changed
HAS_SERVICE_CODE=false
HAS_DOC_UPDATE=false

for file in $STAGED_FILES; do
  case "$file" in
    services/cms/extensions/*/src/*|services/formula-api/src/*|services/flow/src/*|services/ai-api/src/*|services/gateway/*.go)
      HAS_SERVICE_CODE=true
      ;;
    docs/tasks/*|docs/*)
      HAS_DOC_UPDATE=true
      ;;
  esac
done

if [ "$HAS_SERVICE_CODE" = true ] && [ "$HAS_DOC_UPDATE" = false ]; then
  echo "" >&2
  echo "⚠ DOCS REMINDER: Service code changed but no docs/tasks/ files are staged." >&2
  echo "  If this commit implements a task, update the task doc with:" >&2
  echo "    - What was changed and why" >&2
  echo "    - Verification results" >&2
  echo "    - Status update (planned → completed)" >&2
  echo "  If this is a minor fix, ignore this warning." >&2
  echo "" >&2
fi

# Always allow — this is a reminder, not a blocker
exit 0
