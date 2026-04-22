#!/bin/bash
# =============================================================================
# Schema Drift Detection — DB vs snapshot.yaml
# =============================================================================
# Compares Directus DB state against the canonical snapshot.yaml.
# Reports fields/tables missing in either direction.
# Exit 0 = no drift, Exit 1 = drift detected.
#
# Usage:
#   ./scripts/validate-schema.sh              # full check
#   ./scripts/validate-schema.sh --quiet      # exit code only
# =============================================================================

set -euo pipefail

COMPOSE="docker compose -f infrastructure/docker/docker-compose.dev.yml"
SNAPSHOT="services/cms/snapshots/snapshot.yaml"
QUIET=false

[[ "${1:-}" == "--quiet" ]] && QUIET=true

# Require running DB
if ! $COMPOSE exec -T postgres pg_isready -U directus -d directus &>/dev/null; then
  echo "ERROR: Postgres not running. Start with: make up" >&2
  exit 1
fi

# Require snapshot file
if [ ! -f "$SNAPSHOT" ]; then
  echo "ERROR: $SNAPSHOT not found" >&2
  exit 1
fi

DRIFT=false

# --- 1. Copy snapshot into container and dry-run apply ---
$COMPOSE cp "$SNAPSHOT" bl-cms:/directus/snapshots/_validate_check.yaml >/dev/null 2>&1

DIFF_OUTPUT=$($COMPOSE exec bl-cms node /directus/cli.js schema apply \
  --dry-run --yes /directus/snapshots/_validate_check.yaml 2>&1 | \
  grep -v "Update available" | grep -v "│" | grep -v "╭" | grep -v "╰" | \
  grep -v "DeprecationWarning" | grep -v "MaxListenersExceeded" | \
  grep -v "INFO:" | grep -v "^\s*$" || true)

# Clean up
$COMPOSE exec bl-cms rm -f /directus/snapshots/_validate_check.yaml >/dev/null 2>&1 || true

if echo "$DIFF_OUTPUT" | grep -qE "^\s+- (Create|Update|Delete) "; then
  DRIFT=true
  if [ "$QUIET" = false ]; then
    echo "DRIFT DETECTED: Snapshot vs DB mismatch"
    echo ""
    echo "$DIFF_OUTPUT"
    echo ""
  fi
fi

# --- 2. Check for DB columns without Directus metadata ---
NO_META=$($COMPOSE exec -T postgres psql -U directus -d directus -t -A -c "
  SELECT c.table_name || '.' || c.column_name
  FROM information_schema.columns c
  INNER JOIN directus_collections dc ON dc.collection = c.table_name
  LEFT JOIN directus_fields df ON df.collection = c.table_name AND df.field = c.column_name
  WHERE c.table_schema = 'public'
    AND c.table_name NOT LIKE 'directus_%'
    AND c.table_name NOT LIKE 'spatial_%'
    AND df.field IS NULL
    AND c.column_name NOT IN ('id')
  ORDER BY c.table_name, c.column_name;
" 2>/dev/null || true)

if [ -n "$NO_META" ]; then
  DRIFT=true
  if [ "$QUIET" = false ]; then
    echo "UNMANAGED COLUMNS (in DB but no Directus metadata):"
    echo "$NO_META" | sed 's/^/  - /'
    echo ""
  fi
fi

# --- 3. Check for public tables not in snapshot ---
SNAPSHOT_TABLES=$(grep "^  - collection:" "$SNAPSHOT" | sed 's/.*collection: //' | sort -u)
DB_TABLES=$($COMPOSE exec -T postgres psql -U directus -d directus -t -A -c "
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    AND table_name NOT LIKE 'directus_%'
    AND table_name NOT LIKE 'spatial_%'
  ORDER BY table_name;
" 2>/dev/null || true)

MISSING_IN_SNAPSHOT=$(comm -23 <(echo "$DB_TABLES" | sort) <(echo "$SNAPSHOT_TABLES" | sort) | grep -v '^$' || true)

if [ -n "$MISSING_IN_SNAPSHOT" ]; then
  # Only flag if these tables have directus_collections entries (managed by Directus)
  for tbl in $MISSING_IN_SNAPSHOT; do
    HAS_COLLECTION=$($COMPOSE exec -T postgres psql -U directus -d directus -t -A -c "
      SELECT COUNT(*) FROM directus_collections WHERE collection = '$tbl';
    " 2>/dev/null || echo "0")
    if [ "$HAS_COLLECTION" -gt 0 ] 2>/dev/null; then
      DRIFT=true
      if [ "$QUIET" = false ]; then
        echo "TABLE MISSING IN SNAPSHOT: $tbl (exists in DB + directus_collections)"
      fi
    fi
  done
fi

# --- Result ---
if [ "$DRIFT" = true ]; then
  [ "$QUIET" = false ] && echo "Schema validation FAILED — drift detected."
  exit 1
else
  [ "$QUIET" = false ] && echo "Schema validation PASSED — no drift."
  exit 0
fi
