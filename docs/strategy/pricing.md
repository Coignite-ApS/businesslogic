# Pricing Strategy — v2 (Modular)

**Last updated:** 2026-04-17
**Canonical operational reference:** `docs/pricing/businesslogic-api-pricing.md` (tier prices, slot rules, formulas, COGS)
**Live calculator:** `docs/pricing/Businesslogic API Pricing.xlsx` (Quote sheet)
**Companion analysis:** `docs/reports/bizdev-strategy-2026-04-17-pricing.md`

> This document supersedes the prior **bundled-tier model** (Spark/Build/Operate/Scale) drafted earlier on 2026-04-17. After review, that model was rejected in favor of **modular feature activation** with no free tier — see §2 for rationale.

---

## TL;DR

BusinessLogic prices on **modular feature activation** with a **horizontal AI Wallet**.

- **No platform fee, no free tier.** Account/dashboard/API keys cost €0. 14-day trial = entry path.
- **Activate what you need:** Calculators, Knowledge Base, Flows are independent subscriptions. Each has Starter / Growth / Scale tiers.
- **AI Wallet (EUR-denominated)** powers all AI consumption — chat, KB Q&A, AI in flows, MCP. Top up €20/€50/€200 with 12-month expiry.
- **Calculator slots** — bigger workbooks consume more slots (XS=1, S=3, M=8, L=20). Honest pricing for the real cost driver: memory.
- **Always-on switch** per calculator. Default = auto-evict (free). Always-on = 2× slot consumption.
- **Per-API-key sub-limits** on Growth+ — independent caps per key (request, AI spend, RPS, IP allowlist).
- **Hard cap default-on**, opt-in auto-reload with mandatory monthly spend cap.
- **Annual = 17% off** (industry-standard "12 for 10").
- **EUR primary**, USD/DKK toggleable.

---

## 1. Why Modular Beats Bundled

The first-pass strategy proposed five all-in-one tiers (Spark/Build/Operate/Scale/Enterprise). After review, three problems killed it:

1. **Features ship at different times.** Forcing customers into a tier that bundles unbuilt features sells vapor. Modular lets us monetize each pillar the day it ships.
2. **Honest billing builds trust.** A customer who only uses calculators shouldn't subsidize a flows runtime they don't touch. Modular = "you see exactly what you're paying for."
3. **Bundled tiers anchor too early.** Once we publish "Build = €29 includes everything," every later add-on feels like clawback. Modular leaves room for new modules to land at fair prices without renegotiating the headline.

### Why no free tier

A 14-day trial replaces a perpetual free tier because:

- **AI inference is expensive to subsidize.** Every free user with an AI Wallet quota burns real Anthropic/OpenAI bills. With one paying customer, the math doesn't support distribution-by-free-tier.
- **B2B buyers sign trial → paid cleanly.** Free tier is a PLG distribution lever, not a B2B SaaS necessity. We'll add free if/when distribution data shows it pays back.
- **Calculator memory is finite.** A free tier of "1 calculator forever" creates a long-tail of pinned XS workbooks that generate no revenue but fragment infrastructure.
- **Implicit free entry exists.** Account/dashboard/keys are €0. Customer pays only when they activate a module. The "free start" is the trial.

---

## 2. Strategic Principles

| # | Principle | Strategic intent |
|---|---|---|
| 1 | **Modular activation** | Expansion revenue grows organically as customers adopt more pillars. Land-and-expand is built into the pricing shape. |
| 2 | **Slot-based capacity (calculators)** | Aligns price with our actual cost driver (memory). A 5MB calc and a 200MB calc cannot cost the same — nor should they. |
| 3 | **Always-on as user choice** | Customer self-selects performance tier. Lifts ARPU without forcing it on customers who don't need it. |
| 4 | **AI Wallet in EUR (not credits)** | Cursor's June 2025 credit-system implosion — 180k subreddit revolt, CEO public apology, refunds — is the canonical case for transparency. We won't repeat it. |
| 5 | **Hard cap default-on** | 78% of IT leaders reported surprise AI charges in 2025 (HubSpot). Trust moat: we're the platform that won't bill-shock. |
| 6 | **Per-key sub-limits** | The "spend control" intuition is real. Validates dev/staging/prod key isolation at the pricing layer. |
| 7 | **12-month top-up expiry** | Industry norm. Prevents indefinite liability and matches B2B budgeting cycles. |
| 8 | **17% annual discount** | "Pay 10, get 12" is cleaner than 15%. Matches Stripe/Linear/Vercel/Notion. |

---

## 3. The Model (one-page summary)

| Module | Starter | Growth | Scale | Enterprise |
|---|---|---|---|---|
| **Calculators** | €19 — 10 slots, 10k req, 2 always-on | €79 — 50 slots, 100k req, 10 always-on | €299 — 250 slots, 1M req, 50 always-on | Custom |
| **Knowledge Base** | €15 — 200 MB, 1M embed tok | €49 — 2 GB, 10M embed tok | €199 — 20 GB, 100M embed tok | Custom |
| **Flows** | €19 — 1k exec, 20 steps/exec | €59 — 10k exec, 50 steps/exec | €249 — 100k exec, 200 steps/exec | Custom |
| **AI Assistant** | Free UI access (no module fee) | Free UI access | Free UI access | Free UI access |
| **AI Wallet** | Top-up €20 / €50 / €200 — 1.5× wholesale per model — EUR — 12-mo expiry | | | |

**Add-ons (recurring or one-time):**
- +25 slots €15/mo · +10 always-on slots €25/mo · +100k req €10 (12-mo) · +1M req €60 (12-mo)
- +1 GB KB storage €10/mo · +10M embed tokens €8 (12-mo)
- +5k flow exec €15 (12-mo) · +50k flow exec €100 (12-mo)

Full per-tier table, slot definitions, and worked examples → `docs/pricing/businesslogic-api-pricing.md`.

---

## 4. Calculator Slot Concept (the load-bearing innovation)

Memory is the real cost driver for calculators (Excel evaluated in-memory). Per-calculator counting is dishonest because a 5MB workbook ≠ a 200MB workbook.

### Size classes → slot count

| Class | Built RSS | Sheets | Formulas | Slots |
|---|---|---|---|---|
| XS | ≤ 10 MB | ≤ 5 | ≤ 500 | **1** |
| S  | ≤ 30 MB | ≤ 15 | ≤ 5,000 | **3** |
| M  | ≤ 80 MB | ≤ 30 | ≤ 20,000 | **8** |
| L  | ≤ 200 MB | ≤ 60 | ≤ 50,000 | **20** |
| XL | > 200 MB | > 60 | > 50,000 | **Enterprise** |

Highest dimension wins. Slot count shown at upload time.

### Always-on toggle

- **Default (auto-evict):** uses N slots, evicts after 15 min idle, ~1–15s warm-up on first call after eviction.
- **Always-on:** uses **2× N slots**, pinned 24/7, every call instant.

Plan-level always-on allowance included; surplus billed via the +10 always-on slot pack at €25/mo.

This is the **honest** way to price: customer sees the cost of pinning their largest workbooks and decides explicitly.

---

## 5. AI Wallet (the horizontal layer)

All AI consumption flows through the wallet — KB Q&A, AI Assistant, AI steps in flows, MCP tool use. Single pool, transparent pricing.

### Pricing model
- **1.5× wholesale per model.** Customer sees both the wholesale and BL rate.
- **EUR-denominated.** No abstract credits. Every receipt shows model, tokens, cost.
- **Auto-converts** to display currency for non-EUR customers.

### Indicative rates (April 2026)

| Model | Wholesale (USD/M tok) | BL (EUR/M tok, 1.5×) |
|---|---|---|
| Claude Haiku 4.5 | $1 in / $5 out | €1.38 in / €6.90 out |
| Claude Sonnet 4.6 | $3 in / $15 out | €4.14 in / €20.70 out |
| Claude Opus 4.7 | $15 in / $75 out | €20.70 in / €103.50 out |

### Trust mechanics
- Hard cap default-on. Wallet hits €0 → AI features pause; modules and non-AI features keep working.
- Auto-reload OFF by default. Enabling it requires a monthly spend cap.
- Spend alerts at 50/75/90/100% of monthly cap.
- Per-feature usage breakdown in dashboard.
- Top-up packs: €20 / €50 / €200, all expire 12 months from purchase.

---

## 6. Per-API-Key Sub-Limits

Available on Growth+ tier of any module. Each API key can have independent caps:

- Monthly request cap (calculator calls)
- Monthly AI Wallet spend cap (AI usage on this key)
- Monthly KB search cap
- RPS cap
- IP allowlist
- Module allowlist (e.g., a frontend key restricted to calculators only — no AI access)

When a key hits its limit: `429 Too Many Requests` with header naming the breached limit. Account-level cap unaffected.

This is the strategic answer to the customer intuition: "I want to give my partner an API key that can't spend more than €50/mo of my AI budget." Now they can.

---

## 7. Margin & Mix

Per-tier gross margins at 80% utilization on Hetzner CCX23-class infra:

| Tier | Est. COGS | Margin |
|---|---|---|
| Calc Starter (€19) | €0.40 | 98% |
| Calc Growth (€79) | €2.10 | 97% |
| Calc Scale (€299) | €10.50 | 96% |
| KB Starter (€15) | €0.15 | 99% |
| KB Growth (€49) | €1.50 | 97% |
| KB Scale (€199) | €13.00 | 93% |
| Flows Starter (€19) | €0.30 | 98% |
| Flows Growth (€59) | €1.50 | 97% |
| Flows Scale (€249) | €8.00 | 97% |
| AI Wallet | 1.5× wholesale | ~28% net (after 5% overhead) |

**Healthy revenue mix target:** AI Wallet 25–40% of total revenue. Modules carry margin; AI carries engagement and expansion.

If AI Wallet exceeds 50% of total revenue, we're under-priced on modules (or AI markup is too low). If under 15%, customers aren't engaging with AI features — investigate UX.

---

## 8. Migration from v1

Current single paying customer is on the legacy €74/mo Premium plan (5 calculators, 100k calls).

**Migration offer:**
- Move to **Calculators Growth (€79/mo)** — gains 50 slots vs hard 5-calc cap, AI Wallet access, KB & Flows now optional, per-key limits.
- **12-month price lock at €74/mo grandfathered** (no €5 increase).
- **€20 AI Wallet credit one-time bonus** as upgrade incentive.
- Quarterly review.

---

## 9. Roadmap

| Phase | Work | Owner | Target |
|---|---|---|---|
| **1** | Calculators v2 (slots) + AI Wallet + hard cap + dashboard + migrate existing customer | cms + ai-api + formula-api | Q2 2026 |
| **2** | KB module monetization + storage quotas + KB Q&A → AI Wallet wiring | cms + ai-api | Q3 2026 |
| **3** | Flows module monetization + AI steps → AI Wallet | cms + flow | Q3 2026 |
| **4** | Per-API-key sub-limits + module allowlist | gateway + cms | Q3 2026 |
| **5** | Enterprise SKU + sales motion | bizdev + cms | Q4 2026 |
| **6** | Bundle discount evaluation (only if data supports) | bizdev | Q4 2026 |

---

## 10. Open Strategic Questions

| # | Question | Tentative |
|---|---|---|
| 1 | Should we offer a "Suite" bundle once 50+ customers exist? | Wait for data. Modular ARPU should grow naturally; bundle is a discount lever, only deploy if expansion stalls. |
| 2 | At what scale do we add Mid-Market and Enterprise SKUs? | Mid-Market when avg customer has 2+ active modules; Enterprise when first ≥€10k/mo lead requires custom contract terms. |
| 3 | Should AI Assistant be a paid module instead of free + wallet? | No. AI Assistant access is a wedge — free UI gets users into the AI Wallet flow. Don't double-monetize. |
| 4 | Marketplace pricing for community-built calculator templates? | Defer — needs template marketplace first (`docs/tasks/cms/07-template-gallery.md`). |
| 5 | Self-hosted / on-prem pricing? | Keep 10× multiplier for now. Revisit once cloud has 100+ paying customers. |
| 6 | Verticalized pricing (industry packages)? | Defer until vertical chosen. See `memory/project_business_status.md`. |

---

## 11. Living Documents

This file = **strategic rationale.** Revisit quarterly or on major market shifts.

| File | Owner | Updated |
|---|---|---|
| `docs/strategy/pricing.md` (this) | BizDev | Quarterly |
| `docs/pricing/businesslogic-api-pricing.md` | Product | When prices change |
| `docs/pricing/Businesslogic API Pricing.xlsx` | Product | When prices change |
| `docs/reports/bizdev-strategy-2026-04-17-pricing.md` | BizDev (one-shot) | Frozen — historical analysis |

Implementation tracked in:
- `docs/tasks/cms/08-pricing-billing.md` — master billing evolution
- `docs/tasks/cross-cutting/14-pricing-v2-stripe-catalog.md` — Stripe products + price IDs
- `docs/tasks/cross-cutting/15-pricing-v2-directus-schema.md` — schema work via /db-admin
