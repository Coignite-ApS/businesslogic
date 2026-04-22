#!/bin/bash
# =============================================================================
# Claude Code Hook: Pre-Commit Schema Drift Check
# =============================================================================
# Warns (does not block) if snapshot.yaml is staged and there's drift.
# Exit 0 = allow, Exit 2 = block.
# =============================================================================

set -euo pipefail

if ! command -v jq &>/dev/null; then
  exit 0
fi

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Only intercept git commit
if ! echo "$COMMAND" | grep -qE '^\s*git\s+commit'; then
  exit 0
fi

# Check if snapshot.yaml is staged
STAGED_FILES=$(cd "$CWD" && git diff --cached --name-only 2>/dev/null || true)
if ! echo "$STAGED_FILES" | grep -q "snapshots/snapshot.yaml"; then
  exit 0
fi

# Check if Docker is running (skip if not)
COMPOSE="docker compose -f $CWD/infrastructure/docker/docker-compose.dev.yml"
if ! $COMPOSE exec -T postgres pg_isready -U directus -d directus &>/dev/null 2>&1; then
  echo "WARN: Snapshot staged but DB not running — skipping drift check" >&2
  exit 0
fi

# Run validation
if ! "$CWD/scripts/validate-schema.sh" --quiet 2>/dev/null; then
  echo "" >&2
  echo "WARNING: Schema drift detected while committing snapshot.yaml" >&2
  echo "Run: make validate-schema   for details" >&2
  echo "Committing anyway — but investigate the drift." >&2
  echo "" >&2
fi

exit 0
