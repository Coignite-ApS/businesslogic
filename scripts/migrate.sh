#!/bin/bash
# Run pending database migrations for all schemas
set -euo pipefail

DB_URL=${DATABASE_URL:-postgresql://directus:directus@localhost:5432/directus}
DRY_RUN=${DRY_RUN:-false}

echo "=== BusinessLogic Database Migrations ==="
echo "Target: $DB_URL"
echo "Dry run: $DRY_RUN"
echo ""

applied=0
failed=0

for schema_dir in migrations/*/; do
  [ -d "$schema_dir" ] || continue
  schema=$(basename "$schema_dir")

  echo "--- Schema: $schema ---"

  for migration in "$schema_dir"*.sql; do
    [ -f "$migration" ] || continue
    filename=$(basename "$migration")

    if [ "$DRY_RUN" = "true" ]; then
      echo "  [DRY RUN] Would apply: $filename"
    else
      echo "  Applying: $filename"
      if psql "$DB_URL" -f "$migration" 2>&1; then
        ((applied++))
        echo "  ✅ Applied: $filename"
      else
        ((failed++))
        echo "  ❌ Failed: $filename"
      fi
    fi
  done
done

echo ""
echo "Migrations complete. Applied: $applied, Failed: $failed"

if [ "$failed" -gt 0 ]; then
  echo "⚠️  Some migrations failed. Review errors above."
  exit 1
fi
