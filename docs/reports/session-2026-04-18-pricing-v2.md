# Session Log — Pricing v2 Implementation

**Date:** 2026-04-17 (planning) → 2026-04-18 (implementation)
**Branch:** `dev`
**Status:** Code-complete in dev; production deployment pending operational steps (see §10)

---

## 1. Outcome

The platform now has a fully functional **modular pricing v2** stack in dev:

- 3 independent module subscriptions (Calculators, Knowledge Base, Flows) × 4 tiers each (Starter, Growth, Scale, Enterprise)
- Horizontal **AI Wallet** in EUR with one-time top-ups (€20/€50/€200/custom), 12-month expiry, atomic ledger
- Per-module 14-day trial on first activation (no auto-trial-subscriptions at signup; signup gives €5 wallet credit only)
- Per-API-key sub-limits (`ai_spend_cap_monthly_eur`, `kb_search_cap_monthly`, `module_allowlist`) — schema in place; enforcement deferred to gateway work
- Recurring add-ons (slot packs, always-on packs, KB storage) and one-time top-up packs (request packs, embed token packs, execution packs)
- Stripe test catalog (23 products) live and linked to `subscription_plans`
- Admin financials show MRR by `(module, tier)` matrix + AI Wallet revenue separately

---

## 2. Timeline

### 2026-04-17 — Strategy & planning
1. BizDev agent produced initial 5-tier bundled pricing recommendation
2. User rejected bundled tiers in favor of **modular feature activation**
3. Refined model: per-module subs + AI Wallet, no free tier (14-day trial)
4. Calculator slot system designed (XS/S/M/L/XL by built RSS) to honestly price memory cost
5. EUR primary currency (Europe expansion)
6. Pricing markdown rewritten; xlsx rebuilt with Quote/Catalog/Currency/Scenarios/COGS sheets
7. Strategy doc, operational spec, BizDev report all aligned to v2

### 2026-04-18 — Schema (task 15)
8. Plan-mode session: explored existing schema, decided to drop+rebuild `subscriptions`/`subscription_plans` (no live customer on this codebase)
9. **/db-admin Inv 1 (`pricing-v2-schema`)**: 14 migrations (002–014 cms + 008 gateway), drop+rebuild 2 tables, add 9 new tables, extend `api_keys` with 3 cols, register 9 collections via Directus REST API, apply 26 row-level account-isolation permissions
10. **/db-admin Inv 2 (`ai-token-usage-fk-fix`)**: closed pre-existing data isolation gap on `ai_token_usage.account` (NOT NULL + FK + index)
11. **/db-admin (`ai-token-usage-cols`)**: surfaced bug in `chat.js` writing to non-existent `response_time_ms` and `tool_calls` columns (silent INSERT failures via `try/catch`); added the columns

### 2026-04-18 — Code refactor (task 14, 5 phases)
12. Plan-mode session: explored 26 broken downstream call sites; decided empty-trial model + direct-JOIN reader pattern + atomic ship in one task
13. **Phase 1**: Stripe product catalog script (idempotent, 23 products with metadata `pricing_version=v2`, generates UPSERT SQL for `subscription_plans`)
14. **Phase 2**: Stripe webhook + checkout refactor (multi-module routing via `metadata.module`, `withIdempotency()` wrapper backed by new `stripe_webhook_events` dedup table); register hook now provisions €5 wallet credit instead of auto-subscription; trial cron sets `canceled` per module
15. **/db-admin (`stripe-webhook-events`)**: applied migration 016 (additive)
16. **Phase 3**: AI Wallet endpoints (`POST /stripe/wallet-topup`, `POST /stripe/wallet-config`, `GET /wallet/balance`) + atomic credit flow on `payment_intent.succeeded` (single transaction: topup row + balance increment + ledger entry)
17. **Phase 4**: 15 auth/metering sites refactored across 6 extensions + 2 Node services. Created shared helper `services/cms/extensions/local/_shared/v2-subscription.ts` (TS) + inlined equivalent in plain JS for `services/ai-api/` and `services/formula-api/`. AI gates switched to wallet balance (HTTP 402 when ≤ €0). KB count gates dropped (v2 enforces only storage). RPS mapping by tier (Starter=10, Growth=50, Scale=200) — transitional pending per-key RPS decision.
18. **Phase 5**: 8 UI sites refactored — account UI renders per-module subscription cards + AI Wallet card + activation buttons; AI Assistant upgrade dialog now shows wallet balance + top-up CTAs; calculator config-card filtered to `module=calculators`; admin overview shows (module × tier) MRR matrix + AI Wallet revenue line
19. **Stripe test catalog created** — 23 products in Stripe test mode, all tagged `metadata.pricing_version=v2`
20. **/db-admin (`seed-v2-plans-test`)**: applied migration 018 — 12 `subscription_plans` rows inserted linking to test product/price IDs
21. **Generator script bugs fixed** — patched two SQL output bugs (`ON CONFLICT` clause syntax + missing `id` column with `gen_random_uuid()`); future re-runs produce clean SQL on first try

---

## 3. Locked decisions and rationale

| # | Decision | Why |
|---|---|---|
| 1 | **Modular activation, not bundled tiers** | Features ship at different times; honest billing builds trust; bundled tiers anchor too early |
| 2 | **No free tier; 14-day trial only** | AI inference is expensive to subsidize; B2B trial→paid is cleaner than free→paid; calculator memory is finite |
| 3 | **Empty trial: signup = €5 AI Wallet credit, no auto-subs** | Per-module trial starts on first activation; aligns with "pay for what you use" |
| 4 | **Calculator slot system (XS=1, S=3, M=8, L=20)** | Memory is the real cost driver; honest pricing for big workbooks |
| 5 | **Always-on as 2× slot multiplier** | User self-selects performance tier; explicit cost transparency |
| 6 | **AI Wallet in EUR, not credits** | Cursor's June 2025 credit-system implosion is the cautionary tale |
| 7 | **1.5× wholesale markup on AI tokens** | Margin protection across model mix (Opus/Sonnet/Haiku); all tiers profitable |
| 8 | **Hard cap convention via `balance_eur > 0` (no flag column)** | DB CHECK constraint enforces non-negative; app gate is just `> 0` check; simpler |
| 9 | **Drop + rebuild `subscriptions`/`subscription_plans`** | No live customer on this codebase (legacy €74 customer is on a different deployment); cleanest schema |
| 10 | **Direct-JOIN reader pattern, not feature_quotas** | Decouples task 14 from task 17 (feature_quotas refresh job); migrate to feature_quotas later for performance |
| 11 | **Programmatic Stripe product setup via script** | Idempotent, reproducible across test/prod, version-controlled, no Dashboard click-around |
| 12 | **Webhook idempotency via `stripe_webhook_events` table** | Belt+suspenders with Stripe's own 24h dedup; handles redelivery cleanly |
| 13 | **`public.*` schema for all v2 tables (not `cms.*`)** | The schema-per-service split from CLAUDE.md isn't implemented in DB yet; deferred |
| 14 | **17% annual discount (pay 10 get 12)** | Industry standard; matches Stripe/Linear/Vercel/Notion |
| 15 | **EUR primary, USD/DKK secondary** | Europe expansion focus; Stripe handles per-currency prices on same product |

---

## 4. Artifacts

### Strategy & Pricing
- `docs/strategy/pricing.md` — strategic rationale + roadmap (canonical)
- `docs/pricing/businesslogic-api-pricing.md` — operational spec (tier prices, slot rules, COGS)
- `docs/pricing/Businesslogic API Pricing.xlsx` — interactive Quote calculator
- `docs/pricing/Businesslogic API Pricing.v1-backup.xlsx` — v1 archive
- `docs/reports/bizdev-strategy-2026-04-17-pricing.md` — full BizDev analysis (frozen)

### Schema (task 15)
- `migrations/cms/{002–014}_*.sql` + paired `_down.sql` (14 migration pairs)
- `migrations/gateway/008_api_key_v2_limits.sql` + `_down.sql`
- `services/cms/snapshots/snapshot.yaml` — canonical schema (updated)
- `services/cms/snapshots/{pre,post}_pricing-v2-schema*.yaml` — task snapshots
- `docs/reports/db-admin-2026-04-18-pricing-v2-schema-064122.md`

### Data integrity fixes
- `migrations/cms/015_ai_token_usage_account_fk.sql` (+ down) — Inv 2
- `migrations/cms/017_ai_token_usage_observability_cols.sql` (+ down) — ai-api/19
- `services/cms/snapshots/{pre,post}_ai-token-usage-*.yaml`
- `docs/reports/db-admin-2026-04-18-ai-token-usage-fk-fix-073027.md`
- `docs/reports/db-admin-2026-04-18-ai-token-usage-cols-114751.md`

### Code (task 14)
- **Stripe extension** (`services/cms/extensions/local/project-extension-stripe/`)
  - `scripts/create-products-v2.ts` — Phase 1 idempotent catalog script (23 products)
  - `scripts/v2-catalog-output.sql` — generated SQL (test-mode; regenerate for prod)
  - `scripts/README.md` — usage docs
  - `src/types.ts` — v2 type definitions
  - `src/webhook-handlers.ts` — refactored handlers + new `handlePaymentIntentSucceeded`
  - `src/index.ts` — refactored checkout, account hook, portal, trial cron
  - `src/wallet-handlers.ts` — Phase 3 wallet endpoints
  - `package.json` — added `tsx` + `npm run stripe:create-v2-products`
- **Shared helper**
  - `services/cms/extensions/local/_shared/v2-subscription.ts` — `getActiveSubscription`, `getWalletState`, `hasWalletBalance`
- **Auth/metering refactor** (Phase 4 — 9 files modified):
  - `services/cms/extensions/local/project-extension-calculator-api/src/{auth,index,admin-routes}.ts`
  - `services/cms/extensions/local/project-extension-knowledge-api/src/{auth,metering}.ts`
  - `services/cms/extensions/local/project-extension-ai-api/src/{auth,tools}.ts`
  - `services/ai-api/src/utils/auth.js`
  - `services/formula-api/src/services/calculator-db.js`
- **UI/admin refactor** (Phase 5 — 6 files modified):
  - `services/cms/extensions/local/project-extension-account/src/{composables/use-account.ts, components/subscription-info.vue, routes/subscription.vue, types.ts}`
  - `services/cms/extensions/local/project-extension-ai-assistant/src/module.vue`
  - `services/cms/extensions/local/project-extension-calculators/src/components/config-card.vue`
  - `services/cms/extensions/local/project-extension-admin/src/{routes/overview.vue, routes/accounts.vue, types.ts}`
- **Migrations**:
  - `migrations/cms/016_stripe_webhook_events.sql` (+ down) — Phase 2 dedup table
  - `migrations/cms/018_seed_v2_plans_test.sql` (+ down) — Phase 1 SQL applied
- `docs/reports/db-admin-2026-04-18-stripe-webhook-events-120420.md`
- `docs/reports/db-admin-2026-04-18-seed-v2-plans-test-161226.md`

### Tasks
- `docs/tasks/cms/08-pricing-billing.md` — master tracker (revised)
- `docs/tasks/cross-cutting/14-pricing-v2-stripe-catalog.md`
- `docs/tasks/cross-cutting/15-pricing-v2-directus-schema.md` — completed
- `docs/tasks/cross-cutting/16-snapshot-makefile-container-fix.md`
- `docs/tasks/cross-cutting/17-pricing-v2-feature-quotas-refresh-job.md`
- `docs/tasks/cross-cutting/18-pricing-v2-ai-wallet-debit-trigger.md`
- `docs/tasks/cross-cutting/19-pricing-v2-calculator-slots-compute.md`
- `docs/tasks/cross-cutting/20-pricing-v2-usage-events-emitter.md`
- `docs/tasks/cross-cutting/21-pricing-v2-monthly-aggregates-job.md`
- `docs/tasks/cross-cutting/22-pricing-v2-calls-per-month-enforcement.md`
- `docs/tasks/cross-cutting/23-bl-flow-executions-account-fk.md`
- `docs/tasks/cross-cutting/24-pricing-v2-ai-wallet-ledger-partitioning.md`
- `docs/tasks/cross-cutting/25-pricing-v2-counter-tables-directus-tracking.md`
- `docs/tasks/ai-api/19-ai-token-usage-column-mismatch.md` — completed
- `docs/tasks/README.md` — updated index

### Architecture & runbooks (this session)
- `docs/architecture/pricing-v2.md` — system architecture, data model, flows
- `docs/operations/stripe-production-setup.md` — production deployment runbook
- `docs/reports/session-2026-04-18-pricing-v2.md` — this file

---

## 5. Schema state (verifiable)

```bash
docker exec businesslogic-postgres-1 psql -U directus -d directus -c "
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN (
    'subscription_plans','subscriptions','subscription_addons',
    'feature_quotas','calculator_slots','usage_events','monthly_aggregates',
    'ai_wallet','ai_wallet_topup','ai_wallet_ledger','api_key_usage',
    'stripe_webhook_events','ai_token_usage','api_keys'
  ) ORDER BY table_name;
"
```

Should return all 14 tables. Plus 2 enum types: `module_kind` and `tier_level`.

12 plan rows (3 modules × 4 tiers):
```bash
docker exec businesslogic-postgres-1 psql -U directus -d directus -c "
  SELECT module, tier, name, price_eur_monthly FROM public.subscription_plans
  ORDER BY module, sort;
"
```

---

## 6. Verification done

- ✅ All 18 extensions build (`make ext`)
- ✅ Account extension Vitest: 15/15 pass
- ⚠ Calculator-api Vitest: 118/121 pass (3 stale fixtures from v1 — captured in follow-up)
- ✅ TypeScript compiles for all extension code
- ✅ Plain JS files in `services/ai-api/` and `services/formula-api/` pass `node --check`
- ✅ All migrations applied via /db-admin with Phase 4.5 + 6.5 integrity verification
- ✅ Database `make diff` is clean (no drift between snapshot.yaml and live DB)
- ✅ Stripe test products visible at https://dashboard.stripe.com/test/products?metadata%5Bpricing_version%5D=v2
- ✅ End-to-end shape tests in db-admin reports (subscriptions partial unique index, FK enforcement, wallet credit flow, etc.)

**Not yet verified (blocked on operational steps):**
- ❌ Live checkout flow (requires Stripe webhook endpoint registration in Stripe Dashboard)
- ❌ Top-up flow round-trip (requires webhook delivery to dev → would need ngrok or stripe-cli)
- ❌ Browser smoke test of account UI rendering

---

## 7. Stripe configuration (test mode — done)

- 23 products created in Stripe test mode
- All tagged `metadata.pricing_version=v2`
- Each base subscription has 4 prices: EUR monthly + EUR annual + USD monthly + USD annual
- One-time products (top-ups, packs) have 2 prices: EUR + USD
- Webhook secret in `infrastructure/docker/.env` (`STRIPE_WEBHOOK_SECRET=whsec_...`) — already set
- Webhook endpoint NOT registered in Stripe Dashboard yet (operational step)

To register webhook:
1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://<dev-or-prod-host>/stripe/webhook` (or use `stripe listen --forward-to localhost:18055/stripe/webhook` for local dev)
3. Events: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`, `payment_intent.succeeded`, `product.updated`
4. Webhook secret already in env — verify it matches what Stripe shows

---

## 8. Stripe configuration (production — pending)

See `docs/operations/stripe-production-setup.md` for the full runbook. Summary:

1. `STRIPE_SECRET_KEY=sk_live_... npm run stripe:create-v2-products` (script auto-detects live mode, prints 🔴 warning, 5s abort window)
2. Move `scripts/v2-catalog-output.sql` to `migrations/cms/NNN_seed_v2_plans_prod.sql` (next available number)
3. `/db-admin seed-v2-plans-prod` to apply
4. Register webhook in production Stripe Dashboard
5. Smoke test with a real test transaction (Stripe doesn't have real test cards in live mode — use a real card with €0.50 charge then refund)

---

## 9. Outstanding work — sprint planning

Tasks created today (status `planned` unless noted):

| Task | Severity | Estimate | Required for v2 launch? |
|---|---|---|---|
| **cross-cutting/16** Snapshot Makefile container-name fix | MEDIUM | 0.5d | No (workaround in place) |
| **cross-cutting/17** feature_quotas refresh job | HIGH | 1d | No (direct JOIN works) |
| **cross-cutting/18** AI Wallet atomic debit hook in ai-api | HIGH | 1.5d | **YES** — wallet doesn't actually deplete without this |
| **cross-cutting/19** calculator_slots compute on upload | HIGH | 1d | **YES** — slot count enforcement is currently a 1-calc-=-1-slot proxy |
| **cross-cutting/20** usage_events emitter pipeline | HIGH | 2d | No (analytics only) |
| **cross-cutting/21** monthly_aggregates rollup job | HIGH | 1d | No (depends on 20) |
| **cross-cutting/22** calls_per_month enforcement | MEDIUM | 0.5d | No (Phase 4 already enforces request_allowance via gateway) |
| **cross-cutting/23** bl_flow_executions account FK fix | MEDIUM | 0.5d | No (data integrity hardening) |
| **cross-cutting/24** ai_wallet_ledger partitioning | LOW | 1d | Defer until row count > 10M |
| **cross-cutting/25** Counter tables Directus tracking | LOW | 0.5d | Defer (admin convenience) |

Plus newly identified:

| Task | Severity | Estimate | Notes |
|---|---|---|---|
| **(new)** Production seed migration | MEDIUM | 0.5d | One-shot operational task; combine with prod webhook setup |
| **(new)** Stale calculator-api test fixtures (3 tests) | LOW | 0.5d | Update fixtures to v2 schema |
| **(new)** Account isolation E2E test | MEDIUM | 1d | Verify per-account row-level filtering works for all 11 new collections |
| **(new)** Wallet auto-reload UI surface | LOW | 0.5d | Config endpoint exists, no UI yet |
| **(new)** AI assistant low-balance banner outside dialog | LOW | 0.5d | Inline in conversation-nav |
| **(new)** PlanCards shared component v2 rewrite | LOW | 0.5d | Currently uses v1→v2 mapping |

### Recommended sprint plan (post-merge)

**Sprint 1: Make wallet actually work (blockers for revenue)** — ~2.5d
- Task 18 (AI Wallet debit hook) — 1.5d
- Task 19 (calculator_slots compute) — 1d

**Sprint 2: Production deployment + monitoring** — ~2d
- Production seed + webhook registration — 0.5d
- Account isolation E2E test — 1d
- Smoke test in production — 0.5d

**Sprint 3: Analytics + observability** — ~3d
- Task 20 (usage_events emitter) — 2d
- Task 21 (monthly_aggregates rollup) — 1d (parallel with 20 once 20's emitter contract is set)

**Sprint 4: Quality of life + tech debt** — ~3d (parallelizable)
- Task 17 (feature_quotas refresh) — 1d
- Task 16 (Makefile fix) — 0.5d
- Task 22 (calls_per_month) — 0.5d
- Task 23 (bl_flow_executions FK) — 0.5d
- Test fixture updates — 0.5d

---

## 10. Known good state — recovery instructions

If anything goes wrong, recovery from this session's state:

### Database
- Pre-task PG dumps: `infrastructure/db-snapshots/pre_*_20260418_*.sql.gz` (gitignored — large)
- Post-task PG dumps: `infrastructure/db-snapshots/post_*_20260418_*.sql.gz`
- Restore latest: `gunzip -c infrastructure/db-snapshots/post_seed-v2-plans-test_20260418_161207.sql.gz | docker exec -i businesslogic-postgres-1 psql -U directus -d directus`

### Code
- All work committed to `dev` branch (this session's commits)
- Each commit message summarizes scope; full detail in this report
- Roll back via `git revert <sha>` (commits are designed to be revertible)

### Stripe
- Test products are tagged `metadata.pricing_version=v2`
- To wipe and re-create: archive products manually in Stripe Dashboard, then re-run script
- Production products are NOT yet created (operational step pending)

### Snapshots
- `services/cms/snapshots/snapshot.yaml` — canonical (committed)
- Snapshot directory has rolling 5-copy retention via `make prune` (count-based, never time-based)

---

## 11. Decision log (frozen)

This is the durable record of why we chose what we chose:

- **Q1 (schema location)**: 1C — keep `migrations/cms/` paths, write `public.*` SQL. Defer real schema split.
- **Q2 (column renames)**: YES — `account → account_id`, `plan → subscription_plan_id`. Aligns with `api_keys`.
- **Q3 (apply strategy)**: 3A — raw psql + Directus REST API for collection registration. Memory `feedback_schema_apply_danger.md` honored.
- **Q4 (policy mapping)**: User Access for account user reads; per-service policies for service reads.
- **Q5 (services on shared collections)**: All 4 service policies get read on `feature_quotas`, `monthly_aggregates`.
- **Trial scope**: Empty trial — €5 wallet credit only, per-module trial on activation.
- **Task shape**: One task 14 with 5 phases — atomic ship.
- **Reader pattern**: Direct JOIN — decouples from task 17.
- **Schema shape**: Drop+rebuild same names — no live customer to protect.
- **Code refactor scope**: Schema-only in 15, code in 14.
- **Backfill policy (`ai_token_usage`)**: Policy A (DELETE WHERE NULL) — was a no-op (0 rows).
- **`duration_ms` in ai_token_usage**: Option X (KEEP) — preserve safety net; defer drop.
- **Two /db-admin invocations for task 15**: yes, separate risk profiles.

---

## 12. Memory updates this session

Auto-memory at `/Users/kropsi/.claude/projects/-Users-kropsi-Documents-Claude-businesslogic/memory/` was added to during the session — see `MEMORY.md` for current index. New entry: `feedback_schema_apply_danger.md` (NEVER use `make apply` for surgical changes).

---

## 13. What's NOT in this session (explicitly out of scope)

- Production deployment (operational steps documented in runbook)
- AI Wallet debit on actual AI usage (task 18)
- Calculator slot real enforcement (task 19 — currently uses 1-calc proxy)
- Usage events / monthly aggregates analytics (tasks 20, 21)
- Per-API-key sub-limit enforcement at gateway (schema in place; code work TBD)
- bl-SDK billing methods (deferred — internal use first)
- Onboarding wizard for empty trial (cms/03 — exists as separate task)
- Cohort migration of existing test customer (no live customer; not applicable)
