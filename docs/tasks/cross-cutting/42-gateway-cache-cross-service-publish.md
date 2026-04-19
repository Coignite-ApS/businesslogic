# 42. Gateway cache cross-service PUBLISH on wallet debit + usage events

**Status:** planned
**Severity:** LOW — TTL floor is acceptable; gains are freshness, not correctness
**Source:** Code review of Sprint B task 27 (`docs/tasks/cross-cutting/27-pricing-v2-gateway-sublimits.md` — deferred follow-up)
**Depends on:** tasks 18 (wallet debit hook), 20 (usage events emit), 27 (gateway cache)

## Problem

Gateway's per-API-key sublimit caches (`gw:apikey:{id}:ai_spend_month:{yyyymm}`, `gw:apikey:{id}:kb_search_month:{yyyymm}`) have a 60s TTL and no external invalidation. Consequence: a customer hitting their AI spend cap can still make up to 60s of extra requests before the cache refreshes from DB. Acceptable for current scale; worth tightening.

`InvalidateAISpendCache` and `InvalidateKBSearchCache` helpers were defined in `services/gateway/internal/service/sublimits.go` during task 27 implementation, then DELETED in polish (code review I3) because nothing was calling them. This task reinstates them + wires the publish side.

## Required behavior

### Wallet debit side (ai_spend invalidation)

Each time a row is inserted into `ai_wallet_ledger` with `entry_type='debit'`:
- Extract `api_key_id` from metadata (or from the linked `usage_event.api_key_id`)
- PUBLISH to `bl:gw_apikey_ai_spend:invalidated` with `<api_key_id>`
- Gateway subscriber DELs `gw:apikey:{id}:ai_spend_month:*` for that key

Likely site: `project-extension-stripe` wallet handlers or the usage-consumer DB insert path (wherever the ledger row gets written).

### KB event emit side (kb_search invalidation)

Each `kb.search` or `kb.ask` event that makes it into `usage_events`:
- PUBLISH to `bl:gw_apikey_kb_search:invalidated` with `<api_key_id>`
- Gateway subscriber DELs `gw:apikey:{id}:kb_search_month:*`

Likely site: usage-consumer's INSERT path (after XACK, before moving to next batch).

### Gateway subscriber (new)

New Go subscriber in gateway, mirroring formula-api's pattern:

```go
// services/gateway/internal/service/cache_invalidator.go
func StartCacheInvalidationSubscriber(ctx context.Context, redisClient *redis.Client, log zerolog.Logger) {
    ps := redisClient.Subscribe(ctx, "bl:gw_apikey_ai_spend:invalidated", "bl:gw_apikey_kb_search:invalidated")
    // delete matching cache keys on each message
}
```

Reinstate `InvalidateAISpendCache` / `InvalidateKBSearchCache` helpers (previously deleted) to keep key-name logic in one place.

## Key Tasks

- [ ] Reinstate invalidate helpers in `services/gateway/internal/service/sublimits.go`
- [ ] New subscriber in gateway — `cache_invalidator.go` + `main.go` wiring
- [ ] Wire PUBLISH from wallet debit hook (task 18 extension) and usage-consumer INSERT path
- [ ] Tests: publish fires → gateway cache DELETE observed (integration test with real Redis)
- [ ] Document in `docs/architecture/usage-events.md` + gateway architecture doc

## Acceptance

- Wallet debit → AI spend cache invalidated within ~100ms (pub/sub latency)
- KB event landed → KB search count cache invalidated
- Customer hitting cap gets 402/429 on the VERY NEXT request after threshold, not 60s later
- Fail-open preserved: subscriber failure → cache still expires via TTL
- Gateway subscriber survives Redis reconnects (matches formula-api retry strategy — unbounded with 5s cap, per task 22 polish)

## Estimate

3-4 hours (Go subscriber + two publish sites + tests).
