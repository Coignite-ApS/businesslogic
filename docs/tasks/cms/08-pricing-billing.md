# 08. Pricing & Billing Evolution — v2 Modular

**Status:** planned
**Phase:** 1 — Foundation
**Priority:** High — blocks monetization of AI, KB, Flows (currently unmonetized)

> **Model approved 2026-04-17.** This task becomes the master tracker for v2 rollout. Implementation work is split into focused sub-tasks below.

---

## Canonical references

| Doc | Purpose |
|---|---|
| `docs/strategy/pricing.md` | Strategic rationale — why modular, why AI Wallet, principles, roadmap |
| `docs/pricing/businesslogic-api-pricing.md` | Operational spec — tier prices, slot rules, add-ons, COGS, migration |
| `docs/pricing/Businesslogic API Pricing.xlsx` | Live quote calculator (Quote sheet) |
| `docs/reports/bizdev-strategy-2026-04-17-pricing.md` | Full BizDev analysis (frozen) |

---

## The Model (one-page)

**Modular feature activation.** Calculators, Knowledge Base, Flows = independent subscriptions (each has Starter/Growth/Scale). AI consumption flows through a horizontal **AI Wallet** (EUR, top-ups, 12-mo expiry). No platform fee, no free tier, 14-day trial.

### Base tier prices (EUR/mo, monthly billing)

| Module | Starter | Growth | Scale |
|---|---|---|---|
| Calculators | €19 (10 slots, 10k req, 2 always-on) | €79 (50 slots, 100k req, 10 always-on) | €299 (250 slots, 1M req, 50 always-on) |
| Knowledge Base | €15 (200 MB, 1M embed tok) | €49 (2 GB, 10M tok) | €199 (20 GB, 100M tok) |
| Flows | €19 (1k exec) | €59 (10k exec) | €249 (100k exec) |
| AI Assistant | Free UI; draws from AI Wallet | | |

**Annual = 17% off.** Add-ons available for all modules. See strategy doc for full details.

### Key innovations

- **Calculator slots** — XS=1, S=3, M=8, L=20 based on built RSS/sheets/formulas. Memory is the honest cost driver.
- **Always-on switch** per calculator — 2× slot cost. Plan includes allowance; surplus via +10 always-on pack (€25/mo).
- **AI Wallet** — EUR-denominated (not credits). 1.5× wholesale per model. Hard cap default-on. Top-ups €20/€50/€200 with 12-mo expiry.
- **Per-API-key sub-limits** — Growth+ tier. Per-key caps on requests, AI spend, RPS, IP, modules.

---

## Implementation breakdown

### Sub-tasks (dedicated work items)

| # | Task | Status |
|---|---|---|
| 14 | `cross-cutting/14-pricing-v2-stripe-catalog.md` — Stripe products + price IDs + webhook handlers + migration | planned |
| 15 | `cross-cutting/15-pricing-v2-directus-schema.md` — 11 collections via `/db-admin`: subscriptions, quotas, slots, usage events, AI wallet + ledger, API key limits | planned |

### In-scope work that still lives in this task (CMS extensions)

- **Pricing UI** — `project-extension-account` (or new module): module activation flow, tier switcher, add-on purchase, AI Wallet top-up UI, hard cap / auto-reload settings
- **Quota dashboard** — real-time slot/request/execution/wallet usage per module with 50/75/90/100% alerts
- **Trial flow** — 14-day activation UI, card capture at signup, day-14 conversion prompt
- **Admin stats** — `project-extension-admin` additions: MRR by module, tier distribution, AI Wallet burn, overage packs sold
- **Migration UI** — one-click migration for existing $74 customer to grandfathered Calculators Growth

### Enforcement (across services)

- **formula-api** — calculator slot classification on upload; always-on pinning respects allowance; request counting
- **ai-api** — all AI token consumption writes to `ai_wallet_ledger`; hard cap blocks when balance hits €0
- **flow** — execution counter per account; AI steps inside flows debit AI Wallet
- **gateway** — per-API-key sub-limit enforcement; 429 responses name the breached limit

---

## Rollout phases

| Phase | What ships | Duration |
|---|---|---|
| **1** | Schema (#14) + Stripe catalog (#13) + Calculators v2 UI + AI Wallet UI + hard cap + migrate existing customer | 4–6 weeks |
| **2** | KB module monetization + storage quotas + KB Q&A → AI Wallet | 3–4 weeks |
| **3** | Flows module monetization + AI steps → AI Wallet | 3–4 weeks |
| **4** | Per-API-key sub-limits + module allowlist | 2–3 weeks |
| **5** | Enterprise SKU + sales motion | TBD |

---

## Acceptance for this task

This master task is COMPLETE when:
- [ ] Both sub-tasks (13, 14) done
- [ ] All 5 rollout phases shipped
- [ ] Existing customer migrated without disruption
- [ ] First 3 new customers signed via v2 model
- [ ] MRR dashboard operational showing module/tier breakdown + AI Wallet share
- [ ] No credit-model customer complaints (success indicator)

---

## Dependencies

- **Blocks:** monetization of AI, KB, Flows; any scaling motion
- **Blocked by:** strategic approval (DONE 2026-04-17)
- **Related:** `cms/18-admin-financials.md` (admin P/L dashboard), `cms/22-api-key-ui.md` (done — reuse for sub-limits UI)

---

## Legacy context (archived)

The prior version of this task described v1 calculator-only tiers ($9.90/$49.90/$149.90 with unenforced limits). That content is preserved in git history. The v2 model fully supersedes it.
