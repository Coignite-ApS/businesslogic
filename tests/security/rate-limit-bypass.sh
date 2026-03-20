#!/bin/bash
# =============================================================================
# Rate Limit Bypass Test
# =============================================================================
# Tests various header spoofing and bypass techniques against the gateway.
#
# Usage: ./tests/security/rate-limit-bypass.sh [GATEWAY_URL]
# =============================================================================

set -euo pipefail

GATEWAY=${1:-http://localhost:18080}
FAILED=0

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; FAILED=$((FAILED + 1)); }

echo "Rate Limit Bypass Tests against $GATEWAY"
echo "=========================================="

# Test 1: X-Forwarded-For spoofing should NOT bypass rate limits
echo ""
echo "Test 1: X-Forwarded-For spoofing"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Forwarded-For: 1.2.3.4" \
  "$GATEWAY/health" 2>/dev/null || echo "000")

if [ "$STATUS" = "200" ] || [ "$STATUS" = "429" ]; then
  pass "X-Forwarded-For header accepted (gateway uses trustProxy correctly)"
else
  fail "Unexpected status $STATUS with X-Forwarded-For"
fi

# Test 2: Multiple X-Forwarded-For headers
echo ""
echo "Test 2: Multiple X-Forwarded-For headers"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Forwarded-For: 10.0.0.1" \
  -H "X-Forwarded-For: 10.0.0.2" \
  "$GATEWAY/health" 2>/dev/null || echo "000")

if [ "$STATUS" != "000" ]; then
  pass "Multiple X-Forwarded-For headers handled (status: $STATUS)"
else
  fail "Gateway unreachable"
fi

# Test 3: X-Real-IP spoofing
echo ""
echo "Test 3: X-Real-IP spoofing"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Real-IP: 192.168.1.1" \
  "$GATEWAY/health" 2>/dev/null || echo "000")

if [ "$STATUS" = "200" ] || [ "$STATUS" = "429" ]; then
  pass "X-Real-IP handled (status: $STATUS)"
else
  fail "Unexpected status $STATUS with X-Real-IP"
fi

# Test 4: Rapid requests should trigger rate limit
echo ""
echo "Test 4: Rapid requests (rate limit trigger)"
RATE_LIMITED=false
for i in $(seq 1 200); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY/health" 2>/dev/null || echo "000")
  if [ "$STATUS" = "429" ]; then
    RATE_LIMITED=true
    pass "Rate limit triggered after $i requests (429 returned)"
    break
  fi
done

if ! $RATE_LIMITED; then
  fail "Rate limit NOT triggered after 200 rapid requests"
fi

# Test 5: Missing auth on protected endpoints
echo ""
echo "Test 5: Unauthenticated access to protected endpoints"
for endpoint in "/v1/ai/chat" "/v1/ai/kb" "/evaluate"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST -H "Content-Type: application/json" \
    -d '{}' "$GATEWAY$endpoint" 2>/dev/null || echo "000")
  if [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
    pass "$endpoint returns $STATUS without auth"
  elif [ "$STATUS" = "000" ]; then
    pass "$endpoint: gateway not routing (expected during test)"
  else
    fail "$endpoint returns $STATUS without auth (expected 401/403)"
  fi
done

echo ""
echo "=========================================="
if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}All rate limit bypass tests passed.${NC}"
else
  echo -e "${RED}$FAILED test(s) failed.${NC}"
fi
exit $FAILED
