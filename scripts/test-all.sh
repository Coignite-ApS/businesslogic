#!/bin/bash
# =============================================================================
# BusinessLogic Platform — Run All Tests
# =============================================================================
# Runs test suites for all services that have been set up.
# Returns non-zero if ANY test suite fails.
#
# Usage:
#   ./scripts/test-all.sh              # Run all tests
#   ./scripts/test-all.sh --service cms # Run tests for a specific service
#   ./scripts/test-all.sh --quick      # Run only unit tests (no e2e/integration)
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SPECIFIC_SERVICE=""
QUICK_MODE=false
FAILED=0
PASSED=0
SKIPPED=0

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --service) SPECIFIC_SERVICE="$2"; shift 2 ;;
    --quick)   QUICK_MODE=true; shift ;;
    *)         echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Allow services to start without real secrets during tests
export SKIP_SECRET_VALIDATION=true

run_test() {
  local name="$1"
  local dir="$2"
  local cmd="$3"

  if [ -n "$SPECIFIC_SERVICE" ] && [ "$SPECIFIC_SERVICE" != "$name" ]; then
    return
  fi

  if [ ! -d "$dir" ]; then
    echo "SKIP: $name (directory not found: $dir)"
    SKIPPED=$((SKIPPED + 1))
    return
  fi

  echo ""
  echo "=========================================="
  echo "Testing: $name"
  echo "=========================================="

  if (cd "$dir" && eval "$cmd"); then
    echo "PASS: $name"
    PASSED=$((PASSED + 1))
  else
    echo "FAIL: $name"
    FAILED=$((FAILED + 1))
  fi
}

echo "BusinessLogic Platform — Test Runner"
echo "Root: $ROOT_DIR"
echo ""

# ── CMS Extension Tests ──
# Run tests for each extension that has a test script
for ext_dir in "$ROOT_DIR"/services/cms/extensions/local/*/; do
  ext_name=$(basename "$ext_dir")
  if [ -f "$ext_dir/package.json" ] && grep -q '"test"' "$ext_dir/package.json" 2>/dev/null; then
    run_test "cms-$ext_name" "$ext_dir" "npm test"
  fi
done

# ── Formula API Tests ──
# Integration tests require a running server.
# Auto-starts locally if neither local (3000) nor Docker (13000) is running.
# Sources .env for auth tokens.
_FA_STARTED_HERE=false
if [ -d "$ROOT_DIR/services/formula-api/src" ]; then
  # Load test tokens from service .env
  _FA_ENV=""
  if [ -f "$ROOT_DIR/services/formula-api/.env" ]; then
    _FA_TEST_TOKEN=$(grep '^FORMULA_TEST_TOKEN=' "$ROOT_DIR/services/formula-api/.env" | cut -d= -f2)
    _FA_ADMIN_TOKEN=$(grep '^ADMIN_TOKEN=' "$ROOT_DIR/services/formula-api/.env" | cut -d= -f2)
    _FA_ENV="FORMULA_TEST_TOKEN=$_FA_TEST_TOKEN ADMIN_TOKEN=$_FA_ADMIN_TOKEN"
  fi

  if ! curl -s http://localhost:3000/health &>/dev/null && ! curl -s http://localhost:13000/health &>/dev/null; then
    echo "  Starting formula-api server for tests..."
    (cd "$ROOT_DIR/services/formula-api" && node --env-file=.env src/server.js &>/tmp/formula-api-test.log &)
    _FA_PID=$!
    _FA_STARTED_HERE=true
    sleep 3
  fi

  # Detect which port is active
  _FA_PORT=3000
  if curl -s http://localhost:13000/health &>/dev/null; then _FA_PORT=13000; fi

  _FA_TEST_CMD="$_FA_ENV API_URL=http://localhost:$_FA_PORT"
  if [ "$QUICK_MODE" = true ]; then
    run_test "formula-api" "$ROOT_DIR/services/formula-api" "$_FA_TEST_CMD npm test"
  else
    if grep -q '"test:all"' "$ROOT_DIR/services/formula-api/package.json" 2>/dev/null; then
      run_test "formula-api" "$ROOT_DIR/services/formula-api" "$_FA_TEST_CMD npm run test:all"
    else
      run_test "formula-api" "$ROOT_DIR/services/formula-api" "$_FA_TEST_CMD npm test"
    fi
  fi

  if [ "$_FA_STARTED_HERE" = true ]; then
    kill "$_FA_PID" 2>/dev/null || true
  fi
fi

# ── Flow Engine Tests (Rust) ──
run_test "flow-engine" "$ROOT_DIR/services/flow" "cargo test --workspace"

# ── AI API Tests ──
if [ -f "$ROOT_DIR/services/ai-api/package.json" ]; then
  run_test "ai-api" "$ROOT_DIR/services/ai-api" "npm test"
else
  echo "SKIP: ai-api (not scaffolded yet)"
  SKIPPED=$((SKIPPED + 1))
fi

# ── Gateway Tests (Go) ──
if [ -f "$ROOT_DIR/services/gateway/go.mod" ]; then
  run_test "gateway" "$ROOT_DIR/services/gateway" "go test ./..."
else
  echo "SKIP: gateway (not scaffolded yet)"
  SKIPPED=$((SKIPPED + 1))
fi

# ── Shared Package Tests ──
for pkg_dir in "$ROOT_DIR"/packages/*/; do
  pkg_name=$(basename "$pkg_dir")
  if [ -f "$pkg_dir/package.json" ]; then
    run_test "pkg-$pkg_name" "$pkg_dir" "npm test"
  fi
done

# ── Contract Tests ──
if [ "$QUICK_MODE" = false ] && [ -f "$ROOT_DIR/scripts/test-contracts.sh" ]; then
  echo ""
  echo "=========================================="
  echo "Running contract tests..."
  echo "=========================================="
  if "$ROOT_DIR/scripts/test-contracts.sh"; then
    echo "PASS: contract-tests"
    PASSED=$((PASSED + 1))
  else
    echo "FAIL: contract-tests"
    FAILED=$((FAILED + 1))
  fi
fi

# ── Summary ──
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "  Passed:  $PASSED"
echo "  Failed:  $FAILED"
echo "  Skipped: $SKIPPED"
echo "=========================================="

if [ "$FAILED" -gt 0 ]; then
  echo "RESULT: FAILED ($FAILED test suite(s) failed)"
  exit 1
else
  echo "RESULT: ALL PASSED"
  exit 0
fi
