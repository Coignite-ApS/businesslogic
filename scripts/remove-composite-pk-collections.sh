#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
LOG="docs/reports/db-admin-remove-composite-pk-apply.log"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --log)     LOG="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

source "$(dirname "$0")/_directus-common.sh"

TARGETS=(monthly_aggregates api_key_usage)

mkdir -p "$(dirname "$LOG")"
echo "# remove-composite-pk-collections @ $(date -u +%FT%TZ)${DRY_RUN:+ (DRY-RUN)}" | tee -a "$LOG"

# =============================================================================
# PREFLIGHT SAFETY GATES — abort on any deviation
# =============================================================================

echo "--- preflight: target collections in directus_collections ---" | tee -a "$LOG"
for c in "${TARGETS[@]}"; do
  n=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM directus_collections WHERE collection='$c';")
  echo "  $c: $n row(s)" | tee -a "$LOG"
done

echo "" | tee -a "$LOG"
echo "--- preflight: ghost directus_fields rows ---" | tee -a "$LOG"
for c in "${TARGETS[@]}"; do
  n=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM directus_fields WHERE collection='$c';")
  echo "  $c: $n field row(s)" | tee -a "$LOG"
done

echo "" | tee -a "$LOG"
echo "--- preflight: verify PG tables EXIST and have row counts ---" | tee -a "$LOG"
for c in "${TARGETS[@]}"; do
  n=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM pg_class WHERE relname='$c' AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public') AND relkind='r';")
  if [[ "$n" != "1" ]]; then
    echo "  $c: pg table MISSING — ABORT (expected relkind='r' in public schema)" | tee -a "$LOG" >&2
    exit 1
  fi
  rows=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM public.$c;")
  echo "  $c: pg table present with $rows row(s)" | tee -a "$LOG"
done

echo "" | tee -a "$LOG"
echo "--- preflight: verify no directus_relations reference these collections ---" | tee -a "$LOG"
for c in "${TARGETS[@]}"; do
  n=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM directus_relations WHERE many_collection='$c' OR one_collection='$c';")
  if [[ "$n" != "0" ]]; then
    echo "  $c: $n relation(s) reference this — MUST remove first — ABORT" | tee -a "$LOG" >&2
    exit 1
  fi
  echo "  $c: 0 referencing relations ✓" | tee -a "$LOG"
done

# =============================================================================
# DRY-RUN: report what would be deleted, stop here
# =============================================================================

if [[ "$DRY_RUN" == "1" ]]; then
  echo "" | tee -a "$LOG"
  echo "--- DRY-RUN: no deletes performed ---" | tee -a "$LOG"
  exit 0
fi

# =============================================================================
# APPLY — all DELETEs in a single transaction
# =============================================================================

echo "" | tee -a "$LOG"
echo "--- applying deletes (single transaction) ---" | tee -a "$LOG"

err=$(mktemp); trap 'rm -f "$err"' EXIT

if psql_cmd -v ON_ERROR_STOP=1 2>"$err" <<'SQL' | tee -a "$LOG"
BEGIN;

-- Remove ghost field metadata rows
DELETE FROM directus_fields WHERE collection IN ('monthly_aggregates', 'api_key_usage');

-- Remove from directus_collections (Directus stops trying to load them)
DELETE FROM directus_collections WHERE collection IN ('monthly_aggregates', 'api_key_usage');

-- Defensive: drop any permissions rows (should be 0 for these collections)
DELETE FROM directus_permissions WHERE collection IN ('monthly_aggregates', 'api_key_usage');

COMMIT;

-- Assertions after commit
SELECT 'directus_collections remaining: ' ||
       COUNT(*) FILTER (WHERE collection = 'monthly_aggregates') ||
       ' monthly_aggregates, ' ||
       COUNT(*) FILTER (WHERE collection = 'api_key_usage') ||
       ' api_key_usage'
FROM directus_collections;

SELECT 'directus_fields remaining: ' ||
       COUNT(*) FILTER (WHERE collection = 'monthly_aggregates') ||
       ' monthly_aggregates, ' ||
       COUNT(*) FILTER (WHERE collection = 'api_key_usage') ||
       ' api_key_usage'
FROM directus_fields;

SELECT 'pg_class ' || relname || ' still present' FROM pg_class
WHERE relname IN ('monthly_aggregates', 'api_key_usage')
  AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND relkind = 'r';
SQL
then
  echo "--- DELETE transaction succeeded ---" | tee -a "$LOG"
else
  echo "--- DELETE transaction FAILED ---" | tee -a "$LOG" >&2
  sed 's/^/       /' "$err" | tee -a "$LOG" >&2
  exit 1
fi

# Clear Directus schema cache so the running service stops serving stale collection list
TOKEN="$(directus_auth)"
directus_cache_clear "$TOKEN" | tee -a "$LOG"

echo "--- phase-2 done ---" | tee -a "$LOG"
