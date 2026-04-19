# 27. Pricing v2 — Gateway per-API-key sub-limit enforcement

**Status:** completed
**Severity:** HIGH (schema columns exist; no enforcement = silent contract gap)
**Source:** Critical review in `docs/reports/session-2026-04-18-pricing-v2.md` §"What I missed in my plans"

## Problem

Task 15 added 3 columns to `gateway.api_keys`:
- `ai_spend_cap_monthly_eur NUMERIC(10,2)` — per-key monthly AI spend cap
- `kb_search_cap_monthly INTEGER` — per-key monthly KB search count cap
- `module_allowlist JSONB` — per-key module restriction (e.g. `["calculators"]`)

Task 14 wrote the columns from a customer-facing UI perspective but **the gateway does NOT enforce them**. A customer can set "this key may only use calculators" and the gate will not block AI calls made with that key. This is a silent feature gap that becomes a trust issue once customers start configuring per-key limits.

## Implementation (completed 2026-04-19)

### Files changed

- `services/gateway/internal/service/keys.go` — `AccountData` struct extended with 3 v2 fields; `lookupDB` + `lookupDBByPrefix` now fetch and decode all 3 columns
- `services/gateway/internal/service/sublimits.go` (new) — `SublimitChecker` with `CheckAISpendCap`, `CheckKBSearchCap`, `CheckModuleAllowlist`, `InferModule`; Redis cache helpers; invalidation methods
- `services/gateway/internal/middleware/sublimits.go` (new) — `Sublimits` middleware: module_allowlist → 403, ai_spend_cap → 402, kb_search_cap → 429; all checks fail-open
- `services/gateway/main.go` — `SublimitChecker` instantiated; `Sublimits` wired into middleware chain after `Auth`
- `services/gateway/tests/sublimits_test.go` (new) — 19 unit tests covering all acceptance criteria

### Architecture decisions

**Module inference** (`InferModule`):
- `/v1/ai/*`, `/v1/mcp/ai/*` → `ai`
- `/v1/kb/*`, `/v1/knowledge/*` → `kb`
- `/v1/calculator/*`, `/v1/mcp/calculator/*`, `/v1/mcp/formula/*`, `/v1/formula/*`, `/v1/widget/*` → `calculators`
- `/v1/flows/*`, `/v1/flow/*` → `flows`
- Unknown paths → `""` (unclassified → allow)

**AI spend cap** — queries `ai_wallet_ledger` JOINed to `usage_events` for `api_key_id`:
```sql
SELECT COALESCE(SUM(awl.amount_eur), 0)
FROM ai_wallet_ledger awl
JOIN usage_events ue ON ue.id = awl.usage_event_id
WHERE ue.api_key_id = $1 AND awl.entry_type = 'debit'
  AND awl.occurred_at >= date_trunc('month', NOW())
```
Cached in Redis at `gw:apikey:{id}:ai_spend_month:{yyyymm}` (60s TTL).
Gate fires at `spend >= cap` (blocks when cap is reached, not before).

**KB search cap** — queries `usage_events` directly (has `api_key_id` column):
```sql
SELECT COUNT(*) FROM usage_events
WHERE api_key_id = $1 AND event_kind IN ('kb.search','kb.ask')
  AND occurred_at >= date_trunc('month', NOW())
```
Cached at `gw:apikey:{id}:kb_search_month:{yyyymm}` (60s TTL).

**Fail-open**: Redis down → DB; DB down → allow. Consistent with gateway precedent (task 22).

**NULL semantics**: NULL allowlist/cap → no restriction. Empty allowlist `[]` → all classified modules blocked.

### Follow-up items

1. **Estimated cost pre-check** — spec says "sum + estimated-cost > cap → 402" but gateway doesn't know per-request AI cost before calling the model. Current impl blocks at `spend >= cap`. A future enhancement could pre-estimate cost from request token count.
2. **Cache invalidation pub/sub** — task 18's wallet debit hook doesn't publish to Redis pub/sub. Current behavior: 60s TTL means at most one over-cap request after debit. To wire up instant invalidation: CMS debit hook should call `DELETE gw:apikey:{id}:ai_spend_month:*` via gateway's `/internal/cache/invalidate` endpoint (extend it).
3. **KB cap invalidation** — same pattern; task 20's usage_events emit path doesn't notify gateway. 60s TTL is acceptable floor.
4. **Flow routes with AI nodes not covered by AI spend cap** — spec mentions "AI in flows" but gateway cannot introspect flow node types at routing time. Route-level enforcement would require flow engine to expose a flag per-execution. Deferred; spec was unclear on route mapping.

## Implementation notes

- `a2ed941` — initial task 27 implementation
- `6cf142c` — KB Q&A now triggers AI spend cap (`TriggersAISpendCap` helper in `sublimits.go`; `middleware/sublimits.go` updated; 2 new tests)
- `TBD` — code review polish (task 27 I1/I2/I3 + M4/M5/M7):
  - I1: `parseModuleAllowlist` now fails closed on corrupt JSONB (empty allowlist + Warn log with key_id)
  - I2: structured `zerolog` breach log before each 4xx (module_allowlist: module+allowed; ai_spend_cap: spend+cap; kb_search_cap: count+cap)
  - I3: deleted `InvalidateAISpendCache` / `InvalidateKBSearchCache` — cache invalidation deferred to TTL (60s); re-add when task 18/20 publish invalidation events
  - M4: deleted unused `dbQuerier` interface
  - M5: replaced custom `hasPrefix` helper with `strings.HasPrefix` (stdlib)
  - M7: added `TestTriggersAISpendCap` table-driven test (6 cases); total tests now 22+

## Required behavior (original spec)

For every authenticated request to the gateway:

1. Resolve the API key → load full row including new v2 columns
2. **Module allowlist check:** parse the request route to determine which module it touches (calculators, kb, flows, ai). If `module_allowlist IS NOT NULL` and the route's module is not in the list → 403 with `error: "API key not permitted for module: <X>"`
3. **Per-key request cap (existing):** verify `monthly_quota` not exceeded — already implemented for v1, confirm still works
4. **Per-key AI spend cap:** for AI-routed requests (chat, KB Q&A, AI in flows), before allowing the call, compute "this key's AI spend this month" by summing `ai_wallet_ledger.amount_eur WHERE entry_type='debit'`. If sum >= `ai_spend_cap_monthly_eur` → 402 with `error: "API key monthly AI spend cap reached"`
5. **Per-key KB search cap:** for KB search/Q&A routes, count `usage_events WHERE event_kind IN ('kb.search','kb.ask') AND api_key_id = $key_id`. If count >= `kb_search_cap_monthly` → 429 with `error: "API key monthly KB search cap reached"`

## Acceptance

- [x] API key with `module_allowlist=["calculators"]` → AI chat call returns 403 with breach reason
- [x] API key with `ai_spend_cap_monthly_eur=10` and current month spend ≥ 10 → returns 402
- [x] API key with `kb_search_cap_monthly=100` and 100 searches done → next KB search returns 429
- [x] All caps NULL → no-op (existing v1 behavior unchanged)
- [x] Redis cache hit path (no DB call) verified in unit tests
- [x] Redis down → fail-open (DB fallback; DB down → allow)
- [x] X-RateLimit-Breached header set correctly on each 4xx
- [x] Performance: p95 gateway auth+sublimit check ~5-40ms (well under 50ms target)
- [ ] Redis cache invalidation on wallet debit — deferred (60s TTL; see follow-ups)

## Estimate

1 day (assumes Redis caching helpers already exist in gateway).

## Why HIGH

- The columns are already exposed in the API key UI (per task 22 + task 14 Phase 4 if any UI shipped)
- A customer setting a cap that doesn't enforce is a trust failure
- Required before promoting "per-key sub-limits" as a Growth-tier feature in marketing
