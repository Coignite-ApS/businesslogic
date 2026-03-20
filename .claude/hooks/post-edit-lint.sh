#!/bin/bash
# =============================================================================
# Claude Code Hook: Post-Edit Lint & Format
# =============================================================================
# After file edits, runs service-specific linting/formatting.
# PostToolUse hook — non-blocking (exit 0 always).
# =============================================================================

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || echo "")
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || echo "")

# Skip if no file path or jq not available
[ -z "$FILE_PATH" ] && exit 0

# Determine which service the file belongs to and lint/format
case "$FILE_PATH" in
  */services/formula-api/*.js|*/services/formula-api/*.ts)
    if command -v npx &>/dev/null && ls "$CWD"/services/formula-api/.eslintrc* &>/dev/null; then
      npx eslint --fix "$FILE_PATH" 2>/dev/null || true
    fi
    ;;
  */services/ai-api/*.js|*/services/ai-api/*.ts)
    if command -v npx &>/dev/null && ls "$CWD"/services/ai-api/.eslintrc* &>/dev/null; then
      npx eslint --fix "$FILE_PATH" 2>/dev/null || true
    fi
    ;;
  */services/flow/*.rs)
    if command -v cargo &>/dev/null; then
      cargo fmt --manifest-path "$CWD/services/flow/Cargo.toml" -- "$FILE_PATH" 2>/dev/null || true
    fi
    ;;
  */services/gateway/*.go)
    if command -v gofmt &>/dev/null; then
      gofmt -w "$FILE_PATH" 2>/dev/null || true
    fi
    ;;
esac

exit 0
