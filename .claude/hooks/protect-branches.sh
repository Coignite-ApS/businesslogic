#!/bin/bash
# =============================================================================
# Claude Code Hook: Branch Protection
# =============================================================================
# Prevents direct commits to main/master. Enforces branching strategy:
#   main     — protected, only merges via PR
#   dev      — integration branch, merge feature branches here
#   feature/ — per-task branches: iteration/00-foundation, feat/*, fix/*, etc.
# =============================================================================

set -euo pipefail

# Require jq
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required by protect-branches hook but not installed" >&2
  exit 2
fi

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Only check git commit and git push
if ! echo "$COMMAND" | grep -qE '^\s*git\s+(commit|push)'; then
  exit 0
fi

CURRENT_BRANCH=$(cd "$CWD" && git branch --show-current 2>/dev/null || echo "unknown")

# Block direct commits to main/master
if echo "$COMMAND" | grep -qE '^\s*git\s+commit' && [[ "$CURRENT_BRANCH" =~ ^(main|master)$ ]]; then
  echo "BLOCKED: Direct commits to '$CURRENT_BRANCH' are not allowed." >&2
  echo "" >&2
  echo "Branching strategy:" >&2
  echo "  1. Create a feature branch: git checkout -b iteration/00-foundation dev" >&2
  echo "  2. Make your changes and commit there" >&2
  echo "  3. Merge to dev: git checkout dev && git merge iteration/00-foundation" >&2
  echo "  4. PR from dev to main when iteration is complete" >&2
  exit 2
fi

# Block direct push to main/master (except via PR)
# Matches: git push origin main, git push origin main:main, git push -f origin main
if echo "$COMMAND" | grep -qE '^\s*git\s+push.*(main|master)(:|$|[[:space:]])'; then
  echo "BLOCKED: Direct push to main/master is not allowed." >&2
  echo "Use 'gh pr create' to create a pull request from dev to main." >&2
  exit 2
fi

exit 0
