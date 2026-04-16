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
      if [ "$DRY_RUN" = "true" ]; then
        echo "  [DRY RUN] Would rollback: $filename"
        ((skipped++))
      else
        echo "  Rolling back: $filename"
        if psql "$DB_URL" -f "$migration" 2>&1; then
          ((applied++))
          echo "  Rolled back: $filename"
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

      # Filter by specific migration if specified
      if [ -n "$TARGET_MIGRATION" ] && [[ "$filename" != *"$TARGET_MIGRATION"* ]]; then
        continue
      fi

      if [ "$DRY_RUN" = "true" ]; then
        echo "  [DRY RUN] Would apply: $filename"
        ((skipped++))
      else
        echo "  Applying: $filename"
        if psql "$DB_URL" -f "$migration" 2>&1; then
          ((applied++))
          echo "  Applied: $filename"
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
  echo "Rollback complete. Rolled back: $applied, Failed: $failed, Skipped (dry-run): $skipped"
else
  echo "Migrations complete. Applied: $applied, Failed: $failed, Skipped (dry-run): $skipped"
fi

if [ "$failed" -gt 0 ]; then
  echo "WARNING: Some operations failed. Review errors above."
  exit 1
fi
