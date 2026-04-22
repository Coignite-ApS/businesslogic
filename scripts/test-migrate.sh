#!/bin/bash
# Test suite for migrate.sh — syntax and dry-run checks (no live DB required)
set -euo pipefail

PASS=0
FAIL=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

echo "=== migrate.sh test suite ==="
echo ""

# 1. migrate.sh is executable
echo "-- Executability --"
if [ -x "$SCRIPT_DIR/migrate.sh" ]; then
  pass "migrate.sh is executable"
else
  fail "migrate.sh is not executable"
fi

# 2. Migration files exist
echo ""
echo "-- Migration file existence --"
for f in \
  "migrations/gateway/007_schema_migrations.sql" \
  "migrations/gateway/007_schema_migrations_down.sql"; do
  if [ -f "$PROJECT_ROOT/$f" ]; then
    pass "$f exists"
  else
    fail "$f missing"
  fi
done

# 3. SQL syntax check — 007_schema_migrations.sql must contain expected DDL
echo ""
echo "-- SQL content checks --"
if grep -q "CREATE TABLE IF NOT EXISTS gateway.schema_migrations" "$PROJECT_ROOT/migrations/gateway/007_schema_migrations.sql"; then
  pass "007_schema_migrations.sql contains CREATE TABLE"
else
  fail "007_schema_migrations.sql missing CREATE TABLE"
fi

if grep -q "UNIQUE(schema_name, filename)" "$PROJECT_ROOT/migrations/gateway/007_schema_migrations.sql"; then
  pass "007_schema_migrations.sql has UNIQUE constraint"
else
  fail "007_schema_migrations.sql missing UNIQUE constraint"
fi

if grep -q "DROP TABLE IF EXISTS gateway.schema_migrations" "$PROJECT_ROOT/migrations/gateway/007_schema_migrations_down.sql"; then
  pass "007_schema_migrations_down.sql contains DROP TABLE"
else
  fail "007_schema_migrations_down.sql missing DROP TABLE"
fi

# 4. migrate.sh bash syntax check
echo ""
echo "-- Bash syntax --"
if bash -n "$SCRIPT_DIR/migrate.sh" 2>&1; then
  pass "migrate.sh passes bash -n syntax check"
else
  fail "migrate.sh has bash syntax errors"
fi

# 5. Dry-run forward (no DB required)
echo ""
echo "-- Dry-run forward --"
cd "$PROJECT_ROOT"
output=$(DRY_RUN=true bash "$SCRIPT_DIR/migrate.sh" --dry-run 2>&1)
if echo "$output" | grep -q "\[DRY RUN\] Would apply:"; then
  pass "dry-run forward prints migration files"
else
  fail "dry-run forward produced no output"
fi
if echo "$output" | grep -q "007_schema_migrations.sql"; then
  pass "dry-run lists 007_schema_migrations.sql"
else
  fail "dry-run missing 007_schema_migrations.sql"
fi

# 6. Dry-run rollback
echo ""
echo "-- Dry-run rollback --"
output=$(DRY_RUN=true bash "$SCRIPT_DIR/migrate.sh" --rollback --dry-run 2>&1)
if echo "$output" | grep -q "\[DRY RUN\] Would rollback:"; then
  pass "dry-run rollback prints down migration files"
else
  fail "dry-run rollback produced no output"
fi

# 7. --help exits cleanly
echo ""
echo "-- Help flag --"
if bash "$SCRIPT_DIR/migrate.sh" --help > /dev/null 2>&1; then
  pass "--help exits with code 0"
else
  fail "--help exited with non-zero"
fi

# 8. Unknown flag exits with error
echo ""
echo "-- Unknown flag --"
if ! bash "$SCRIPT_DIR/migrate.sh" --unknown-flag > /dev/null 2>&1; then
  pass "unknown flag exits non-zero"
else
  fail "unknown flag should exit non-zero"
fi

# 9. Dry-run --schema filter
echo ""
echo "-- Schema filter --"
output=$(DRY_RUN=true bash "$SCRIPT_DIR/migrate.sh" --dry-run --schema gateway 2>&1)
if echo "$output" | grep -q "Schema: gateway"; then
  pass "--schema gateway filters correctly"
else
  fail "--schema gateway filter not working"
fi
if echo "$output" | grep -q "Schema: ai" || echo "$output" | grep -q "Schema: formula"; then
  fail "--schema gateway still shows other schemas"
else
  pass "--schema gateway excludes other schemas"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
