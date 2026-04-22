# 15. Pricing v2 — Directus Schema (DB Admin)

**Status:** completed (Inv 1 — `pricing-v2-schema` + Inv 2 — `ai-token-usage-fk-fix`) — 2026-04-18
**Phase:** 1 — Foundation (precedes any v2 pricing rollout)
**Priority:** High — blocks Stripe + metering work
**MUST be executed via `/db-admin`** — no direct schema or `snapshot.yaml` edits.

**Inv 1 report:** [docs/reports/db-admin-2026-04-18-pricing-v2-schema-064122.md](../../reports/db-admin-2026-04-18-pricing-v2-schema-064122.md)
**Inv 2 report:** [docs/reports/db-admin-2026-04-18-ai-token-usage-fk-fix-073027.md](../../reports/db-admin-2026-04-18-ai-token-usage-fk-fix-073027.md)
**Follow-up tasks (Phase 8):** 16, 17, 18, 19, 20, 21, 22, 23, 24, 25 in cross-cutting/

---

## Goal

Design and implement the Directus collections required by the **modular v2 pricing model** so the platform can:
- Store per-account active modules and tiers
- Compute and enforce per-feature quotas
- Track calculator slots and always-on flags
- Manage the AI Wallet (balance, top-ups, ledger)
- Enforce per-API-key sub-limits
- Aggregate usage events for billing reports

**Canonical source:** `docs/strategy/pricing.md` and `docs/pricing/businesslogic-api-pricing.md`.

---

## Collections to design

### Core subscription model

| Collection | Purpose | Schema owner |
|---|---|---|
| `subscription_plans` | Module/tier catalog. Mirrors Stripe products. (module, tier, price_eur, slot_allowance, request_allowance, ao_allowance, storage_mb, embed_tokens_m, executions, max_steps, concurrent_runs, stripe_price_monthly, stripe_price_annual, currency_variants_json) | cms |
| `subscriptions` | Per-account subscription rows — ONE per active module. (account_id, module, tier, status, billing_cycle, stripe_subscription_id, current_period_start/end, trial_end, cancel_at, grandfather_price_eur) | cms |
| `subscription_addons` | Recurring add-on packs attached to a subscription. (subscription_id, addon_type, qty, stripe_subscription_item_id, current_period_start/end) | cms |

### Quotas + usage

| Collection | Purpose | Schema owner |
|---|---|---|
| `feature_quotas` | Materialized per-account quota view: aggregated allowances from subscriptions + add-ons. (account_id, module, slots, requests, ao_slots, storage_mb, embed_tokens_remaining, executions, period_start/end). Refreshed on subscription change. | cms |
| `calculator_slots` | Per-calculator slot count + always-on flag + size class. Computed at upload by formula-api, stored in cms. (calculator_id, account_id, size_class, slots_consumed, always_on, last_evicted_at) | cms |
| `usage_events` | Append-only event stream. (account_id, api_key_id, module, event_type, qty, model, tokens_in, tokens_out, cost_eur, timestamp). Source: each service emits via Redis stream → consumer writes here. | cms |
| `monthly_aggregates` | Materialized monthly counters per account. (account_id, period_yyyymm, requests, kb_searches, executions, ai_cost_eur, ai_tokens_by_model_json). Updated nightly + on-demand. | cms |

### AI Wallet

| Collection | Purpose | Schema owner |
|---|---|---|
| `ai_wallet` | Per-account wallet config. (account_id, balance_eur, monthly_spend_cap_eur, hard_cap_enabled, auto_reload_enabled, auto_reload_threshold_eur, auto_reload_amount_eur, alert_thresholds_json) | cms |
| `ai_wallet_topup` | Top-up purchase history. (account_id, amount_eur, purchased_at, expires_at, stripe_checkout_session_id, remaining_eur) | cms |
| `ai_wallet_ledger` | Append-only ledger of all credits/debits. (account_id, ts, type [credit/debit], amount_eur, balance_after_eur, source [topup/usage/refund/expiry], reference_id, model, tokens_in, tokens_out) | cms |

### API key sub-limits

| Collection | Purpose | Schema owner |
|---|---|---|
| `api_key_limits` | Per-key sub-limits (already partial — extend existing). (api_key_id, request_cap_monthly, ai_spend_cap_monthly_eur, kb_search_cap_monthly, rps_cap, ip_allowlist_json, module_allowlist_json) | cms |
| `api_key_usage` | Per-key monthly usage counters. (api_key_id, period_yyyymm, requests, ai_cost_eur, kb_searches) | cms |

---

## Required workflow per `/db-admin`

1. **Pre-snapshot** before ANY changes (`make snapshot-pre SLUG=pricing-v2-schema`)
2. **Consult user** with full schema proposal — every collection, every field, every relation, every permission
3. **Write SQL migration** (NOT `make apply` — see memory `feedback_schema_apply_danger.md`)
4. **Apply migration** + `make snapshot` after
5. **Schema diff verification** — confirm exactly the intended changes landed
6. **Update `snapshot.yaml`** to match
7. **Post-snapshot** (`make snapshot-post SLUG=pricing-v2-schema`)
8. **Dated report** to `docs/reports/db-admin-YYYY-MM-DD-pricing-v2.md`

---

## Permissions matrix

| Collection | Account role read | Account role write | Service read | Service write |
|---|---|---|---|---|
| `subscription_plans` | YES (catalog) | NO | All | NO (admin only via Stripe sync) |
| `subscriptions` | Own only | NO (Stripe owns) | All | cms only (via webhook) |
| `subscription_addons` | Own only | NO | All | cms only |
| `feature_quotas` | Own only | NO | gateway, ai-api, formula-api, flow | cms only (refresh) |
| `calculator_slots` | Own only | NO | formula-api | formula-api (compute on upload) |
| `usage_events` | Own only (last 30 days) | NO | All emit | All emit, none read except cms aggregator |
| `monthly_aggregates` | Own only | NO | All (read for limits) | cms only (nightly job) |
| `ai_wallet` | Own only | Own (cap settings) | gateway, ai-api | cms only (balance debits via ledger) |
| `ai_wallet_topup` | Own only | NO (Stripe owns) | cms | cms only (via webhook) |
| `ai_wallet_ledger` | Own only | NO | ai-api (debit), cms (credit) | ai-api debits, cms credits |
| `api_key_limits` | Own only | Own (set caps) | gateway | cms (UI), gateway enforces |
| `api_key_usage` | Own only | NO | gateway | gateway (atomic increment) |

**Critical:** every collection must enforce `account_id` row-level filtering (per `feedback_kb_data_isolation.md` — account-level + API-key-level isolation is mandatory).

---

## Indexes (required for performance)

- `usage_events`: `(account_id, timestamp)`, `(account_id, module, timestamp)`
- `monthly_aggregates`: PK `(account_id, period_yyyymm)`
- `ai_wallet_ledger`: `(account_id, ts DESC)` for transaction history queries
- `ai_wallet_topup`: `(account_id, expires_at)` for expiry sweep
- `subscriptions`: `(account_id, status)` for active subscription lookup
- `calculator_slots`: `(account_id, always_on)` for memory pinning queries
- `api_key_usage`: PK `(api_key_id, period_yyyymm)`

---

## Acceptance

- [ ] `/db-admin` workflow executed end-to-end with pre/post snapshots
- [ ] All 11 collections exist in dev with correct fields and types
- [ ] All FKs and indexes in place
- [ ] Permissions enforce row-level account isolation
- [ ] Schema snapshot YAML committed
- [ ] Migration script present and idempotent
- [ ] Dated report at `docs/reports/db-admin-YYYY-MM-DD-pricing-v2.md`
- [ ] Audit log shows no unintended drops or alters
- [ ] Test: insert dummy account, subscribe to Calc Growth, verify `feature_quotas` populates correctly

---

## Dependencies

- **Blocks:** `cross-cutting/14-pricing-v2-stripe-catalog.md` (Stripe webhooks need these tables to exist)
- **Blocked by:** Strategic approval of v2 pricing model (DONE 2026-04-17)
- **Related:** `cms/08-pricing-billing.md` (master)

---

## Risk notes

- **Existing `subscriptions` collection** likely already exists for v1 — must extend, not replace. The `/db-admin` workflow will diff and propose.
- **Existing `calculator_calls`** collection (per current schema) may overlap with `usage_events`. Decide: extend `calculator_calls` to be the calc-specific event type within `usage_events`, OR keep separate and write twice. Resolve in consultation phase.
- **AI Wallet ledger growth** — append-only, will grow large. Plan partitioning by month or archival to S3 after 12 months.
- **Stripe webhook idempotency** — `subscriptions` writes must use `stripe_subscription_id` as upsert key.
