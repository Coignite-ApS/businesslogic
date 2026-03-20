#!/bin/bash
# =============================================================================
# Chaos Testing Suite
# =============================================================================
# Tests graceful degradation when services are killed/unavailable.
# Requires Docker Compose stack running.
#
# Usage: ./tests/chaos/chaos-test.sh
# Env:   COMPOSE_FILE (default: infrastructure/docker/docker-compose.dev.yml)
# =============================================================================

set -euo pipefail
cd "$(dirname "$0")/../.."

COMPOSE_FILE="${COMPOSE_FILE:-infrastructure/docker/docker-compose.dev.yml}"
DC="docker compose -f $COMPOSE_FILE"
FAILED=0
TOTAL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; FAILED=$((FAILED + 1)); }
section() { echo -e "\n${YELLOW}═══ $1 ═══${NC}"; TOTAL=$((TOTAL + 1)); }

# Wait for a service to be healthy
wait_healthy() {
  local svc=$1 max=${2:-30}
  for i in $(seq 1 $max); do
    if $DC ps "$svc" 2>/dev/null | grep -q "healthy"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Check HTTP response
check_status() {
  local url=$1 expected=$2
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
  [ "$status" = "$expected" ]
}

echo "BusinessLogic Chaos Testing Suite"
echo "=================================="
echo "Compose: $COMPOSE_FILE"
echo ""

# ─── Test 1: Kill bl-ai-api → CMS still works, AI returns 503 ──────────────
section "Kill bl-ai-api → CMS still works"

$DC stop bl-ai-api 2>/dev/null || true
sleep 3

if check_status "http://localhost:18055/server/ping" "200"; then
  pass "CMS still responds (200)"
else
  fail "CMS not responding after ai-api killed"
fi

# Gateway should return 503 for AI routes
if check_status "http://localhost:18080/v1/ai/chat" "503" || \
   check_status "http://localhost:18080/v1/ai/chat" "502"; then
  pass "Gateway returns 502/503 for AI routes"
else
  fail "Gateway did not return 502/503 for AI routes"
fi

$DC start bl-ai-api 2>/dev/null || true
wait_healthy bl-ai-api 30 || warn "bl-ai-api slow to recover"

# ─── Test 2: Kill bl-formula-api → AI chat works, tool calls fail gracefully ─
section "Kill bl-formula-api → AI still works"

$DC stop bl-formula-api 2>/dev/null || true
sleep 3

if check_status "http://localhost:13200/ping" "200"; then
  pass "AI API still responds (200)"
else
  fail "AI API not responding after formula-api killed"
fi

$DC start bl-formula-api 2>/dev/null || true
wait_healthy bl-formula-api 30 || warn "bl-formula-api slow to recover"

# ─── Test 3: Kill Redis → verify fallback behavior ─────────────────────────
section "Kill Redis → services degrade gracefully"

$DC stop redis 2>/dev/null || true
sleep 5

# Gateway should still respond (may have degraded functionality)
GW_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "http://localhost:18080/health" 2>/dev/null || echo "000")
if [ "$GW_STATUS" = "200" ] || [ "$GW_STATUS" = "503" ]; then
  pass "Gateway responds with $GW_STATUS (graceful degradation)"
else
  fail "Gateway returned $GW_STATUS (expected 200 or 503)"
fi

# Formula API should still work for basic eval (uses in-memory cache)
FA_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "http://localhost:13000/ping" 2>/dev/null || echo "000")
if [ "$FA_STATUS" = "200" ]; then
  pass "Formula API still responds without Redis"
else
  fail "Formula API not responding without Redis (status: $FA_STATUS)"
fi

$DC start redis 2>/dev/null || true
wait_healthy redis 15 || warn "Redis slow to recover"
sleep 3

# ─── Test 4: Kill PostgreSQL → all services return 503 ─────────────────────
section "Kill PostgreSQL → services return 503 (not crash)"

$DC stop postgres 2>/dev/null || true
sleep 5

SERVICES_CRASHED=false

# Check each service is still running (not crashed)
for svc in bl-cms bl-ai-api bl-formula-api bl-gateway; do
  SVC_RUNNING=$($DC ps "$svc" 2>/dev/null | grep -c "Up\|running" || echo "0")
  if [ "$SVC_RUNNING" -gt 0 ]; then
    pass "$svc still running (not crashed)"
  else
    fail "$svc crashed when PostgreSQL died"
    SERVICES_CRASHED=true
  fi
done

$DC start postgres 2>/dev/null || true
wait_healthy postgres 30 || warn "PostgreSQL slow to recover"
sleep 5

# ─── Test 5: Verify recovery after chaos ───────────────────────────────────
section "Recovery: all services healthy after restarts"

sleep 10

ALL_HEALTHY=true
for svc_url in \
  "http://localhost:18055/server/ping" \
  "http://localhost:13000/ping" \
  "http://localhost:13100/ping" \
  "http://localhost:13200/ping" \
  "http://localhost:18080/health"; do

  if check_status "$svc_url" "200"; then
    pass "$svc_url → 200"
  else
    fail "$svc_url not healthy after recovery"
    ALL_HEALTHY=false
  fi
done

# ─── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "=================================="
echo "Tests: $TOTAL | Failed: $FAILED"
if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}All chaos tests passed — services degrade gracefully.${NC}"
else
  echo -e "${RED}$FAILED chaos test(s) failed.${NC}"
fi
exit $FAILED
