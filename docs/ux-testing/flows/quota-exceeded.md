# Flow: Quota Exceeded Recovery

User has been making calculator calls and hits their monthly allowance. This flow tests the 429 response, the UI surfacing of the quota state, and the recovery paths (upgrade, wait, or hit a per-key cap).

**Why this matters:** Hitting quota is a paying-customer moment. If the experience is opaque ("my API just stopped working"), trust erodes. If it's clear + offers fast upgrade, it's a revenue opportunity.

## Prerequisites

- Account with active Starter calculator subscription (Starter = 1,000 calls/month)
- API key with permissions to `/v1/calc/*`
- Ability to simulate a large number of calls (manual script or bulk request)
- Stripe test cards (see `docs/ux-testing/stripe-test-cards.md`)

## Accept Criteria

- [ ] Hitting quota returns HTTP 429 with clear error body
- [ ] Response includes `Retry-After` header as delta-seconds (to start of next month)
- [ ] Error body names the breached quota (e.g. `"Monthly calculator call allowance exceeded"`)
- [ ] User can see quota status pre-breach (usage dashboard or similar)
- [ ] Recovery paths clear: upgrade plan OR wait until next period
- [ ] AI Assistant / admin UI surfaces the 429 with actionable copy (not raw error)

## Red Flags

- No 429 at quota — requests keep passing (quota not enforced) → (F) -3 critical (regression of task 22)
- 429 but generic 500 body (wrong status or no retry-after) → (F) -2
- User can't tell WHICH quota was hit → Error Handling -2
- No upgrade path surfaced → (F) Revenue Opportunity Missed -2
- After period rolls over, quota doesn't reset → (F) -3 critical

## Phases

### Phase 1: Pre-Quota Baseline

**Actions:**
1. Navigate to `/admin/account/subscription`
2. Calculators card shows usage: "X of 1,000 calls this month"
3. Look for visual progress bar or similar at 60-80%
4. Check if warning banner appears at 80%+ ("Approaching quota")

**Evaluate:** First Impression (proactive visibility), (F) Usage Transparency

**Persona variations:**
- **Sarah:** Checks status once, trusts it, moves on
- **Marcus:** Wants detailed daily breakdown — clicks through to analytics
- **Anna:** Finds progress bar reassuring; watches it periodically
- **Raj:** Queries the underlying `monthly_aggregates` table directly via SQL

### Phase 2: Approach Quota (80-95%)

**Actions:**
1. Drive calls from a script or repeated curl:
   ```bash
   API_KEY="bl_test_..."
   for i in {1..900}; do
     curl -s -o /dev/null -w "%{http_code} " \
       -X POST http://localhost:18080/v1/calc/<calc-id>/execute \
       -H "Authorization: Bearer $API_KEY" \
       -H "Content-Type: application/json" \
       -d '{"inputs":{"a":1}}'
   done
   ```
2. Subscription page updates usage bar
3. At 80%: look for proactive warning banner / email notification
4. At 95%: more urgent warning

**Evaluate:** (F) Warning UX (proactive vs surprise), Error Handling (escalation)

### Phase 3: Hit Quota (1,000/1,000)

**Actions:**
1. Continue calls until 429 returns
2. Capture the 429 response body + headers:
   ```bash
   curl -v -X POST http://localhost:18080/v1/calc/<calc-id>/execute \
     -H "Authorization: Bearer $API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"inputs":{"a":1}}'
   ```
3. Response should include:
   - Status: `429 Too Many Requests`
   - Header: `Retry-After: <seconds until start of next month UTC>`
   - Body:
     ```json
     {
       "error": "Monthly calculator call allowance exceeded",
       "allowance": 1000,
       "used": 1000,
       "resets_at": "2026-05-01T00:00:00.000Z"
     }
     ```

**Evaluate:** Error Handling (specificity, Retry-After correctness)

**Expected logs (per task 22 polish):**
- Structured `[quota] 429 monthly calc calls exceeded` log line with account_id + used + allowance

### Phase 4: UI Surface of 429

**Actions:**
1. If AI Assistant uses the quota-bound endpoint, trigger a request there
2. Observe: AI Assistant surfaces the error — not raw JSON, a translated message
3. Check for "Upgrade plan" CTA in the error toast or inline
4. Click CTA → routes to subscription upgrade dialog

**Evaluate:** Error Handling (translation vs raw), (F) Revenue Funnel

### Phase 5: Recovery Path A — Upgrade

**Actions:**
1. From the quota breach, user clicks "Upgrade"
2. Plan-cards dialog shows tiers with higher allowances (Starter 1k → Growth 10k → Scale 100k)
3. Pick Growth → Stripe Checkout → complete with test card
4. Return to subscription — Growth plan active
5. Immediately retry the curl request
6. 200 OK (feature_quotas refreshed via task 17 hook, new 10,000 allowance)

**Evaluate:** (F) Recovery Speed (how fast does new quota become effective?)

**Expected webhooks + hooks:**
- `customer.subscription.updated` → feature_quotas hook fires → `refresh_feature_quotas(account_id)`
- Formula-api's Redis cache invalidates via `bl:feature_quotas:invalidated` publish → next quota check hits DB (fresh allowance)

### Phase 6: Recovery Path B — Wait for Next Period

**Actions:**
1. Don't upgrade; simulate period roll-over via Stripe CLI test clock OR just check after actual period end
2. At start of next month: `monthly_aggregates` row for new period has `calc_calls = 0`
3. Retry the curl request → 200 OK

**Evaluate:** (F) Automatic Recovery correctness

**Note:** Monthly aggregates rollup runs hourly (task 21) and the Redis cache has 5min TTL — so at most 5min staleness after the period actually rolls.

### Phase 7: Per-Key Sub-Limit (Gateway, Task 27)

Simulate: API key with a sub-limit lower than the account's monthly allowance.

**Setup:**
- Account has Starter (1k calls)
- API key set with `kb_search_cap_monthly = 50` (via admin UI or direct DB)

**Actions:**
1. Use that API key to make KB search calls
2. Hit 50 searches
3. 51st search returns 429 from gateway (not from formula-api)
4. Response header: `X-RateLimit-Breached: kb_search_cap`
5. Body: `{"error": "API key monthly KB search cap reached"}`

**Evaluate:** (F) Per-Key Enforcement clarity

### Phase 8: AI Spend Cap (Task 27)

Similar to Phase 7 but for AI spend:

**Setup:**
- API key has `ai_spend_cap_monthly_eur = 2.00`
- Make enough AI calls to breach

**Actions:**
1. Make AI calls via that key
2. At €2.00 spend: next call → 402 (not 429 — Payment Required is the task 27 choice)
3. Header: `X-RateLimit-Breached: ai_spend_cap`
4. Body: `{"error": "API key monthly AI spend cap reached"}`

**Evaluate:** Error Handling (402 vs 429 distinction — document why)

### Phase 9: Module Allowlist Breach (Task 27)

**Setup:**
- API key with `module_allowlist = ["calculators"]`
- Try to make an AI chat call with that key

**Actions:**
1. `curl ... /v1/chat/...` with the restricted key
2. Gateway returns 403
3. Header: `X-RateLimit-Breached: module_allowlist`
4. Body: `{"error": "API key not permitted for module: ai"}`

**Evaluate:** Error Handling (precise breach naming)

## Cross-persona reactions

- **Sarah:** Upgrade path should feel urgent but not pushy — just "here's how to keep going"
- **Marcus:** Wants detailed logs of WHICH calls caused the breach (audit trail in admin dashboard?)
- **Anna:** Prefers waiting for next period to extra spending — needs clear "you're fine until <date>" copy
- **Raj:** Verifies the 429 on the gateway side vs the formula-api side using network tab; checks headers match spec

## Expected state after flow

- Test account has burned through Starter monthly quota
- Possibly upgraded to Growth via Phase 5 (depending on persona choice)
- `usage_events` has 1,000+ rows for the test month
- `monthly_aggregates` shows `calc_calls` matching the actual count

## Cleanup

- Delete or reset test usage_events to avoid polluting dev aggregates:
  ```sql
  DELETE FROM usage_events WHERE account_id = '<test>' AND metadata->>'test_marker' IS NOT NULL;
  ```
- Refresh monthly_aggregates: `SELECT public.aggregate_usage_events();` (re-runs aggregator)
- Downgrade plan back to Starter if Phase 5 upgraded
