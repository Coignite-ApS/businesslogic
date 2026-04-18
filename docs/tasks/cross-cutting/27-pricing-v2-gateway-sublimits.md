# 27. Pricing v2 — Gateway per-API-key sub-limit enforcement

**Status:** planned
**Severity:** HIGH (schema columns exist; no enforcement = silent contract gap)
**Source:** Critical review in `docs/reports/session-2026-04-18-pricing-v2.md` §"What I missed in my plans"

## Problem

Task 15 added 3 columns to `gateway.api_keys`:
- `ai_spend_cap_monthly_eur NUMERIC(10,2)` — per-key monthly AI spend cap
- `kb_search_cap_monthly INTEGER` — per-key monthly KB search count cap
- `module_allowlist JSONB` — per-key module restriction (e.g. `["calculators"]`)

Task 14 wrote the columns from a customer-facing UI perspective but **the gateway does NOT enforce them**. A customer can set "this key may only use calculators" and the gate will not block AI calls made with that key. This is a silent feature gap that becomes a trust issue once customers start configuring per-key limits.

Plus the existing v1 fields (`rate_limit_rps`, `monthly_quota`, `allowed_ips`, `allowed_origins`) — verify these still enforce correctly under v2 (likely fine; just confirm).

## Required behavior

For every authenticated request to the gateway:

1. Resolve the API key → load full row including new v2 columns
2. **Module allowlist check:** parse the request route to determine which module it touches (calculators, kb, flows, ai). If `module_allowlist IS NOT NULL` and the route's module is not in the list → 403 with `error: "API key not permitted for module: <X>"`
3. **Per-key request cap (existing):** verify `monthly_quota` not exceeded — already implemented for v1, confirm still works
4. **Per-key AI spend cap:** for AI-routed requests (chat, KB Q&A, AI in flows), before allowing the call, compute "this key's AI spend this month" by summing `ai_wallet_ledger.amount_eur WHERE entry_type='debit' AND metadata->>'api_key_id' = $key_id AND occurred_at >= date_trunc('month', NOW())`. If sum + estimated cost > `ai_spend_cap_monthly_eur` → 402 with `error: "API key monthly AI spend cap reached"`
5. **Per-key KB search cap:** for KB search/Q&A routes, count `usage_events WHERE event_type IN ('kb_search','kb_qa') AND api_key_id = $key_id AND occurred_at >= date_trunc('month', NOW())`. If count + 1 > `kb_search_cap_monthly` → 429 with `error: "API key monthly KB search cap reached"`

## Implementation notes

### Where this lives

`services/gateway/internal/handler/auth.go` (or equivalent) — the existing API key validation path. Add the new checks after the existing v1 checks pass.

### Performance

These checks run on every request. For hot paths:
- **Module allowlist:** zero DB cost (read from already-loaded api_key row)
- **Per-key AI spend:** SUM aggregation per request is expensive. Cache in Redis with 60s TTL, key `gw:apikey:{id}:ai_spend_month:{yyyymm}`. Invalidate on write (when wallet debit hook in task 18 fires)
- **Per-key KB search count:** same pattern — cached COUNT, key `gw:apikey:{id}:kb_search_month:{yyyymm}`

### Dependencies

- **Hard:** task 18 (wallet debit hook) — without it, `ai_wallet_ledger` debit rows don't exist; AI spend cap is unenforceable
- **Hard:** task 20 (usage_events emitter) — without it, KB search count is always 0; cap is unenforceable
- **Soft:** `api_key_usage` table from task 15 — could store the rolling count instead of computing each time (faster but stale by ≤1 min)

### Error response shape

Match the existing gateway error format. Include the breached limit name in the response header (`X-RateLimit-Breached: ai_spend_cap`) so client SDKs can surface the right message.

## Acceptance

- [ ] API key with `module_allowlist=["calculators"]` → AI chat call returns 403 with breach reason
- [ ] API key with `ai_spend_cap_monthly_eur=10` and current month spend €9.50 → next AI call estimated at €1 returns 402
- [ ] API key with `kb_search_cap_monthly=100` and 100 searches done → next KB search returns 429
- [ ] All caps NULL → no-op (existing v1 behavior unchanged)
- [ ] Redis cache invalidates correctly on wallet debit (verify via integration test)
- [ ] Performance: p95 gateway auth check < 50ms (target from `services/gateway/`)

## Estimate

1 day (assumes Redis caching helpers already exist in gateway).

## Why HIGH

- The columns are already exposed in the API key UI (per task 22 + task 14 Phase 4 if any UI shipped)
- A customer setting a cap that doesn't enforce is a trust failure
- Required before promoting "per-key sub-limits" as a Growth-tier feature in marketing
