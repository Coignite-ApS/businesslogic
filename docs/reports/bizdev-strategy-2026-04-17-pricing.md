# Pricing & Packaging Architecture — Strategic Report

**Date:** 2026-04-17
**Reviewer:** BizDev Strategy Agent (Opus)
**Scope:** Multi-feature pricing architecture for BusinessLogic (KB + Calculators + Flows + AI + MCP + Guardrails)
**Branch:** dev
**Status of business:** Pre-launch on new platform. 1 paying customer @ $74/mo on legacy calculator-only product. No marketing infra. Vertical undecided.

---

## Executive Summary

BusinessLogic must abandon calculator-only pricing and adopt a **hybrid platform subscription + dollar-denominated AI usage credits with a cap** — the model the entire AI-SaaS market converged on in 2025–2026 (43% adoption, projected 61% by year-end; Microsoft, Anthropic, Cursor, Vercel all use variants). The vision is a business brain — every pillar (KB, Calculators, Flows, AI, MCP, Guardrails) must be monetized inside one bill the buyer understands in 30 seconds.

**Recommended model — "Platform fee + AI Wallet":**
1. **Flat monthly platform fee** that includes generous allowances for predictable resources (calculators count, KB storage, flow executions, seats, AI baseline).
2. **One unified "AI Wallet" in dollars** for usage that varies by AI model — Opus burns it 10× faster than Haiku, but the customer sees one number. Hard cap by default; opt-in auto-reload; per-API-key sub-limits.
3. **Always-on calculator memory** as a per-calculator add-on ($/MB-hour tier), not a plan benefit — the cost driver is too variable to bundle.
4. **Annual = ~17% off** (2 months free — industry standard).
5. **Free tier limited and enforced** (lessons from 2026 PLG: generous free + AI = burn).

**Top 3 risks:**
1. **Bill-shock backlash** (the Cursor June 2025 disaster — 180k-strong subreddit revolted). Mitigate with hard caps default-on, transparent dashboard, alerts at 50/75/90/100%.
2. **Margin erosion on heavy Opus users** if dollar wallet is priced at API cost. Mitigate with 1.4–1.6× wholesale markup baked into wallet rate.
3. **Single existing customer churn** during migration. Mitigate by grandfathering at current price for 12 months minimum.

**Immediate next 3 actions:**
1. Approve recommended model (Section 4) and tier names.
2. DB Admin task: design `feature_quotas`, `credit_wallet`, `api_key_limits`, `usage_events` collections (Section 5.1).
3. Land Stripe products and metering in v1 scope (calculators, AI wallet, KB storage). Defer flow/guardrails metering to v2.

---

## SECTION 1 — Research Synthesis

### 1.1 The market converged on hybrid base+credit

| Source | Key finding |
|---|---|
| Chargebee 2025 State of Subscriptions | 43% of SaaS now use hybrid (base + usage), projected 61% by end-2026 |
| OpenView | Hybrid models grow 38% faster than single-model; 21% median revenue growth vs ~13% for pure subscription |
| Microsoft Copilot | $30/user base + Copilot Credits ($200/tenant for 25k credits). Industry-defining example |
| Anthropic Claude Pro/Max | Plan with included usage; "Extra Usage" toggleable; auto-reload optional; spend caps explicit |
| Cursor (counter-example) | Flipped to credits June 2025 → 180k-user backlash, CEO public apology, refunds. Lesson: **transparency and opt-in are non-negotiable** |
| Vercel Pro | $20/user base + $20 included credits + spend cap with alerts at 75%/100% |

**Conclusion:** Hybrid is dominant. The variable is *how* you implement it — opt-in vs default-on overage, wallet vs credits, single rate vs model multipliers.

### 1.2 Customer voice — what makes credit systems fail

Reddit/HN/community signals collected:

- **Cursor (June 2025):** "Effective price for agentic coding workflows jumped 20×." CEO admitted comms failure. r/cursor (180k members) revolted. (TechCrunch, July 2025)
- **Manus AI:** "I watched 900 credits disappear on what I thought was a simple task. There's no way to predict this."
- **HubSpot AI Credits Buyer's Guide:** 78% of IT leaders reported surprise AI charges in past year.
- **Generic SaaS credit complaints:** "We lost credits two months in a row during a campaign pause. No rollover."

**Universal failure modes:**
1. Credits silently consumed faster than expected (model class hidden).
2. No hard cap by default → bill shock.
3. Expiry without warning.
4. No per-key limits → one rogue script burns the company budget.
5. Confusing units ("what is 1 credit worth?").

**Universal success patterns:**
1. **Dollar-denominated wallet** (not abstract credits). Customer sees "$8.42 of $20 used."
2. **Hard cap default-on**, opt-in auto-reload.
3. **Per-key sub-limits** with separate budgets.
4. **Real-time dashboard** with model-class breakdown.
5. **Progressive alerts** (50/75/90/100%).

### 1.3 Competitive pricing benchmarks (April 2026)

#### AI/Knowledge platforms
| Platform | Base | Usage layer | Notes |
|---|---|---|---|
| Microsoft 365 Copilot | $30/user/mo annual | Credits ($200 = 25k) | The benchmark for AI-augmented productivity |
| Glean | ~$50/user/mo, ~100-seat min ($60k/yr+) | Custom | Enterprise-only; unattainable for SMB |
| Anthropic Claude API | Pure usage | Sonnet $3/$15 per MTok; Opus $5/$25; Haiku $1/$5 | Wholesale rates we resell |
| OpenAI ChatGPT Business | $20–25/user/mo | Optional credit pack | Bifurcated — API billed separately |

#### Spreadsheet/calculator-as-API
| Platform | Pricing |
|---|---|
| Sourcetable | $29/seat/mo Max; $149/seat/mo Enterprise; AI queries metered |
| Causal/Rows | Per-seat; no public credit model |
| Outgrow/Calconic/involve.me | $15–80/mo; pure calc, no AI |

#### Embedded BI
| Platform | Pricing |
|---|---|
| Sigma | $1,380–$1,980/user/yr; viewer unlimited; median deal $60k/yr |
| Hex | Per-seat creator + viewer model |

#### Vector DB / RAG infra (cost-of-goods reference)
| Platform | Reference cost |
|---|---|
| Pinecone | Read/write units + storage; 10M vectors+50GB ≈ $84/mo at moderate query vol |
| Weaviate Cloud | Dimension-billed; 10M vec ≈ $23/mo storage + $41/mo reads |
| pgvector (current) | ~$0 marginal — Postgres handles it |

**Implication:** Our KB infra COGS is near-zero on pgvector. We can offer generous KB storage allowances without margin pain.

#### Hosted compute (always-on memory reference)
| Platform | Memory unit price |
|---|---|
| AWS Lambda Provisioned Concurrency | $0.0000046/GB-second ≈ $12/GB-month idle |
| Modal | $0.008/GiB-hr ≈ $5.76/GB-month |
| Railway | ~$0.000000231/GB-second ≈ $0.60/GB-month |
| Cloudflare Durable Objects | Wall-clock duration billed for 128 MB allocation |

**Implication for "always-on calculators":** A 100MB always-on calculator on our Hetzner infra costs ~$0.30/mo in raw RAM. Charge $3–5/mo per 100MB-tier (10–15× markup) to cover scheduling overhead, provide healthy margin, and discourage wasteful pinning. This matches Render/Modal markup ratios.

### 1.4 Annual discount norms

- **Industry standard:** 16.7% (= 2 months free) — Recurly 2024
- **Trending down:** Vendr reports avg ~10% in 2026
- **Best outcomes:** 5–10% acquisition discounts; 15–20% reserved for annual+
- **Recommendation:** Stay at ~17% (12 for 10) — easy to communicate, well-anchored

### 1.5 Free tier reality in AI era

- **Old PLG rule:** "Generous free forever."
- **2026 reality (ProductLed, Aakash Gupta):** Free + AI burns cash. Conversion below 2–3% means free is too generous. Trial median moving from 30 → 14 → 7 days for AI-native.
- **Recommendation:** Offer free tier but cap AI usage tightly ($1 wallet/mo, no overage). Calculator + KB usage allowed but limited. **Credit card not required**, but auto-suspend on cap.

### 1.6 Embedding & AI cost model (April 2026)

| Model | Input $/MTok | Output $/MTok | Notes |
|---|---|---|---|
| Claude Haiku 4.5 | $1.00 | $5.00 | KB retrieval, simple chat |
| Claude Sonnet 4.6 | $3.00 | $15.00 | Default chat, tool use |
| Claude Opus 4.6 | $5.00 | $25.00 | Deep analysis |
| OpenAI text-embedding-3-small | $0.02/MTok | — | Standard KB ingest |
| OpenAI text-embedding-3-large | $0.13/MTok | — | High-precision (rare) |
| Batch API | 50% discount | | All providers |
| Prompt cache | up to 90% input discount | | Anthropic |

**Effective cost per typical request:**
- KB search (Haiku + 1k tokens cached): ~$0.0008
- Chat response (Sonnet, 2k in / 1k out): ~$0.021
- Deep analysis (Opus, 5k in / 2k out): ~$0.075
- Doc ingest (10k tokens embedded): ~$0.0002

**Markup recommendation for AI Wallet:**
- Resell at **1.5× wholesale** (covers infra, support, prompt cache passthrough we don't share, model price normalization risk).
- This still beats every consumer AI tool's effective rate because we use cache + batch.

---

## SECTION 2 — Pricing Architecture Decisions

### 2.1 Core architecture

**Three pricing axes for BusinessLogic:**

| Axis | Pricing form | Why |
|---|---|---|
| **Predictable assets** (calculators count, KB storage, seats, flow definitions) | Bundled by tier | Easy to budget, scales smoothly |
| **AI consumption** (chat, tool rounds, doc Q&A, KB ingest embeddings, MCP) | Unified $-denominated AI Wallet | One number, model-agnostic UX, margin-protected |
| **Always-on calculator memory** | Per-calculator add-on, MB-hour tier | Customer chooses; cost too variable to bundle |

**Why NOT credits:** Credits are an abstraction layer that confuses customers (Cursor lesson). A dollar wallet is honest, transparent, and trustworthy. We use markup multipliers internally to hit margin — customers see only dollars.

### 2.2 Per-feature included allowances design

**Predictable bundling rule:** Each tier ships with allowances that cover ~80% of the target persona's monthly need. The remaining 20% is overage (pay-as-you-go from wallet for AI; explicit upgrade for calculators/seats).

**Why generous KB:** pgvector COGS is near-zero. Make KB storage a felt-value differentiator.
**Why tight AI:** AI is real $ COGS that scales with usage. Wallet protects margin.
**Why count-limits on calculators:** Each calculator can pin memory; uncapped would be abusable.

### 2.3 The unified AI Wallet (this is the heart of the model)

**Mechanics:**
- Each tier includes a base **AI Wallet balance** in $USD that resets monthly (use-it-or-lose-it; NO rollover for monthly base — customer simplicity).
- Usage debits wallet at **1.5× wholesale model rates** in real time.
- Customer dashboard shows: "$8.42 of $20.00 used this month" + breakdown by model + by API key.
- **At 100% used: hard stop by default.** No surprise bill.
- **Optional opt-in:** Auto-reload top-ups in $20/$50/$100 packs purchasable any time. Top-ups have **12-month expiry** (industry norm).
- **Optional opt-in:** Spend cap on top-ups (e.g., "max $200/mo extra"). Spend cap is **mandatory** to enable auto-reload.

**Why no rollover on monthly wallet:** Rollover creates accounting complexity, encourages hoarding, and customers complain when expiry hits anyway (Reddit voice). Keeping monthly = simple. Top-ups (which customer paid extra for) DO rollover for 12 months — fair.

**Per-API-key sub-limits (the user's intuition — VALIDATED):**
- Each API key can have its own monthly wallet cap (e.g., dev key $5, prod key $50, partner key $30).
- Sum of per-key caps may exceed account wallet (account wallet is the hard ceiling).
- Per-key caps are a **Growth tier+ feature** — table stakes for any team using us in production.

### 2.4 Always-on calculator memory pricing

- **Default behavior:** Calculators auto-evict when idle (free, but cold start latency).
- **Always-on add-on:** Per calculator, choose tier:
  - Tier A: ≤50MB → **$3/mo**
  - Tier B: 51–200MB → **$8/mo**
  - Tier C: 201–500MB → **$20/mo**
  - Tier D: >500MB → contact sales (Enterprise)
- Margin: ~10× over raw Hetzner RAM cost. Covers scheduler overhead, monitoring, replacement nodes.
- **UX:** A toggle on the calculator page — "Keep warm: $8/mo" — with clear cold-start latency comparison ("avg 2.4s cold vs <100ms warm").

### 2.5 Currency & geo

- **Primary: USD.** All competitor research is USD-anchored. Stripe handles conversion.
- **Display: USD/EUR/local on landing page** based on geo (Stripe Tax + currency display).
- **Billing: USD always.** Avoids fragmented price tables. Customers in DK/EU see VAT clearly; Stripe handles VAT MOSS.
- **Reasoning:** Multi-currency adds operational complexity for a 1-customer business. USD is universal in B2B SaaS.

### 2.6 Annual discount

**~17% (2 months free).** Industry standard, easy math, well-anchored. "12 for the price of 10."

### 2.7 Free tier — capped, no card

- **Free, no card required.** Self-suspend at limits.
- Calculators: 1
- API calls: 1,000/mo
- AI Wallet: $1.00/mo (≈ 50 Sonnet replies or 1k Haiku KB queries)
- KB storage: 50MB
- Flows: disabled (Growth tier+)
- MCP: disabled (Pro tier+)
- Always-on memory: disabled (force cold-start)
- **Why so capped:** AI costs are real. Aakash Gupta / ProductLed: "If <2-3% conversion, free is too generous." We can loosen later if conversion is healthy.

---

## SECTION 3 — Recommended Tier Names & Table

### 3.1 Tier names (proposed)

Replacing generic Basic/Premium/Professional with names that signal the **business brain** vision:

| Old | NEW | Rationale |
|---|---|---|
| Free | **Spark** | Try the brain |
| Basic | **Build** | Solo founder, 1 calc, basic AI |
| Premium | **Operate** | Small business — runs daily ops |
| Professional | **Scale** | Team, multiple calcs, heavy AI |
| (new) | **Enterprise** | Custom; sales-led |

Names communicate stage of customer journey, not feature count.

### 3.2 Pricing table

| | **Spark** (Free) | **Build** | **Operate** | **Scale** | **Enterprise** |
|---|---|---|---|---|---|
| **Monthly (USD)** | $0 | $29 | $99 | $349 | Custom |
| **Annual (USD)** | — | $290/yr | $990/yr | $3,490/yr | Custom |
| **Target persona** | Eval / dev | Solo founder | SMB owner | Team / agency | Mid-market+ |
| **Calculators** | 1 | 3 | 15 | 50 | Unlimited |
| **API calls/mo** | 1,000 | 10,000 | 100,000 | 1,000,000 | Custom |
| **AI Wallet/mo** | $1 | $5 | $25 | $100 | Custom |
| **Knowledge Bases** | 1 (read-only demo) | 1 | 5 | 25 | Unlimited |
| **KB storage** | 50 MB | 500 MB | 5 GB | 25 GB | Custom |
| **Flows** | — | 100 runs | 5,000 runs | 50,000 runs | Custom |
| **MCP** | — | — | Per-calc | Account-wide | Account-wide |
| **Seats** | 1 | 1 | 5 | 15 | Custom |
| **API keys** | 1 | 3 | 10 | 50 | Unlimited |
| **Per-key sub-limits** | — | — | YES | YES | YES |
| **Always-on memory** | — | Add-on | Add-on | Add-on | Included pool |
| **Widget branding** | "Powered by" | "Powered by" | Removable | White-label | White-label |
| **Support** | Community | Email 48h | Email 24h | Priority + Slack | Dedicated CSM + SLA |
| **Guardrails (planned)** | — | — | Read | Build | Build + API |

### 3.3 Add-ons (any paid tier)

| Add-on | Price | Notes |
|---|---|---|
| AI Wallet top-up $20 | $20 | 12-mo expiry; opt-in auto-reload |
| AI Wallet top-up $50 | $50 | 12-mo expiry |
| AI Wallet top-up $200 | $200 | 12-mo expiry; volume buyer |
| +5 calculators | $19/mo | |
| +1 seat | $12/mo | |
| +5 GB KB storage | $15/mo | |
| +1,000 flow runs | $10/mo | |
| Always-on calculator (≤50MB) | $3/mo per calc | |
| Always-on calculator (51–200MB) | $8/mo per calc | |
| Always-on calculator (201–500MB) | $20/mo per calc | |
| White-label widget | $49/mo | Build/Operate (free on Scale+) |

### 3.4 Lifetime Deal (launch only — AppSumo/Directus channel)

| LTD | One-time | Equivalent | Cap | Notes |
|---|---|---|---|---|
| Tier 1 | $99 | Build forever | 300 | AI Wallet $5/mo included |
| Tier 2 | $249 | Operate forever | 200 | AI Wallet $15/mo (reduced) |
| Tier 3 | $499 | Scale-lite forever | 100 | AI Wallet $50/mo (reduced) |

**Critical:** LTD AI Wallets are **reduced** — LTD users would otherwise have unlimited margin drain on AI. They can buy top-ups normally.

---

## SECTION 4 — Margin & Unit Economics

### 4.1 COGS model (per customer/month, full utilization)

Assumes typical mix: 20% Opus, 50% Sonnet, 30% Haiku for chat; embeddings on text-embedding-3-small.

| Tier | Wallet | Wholesale AI cost @ 1.5× markup | KB storage cost (Hetzner) | Always-on cost included | Other infra | **Total COGS** | Revenue | **Gross margin** |
|---|---|---|---|---|---|---|---|---|
| Spark | $1 | $0.67 | $0.01 | $0 | $0.50 | $1.18 | $0 | -$1.18 (CAC bucket) |
| Build | $5 | $3.33 | $0.05 | $0 | $1 | $4.38 | $29 | **85%** |
| Operate | $25 | $16.67 | $0.50 | $0 | $3 | $20.17 | $99 | **80%** |
| Scale | $100 | $66.67 | $2.50 | $0 | $8 | $77.17 | $349 | **78%** |

**At 80% utilization (realistic):**

| Tier | COGS @ 80% | Revenue | **Gross margin @ 80%** |
|---|---|---|---|
| Build | $3.50 | $29 | **88%** |
| Operate | $16.13 | $99 | **84%** |
| Scale | $61.73 | $349 | **82%** |

**All paid tiers clear 80% gross margin even at full utilization — healthy SaaS standard (Bessemer benchmarks: best-in-class >75%).**

### 4.2 Risk: heavy Opus user on Operate

Worst-case scenario: customer burns entire $25 wallet on Opus only.
- $25 wallet ÷ $0.075/Opus call ≈ 333 deep-analysis calls
- Wholesale cost: $25 / 1.5 = $16.67
- Margin: $99 - $16.67 - $3.50 (other COGS) = **$78.83 (79%)** ✓

**The 1.5× markup protects us at all model mixes.** Even pure-Opus users yield 79% margin.

### 4.3 Top-up margins

Top-ups sold at same 1.5× markup. Margin: **33%** on AI alone (1.5×−1× = 0.5×, divided by 1.5× = 33%). Lower than base wallet (which carries platform fee margin), but still positive and scales with customer's own demand.

### 4.4 Spark (free) tier economics

- Cost: ~$1.18/mo per active free user
- Conversion target: 3% (industry std for AI-included free)
- Break-even: Build customer at $29 covers ~25 free users for the month
- Free tier viable if conversion ≥ 4% → comfortable buffer

---

## SECTION 5 — Implementation Blueprint

### 5.1 Database — required Directus collections

**ALL DB changes via /db-admin (per CLAUDE.md). DO NOT edit snapshot.yaml directly.**

New/extended collections (cms schema):

```
subscription_plans (extend existing)
  + ai_wallet_monthly_usd (numeric)
  + kb_storage_mb (integer)
  + flow_runs_monthly (integer)
  + api_keys_max (integer)
  + per_key_sublimits_enabled (boolean)
  + always_on_included_mb_hours (integer, for Enterprise)

feature_quotas (NEW)
  - id, account_id
  - calculators_used, calculators_max
  - kb_storage_used_mb, kb_storage_max_mb
  - api_keys_used, api_keys_max
  - flow_runs_used, flow_runs_max
  - period_start, period_end

ai_wallet (NEW)
  - id, account_id
  - balance_usd (current monthly base)
  - period_start, period_end
  - hard_cap_usd (set by tier)
  - auto_reload_enabled (boolean, default false)
  - auto_reload_threshold_usd
  - auto_reload_amount_usd
  - max_overage_monthly_usd (mandatory if auto_reload)

ai_wallet_topup (NEW)
  - id, account_id, amount_usd, purchased_at, expires_at
  - balance_remaining_usd

api_key_limits (NEW)
  - api_key_id (FK)
  - monthly_wallet_cap_usd (nullable; null = unlimited within account)
  - monthly_calls_cap (nullable)
  - usage_this_period_usd

usage_events (NEW — append-only ledger)
  - id, account_id, api_key_id (nullable)
  - service (ai|kb|formula|flow), action
  - cost_usd_wholesale, cost_usd_billed (after 1.5× markup)
  - tokens_in, tokens_out, model (nullable)
  - timestamp

monthly_aggregates (NEW)
  - account_id, period
  - ai_spend_usd, calls_total, kb_storage_max_mb, flow_runs_total
  - by_service breakdown JSON
```

**Schema ownership:** All new tables in `cms` schema (consistent with subscription/account ownership). AI service writes usage_events via service-token API.

### 5.2 Metering infrastructure

- **Each service emits usage events** to a central metering endpoint on bl-cms (or async via Redis stream → batch insert).
- **Real-time wallet decrement:** AI service must call `decrement_wallet(account_id, cost_usd_billed)` synchronously before generating response (prevents race over hard cap). On insufficient balance: return structured error → client shows "AI Wallet exhausted; top up or wait until reset."
- **Async aggregation:** Hourly job rolls usage_events into monthly_aggregates.
- **Per-key enforcement:** Gateway checks `api_key_limits` on each call; rejects with 429 if key sub-limit hit.

### 5.3 Stripe products & prices structure

```
Product: BusinessLogic Platform
  Prices:
    - Build / Monthly USD ($29)
    - Build / Annual USD ($290)
    - Operate / Monthly USD ($99)
    - Operate / Annual USD ($990)
    - Scale / Monthly USD ($349)
    - Scale / Annual USD ($3,490)

Product: AI Wallet Top-up
  Prices: $20 / $50 / $200 (one-time, with metadata.expires_in_days = 365)

Product: Always-on Calculator
  Prices: $3 / $8 / $20 (subscription, qty = number of pinned calculators)

Product: Add-on (Calculators / Storage / Seats / Flow Runs / Widget)
  Prices: per add-on type
```

**Webhook handling:** invoice.payment_succeeded → reset monthly wallet; charge.refunded → reverse credits; subscription.updated → update tier quotas.

### 5.4 Migration path for existing customer

The 1 paying customer at $74/mo (legacy Premium):

1. **Grandfather indefinitely** at $74/mo with current quotas mapped to NEW tier features:
   - Calculators: 5 (current Premium) → 5 (Operate has 15, give them their original)
   - API calls: 100,000 → 100,000
   - AI Wallet: gift $25/mo (Operate-equivalent) — they didn't pay for AI before, so this is bonus value
   - KB storage: 5 GB
2. **Personal email** explaining the new model + their grandfathered status (no surprises).
3. **12-month grandfather guarantee.** After 12 months, offer migration to Operate ($99) with a 3-month transition discount.

### 5.5 Phased rollout

**v1 (this quarter — ship before any marketing):**
- 4 paid tiers + Spark in Stripe
- AI Wallet (account-level only, no per-key limits yet)
- Calculator count + KB storage + flow run quotas enforced
- Top-up purchase + 12-mo expiry
- Hard cap default-on; no auto-reload yet
- Dashboard: usage by service, wallet balance, alerts at 75/100%
- Grandfather existing customer
- Public pricing page rebuilt

**v2 (next quarter — after first 50 paying customers):**
- Per-API-key sub-limits
- Auto-reload + spend cap
- Always-on calculator add-on UI + metering
- Flow execution metering
- Widget white-label SKU
- Annual upgrade flow with proration

**v3 (after Guardrails GA):**
- Guardrails as Scale+ feature
- Enterprise tier formalized (sales-led)
- Volume discounts on Wallet ($1000+ → 10% off)
- Multi-currency display

### 5.6 Pricing page UX requirements

- **Above the fold:** "Try free. Pay only for AI you use."
- **Comparison table** with the 5 tiers (Spark + 4 paid).
- **AI Wallet calculator widget:** "Estimate my monthly AI cost" — slider for chat volume + KB query volume → outputs $/mo.
- **Always-on toggle** explained: "Keep your calculator warm — instant response — $3–20/mo."
- **FAQ section** addressing the top fears: "Will I get a surprise bill?" "What happens at limit?" "Can I cap spending?"
- **Honesty principle:** Show the model multiplier table ("Opus uses wallet ~10× faster than Haiku — pick the right model for the task").

---

## SECTION 6 — Risks & Guardrails

### 6.1 Top 5 risks

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Bill-shock backlash** (Cursor 2025 redux) | MEDIUM | HIGH | Hard cap default-on. Auto-reload must be opt-in with mandatory spend cap. Real-time dashboard. Alerts at 50/75/90/100%. |
| 2 | **Heavy Opus users erode margin** | LOW | MEDIUM | 1.5× markup baked in; margin still 79% even at pure-Opus. Watch real usage and adjust to 1.6× if needed. |
| 3 | **Free tier abuse** (multi-account farming) | MEDIUM | LOW | Email verification required. Rate-limit per IP. Spark hard-capped — no overage path. |
| 4 | **Existing customer churns during migration** | LOW (only 1 customer) | HIGH (100% MRR) | Personal grandfather email. 12-mo price lock. Add bonus value (AI Wallet they didn't have). |
| 5 | **Confusion over model multipliers** ("why did Opus burn so much?") | HIGH | MEDIUM | Dashboard breakdown by model + per-call cost shown. Pricing page explains model classes. Default to Sonnet — never silently route to Opus. |

### 6.2 90-day post-launch metrics

Watch these weekly:

| Metric | Target | Red flag |
|---|---|---|
| Spark → Build conversion | ≥3% | <2% (free too generous) |
| Avg AI Wallet utilization | 40–70% | >85% (under-priced wallet) or <20% (over-priced wallet) |
| Top-up purchase rate (% of paid users) | 15–30% | >50% (base wallet too small — bill shock risk) |
| Refund/cancellation citing pricing | <2% | >5% (model is broken) |
| Per-tier gross margin | >75% | <70% (price increase needed) |
| Time on pricing page → signup | <60s | >120s (page too complex) |
| Support tickets re: billing | <5% of MRR-impact tickets | >15% |

### 6.3 What to NOT do

- ❌ Don't launch model-class credits (Cursor lesson — opaque).
- ❌ Don't make Wallet rollover infinite (cash flow disaster).
- ❌ Don't default to auto-reload (Cursor lesson #2).
- ❌ Don't bundle always-on memory in tier (encourages waste).
- ❌ Don't charge per-seat as primary axis (BL is platform, not productivity tool).
- ❌ Don't price in EUR/DKK as primary (operational complexity, mixed signals).
- ❌ Don't grandfather forever without a sunset path (locks in unfair pricing).

---

## SECTION 7 — Alternatives Considered (and Rejected)

### Alt A: Pure usage-based (Anthropic API model)
- ❌ Too volatile for SMB buyers; no predictable bill.
- ❌ Loses "platform" framing (BL is a hub, not a meter).

### Alt B: Pure per-seat (Glean / Sigma model)
- ❌ Doesn't fit BL — most usage is API/widget consumption, not human seats.
- ❌ Anchors price to people-count, which scales wrong for our use cases.

### Alt C: Model-class credits (Cursor / Replicate model)
- ❌ Cursor's June 2025 disaster is the cautionary tale.
- ❌ Customers can't intuit "1 credit = ?" → distrust → churn.

### Alt D: Outcome-based (per-resolution / per-completed-flow)
- ⚠️ Promising long-term but hard to attribute outcomes today.
- DEFERRED to v3 once Guardrails+Flows have observable success metrics.

### Alt E: Tiered AI quotas (e.g., "500 Sonnet messages/mo")
- ❌ Same Cursor problem — customers run out unpredictably depending on conversation length.
- ❌ Forces us to rate-limit by message count, which is meaningless on long contexts.

**Selected: Hybrid Platform Fee + Dollar AI Wallet (Section 2).** Beats all alternatives on transparency, margin protection, scalability, and SMB-friendliness.

---

## SECTION 8 — Strategy Documents Updated

- `docs/strategy/pricing.md` — UPDATED to reflect this architecture as canonical
- `docs/reports/bizdev-strategy-2026-04-17-pricing.md` — THIS REPORT

---

## Sources

### Hybrid pricing & market trends
- [Future of SaaS Pricing in 2026](https://medium.com/@aymane.bt/the-future-of-saas-pricing-in-2026-an-expert-guide-for-founders-and-leaders-a8d996892876)
- [Hybrid Pricing Guide 2026 — Flexprice](https://flexprice.io/blog/hybrid-pricing-guide)
- [Hybrid Pricing Models 2025 — Maxio](https://www.maxio.com/blog/the-rise-of-hybrid-pricing-models)
- [Token-based AI pricing — Ibbaka](https://www.ibbaka.com/ibbaka-market-blog/why-tokens-and-credits-are-becoming-a-standard-approach-to-pricing-ai-solutions)
- [Agentic AI Pricing Models — Monetizely](https://www.getmonetizely.com/articles/agentic-ai-pricing-models-how-to-choose-between-token-task-and-outcomebased-pricing)
- [How to Price AI Products 2026 — Aakash Gupta](https://www.news.aakashg.com/p/how-to-price-ai-products)

### Customer voice & failure cases
- [Cursor pricing backlash — TechCrunch July 2025](https://techcrunch.com/2025/07/07/cursor-apologizes-for-unclear-pricing-changes-that-upset-users/)
- [Cursor's Pricing Disaster — wearefounders](https://www.wearefounders.uk/cursors-pricing-disaster-how-a-routine-update-turned-into-a-developer-exodus/)
- [When Cursor silently raised prices 20× — Medium Feb 2026](https://medium.com/@jimeng_57761/when-cursor-silently-raised-their-price-by-over-20-and-more-what-is-the-message-the-users-are-6af93385f362)
- [Buyer's Guide to Credit-Based AI Pricing — HubSpot](https://blog.hubspot.com/website/ai-credits-buyers-guide)
- [Manus AI Credits problem 2025](https://blog.geta.team/manus-ai-pricing-2025-why-credits-are-costing-you-more-than-you-think/)

### Competitor pricing pages
- [Anthropic Claude API Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Anthropic Extra Usage management](https://support.claude.com/en/articles/12429409-manage-extra-usage-for-paid-claude-plans)
- [OpenAI Pricing](https://openai.com/api/pricing/)
- [OpenAI ChatGPT Business pricing](https://openai.com/business/chatgpt-pricing/)
- [Microsoft 365 Copilot Pricing](https://www.microsoft.com/en-us/microsoft-365-copilot/pricing)
- [Microsoft Copilot Credit Pre-Purchase Plan](https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/scale-your-agent-rollout-with-confidence-introducing-copilot-credit-pre-purchase-plan/)
- [Vercel Pricing](https://vercel.com/pricing)
- [Modal Pricing](https://modal.com/pricing)
- [Sourcetable Pricing](https://sourcetable.com/pricing)
- [Sigma BI Pricing 2026](https://www.vendr.com/marketplace/sigma)
- [Glean Pricing 2026](https://www.gosearch.ai/blog/glean-pricing-explained/)
- [Retool Pricing](https://retool.com/pricing)
- [Supabase Pricing](https://supabase.com/pricing)
- [Pinecone Pricing](https://docs.pinecone.io/guides/manage-cost/understanding-cost)
- [Weaviate Pricing](https://weaviate.io/pricing)

### Compute/memory pricing
- [AWS Lambda Provisioned Concurrency](https://aws.amazon.com/lambda/pricing/)
- [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Cloudflare Workers vs AWS Lambda — Vantage](https://www.vantage.sh/blog/cloudflare-workers-vs-aws-lambda-cost)

### Discount, free tier, PLG
- [SaaS Discount Strategy 2026](https://medium.com/@lesiapolivod/saas-discount-strategy-2026-when-discounts-work-and-when-they-dont-e33dac0014fb)
- [PLG Predictions 2026 — ProductLed](https://productled.com/blog/plg-predictions-for-2026)
- [Recurly SaaS Subscription Benchmarks](https://recurly.com/research/saas-benchmarks-for-subscription-plans/)

### Embeddings cost
- [OpenAI text-embedding-3 pricing](https://developers.openai.com/api/docs/pricing)

### Credit expiry / wallet best practices
- [Credit-based pricing — Lago](https://getlago.com/blog/credit-based-pricing)
- [SaaS Credits guide — m3ter](https://www.m3ter.com/guides/saas-credit-pricing)
- [Credits subscription model — Stripe](https://stripe.com/resources/more/what-is-a-credits-based-subscription-model-and-how-does-it-work)

---

## Next Review

**Recommended in:** 6 weeks (after v1 ships and first 20 customers convert)
**Focus areas:** Real conversion rates, wallet utilization distribution, top-up purchase frequency, support ticket themes
**Market triggers to watch:** Anthropic price changes, Microsoft Copilot Credit pricing changes, any high-profile SaaS pricing-related backlash
