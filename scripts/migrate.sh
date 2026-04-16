#!/bin/bash
# Run database migrations (forward or rollback) for all schemas
set -euo pipefail

DB_URL=${DATABASE_URL:-postgresql://directus:directus@localhost:5432/directus}
DRY_RUN=${DRY_RUN:-false}
ROLLBACK=false
TARGET_SCHEMA=""
TARGET_MIGRATION=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rollback)
      ROLLBACK=true
      shift
      ;;
    --schema)
      TARGET_SCHEMA="$2"
      shift 2
      ;;
    --migration)
      TARGET_MIGRATION="$2"
      shift 2
      ;;
    --target)
      case "$2" in
        local)
          DB_URL="postgresql://directus:directus@localhost:5432/directus"
          ;;
        *)
          DB_URL="$2"
          ;;
      esac
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      echo "Usage: migrate.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --rollback              Run rollback (down) migrations instead of forward"
      echo "  --schema <name>         Only run migrations for this schema (ai, formula, gateway, flow)"
      echo "  --migration <filename>  Only run a specific migration file (e.g., 005_retrieval_quality)"
      echo "  --target <local|URL>    Database target (default: local)"
      echo "  --dry-run               Show what would run without executing"
      echo "  --help                  Show this help"
      echo ""
      echo "Examples:"
      echo "  ./scripts/migrate.sh                                    # Apply all pending migrations"
      echo "  ./scripts/migrate.sh --rollback --schema ai             # Rollback all ai migrations (reverse order)"
      echo "  ./scripts/migrate.sh --rollback --migration 007         # Rollback migration matching '007'"
      echo "  ./scripts/migrate.sh --rollback --schema gateway --target local"
      echo "  ./scripts/migrate.sh --dry-run                          # Preview what would run"
      exit 0
      ;;
    *)
      echo "Unknown option: $1 (use --help)"
      exit 1
      ;;
  esac
done

if [ "$ROLLBACK" = "true" ]; then
  echo "=== BusinessLogic Database ROLLBACK ==="
else
  echo "=== BusinessLogic Database Migrations ==="
fi
echo "Target: $DB_URL"
echo "Dry run: $DRY_RUN"
echo ""

# Bootstrap: ensure gateway.schema_migrations exists before forward migrations
# Skip bootstrap in dry-run (no DB access needed) and during rollback
TRACKING_AVAILABLE=false
TRACKING_FILE="migrations/gateway/007_schema_migrations.sql"

if [ "$DRY_RUN" = "false" ] && [ "$ROLLBACK" = "false" ]; then
  table_exists=$(psql "$DB_URL" -tAc "SELECT to_regclass('gateway.schema_migrations')" 2>/dev/null || true)
  if [ "$table_exists" = "gateway.schema_migrations" ]; then
    TRACKING_AVAILABLE=true
  elif [ -f "$TRACKING_FILE" ]; then
    echo "Bootstrapping migration tracking table..."
    if psql "$DB_URL" -f "$TRACKING_FILE" 2>&1; then
      TRACKING_AVAILABLE=true
      echo "Tracking table created."
      echo ""
    else
      echo "WARNING: Could not create tracking table — running without state tracking"
    fi
  fi
elif [ "$DRY_RUN" = "false" ] && [ "$ROLLBACK" = "true" ]; then
  # During rollback, check if tracking table exists (may be rolled back itself)
  table_exists=$(psql "$DB_URL" -tAc "SELECT to_regclass('gateway.schema_migrations')" 2>/dev/null || true)
  if [ "$table_exists" = "gateway.schema_migrations" ]; then
    TRACKING_AVAILABLE=true
  fi
fi

# Helper: check if a migration is recorded in the tracking table
is_applied() {
  local schema="$1"
  local filename="$2"
  if [ "$TRACKING_AVAILABLE" = "false" ]; then
    return 1
  fi
  local result
  result=$(psql "$DB_URL" -tAc "SELECT 1 FROM gateway.schema_migrations WHERE schema_name=:'schema' AND filename=:'filename'" -v schema="$schema" -v filename="$filename" 2>/dev/null || true)
  [ "$result" = "1" ]
}

# Helper: record a migration as applied
record_applied() {
  local schema="$1"
  local filename="$2"
  if [ "$TRACKING_AVAILABLE" = "false" ]; then
    return 0
  fi
  psql "$DB_URL" -c "INSERT INTO gateway.schema_migrations (schema_name, filename) VALUES (:'schema', :'filename') ON CONFLICT DO NOTHING" -v schema="$schema" -v filename="$filename" 2>/dev/null || true
}

# Helper: remove a migration record (rollback)
record_removed() {
  local schema="$1"
  local filename="$2"
  if [ "$TRACKING_AVAILABLE" = "false" ]; then
    return 0
  fi
  # Table may have just been dropped — ignore errors
  psql "$DB_URL" -c "DELETE FROM gateway.schema_migrations WHERE schema_name=:'schema' AND filename=:'filename'" -v schema="$schema" -v filename="$filename" 2>/dev/null || true
}

applied=0
failed=0
skipped=0

for schema_dir in migrations/*/; do
  [ -d "$schema_dir" ] || continue
  schema=$(basename "$schema_dir")

  # Filter by schema if specified
  if [ -n "$TARGET_SCHEMA" ] && [ "$schema" != "$TARGET_SCHEMA" ]; then
    continue
  fi

  echo "--- Schema: $schema ---"

  if [ "$ROLLBACK" = "true" ]; then
    # Collect down migrations, apply in REVERSE order
    down_files=()
    for migration in "$schema_dir"*_down.sql; do
      [ -f "$migration" ] || continue
      filename=$(basename "$migration")

      # Filter by specific migration if specified
      if [ -n "$TARGET_MIGRATION" ] && [[ "$filename" != *"$TARGET_MIGRATION"* ]]; then
        continue
      fi

      down_files+=("$migration")
    done

    # Reverse the array for rollback order (newest first)
    reversed=()
    for ((i=${#down_files[@]}-1; i>=0; i--)); do
      reversed+=("${down_files[$i]}")
    done

    if [ ${#reversed[@]} -eq 0 ]; then
      echo "  (no rollback files matched)"
      continue
    fi

    for migration in "${reversed[@]}"; do
      filename=$(basename "$migration")
      # Derive the forward migration filename for tracking lookup
      forward_filename="${filename/_down.sql/.sql}"

      if [ "$DRY_RUN" = "true" ]; then
        echo "  [DRY RUN] Would rollback: $filename"
        ((skipped++))
      else
        # Skip if not recorded as applied (except 007 which tracks itself)
        if [ "$TRACKING_AVAILABLE" = "true" ] && [[ "$forward_filename" != "007_schema_migrations.sql" ]]; then
          if ! is_applied "$schema" "$forward_filename"; then
            echo "  Not applied, skipping: $filename"
            ((skipped++))
            continue
          fi
        fi

        echo "  Rolling back: $filename"
        if psql "$DB_URL" -f "$migration" 2>&1; then
          ((applied++))
          echo "  Rolled back: $filename"
          # Remove record — for 007 itself, table is now gone so this is a no-op
          record_removed "$schema" "$forward_filename"
          # If we just rolled back the tracking table, mark it unavailable
          if [[ "$forward_filename" == "007_schema_migrations.sql" ]]; then
            TRACKING_AVAILABLE=false
          fi
        else
          ((failed++))
          echo "  FAILED rollback: $filename"
        fi
      fi
    done
  else
    # Forward migrations — skip _down.sql files
    for migration in "$schema_dir"*.sql; do
      [ -f "$migration" ] || continue
      filename=$(basename "$migration")

      # Skip rollback files during forward migration
      if [[ "$filename" == *_down.sql ]]; then
        continue
      fi

      # Skip 007_schema_migrations.sql — already handled by bootstrap
      if [ "$filename" = "007_schema_migrations.sql" ] && [ "$schema" = "gateway" ]; then
        if [ "$DRY_RUN" = "false" ]; then
          # Bootstrap already applied it; just ensure it's recorded
          record_applied "$schema" "$filename"
          echo "  Already bootstrapped: $filename"
          ((skipped++))
          continue
        fi
      fi

      # Filter by specific migration if specified
      if [ -n "$TARGET_MIGRATION" ] && [[ "$filename" != *"$TARGET_MIGRATION"* ]]; then
        continue
      fi

      if [ "$DRY_RUN" = "true" ]; then
        echo "  [DRY RUN] Would apply: $filename"
        ((skipped++))
      else
        # Check if already applied
        if [ "$TRACKING_AVAILABLE" = "true" ] && is_applied "$schema" "$filename"; then
          echo "  Already applied: $filename"
          ((skipped++))
          continue
        fi

        echo "  Applying: $filename"
        if psql "$DB_URL" -f "$migration" 2>&1; then
          ((applied++))
          echo "  Applied: $filename"
          record_applied "$schema" "$filename"
        else
          ((failed++))
          echo "  Failed: $filename"
        fi
      fi
    done
  fi
done

echo ""
if [ "$ROLLBACK" = "true" ]; then
  echo "Rollback complete. Rolled back: $applied, Failed: $failed, Skipped: $skipped"
else
  echo "Migrations complete. Applied: $applied, Failed: $failed, Skipped: $skipped"
fi

if [ "$failed" -gt 0 ]; then
  echo "WARNING: Some operations failed. Review errors above."
  exit 1
fi
