#!/usr/bin/env bash
# =============================================================================
# DB Baseline — capture row count and (optionally) per-column fingerprint
# =============================================================================
# Used by db-admin Phase 4.5 (pre-apply baseline) and Phase 6.5 (post-apply check).
# Output is psql expanded format — copy-paste directly into the WIP file.
#
# Usage:
#   TABLE=schema.table ./scripts/db-baseline.sh
#   TABLE=schema.table COL=column_name ./scripts/db-baseline.sh
#   TABLE=schema.table COL=column_name ID_COL=primary_key ./scripts/db-baseline.sh
#
# Or via Makefile:
#   make data-baseline TABLE=cms.calculators
#   make data-baseline TABLE=cms.calculators COL=name
#   make data-baseline TABLE=cms.calculators COL=name ID_COL=id
#
# Defaults:
#   ID_COL=id   (most Directus tables use 'id'; junction tables may differ)
#
# Output (no COL): table, rows
# Output (with COL): table, rows, non_null, min_v, max_v, content_hash (MD5)
# =============================================================================

set -euo pipefail

TABLE="${TABLE:-${1:-}}"
COL="${COL:-${2:-}}"
ID_COL="${ID_COL:-id}"

if [ -z "$TABLE" ]; then
  echo "ERROR: TABLE=<schema.table> required" >&2
  echo "  Usage: TABLE=cms.calculators [COL=name] [ID_COL=id] $0" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/infrastructure/docker/docker-compose.dev.yml"

# Validate identifier-like inputs (defense against SQL injection via env vars)
valid_id() { [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_.]*$ ]]; }
valid_id "$TABLE"  || { echo "ERROR: TABLE has invalid characters: $TABLE" >&2; exit 1; }
if [ -n "$COL" ]; then
  valid_id "$COL"     || { echo "ERROR: COL has invalid characters: $COL" >&2; exit 1; }
  valid_id "$ID_COL"  || { echo "ERROR: ID_COL has invalid characters: $ID_COL" >&2; exit 1; }
fi

if [ -n "$COL" ]; then
  SQL="SELECT
  '$TABLE' AS \"table\",
  COUNT(*) AS \"rows\",
  COUNT(\"$COL\") AS \"non_null\",
  MIN(\"$COL\"::text) AS \"min_v\",
  MAX(\"$COL\"::text) AS \"max_v\",
  MD5(STRING_AGG(COALESCE(\"$COL\"::text,''), ',' ORDER BY \"$ID_COL\")) AS \"content_hash\"
FROM $TABLE;"
else
  SQL="SELECT '$TABLE' AS \"table\", COUNT(*) AS \"rows\" FROM $TABLE;"
fi

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U directus -d directus -x -P pager=off -c "$SQL"
