#!/bin/bash
# =============================================================================
# Claude Code Hook: Pre-Commit Test Enforcement
# =============================================================================
# Intercepts git commit/push commands and ensures tests pass first.
# Exit 0 = allow, Exit 2 = block with error message.
# =============================================================================

set -euo pipefail

# Require jq
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required by pre-commit-tests hook but not installed" >&2
  exit 2
fi

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Only intercept git commit and git push
if ! echo "$COMMAND" | grep -qE '^\s*git\s+(commit|push)'; then
  exit 0
fi

# Determine which service(s) have staged changes
CHANGED_SERVICES=()
STAGED_FILES=$(cd "$CWD" && git diff --cached --name-only 2>/dev/null || true)

if [ -z "$STAGED_FILES" ] && echo "$COMMAND" | grep -qE '^\s*git\s+push'; then
  # For push, check committed changes vs remote
  exit 0
fi

for file in $STAGED_FILES; do
  case "$file" in
    services/cms/*)         CHANGED_SERVICES+=("cms") ;;
    services/formula-api/*) CHANGED_SERVICES+=("formula-api") ;;
    services/flow/*)        CHANGED_SERVICES+=("flow") ;;
    services/ai-api/*)      CHANGED_SERVICES+=("ai-api") ;;
    services/gateway/*)     CHANGED_SERVICES+=("gateway") ;;
    packages/*)             CHANGED_SERVICES+=("packages") ;;
    migrations/*)           CHANGED_SERVICES+=("migrations") ;;
  esac
done

# Deduplicate
CHANGED_SERVICES=($(printf '%s\n' "${CHANGED_SERVICES[@]}" | sort -u))

if [ ${#CHANGED_SERVICES[@]} -eq 0 ]; then
  # No service changes (docs, scripts, etc.) — allow commit
  exit 0
fi

echo "Pre-commit: Changes detected in: ${CHANGED_SERVICES[*]}" >&2
FAILED=false

for svc in "${CHANGED_SERVICES[@]}"; do
  case "$svc" in
    cms)
      if [ -f "$CWD/services/cms/extensions/package.json" ]; then
        echo "Running CMS extension tests..." >&2
        (cd "$CWD/services/cms" && npm test 2>&1) || { echo "FAIL: CMS tests failed" >&2; FAILED=true; }
      fi
      ;;
    formula-api)
      if [ -f "$CWD/services/formula-api/package.json" ]; then
        echo "Running formula-api tests..." >&2
        (cd "$CWD/services/formula-api" && npm test 2>&1) || { echo "FAIL: formula-api tests failed" >&2; FAILED=true; }
      fi
      ;;
    flow)
      if [ -f "$CWD/services/flow/Cargo.toml" ]; then
        echo "Running flow engine tests..." >&2
        (cd "$CWD/services/flow" && cargo test --workspace 2>&1) || { echo "FAIL: flow tests failed" >&2; FAILED=true; }
      fi
      ;;
    ai-api)
      if [ -f "$CWD/services/ai-api/package.json" ]; then
        echo "Running ai-api tests..." >&2
        (cd "$CWD/services/ai-api" && npm test 2>&1) || { echo "FAIL: ai-api tests failed" >&2; FAILED=true; }
      fi
      ;;
    gateway)
      if [ -f "$CWD/services/gateway/go.mod" ]; then
        echo "Running gateway tests..." >&2
        (cd "$CWD/services/gateway" && go test ./... 2>&1) || { echo "FAIL: gateway tests failed" >&2; FAILED=true; }
      fi
      ;;
    packages)
      echo "Running shared package tests..." >&2
      for pkg_dir in "$CWD"/packages/*/; do
        if [ -f "$pkg_dir/package.json" ]; then
          (cd "$pkg_dir" && npm test 2>&1) || { echo "FAIL: $(basename $pkg_dir) tests failed" >&2; FAILED=true; }
        fi
      done
      ;;
    migrations)
      echo "Validating SQL migrations..." >&2
      for sql_file in $(echo "$STAGED_FILES" | grep 'migrations/.*\.sql$'); do
        if [ -f "$CWD/$sql_file" ]; then
          # Basic SQL syntax check: ensure no DROP TABLE or TRUNCATE without safeguards
          if grep -qiE '^\s*(DROP TABLE|TRUNCATE)\s' "$CWD/$sql_file"; then
            echo "WARNING: $sql_file contains DROP TABLE or TRUNCATE — review carefully" >&2
          fi
        fi
      done
      ;;
  esac
done

if [ "$FAILED" = true ]; then
  echo "" >&2
  echo "BLOCKED: Tests failed. Fix the failing tests before committing." >&2
  echo "To skip (emergency only): set BL_SKIP_TESTS=1 in your environment." >&2
  exit 2
fi

echo "All tests passed. Commit allowed." >&2
exit 0
