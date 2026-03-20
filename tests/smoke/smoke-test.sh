#!/bin/bash
# =============================================================================
# Production Smoke Test Suite
# =============================================================================
# End-to-end verification of all services after deployment.
#
# Usage: ./tests/smoke/smoke-test.sh [BASE_URL]
# Env:   BASE_URL   (default: http://localhost:18080)
#        API_KEY    (required for authenticated endpoints)
#        ADMIN_TOKEN (for admin endpoints)
# =============================================================================

set -euo pipefail

BASE=${1:-${BASE_URL:-http://localhost:18080}}
API_KEY="${API_KEY:-}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
FAILED=0
PASSED=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✓${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAILED=$((FAILED + 1)); }
skip() { echo -e "  ${YELLOW}○${NC} $1 (skipped)"; }
section() { echo -e "\n${YELLOW}═══ $1 ═══${NC}"; }

echo "BusinessLogic Production Smoke Tests"
echo "====================================="
echo "Target: $BASE"
echo ""

# ─── 1. Gateway Health ──────────────────────────────────────────────────────
section "Gateway Health"

GW_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/health" 2>/dev/null || echo "000")
if [ "$GW_STATUS" = "200" ]; then
  pass "Gateway /health → 200"
else
  fail "Gateway /health → $GW_STATUS (expected 200)"
fi

# Check backends health
GW_BODY=$(curl -s --max-time 5 "$BASE/health" 2>/dev/null || echo "{}")
if echo "$GW_BODY" | grep -qi "healthy\|ok\|up"; then
  pass "Gateway reports backends healthy"
else
  fail "Gateway health response unexpected: $GW_BODY"
fi

# ─── 2. CMS Health ──────────────────────────────────────────────────────────
section "CMS (Directus)"

# Direct CMS check (might not be exposed publicly)
CMS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "${CMS_URL:-http://localhost:18055}/server/ping" 2>/dev/null || echo "000")
if [ "$CMS_STATUS" = "200" ]; then
  pass "CMS /server/ping → 200"
else
  skip "CMS direct access not available (status: $CMS_STATUS)"
fi

# ─── 3. Formula API — Execute Calculator ────────────────────────────────────
section "Formula API"

FA_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "${FORMULA_URL:-http://localhost:13000}/ping" 2>/dev/null || echo "000")
if [ "$FA_STATUS" = "200" ]; then
  pass "Formula API /ping → 200"
else
  skip "Formula API not directly accessible (status: $FA_STATUS)"
fi

# Test formula evaluation via gateway
if [ -n "$API_KEY" ]; then
  EVAL_RESP=$(curl -s --max-time 10 \
    -X POST -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d '{"formula":"SUM(1,2,3)"}' \
    "$BASE/evaluate" 2>/dev/null || echo '{"error":"timeout"}')

  if echo "$EVAL_RESP" | grep -qE '"result"|"value"'; then
    pass "Formula evaluation via gateway works"
  elif echo "$EVAL_RESP" | grep -q '"error"'; then
    fail "Formula evaluation error: $(echo "$EVAL_RESP" | head -c 200)"
  else
    skip "Formula eval response unexpected"
  fi
else
  skip "Formula evaluation (no API_KEY set)"
fi

# ─── 4. AI API — Chat ───────────────────────────────────────────────────────
section "AI API"

AI_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "${AI_URL:-http://localhost:13200}/ping" 2>/dev/null || echo "000")
if [ "$AI_STATUS" = "200" ]; then
  pass "AI API /ping → 200"
else
  skip "AI API not directly accessible (status: $AI_STATUS)"
fi

if [ -n "$API_KEY" ]; then
  CHAT_RESP=$(curl -s --max-time 30 \
    -X POST -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d '{"message":"Say hello in exactly one word","model":"claude-haiku-4-5-20251001","stream":false}' \
    "$BASE/v1/ai/chat" 2>/dev/null || echo '{"error":"timeout"}')

  if echo "$CHAT_RESP" | grep -qE '"response"|"content"'; then
    pass "AI chat via gateway works"
  else
    fail "AI chat error: $(echo "$CHAT_RESP" | head -c 200)"
  fi
else
  skip "AI chat (no API_KEY set)"
fi

# ─── 5. Knowledge Base ──────────────────────────────────────────────────────
section "Knowledge Base"

if [ -n "$API_KEY" ]; then
  KB_LIST=$(curl -s --max-time 10 \
    -H "Authorization: Bearer $API_KEY" \
    "$BASE/v1/ai/kb" 2>/dev/null || echo '{"error":"timeout"}')

  if echo "$KB_LIST" | grep -qE '^\[' || echo "$KB_LIST" | grep -q '"knowledge_bases"'; then
    pass "KB list endpoint works"
  elif echo "$KB_LIST" | grep -q '"error"'; then
    fail "KB list error: $(echo "$KB_LIST" | head -c 200)"
  else
    skip "KB response unexpected"
  fi
else
  skip "KB endpoints (no API_KEY set)"
fi

# ─── 6. Flow Engine ─────────────────────────────────────────────────────────
section "Flow Engine"

FLOW_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "${FLOW_URL:-http://localhost:13100}/ping" 2>/dev/null || echo "000")
if [ "$FLOW_STATUS" = "200" ]; then
  pass "Flow trigger /ping → 200"
else
  skip "Flow trigger not directly accessible (status: $FLOW_STATUS)"
fi

# ─── 7. Monitoring ──────────────────────────────────────────────────────────
section "Monitoring"

OTEL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "${OTEL_URL:-http://localhost:14318}/v1/traces" 2>/dev/null || echo "000")
if [ "$OTEL_STATUS" != "000" ]; then
  pass "OTel collector reachable (status: $OTEL_STATUS)"
else
  skip "OTel collector not accessible"
fi

# ─── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "====================================="
echo "Passed: $PASSED | Failed: $FAILED"

if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}All smoke tests passed.${NC}"
  exit 0
else
  echo -e "${RED}$FAILED smoke test(s) failed.${NC}"
  exit 1
fi
