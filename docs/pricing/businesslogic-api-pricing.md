# BusinessLogic Pricing Model — v2 (Modular)

**Status:** Draft — supersedes v1 calculator-only model
**Last updated:** 2026-04-17
**Currency base:** EUR (primary), USD secondary, DKK internal cost basis
**Trial:** 14 days (no perpetual free tier)

---

## 1. Pricing Philosophy

BusinessLogic prices on **modular feature activation**. There is no all-in-one tier. Customers turn on the modules they need — Calculators, Knowledge Base, Flows — and the bill grows only with what they actually use. AI consumption flows through a separate **AI Wallet** so AI cost stays transparent and decoupled from feature subscriptions.

### Principles

| # | Principle | Why |
|---|---|---|
| 1 | **Modular activation** — pay per enabled module | Honest. Customer sees exactly which features they pay for. Expansion revenue grows naturally as they adopt more. |
| 2 | **Slot-based capacity for calculators** — bigger calculators consume more slots | Memory is the real cost driver. A 200MB workbook can't cost the same as a 5MB one. |
| 3 | **Always-on as a per-calculator switch** — explicit user choice | Customer decides which calcs need instant response and pays for the privilege. Default = auto-evict (free). |
| 4 | **AI Wallet in EUR, not opaque credits** | Cursor's June 2025 credit-system implosion is the cautionary tale. Customers want to see real money. |
| 5 | **Hard cap default-on** + spend alerts at 50/75/90/100% | 78% of IT leaders reported surprise AI charges in 2025 (HubSpot). We win trust by being the platform that doesn't bill-shock. |
| 6 | **No platform fee** | Account, dashboard, API keys are free. Only activated modules cost money. |
| 7 | **Top-up packs expire in 12 months** | Industry norm. Prevents perpetual liability and matches B2B budgeting cycles. |
| 8 | **Annual = 17% off (pay 10 months, get 12)** | Industry standard. Cleaner customer message than 15%. |

---

## 2. Module: Calculators

### 2.1 The Slot Concept

A **slot** is a unit of calculator capacity. Every calculator consumes 1+ slots based on its built memory footprint and complexity. The slot count is computed at upload time and shown to the customer immediately.

| Size class | Built RSS | Sheets | Formulas | Slots |
|---|---|---|---|---|
| **XS** | ≤ 10 MB | ≤ 5 | ≤ 500 | **1 slot** |
| **S** | ≤ 30 MB | ≤ 15 | ≤ 5,000 | **3 slots** |
| **M** | ≤ 80 MB | ≤ 30 | ≤ 20,000 | **8 slots** |
| **L** | ≤ 200 MB | ≤ 60 | ≤ 50,000 | **20 slots** |
| **XL** | > 200 MB | > 60 | > 50,000 | **Enterprise** (contact sales) |

**Sizing rule:** the calculator is classified by the **highest** dimension it falls into. A 5-sheet workbook with 25k formulas = M (8 slots), not S.

**Slot count is shown in the UI when uploading**, e.g.:

> *Your calculator uses **8 slots** (M — 30 sheets, 18,400 formulas, 64 MB).*
> *Your plan: 50 slots total — 22 used, 28 remaining.*

### 2.2 Always-On Switch

Every calculator has an **Always-on** toggle on its detail page.

| Mode | What it does | Slot cost |
|---|---|---|
| **Auto-evict** (default) | Calculator unloads from memory when idle 15+ min. First call after eviction = 1–15s warm-up depending on size. | 1× slot count |
| **Always-on** | Calculator stays pinned in memory 24/7. Every call is instant. | **2× slot count** |

**Plan-level always-on allowance** (slots that can be pinned without doubling):

- **Starter:** 2 always-on slots included
- **Growth:** 10 always-on slots included
- **Scale:** 50 always-on slots included

If a customer pins beyond their included allowance, the surplus slots are billed at the **slot pack** rate.

**UI psychology:** the toggle shows live impact, e.g.:

> *Always-on is OFF — uses 8 slots. First call after idle ≈ 4s.*
> *Always-on is ON — uses 16 slots. Every call instant. ⚠ Exceeds your included always-on allowance by 6 slots → +€9/mo.*

### 2.3 Calculator Module Tiers

| Tier | Slots | Requests/mo | Always-on incl. | API keys | EUR/mo | USD/mo |
|---|---|---|---|---|---|---|
| **Starter** | 10 | 10,000 | 2 | 3 | **€19** | $21 |
| **Growth** | 50 | 100,000 | 10 | 10 | **€79** | $89 |
| **Scale** | 250 | 1,000,000 | 50 | Unlimited | **€299** | $335 |
| **Enterprise** | Custom | Custom | Custom | Custom | Custom | Custom |

### 2.4 Add-On Packs

Bought ad-hoc or auto-attached when limits are hit (only with auto-reload enabled — default OFF).

| Pack | Adds | Price | Expires |
|---|---|---|---|
| **+25 slots** | Permanent slot capacity (recurring) | **€15/mo** | Recurring |
| **+10 always-on slots** | Permanent always-on capacity (recurring) | **€25/mo** | Recurring |
| **+100k requests** | One-time request top-up | **€10** | 12 months |
| **+1M requests** | One-time request top-up | **€60** | 12 months |

---

## 3. Module: Knowledge Base

| Tier | Storage | Documents | Embed tokens incl. (ingest) | EUR/mo | USD/mo |
|---|---|---|---|---|---|
| **Starter** | 200 MB | 50 | 1M tokens | **€15** | $17 |
| **Growth** | 2 GB | 500 | 10M tokens | **€49** | $55 |
| **Scale** | 20 GB | 5,000 | 100M tokens | **€199** | $223 |
| **Enterprise** | Custom | Custom | Custom | Custom | Custom |

**Included in module fee:** unlimited semantic search/retrieval (pgvector COGS is near-zero at this scale).

**AI-powered Q&A on KB content:** draws from **AI Wallet** (token cost transparently passed at 1.5× wholesale).

### Add-on packs

| Pack | Adds | Price | Expires |
|---|---|---|---|
| **+1 GB storage** | Recurring | **€10/mo** | Recurring |
| **+10M embed tokens** | One-time | **€8** | 12 months |

---

## 3b. flow.step Metering (non-AI steps)

### Rate

**€0.001 per non-AI flow step** (1 millicent/step).

A "step" is a single node that successfully completes inside a flow execution (emitted as a `flow.step` usage event). The flat rate is applied by the usage-consumer aggregator during hourly rollup into `monthly_aggregates.total_cost_eur`.

### AI + internal step exclusion

Two classes of steps are **not charged** as flow steps:

1. **AI steps billed via AI Wallet** — LLM token cost flows through `ai.message` events (wholesale ×1.5 pricing).
2. **Internal/local-compute steps** — zero marginal cost to us, so we don't meter them. Encourages heavy KB ingestion and search without per-step friction.

| Node type | Excluded from flow.step rate? | Why |
|-----------|-------------------------------|-----|
| `core:llm` | ✅ excluded | Billed via AI Wallet (LLM token cost) |
| `core:embedding` | ✅ excluded | **Free** — local ONNX inference, zero API cost |
| `core:vector_search` | ✅ excluded | **Free** — local pgvector query |
| `ai:*` (KB pipeline: `store_vectors`, `parse_document`, `filter_unchanged`, `merge_rrf`, `update_status`, `text_search`, `chunk_text`) | ✅ excluded | **Free** — internal housekeeping, encourages KB ingestion |
| `core:noop`, `core:http_request`, `core:transform`, `core:condition`, `core:formula_eval`, `core:calculator`, `core:loop`, `core:database`, `core:redis`, `core:delay`, `core:aggregate`, `core:script`, `core:expression` | **charged** | flow.step flat rate |

### Env-var control

The rate is configurable without code change:

```bash
FLOW_STEP_COST_EUR=0.001   # default; ops can tune per deployment
```

Read by the usage-consumer cron at startup. Invalid/negative values fall back to the default with a WARN log.

### Example

| Scenario | Steps | Rate | Cost |
|----------|-------|------|------|
| 1,000 non-AI steps/mo | 1,000 | €0.001 | **€1.00** |
| 10,000 non-AI steps/mo (Growth-tier flow user) | 10,000 | €0.001 | **€10.00** |
| 1,000 AI steps (core:llm) | 1,000 | €0.000 (excluded) | **€0.00** from this rate; token cost from AI Wallet |
| 1,000 KB-pipeline steps (ai:*, core:embedding, core:vector_search) | 1,000 | €0.000 (excluded) | **€0.00** — free internal compute |

Step costs accumulate in `monthly_aggregates.total_cost_eur` alongside AI and other event costs.

---

## 4. Module: Flows

| Tier | Executions/mo | Max steps/exec | Concurrent runs | Scheduled triggers | EUR/mo | USD/mo |
|---|---|---|---|---|---|---|
| **Starter** | 1,000 | 20 | 2 | 5 | **€19** | $21 |
| **Growth** | 10,000 | 50 | 10 | 50 | **€59** | $66 |
| **Scale** | 100,000 | 200 | 50 | Unlimited | **€249** | $279 |
| **Enterprise** | Custom | Custom | Custom | Custom | Custom | Custom |

**AI steps inside flows** (LLM calls, embeddings, etc.) draw from **AI Wallet**.

### Add-on packs

| Pack | Adds | Price | Expires |
|---|---|---|---|
| **+5,000 executions** | One-time | **€15** | 12 months |
| **+50,000 executions** | One-time | **€100** | 12 months |

---

## 5. AI Assistant (no module fee)

The AI Assistant chat UI is **available to every account** at no module fee. All token consumption comes from the **AI Wallet**. New accounts receive **€5 free wallet credit** to try the assistant during the 14-day trial.

Models exposed: Claude Opus, Claude Sonnet, Claude Haiku, GPT-4/5 class. Customer sees the per-message cost in real time.

---

## 6. AI Wallet (horizontal layer)

The AI Wallet is the **only place AI is monetized**. Any feature that consumes LLM tokens (KB Q&A, AI Assistant, AI steps in Flows, MCP tool use) draws from the wallet.

### Pricing model

- **Wholesale + 1.5× markup** per model. Customer sees both the wholesale rate and the BusinessLogic rate. No opacity.
- **EUR-denominated** — customer sees real money, not points or credits.
- **Per-message receipts** — every AI call shows: model, input tokens, output tokens, cost.

### Top-up packs

| Pack | Credit | Price | Expires |
|---|---|---|---|
| **Small** | €20 wallet | **€20** | 12 months |
| **Medium** | €50 wallet | **€50** | 12 months |
| **Large** | €200 wallet | **€200** | 12 months |
| **Custom** | Any amount ≥ €10 | 1:1 | 12 months |

### Hard cap & auto-reload (UX)

- **Hard cap default-on.** When wallet hits €0, AI features pause. Module subscriptions and non-AI features keep working.
- **Auto-reload OFF by default.** If enabled, the customer **must** set a monthly spend cap. Reload triggers at low balance.
- **Spend alerts** sent at 50%, 75%, 90%, 100% of monthly cap.
- **Per-feature usage breakdown** in the dashboard (KB Q&A, Assistant, Flows, MCP).

### Indicative wholesale rates (as of 2026-04)

| Model | Input ($/M tok) | Output ($/M tok) | BusinessLogic rate (1.5×, EUR) |
|---|---|---|---|
| Claude Haiku 4.5 | $1.00 | $5.00 | €1.34 / €6.70 per M |
| Claude Sonnet 4.6 | $3.00 | $15.00 | €4.02 / €20.10 per M |
| Claude Opus 4.7 | $15.00 | $75.00 | €20.10 / €100.50 per M |
| GPT-5 (est.) | $5.00 | $15.00 | €6.70 / €20.10 per M |

Rates auto-update from upstream provider pricing (refreshed weekly). Markup factor is the only constant.

---

## 7. Per-API-Key Sub-Limits

Available on **Growth and Scale** tiers (any module).

Each API key can have independent limits set:

| Limit type | Applies to | Example use |
|---|---|---|
| Monthly request cap | Calculator calls | Cap dev key at 5k req/mo |
| Monthly AI Wallet spend cap | All AI usage on this key | Cap partner key at €50/mo AI |
| Monthly KB search cap | KB queries | Cap embedded widget at 1k searches/mo |
| RPS cap | All requests | Throttle untrusted key to 5 RPS |
| IP allowlist | All requests | Production keys locked to known IPs |
| Module allowlist | Which modules this key can access | Frontend key = calculators only, no AI |

When a key hits its limit, the response is `429 Too Many Requests` with a header naming the breached limit. The account-level cap is unaffected.

---

## 8. Platform Allowances

Free with any paid module:

- 5 users / seats
- 10 API keys (more on Scale: unlimited)
- Audit log (90 days on Starter, 1 year on Growth, unlimited on Scale)
- Email support (Starter), priority support (Growth), dedicated Slack (Scale)
- 99.9% uptime SLA on Growth, 99.95% on Scale, 99.99% on Enterprise

Extra users: **€5/user/mo** beyond the included 5.

---

## 9. Trial

- **14 days, all four modules at Growth tier active**
- **€5 AI Wallet credit included**
- Hard cap on; wallet stops at €0
- Card not required to start; required to continue at day 14
- One trial per organization (email + domain check)

---

## 10. Annual Billing

**17% discount** when paying annually (pay 10 months, get 12).

Applies to all module subscriptions and recurring add-on packs. Does NOT apply to one-time top-up packs (those don't repeat).

| Module | Monthly | Annual (per month effective) | Annual upfront |
|---|---|---|---|
| Calculators Starter | €19 | €15.83 | €190 |
| Calculators Growth | €79 | €65.83 | €790 |
| Calculators Scale | €299 | €249.17 | €2,990 |
| KB Starter | €15 | €12.50 | €150 |
| KB Growth | €49 | €40.83 | €490 |
| KB Scale | €199 | €165.83 | €1,990 |
| Flows Starter | €19 | €15.83 | €190 |
| Flows Growth | €59 | €49.17 | €590 |
| Flows Scale | €249 | €207.50 | €2,490 |

---

## 11. Worked Examples

### Example A — Solo consultant launching one calculator

Activates only Calculators Starter. 1 medium calculator (8 slots), 3,500 calls/mo, no AI.

- Calculators Starter: **€19/mo**
- AI Wallet: €0 (not used)
- **Total: €19/mo** (€190/yr annual)

### Example B — SMB with calculators + AI assistant

Calculators Growth (3 calcs totalling 18 slots, 45k calls/mo), AI Assistant chat for staff (~€30/mo Sonnet usage).

- Calculators Growth: **€79/mo**
- AI Wallet usage: **~€30/mo**
- **Total: ~€109/mo**

### Example C — KB-driven support team

Activates KB Growth (1.2 GB docs, 8k Q&A/mo using Sonnet ≈ €40 wallet).

- KB Growth: **€49/mo**
- AI Wallet usage: **~€40/mo**
- **Total: ~€89/mo**

### Example D — Full platform user

Calculators Scale (60 slots used, 700k calls), KB Growth (1.5 GB), Flows Growth (4k executions, ~€80 AI inside flows), AI Assistant (~€50 Sonnet/mo).

- Calculators Scale: €299
- KB Growth: €49
- Flows Growth: €59
- AI Wallet usage: **~€130/mo**
- **Total: ~€537/mo**

### Example E — Large calculator with always-on

Calculators Growth, one L-class calculator (20 slots, ROI engine), customer wants instant response.

- Slot usage: 20 slots (within 50-slot allowance ✓)
- Always-on ON: 20 slots pinned. Plan includes 10 → 10 over allowance.
- Surplus billed via **+10 always-on slots** add-on: **+€25/mo**
- **Total: €79 + €25 = €104/mo**

---

## 12. COGS Sanity Check

Per-tier estimated cost-of-goods at 80% utilization, on Hetzner CCX23-class infrastructure (≈ €30/mo per 4 vCPU / 16 GB instance).

### Calculators

| Tier | Slot capacity | Memory if all slots S-class (24h, 80% always-on usage) | Compute (req/mo at 10ms each) | Est. COGS | Margin |
|---|---|---|---|---|---|
| Starter (€19) | 10 slots | ~80 MB pinned | 10k × 10ms = 100s CPU | **~€0.40** | **98%** |
| Growth (€79) | 50 slots | ~400 MB pinned | 100k × 10ms = 1000s CPU | **~€2.10** | **97%** |
| Scale (€299) | 250 slots | ~2 GB pinned | 1M × 10ms = ~3h CPU | **~€10.50** | **96%** |

**Memory is fully bundled in slot pricing.** Always-on add-on (€25 per 10 slots) covers ~100MB pinned 24/7 ≈ €0.20 actual cost — that price is mostly margin, justified by capacity reservation.

### KB

Storage on PostgreSQL + pgvector is near-zero cost (~€0.10/GB/mo on Hetzner). Embedding tokens are bundled and absorbed by the module fee (Sonnet embedding ≈ €0.10/M tokens at wholesale).

| Tier | Storage cost | Embed tokens cost | Est. COGS | Margin |
|---|---|---|---|---|
| Starter (€15) | €0.02 | €0.10 | **~€0.15** | **99%** |
| Growth (€49) | €0.20 | €1.00 | **~€1.50** | **97%** |
| Scale (€199) | €2.00 | €10.00 | **~€13.00** | **93%** |

### Flows

Flow executions are CPU + DB I/O. Rust engine, very efficient.

| Tier | Executions × avg 50ms CPU | Est. COGS | Margin |
|---|---|---|---|
| Starter (€19) | 1k × 50ms = 50s | **~€0.30** | **98%** |
| Growth (€59) | 10k × 50ms = 500s | **~€1.50** | **97%** |
| Scale (€249) | 100k × 50ms = ~1.4h | **~€8.00** | **97%** |

### AI Wallet

1.5× markup on wholesale = **33% gross margin** on token cost. Overhead (gateway, billing, observability) ≈ 5% → **net ~28% margin** on AI Wallet revenue. This is the lowest-margin line and is offset by the high-margin module subscriptions.

**Healthy mix target:** AI Wallet should be 25–40% of total revenue. Modules carry the gross margin; AI carries the engagement/expansion.

---

## 13. Migration from v1

Current single paying customer is on the legacy €74 ($79) Premium plan (5 calculators, 100k calls/mo).

**Migration offer:**
- Move to **Calculators Growth (€79/mo)** — gains: 50 slots vs hard 5-calc cap, AI Wallet access, KB & Flows now optional, per-key limits.
- **12-month price lock** at €74/mo grandfathered (no €5 increase).
- **€20 AI Wallet credit one-time bonus** as upgrade incentive.
- Quarterly review with the customer to confirm the new model fits.

---

## 14. Implementation Notes

### Directus collections needed

| Collection | Purpose |
|---|---|
| `subscription_plans` | Module + tier catalog (calculator/kb/flows × starter/growth/scale + enterprise) |
| `subscriptions` | Account → active modules (1 row per active module subscription) |
| `feature_quotas` | Per-account computed quotas: slots, requests, executions, KB storage, etc. |
| `calculator_slots` | Per-calculator slot count + always-on flag + size class |
| `addon_packs` | Active recurring add-ons (slot packs, request packs, etc.) per subscription |
| `ai_wallet` | Per-account wallet balance (EUR), monthly spend cap, hard cap toggle, auto-reload settings |
| `ai_wallet_topup` | Top-up history with expiry dates (12-mo from purchase) |
| `ai_wallet_ledger` | Append-only ledger of all wallet credits and debits |
| `api_key_limits` | Per-API-key sub-limits (request cap, AI spend cap, RPS, IP allowlist, module allowlist) |
| `usage_events` | Append-only event stream from each service: calculator calls, KB searches, flow runs, AI tokens |
| `monthly_aggregates` | Materialized monthly counters for dashboard + Stripe metering reports |

### Stripe products structure

- **3 modules × 4 tiers = 12 base subscription products** (Calculators Starter/Growth/Scale, etc.)
- **Recurring add-on products** — slot pack, always-on slot pack, KB storage pack
- **Metered AI Wallet product** — top-ups via Stripe Checkout one-time products
- **Annual variants** — separate price IDs per product with the 17% discount applied

### Metering

Each service emits to a shared `usage_events` channel (Redis stream → consumer aggregates to Postgres). Counters reset monthly on the customer's billing anchor day. Hard cap enforcement at the gateway layer (sub-50ms check via Redis cache).

---

## 15. Phased Rollout

### Phase 1 — Calculators module + AI Wallet (4–6 weeks)

Refactor the existing tiers into the new modular Calculators model with slots. Wire up AI Wallet as a horizontal service. Hard cap default-on. Migrate existing customer.

### Phase 2 — KB module monetization (3–4 weeks)

Activate KB billing. Bundle embed tokens. Wire KB Q&A to AI Wallet. Add the storage quota enforcement.

### Phase 3 — Flows module monetization (3–4 weeks)

Activate Flows billing. Wire AI steps inside flows to AI Wallet. Add execution metering.

### Phase 4 — Per-API-key sub-limits (2–3 weeks)

Add the limit catalog per key. Gateway enforcement. Dashboard UI.

### Phase 5 — Enterprise SKU + bundle discount (TBD)

Once 50+ customers are on modular pricing, evaluate bundle discount ("All Modules" with 15% off). Build Enterprise sales motion.

---

## 16. Open Questions (for review)

| # | Question | Tentative answer |
|---|---|---|
| 1 | Slot thresholds for size classes — XS/S/M/L cutoffs at 10/30/80/200 MB feel right? | Calibrate against the existing test calculators (jaap-calculator at 84 MB → M; ROI at 4.4 MB → XS). Looks reasonable. |
| 2 | Should always-on cost 2× slots, or be a separate flat €/MB-month metric? | 2× slots is simpler and easier to communicate. Tested in worked example E. |
| 3 | Should KB Q&A be free up to N queries/mo before drawing from AI Wallet? | No — keep it simple. AI Wallet covers all AI. Trial €5 credit gives ample try-out room. |
| 4 | Annual discount: 17% (12-for-10) or keep current 15%? | **17% recommended** — cleaner narrative, matches Stripe/Linear/Vercel norm. |
| 5 | Do we need a "bundle" SKU now? | No. Ship modular first. Add bundle at 50+ customers if data shows it's needed. |
| 6 | Currency display — show EUR primary with USD/DKK toggle, or detect by IP? | EUR primary in pricing page; USD shown alongside; full toggle in dashboard. |
| 7 | Does the existing xlsx need rebuilding to match v2? | **Yes — separate task.** Current xlsx encodes v1 logic (microservices count + calls only). Needs full rebuild for slots + modules + wallet. |

---

## 17. References

- v1 model archived in this doc's git history (commit before 2026-04-17)
- Strategy rationale: `docs/strategy/pricing.md`
- BizDev report: `docs/reports/bizdev-strategy-2026-04-17-pricing.md`
- Memory: `project_business_status.md`, `project_vision.md`
