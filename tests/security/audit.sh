#!/bin/bash
# =============================================================================
# Security Audit Script
# =============================================================================
# Runs dependency scanning, secret detection, and basic vulnerability checks.
#
# Usage: ./tests/security/audit.sh [--fix]
# =============================================================================

set -euo pipefail
cd "$(dirname "$0")/../.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
FAILED=0

section() { echo -e "\n${YELLOW}═══ $1 ═══${NC}"; }
pass() { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; FAILED=$((FAILED + 1)); }

FIX_MODE=false
[[ "${1:-}" == "--fix" ]] && FIX_MODE=true

# ─── 1. Node.js dependency audit ────────────────────────────────────────────
section "Node.js Dependency Audit"

for svc in services/ai-api services/formula-api; do
  if [ -f "$svc/package.json" ]; then
    echo "  Checking $svc..."
    AUDIT_OUT=$(cd "$svc" && npm audit --omit=dev 2>&1 || true)
    if echo "$AUDIT_OUT" | grep -q "found 0 vulnerabilities"; then
      pass "$svc: no vulnerabilities"
    elif echo "$AUDIT_OUT" | grep -qi "critical"; then
      fail "$svc: critical vulnerabilities found"
      echo "$AUDIT_OUT" | grep -iE "(critical|high)" | head -5
      if $FIX_MODE; then
        (cd "$svc" && npm audit fix --omit=dev 2>&1) || true
      fi
    else
      warn "$svc: non-critical vulnerabilities (run npm audit in $svc)"
    fi
  fi
done

# ─── 2. Rust dependency audit ───────────────────────────────────────────────
section "Rust Dependency Audit (cargo audit)"

if command -v cargo-audit &>/dev/null; then
  AUDIT_OUT=$(cd services/flow && cargo audit 2>&1 || true)
  if echo "$AUDIT_OUT" | grep -q "No vulnerable packages found"; then
    pass "flow engine: no vulnerable crates"
  else
    CRIT=$(echo "$AUDIT_OUT" | grep -c "Severity: critical" || true)
    if [ "$CRIT" -gt 0 ]; then
      fail "flow engine: $CRIT critical vulnerabilities"
    else
      warn "flow engine: advisories found (review with: cd services/flow && cargo audit)"
    fi
  fi
else
  warn "cargo-audit not installed (install: cargo install cargo-audit)"
fi

# ─── 3. Go vulnerability check ─────────────────────────────────────────────
section "Go Vulnerability Check (govulncheck)"

if command -v govulncheck &>/dev/null; then
  VULN_OUT=$(cd services/gateway && govulncheck ./... 2>&1 || true)
  if echo "$VULN_OUT" | grep -q "No vulnerabilities found"; then
    pass "gateway: no vulnerabilities"
  else
    warn "gateway: vulnerabilities found (review with: cd services/gateway && govulncheck ./...)"
  fi
else
  warn "govulncheck not installed (install: go install golang.org/x/vuln/cmd/govulncheck@latest)"
fi

# ─── 4. Secret detection ────────────────────────────────────────────────────
section "Secret Detection"

# Check for hardcoded secrets in source code
SECRETS_FOUND=0
for pattern in \
  'ANTHROPIC_API_KEY\s*=\s*["\x27]sk-' \
  'OPENAI_API_KEY\s*=\s*["\x27]sk-' \
  'STRIPE_SECRET_KEY\s*=\s*["\x27]sk_' \
  'password\s*=\s*["\x27][^"\x27]{8,}' \
  'secret\s*=\s*["\x27][a-zA-Z0-9+/=]{20,}'; do

  MATCHES=$(grep -rn --include="*.js" --include="*.ts" --include="*.go" --include="*.rs" \
    -E "$pattern" services/ packages/ 2>/dev/null \
    | grep -v node_modules \
    | grep -v '.test.' \
    | grep -v '.example' \
    | grep -v 'config.js' \
    | grep -v 'config.go' || true)

  if [ -n "$MATCHES" ]; then
    fail "Potential secrets in source code:"
    echo "$MATCHES" | head -5
    SECRETS_FOUND=$((SECRETS_FOUND + 1))
  fi
done

if [ "$SECRETS_FOUND" -eq 0 ]; then
  pass "No hardcoded secrets found in source"
fi

# Check .env files are not tracked
if git ls-files --cached | grep -qE '\.env$'; then
  fail ".env file is tracked by git"
else
  pass ".env files not tracked by git"
fi

# ─── 5. API key rotation check ──────────────────────────────────────────────
section "API Key Rotation"

# Verify token encryption is available
if grep -q "TOKEN_ENCRYPTION_KEY" infrastructure/docker/.env.example 2>/dev/null; then
  pass "Token encryption key documented in .env.example"
else
  warn "TOKEN_ENCRYPTION_KEY not in .env.example"
fi

# ─── 6. SQL injection surface ───────────────────────────────────────────────
section "SQL Injection Surface"

# Check for string interpolation in SQL queries
SQL_INTERP=$(grep -rn --include="*.js" --include="*.ts" \
  -E '`[^`]*\$\{[^}]+\}[^`]*`' services/ packages/ 2>/dev/null \
  | grep -iE '(query|sql|SELECT|INSERT|UPDATE|DELETE|WHERE)' \
  | grep -v node_modules \
  | grep -v '.test.' || true)

if [ -n "$SQL_INTERP" ]; then
  warn "Potential SQL interpolation (review manually):"
  echo "$SQL_INTERP" | head -10
else
  pass "No obvious SQL string interpolation found"
fi

# Rust: check for format! in SQL context
SQL_RUST=$(grep -rn --include="*.rs" \
  -E 'format!\s*\([^)]*SELECT|format!\s*\([^)]*INSERT|format!\s*\([^)]*UPDATE' \
  services/flow/ 2>/dev/null || true)

if [ -n "$SQL_RUST" ]; then
  warn "Potential SQL format! usage in Rust (review manually):"
  echo "$SQL_RUST" | head -5
else
  pass "No SQL format! interpolation in Rust"
fi

# ─── Summary ────────────────────────────────────────────────────────────────
section "Summary"

if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}All security checks passed.${NC}"
  exit 0
else
  echo -e "${RED}$FAILED security issue(s) found.${NC}"
  exit 1
fi
