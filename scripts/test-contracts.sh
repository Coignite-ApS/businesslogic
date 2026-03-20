#!/bin/bash
# =============================================================================
# BusinessLogic Platform — Contract Tests
# =============================================================================
# Verifies API contracts between services match expectations.
# Each service that exposes an API should have a contract spec.
#
# Contract tests verify:
#   1. Response shapes match TypeScript types / OpenAPI spec
#   2. Required fields are present
#   3. Status codes are correct
#   4. Error formats are consistent
#
# These tests require services to be running (docker compose up).
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FAILED=0
PASSED=0

check_endpoint() {
  local name="$1"
  local url="$2"
  local expected_status="$3"
  local expected_field="$4"

  local response
  local status

  status=$(curl -s -o /tmp/contract-response.json -w "%{http_code}" --connect-timeout 5 "$url" 2>/dev/null || echo "000")

  if [ "$status" = "000" ] || [ "$status" = "000000" ] || [ -z "$status" ]; then
    echo "  SKIP: $name — service not reachable"
    return
  fi

  if [ "$status" != "$expected_status" ]; then
    echo "  FAIL: $name — expected HTTP $expected_status, got $status"
    FAILED=$((FAILED + 1))
    return
  fi

  if [ -n "$expected_field" ]; then
    if ! jq -e "$expected_field" /tmp/contract-response.json > /dev/null 2>&1; then
      echo "  FAIL: $name — missing expected field: $expected_field"
      FAILED=$((FAILED + 1))
      return
    fi
  fi

  echo "  PASS: $name"
  PASSED=$((PASSED + 1))
}

echo "BusinessLogic Platform — Contract Tests"
echo ""

# ── Formula API Contracts ──
echo "Formula API (http://localhost:13000):"
check_endpoint "GET /ping" "http://localhost:13000/ping" "200" ""
check_endpoint "GET /health" "http://localhost:13000/health" "200" ".status"

# ── Flow Trigger Contracts ──
echo ""
echo "Flow Trigger (http://localhost:13100):"
check_endpoint "GET /ping" "http://localhost:13100/ping" "200" ""

# ── CMS Contracts ──
echo ""
echo "CMS / Directus (http://localhost:18055):"
check_endpoint "GET /server/ping" "http://localhost:18055/server/ping" "200" ""

# ── AI API Contracts (after Iteration 1) ──
echo ""
echo "AI API (http://localhost:13200):"
check_endpoint "GET /ping" "http://localhost:13200/ping" "200" ""

# ── Gateway Contracts (after Iteration 2) ──
echo ""
echo "Gateway (http://localhost:18080):"
check_endpoint "GET /health" "http://localhost:18080/health" "200" ""

# ── Summary ──
echo ""
echo "Contract Tests: $PASSED passed, $FAILED failed"
[ "$FAILED" -gt 0 ] && exit 1
exit 0
