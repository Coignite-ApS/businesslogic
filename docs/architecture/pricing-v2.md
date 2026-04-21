# Pricing v2 — Architecture

**Status:** Live in dev (2026-04-18)
**Source of truth:** This document for code/data architecture. Strategy lives in `docs/strategy/pricing.md`. Operational spec in `docs/pricing/businesslogic-api-pricing.md`. Stripe runbook in `docs/operations/stripe-production-setup.md`.

---

## 1. Mental model

A BusinessLogic account can have:
- **0 to N module subscriptions** (one per module: Calculators, KB, Flows). Each independently activated, independently billed, independently trialed.
- **0 or 1 AI Wallet** (auto-created on signup with €5 credit). Powers all AI consumption across modules.
- **0 to N API keys** (per Growth tier+, can have per-key sub-limits).

Subscription state is the source of truth for module access. Wallet state is the source of truth for AI consumption.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            ACCOUNT (1)                                  │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐               │
│  │  Calculators   │ │  Knowledge     │ │  Flows         │               │
│  │  Subscription  │ │  Base Sub      │ │  Subscription  │               │
│  │  (0 or 1)      │ │  (0 or 1)      │ │  (0 or 1)      │               │
│  │                │ │                │ │                │               │
│  │  + addons      │ │  + addons      │ │  + addons      │               │
│  └────────────────┘ └────────────────┘ └────────────────┘               │
│           │                  │                  │                        │
│           └─────────┬────────┴────────┬─────────┘                        │
│                     │                 │                                  │
│                     ▼                 ▼                                  │
│            ┌────────────────┐ ┌────────────────────────┐                 │
│            │ AI Wallet (1)  │ │  API Keys (N)          │                 │
│            │ (auto-created) │ │  per-key sub-limits    │                 │
│            └────────────────┘ └────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data model

### Core: subscriptions

```
subscription_plans  (catalog, 1 row per (module, tier, status='published'))
   │
   │  module_kind ∈ {calculators, kb, flows}
   │  tier_level  ∈ {starter, growth, scale, enterprise}
   │  feature allowances per module type:
   │    Calculators  → slot_allowance, request_allowance, ao_allowance
   │    KB           → storage_mb, embed_tokens_m
   │    Flows        → executions, max_steps, concurrent_runs, scheduled_triggers
   │  shared:        → included_api_keys, included_users, trial_days
   │  Stripe link:   → stripe_product_id, stripe_price_monthly_id, stripe_price_annual_id
   │  Multi-currency → currency_variants jsonb
   │
   ▼
subscriptions  (per-account-per-module, partial unique on active rows)
   │  account_id FK → account.id
   │  subscription_plan_id FK → subscription_plans.id
   │  module + tier (denormalized for fast filter)
   │  status ∈ {trialing, active, past_due, canceled, expired}
   │  billing_cycle ∈ {monthly, annual}
   │  Stripe link: stripe_customer_id, stripe_subscription_id (UNIQUE)
   │  Periods: current_period_start/end, trial_start/end, cancel_at
   │  Edge: grandfather_price_eur (legacy migration)
   │
   ▼
subscription_addons  (recurring or one-time addon attached to a subscription)
   │  subscription_id FK
   │  addon_kind, quantity, allowance deltas (slot_allowance_delta, etc.)
   │  Stripe link: stripe_subscription_item_id (UNIQUE)
   │  status ∈ {active, canceled, expired}
```

Key constraints:
- `subscriptions_unique_active_per_module` — partial unique index on `(account_id, module) WHERE status NOT IN ('canceled','expired')`. Enforces "one active subscription per module per account" while allowing history rows.
- `subscription_plans_unique_published` — partial unique index on `(module, tier) WHERE status='published'`. Prevents duplicate published plans for same module+tier combo.

### AI Wallet

```
ai_wallet  (1 per account)
   │  account_id FK UNIQUE
   │  balance_eur numeric(12,4) NOT NULL DEFAULT 0 CHECK (balance_eur >= 0)
   │  monthly_cap_eur (optional spend ceiling)
   │  auto_reload_{enabled, threshold_eur, amount_eur}
   │  last_topup_{at, eur}
   │
   ├─< ai_wallet_topup  (purchase history)
   │     account_id, amount_eur, expires_at (12mo from purchase)
   │     stripe_payment_intent_id UNIQUE
   │     status ∈ {pending, completed, refunded, failed}
   │     is_auto_reload boolean
   │
   └─< ai_wallet_ledger  (append-only credit/debit log; BIGSERIAL)
         account_id, entry_type ∈ {credit, debit}
         amount_eur numeric(12,6)
         balance_after_eur numeric(12,4) CHECK (balance_after_eur >= 0)
         source ∈ {topup, usage, refund, promo, adjustment}
         topup_id (nullable FK), usage_event_id (nullable FK)
         metadata jsonb, occurred_at default NOW()
```

**Hard cap convention:** the CHECK constraint `balance_eur >= 0` is the implicit hard cap. Any debit that would go negative is rejected at the DB layer. Application gates on `balance_eur > 0` before allowing AI calls. No separate `hard_cap_enabled` flag — convention is "hard cap is always on; you can't have negative balance."

**Atomicity:** every credit or debit must be a single transaction across (1) `ai_wallet_topup` upsert (if applicable), (2) `ai_wallet.balance_eur` update, (3) `ai_wallet_ledger` insert. The Phase 3 wallet handler already enforces this; the future debit hook (task 18) must do the same.

### Quotas + usage

```
feature_quotas  (materialized per-account quota view)
   account_id, module, source_subscription_id
   slot_allowance, ao_allowance, request_allowance,
   storage_mb, embed_tokens_m, executions, ...
   refreshed_at, period_start/end
   UNIQUE (account_id, module)

calculator_slots  (per-calculator slot count + always-on flag)
   calculator_id FK to calculator_configs (ON DELETE CASCADE)
   account_id FK
   size_class ∈ {XS, S, M, L, XL}
   slots_consumed integer
   always_on boolean
   last_built_rss_mb, last_loaded_at, last_evicted_at
   index (account_id, always_on)

usage_events  (append-only event stream — currently empty; populated by task 20)
   id BIGSERIAL
   account_id, api_key_id (soft FK), module
   event_type ∈ {calc_call, kb_search, kb_qa, flow_exec, ai_token}
   qty numeric, model text, tokens_in/out integer, cost_eur numeric(12,6)
   metadata jsonb, occurred_at
   indexes: (account_id, occurred_at DESC), (account_id, module, occurred_at DESC)

monthly_aggregates  (rolled-up monthly counters — currently empty; populated by task 21)
   account_id, period_yyyymm INT → composite PK
   requests, kb_searches, executions, ai_cost_eur, ai_tokens_by_model jsonb
   slots_used, ao_slots_used
   refreshed_at
```

### API keys

```
api_keys  (gateway schema, extended in v2)
   ... existing v1 fields ...
   ai_spend_cap_monthly_eur numeric(10,2)  NULL = no cap
   kb_search_cap_monthly integer            NULL = no cap
   module_allowlist jsonb                   NULL = all modules; [] = block all; ["calculators"] = allowlist

api_key_usage  (per-key monthly usage counters)
   api_key_id, period_yyyymm → composite PK
   requests, ai_cost_eur, kb_searches
   refreshed_at
```

---

## 3. Stripe ↔ DB synchronization

### Catalog (one-way: Stripe is source of truth for product/price IDs)

```
            create-products-v2.ts
            (idempotent script)
                    │
                    ▼
       ┌──────────────────────────┐
       │   Stripe Products + Prices │
       │   tagged metadata.        │
       │   pricing_version='v2'    │
       └──────────────────────────┘
                    │
                    │ generates UPSERT SQL
                    ▼
       ┌──────────────────────────┐
       │ public.subscription_plans │
       │ (stripe_product_id,       │
       │  stripe_price_*_id, etc.) │
       └──────────────────────────┘
```

The script:
- Searches Stripe by `metadata.product_key` first (idempotent)
- Updates products in place if changed (mutable: name, description, metadata)
- For prices (immutable): if amount changed, archive old + create new
- Outputs `scripts/v2-catalog-output.sql` for `/db-admin` to apply

### Subscriptions (Stripe → DB via webhooks)

```
   Customer → Stripe Checkout
                │
                ▼
   stripe.checkout.sessions.create({
     line_items: [{ price: <price_id_from_subscription_plans> }],
     mode: 'subscription',
     metadata: { account_id, module, tier },          ← session-level
     subscription_data: {
       metadata: { account_id, module, tier }          ← subscription-level (mirrored)
     }
   })
                │
                ▼
   Stripe processes payment, creates subscription
                │
                ▼
   Webhook: checkout.session.completed
                │
                ├─ withIdempotency(event.id) check       ← stripe_webhook_events table
                │
                ├─ Read metadata: { account_id, module, tier }
                │
                ├─ Lookup plan by (module, tier, status='published')
                │
                └─ UPSERT subscriptions row by (account_id, module)
                   (partial unique index ensures one active per module)
```

### Top-ups (Stripe → AI Wallet via webhooks)

```
   POST /stripe/wallet-topup { amount_eur: 20|50|200|"custom" }
                │
                ▼
   Lookup matching wallet_topup price in Stripe (by metadata)
   OR create inline price_data for custom amounts
                │
                ▼
   stripe.checkout.sessions.create({
     mode: 'payment',                          ← one-time
     metadata: {
       account_id, pricing_version: 'v2',
       product_kind: 'wallet_topup',
       wallet_topup_amount_eur: <amount>
     },
     payment_intent_data: { metadata: ... }   ← mirrored
   })
                │
                ▼
   User completes payment
                │
                ▼
   Webhook: payment_intent.succeeded
                │
                ├─ withIdempotency(event.id)
                │
                ├─ Filter by metadata.pricing_version='v2'
                │
                ├─ Route by metadata.product_kind:
                │     'wallet_topup' → process credit
                │     'addon_topup'  → defer (not implemented)
                │     other          → log + skip
                │
                └─ ATOMIC TRANSACTION:
                   1. INSERT ai_wallet_topup ON CONFLICT (stripe_payment_intent_id) DO NOTHING
                      → expires_at = NOW() + INTERVAL '12 months'
                   2. UPSERT ai_wallet (account_id) ON CONFLICT DO UPDATE
                      → balance_eur += amount_eur, last_topup_at, last_topup_eur
                      → RETURNING new balance_eur
                   3. INSERT ai_wallet_ledger
                      → entry_type='credit', amount_eur, balance_after_eur=<from step 2>,
                        source='topup', topup_id=<from step 1>
```

### Webhook idempotency

Every handler entry runs through `withIdempotency()`:

```typescript
async function withIdempotency<T>(db, event, logger, work) {
  if (await alreadyProcessed(db, event.id)) return 'duplicate';
  await work();
  await markProcessed(db, event.id, event.type, event.data?.object ?? null);
  return 'ok';
}
```

`stripe_webhook_events` table records `stripe_event_id UNIQUE`. Race-safe via PG error code 23505 on duplicate insert. Belt+suspenders with Stripe's own 24h dedup cache.

---

## 4. Auth + quota enforcement flows

### Calculator API call

```
   Client (with X-API-Key)
        │
        ▼
   Gateway: validate key → resolve account_id, fetch limits (RPS, monthly quota)
        │
        │  Rate limit check (Redis sliding window)
        │  If exceeded: 429
        │
        ▼
   formula-api: loadAccountLimitsFromDb(account_id)
        │
        │  → getActiveSubscription(db, account_id, 'calculators')  [helper]
        │     SELECT s.*, sp.* FROM subscriptions s
        │     JOIN subscription_plans sp ON s.subscription_plan_id = sp.id
        │     WHERE s.account_id = $1 AND s.module = 'calculators'
        │       AND s.status NOT IN ('canceled','expired')
        │
        │  Returns: { tier, slot_allowance, request_allowance, rps_allowance, ao_allowance }
        │  RPS: sp.rps_allowance (Starter:10, Growth:50, Scale:200, Enterprise:NULL)
        │
        │  If no subscription: return 402 "Subscription required for calculators"
        │
        ▼
   Continue with formula evaluation
```

### AI chat call

```
   Client → ai-api/chat
        │
        ▼
   checkAiQuota(account_id)
        │
        │  → hasWalletBalance(db, account_id)
        │     SELECT balance_eur FROM ai_wallet WHERE account_id = $1
        │     return parseFloat(row?.balance_eur ?? '0') > 0
        │
        │  If false: return 402 "AI Wallet balance is €0 — top up to continue"
        │
        ▼
   Run AI model call
        │
        ▼
   Record usage:
   - INSERT ai_token_usage (account, model, tokens, cost_usd, response_time_ms, tool_calls)
   - [TODO task 18] DEBIT wallet atomically:
        BEGIN;
        UPDATE ai_wallet SET balance_eur = balance_eur - $cost WHERE account_id = $1
          RETURNING balance_eur;  ← CHECK constraint rejects if would go negative
        INSERT ai_wallet_ledger (account_id, entry_type='debit', amount_eur=$cost,
          balance_after_eur=$new, source='usage', metadata={...});
        COMMIT;
```

### KB search/Q&A

Search: gated by KB module subscription only. No per-search billing.
Q&A: gated by KB module subscription AND wallet balance > 0 (because AI tokens are consumed).

### Flow execution

Gated by Flows module subscription. AI steps inside flows debit AI Wallet (same as direct AI calls).

---

## 5. Trial mechanics

**Empty trial model** (decided 2026-04-18):

1. **At signup**: account hook fires
   - Account row created
   - `ai_wallet` row created with `balance_eur = 5.00`
   - `ai_wallet_ledger` entry: `(credit, 5.00, source='promo', metadata={"reason":"signup_bonus"})`
   - **NO subscriptions created**

2. **First module activation**: user POSTs `/stripe/checkout {module, tier, billing_cycle}`
   - Checkout session looks up plan → uses `stripe_price_monthly_id` or `stripe_price_annual_id`
   - **If account has NO prior subscription for this module** (`EXISTS WHERE account_id AND module AND trial_end IS NOT NULL` returns false): set `trial_period_days: 14`
   - **If account already trialed this module** (history row exists): no trial, immediate billing

3. **Per-module trial expiry**: hourly cron
   - `WHERE status='trialing' AND trial_end < NOW()` → set `status='canceled'`
   - One-shot — no retry, no payment_method check (Stripe handles "trial converts to paid" via its own machinery; this cron only catches trials that were never converted)

4. **Auto-cancellation on payment failure**: handled by Stripe's `customer.subscription.updated/deleted` webhooks → `status='past_due'` then `canceled`.

---

## 6. Code organization

```
services/cms/extensions/local/
├── _shared/
│   └── v2-subscription.ts          ← getActiveSubscription, getWalletState, hasWalletBalance
│
├── project-extension-stripe/
│   ├── scripts/
│   │   ├── create-products-v2.ts   ← idempotent catalog sync
│   │   ├── README.md               ← script usage docs
│   │   └── v2-catalog-output.sql   ← gitignored — regenerated per env
│   ├── src/
│   │   ├── index.ts                ← entry: routes + hooks (checkout, portal, register, trial cron)
│   │   ├── webhook-handlers.ts     ← all 6 Stripe webhook handlers + idempotency
│   │   ├── wallet-handlers.ts      ← 3 wallet endpoints
│   │   ├── stripe-client.ts        ← Stripe SDK singleton
│   │   ├── types.ts                ← v2 type definitions
│   │   └── register.ts             ← public signup form
│   └── package.json
│
├── project-extension-account/      ← UI for current user's subscriptions + wallet
├── project-extension-admin/        ← admin: MRR matrix, accounts list with subs
├── project-extension-ai-api/       ← auth.ts + tools.ts gates AI wallet + KB module
├── project-extension-ai-assistant/ ← UI: shows wallet balance + top-up CTAs
├── project-extension-calculator-api/ ← auth.ts + admin-routes.ts + index.ts
├── project-extension-calculators/  ← UI: config card with tier picker
└── project-extension-knowledge-api/ ← auth.ts + metering.ts gates KB module + storage

services/ai-api/src/utils/auth.js         ← inlined wallet check (plain JS service)
services/formula-api/src/services/calculator-db.js  ← inlined helper (plain JS service)
```

---

## 7. Known transitional patterns (refactor when conditions met)

| Pattern | Why transitional | When to refactor | Owner task |
|---|---|---|---|
| Direct JOIN reader pattern | Decouples from feature_quotas refresh job | When task 17 ships | Task 17 |
| 1-calc-=-1-slot proxy in slot enforcement | Slot computation not yet implemented | When task 19 ships | Task 19 |
| Wallet balance "infinite" (never debits) | Debit hook deferred to task 18 | When task 18 ships | Task 18 |
| `metrics-aggregator.js` reads from new columns but rollup not scheduled | Background job not wired | When task 21 ships | Task 21 |
| `monthly_aggregates` and `api_key_usage` lack Directus collection metadata | Composite PKs; service-internal counters | If admin UI needs to display them | Task 25 |

---

## 8. Failure modes and what catches them

| Failure | Catch |
|---|---|
| Duplicate Stripe webhook delivery | `stripe_webhook_events` table dedup + idempotency wrapper |
| Race on top-up (concurrent payments) | `stripe_payment_intent_id UNIQUE` constraint on `ai_wallet_topup` |
| Negative wallet balance | `CHECK (balance_eur >= 0)` on ai_wallet; same on ai_wallet_ledger.balance_after_eur |
| Two active subs for same module on same account | Partial unique index `subscriptions_unique_active_per_module` |
| Two published plans for same (module, tier) | Partial unique index `subscription_plans_unique_published` |
| Account deleted while subs/wallet exist | All FKs use `ON DELETE CASCADE` (subs, addons, slots, wallet, topups, ledger, usage_events, etc.) |
| Plan price changes | Stripe price is immutable — old price archived, new one created; existing subscriptions keep old price (Stripe doesn't auto-migrate) |
| Stale `subscription_plans` row referencing archived Stripe price | Sync via `syncAllProducts()` on startup + on `product.updated` webhook |
| AI call when wallet is €0 | Phase 4 auth gate returns 402 BEFORE making the model call (no charge incurred) |

---

## 9. Glossary

- **Module** — One of `calculators`, `kb`, `flows`. Independent product surface.
- **Tier** — One of `starter`, `growth`, `scale`, `enterprise`. Pricing/feature ladder per module.
- **Slot** — Unit of calculator capacity. Sized by Excel built RSS / sheet count / formula count. XS=1 slot, S=3, M=8, L=20, XL=enterprise.
- **Always-on** — Per-calculator switch that pins the workbook in memory 24/7. Costs 2× slot count.
- **AI Wallet** — Per-account EUR balance used for all AI consumption. Top up in €20/€50/€200 packs (12-month expiry).
- **Add-on** — Recurring (slot pack, AO pack, KB storage) or one-time (request pack, embed pack, exec pack) purchase that augments a base subscription.
- **Trial** — 14-day per-module zero-charge period that starts on first activation of that module.
- **Hard cap** — Implicit constraint that wallet balance can't go negative (DB CHECK). Not a separate flag.
- **Monthly cap** — Optional voluntary spending ceiling per month (`ai_wallet.monthly_cap_eur`).
- **Auto-reload** — Optional configuration to top up wallet automatically when balance < threshold (config writeable now; behavior ships in task 18).
