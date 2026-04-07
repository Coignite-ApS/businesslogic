# Business Development & Strategy Report

**Date:** 2026-04-07
**Reviewer:** BizDev Strategy Agent
**Scope:** Full strategic review
**Branch:** dev
**Previous review:** 2026-03-24

---

## Executive Summary

Two weeks since last review. Engineering execution has been strong: KB scoping shipped, formula UX overhauled, feature flags completed, widget layout builder done, API key cleanup designed. However, **the core strategic gap remains: zero GTM motion**. Still one customer ($79/mo), no landing page, SDK not on npm, no free tier. The competitive landscape has shifted notably — Taskade's "vibe coding" calculator builder and Embeddable.co's AI-assisted builder are narrowing the differentiation gap on the calculator side. MCP ecosystem continues explosive growth. AI inference costs continue their decline, improving BL's unit economics. EU AI Act August 2026 deadline creates urgency for compliance-minded buyers.

**Bottom line:** The product is increasingly polished. The market window is narrowing. Every week spent building without launching increases risk of a well-funded competitor occupying the white space first.

---

## Market Position

**Overall Assessment:** DEVELOPING (unchanged from March)

| Dimension | Rating (1-5) | Key Insight |
|-----------|:---:|-------------|
| Product-Market Fit | 1.5 | Tech at 3+, business at 0. Zero market validation. |
| Competitive Position | 3.5 | Unique combination holds. Competitors nibbling at edges (Taskade AI, Embeddable AI). |
| Pricing Competitiveness | 3.0 | Designed but not implemented. Can't assess until live. |
| GTM Effectiveness | 0.5 | No GTM exists. No landing page, no published SDK, no free tier. |
| Growth Trajectory | 1.0 | $79/mo MRR, flat. Cannot grow without distribution. |

---

## Key Findings

### Market Updates (Since March 24)

**1. BI Platform Market Confirmed Growing**
- BI platform market: $19.4B (2026) -> $43.5B (2035) @ 9.4% CAGR
- 57% of new BI deployments integrate AI analytics engines
- 44% of BI users integrate NLQ (natural language query) — validates BL's AI chat approach
- Confidence: HIGH | Source: [Research Reports World](https://www.researchreportsworld.com/market-reports/business-intelligence-platform-market-500092), [TBlocks](https://tblocks.com/articles/business-intelligence-trends/)

**2. MCP Ecosystem Accelerating**
- 2026 = year of enterprise MCP adoption per CData, Gartner
- MCP Registry ("app store" for MCP servers) in development — BL should be listed day one
- Gartner: 40% of enterprise apps will include task-specific AI agents by end 2026
- Confidence: HIGH | Source: [CData](https://www.cdata.com/blog/2026-year-enterprise-ready-mcp-adoption), [MCP Roadmap](http://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)

**3. AI Inference Costs Continue Declining**
- GPT-4-equivalent: $0.40/M tokens vs $20 in late 2022 (50x decline)
- Budget tier (Haiku 4.5): $1.00/$5.00 per M tokens input/output
- Nano-class models: $0.10-0.25/M tokens
- BL's AI margin per query improves every quarter
- Confidence: HIGH | Source: [CloudIDR](https://www.cloudidr.com/llm-pricing), [PricePerToken](https://pricepertoken.com)

**4. Pricing Models Shifting to Hybrid**
- 43% of SaaS companies now use hybrid pricing (base + usage), projected 61% by end 2026
- Credits: 79 companies in PricingSaaS 500 use credit models (126% YoY growth)
- BUT: "credits are scaffolding, not long-term answer" — trend swinging back to simplicity
- BL's designed hybrid model (subscription tiers + AI query limits) aligns with market direction
- Confidence: HIGH | Source: [Monetizely](https://www.getmonetizely.com/blogs/the-2026-guide-to-saas-ai-and-agentic-pricing-models), [NxCode](https://www.nxcode.io/resources/news/saas-pricing-strategy-guide-2026)

**5. PLG Benchmarks Updated**
- Trial-to-paid: 15-25% for PLG (vs 5-10% sales-led)
- 27% of AI app spend comes through PLG (4x traditional SaaS)
- Value delivery must happen within 5 minutes of signup — "wow" experience is new baseline
- Hybrid PLG + Sales (PLS) is dominant model for high-growth B2B SaaS
- Confidence: HIGH | Source: [ProductLed](https://productled.com/blog/plg-predictions-for-2026), [Salesmate](https://www.salesmate.io/blog/what-is-product-led-growth/)

### Competitive Intelligence Update

**6. Taskade Genesis — New Threat**
- "Vibe coding" calculator builder: describe in plain text, AI generates working calculator
- Pricing: $4-19/mo (significantly cheaper than BL)
- Zero marginal cost per visitor once published (no per-lead/per-view fees)
- Agent Builder for AI agents, autopilot mode
- **Threat level: MEDIUM-HIGH** — AI-generated calculators commoditize simple use cases
- **BL defense:** Taskade can't handle complex Excel formulas (VLOOKUP, nested IF, financial functions). No formula engine. No KB/RAG. No MCP.
- Confidence: HIGH | Source: [Taskade Blog](https://www.taskade.com/blog/best-calculator-builders), [Taskade Pricing](https://www.capterra.com/p/170932/Taskade/pricing/)

**7. Embeddable.co — Gaining AI Features**
- AI editor suggestions: auto-recommends layout improvements and field configurations
- Plain English formula description -> AI creates variables, logic, formulas
- Charts, graphs, progress bars in results
- HubSpot, Mailchimp, Stripe integrations
- Positioning as "best interactive calculator builder in 2026"
- **Threat level: MEDIUM** — closer to BL than before, but still no formula engine, no KB, no MCP
- Confidence: HIGH | Source: [Embeddable.co](https://embeddable.co/calculators)

**8. Coherent Spark — Still Enterprise-Only**
- Launched "Coherent Assistant" Excel add-in (define I/O, test cases, debug in Excel)
- Salesforce AppExchange listing
- AWS Marketplace listing
- No SMB pricing move detected. Still $50K+/year.
- Duck Creek partnership for insurance
- **Threat level: LOW for SMB market** — their DNA is enterprise. Down-market move unlikely near-term.
- Confidence: MEDIUM | Source: [Coherent Platform](https://www.coherent.global/platform)

**9. Outgrow — Price Increase**
- Now starts at $22/mo (was $14/mo)
- Business plans $115+/mo
- No AI features added
- Still no complex formula support
- **Threat level: LOW** — falling behind on AI, raising prices
- Confidence: HIGH | Source: [Taskade comparison](https://www.taskade.com/blog/best-calculator-builders)

### EU AI Act — Regulatory Opportunity

**10. August 2, 2026 Enforcement Date**
- High-risk AI and transparency obligations enforceable
- ANY organization using AI in the EU must comply, regardless of HQ location
- <30% of European SMEs have taken any compliance steps (per Center for Data Innovation)
- Penalties: up to EUR 35M or 7% of global turnover
- **Opportunity for BL:** Audit trails, formula transparency (deterministic + explainable), KB provenance tracking are all compliance-friendly features. Position as "compliant AI calculator" for EU market.
- Confidence: HIGH | Source: [CloudEagle](https://www.cloudeagle.ai/blogs/eu-ai-act-saas-governance-enterprise-compliance), [SecurePrivacy](https://secureprivacy.ai/blog/eu-ai-act-2026-compliance)

---

## Opportunities (Act On)

| # | Opportunity | Impact | Confidence | Urgency | Evidence |
|---|------------|:------:|:----------:|:-------:|----------|
| 1 | **LAUNCH** — Landing page + free tier + SDK on npm | CRITICAL | HIGH | NOW | Zero discovery path exists. Competitors gaining AI features weekly. |
| 2 | **AppSumo LTD** — $99-499 tiers | HIGH | HIGH | Q2 2026 | $113M+ total partner payouts. Frase did $800K in 28 days. Calculator tools sell well on AppSumo. |
| 3 | **MCP Registry listing** — get listed on upcoming MCP "app store" | HIGH | MEDIUM | SOON | MCP Registry in development. First-mover advantage for "business logic MCP server" category. |
| 4 | **EU AI Act positioning** — "compliant smart calculators" for EU market | HIGH | MEDIUM | Q3 2026 | Aug 2 deadline. <30% SMEs compliant. Deterministic formulas + audit trails = natural fit. |
| 5 | **Product Hunt launch** — "Smart Calculators with AI" | MEDIUM | HIGH | After launch | 27% of AI app spend comes through PLG. PH is best PLG launch channel. |

## Risks (Watch / Mitigate)

| # | Risk | Probability | Impact | Mitigation |
|---|------|:----------:|:------:|------------|
| 1 | **Taskade/Embeddable add formula depth** — AI-generated formulas get smarter | MEDIUM | HIGH | Ship before they iterate. Rust engine + 300+ functions is 12-18mo moat. |
| 2 | **Market window closes** — well-funded competitor builds full stack | LOW-MEDIUM | CRITICAL | Launch NOW. First-mover in "smart calculators" category matters more than polish. |
| 3 | **Founder burnout / over-engineering** | HIGH | CRITICAL | March review said "stop building, start selling." Still building. |
| 4 | **AI inference cost normalization** — providers raise prices after market share grab | LOW | MEDIUM | Current margins (90%+) provide buffer. Usage caps protect against spikes. |
| 5 | **Calculator market commoditization via AI** — AI tools make simple calcs trivial to build | MEDIUM | MEDIUM | BL's moat is COMPLEX formulas, not simple ones. Focus messaging accordingly. |

## Gaps (Close)

| # | Gap | Customer Impact | Status vs March | Recommended Fix |
|---|-----|----------------|:---------------:|-----------------|
| 1 | **Landing page** | Zero discovery | UNCHANGED | Build this week. 1-page with demo. |
| 2 | **Free tier** | No PLG funnel | UNCHANGED | Implement. 1 calc, 500 views, 10 AI queries. |
| 3 | **SDK on npm** | Zero dev discovery | UNCHANGED | `npm publish`. 2 hours. |
| 4 | **Templates** | Empty canvas kills activation | UNCHANGED | 5 templates. Insurance, SaaS ROI, Pricing, Loan, TCO. |
| 5 | **Lead capture** | Missing primary purchase driver | UNCHANGED | Ship v1 (email gate on results). |
| 6 | **Usage enforcement** | Revenue leakage | UNCHANGED | Implement soft/hard limits from CMS-08 design. |

**Observation:** All 6 critical gaps from the March 24 review remain open. Two weeks of engineering went to KB scoping, formula UX, feature flags, and API key cleanup — all valuable but none GTM-unblocking.

---

## Competitive Intelligence Update

### Competitor Movement Summary (March 24 - April 7)

| Competitor | Movement | Threat Direction |
|-----------|----------|:----------------:|
| Taskade Genesis | Vibe-coding calculators, zero marginal cost | Rising |
| Embeddable.co | AI editor suggestions, plain-English formula creation | Rising |
| Coherent Spark | Coherent Assistant Excel add-in, Salesforce/AWS listings | Stable (enterprise) |
| Outgrow | Price increase to $22/mo, no AI features | Declining |
| Calconic | No significant updates detected | Stable |
| ConvertCalculator | No significant updates detected | Stable |
| involve.me | AI funnel generator positioning | Stable |

### Moat Reassessment

| Moat Component | March Status | April Status | Trend |
|----------------|:----------:|:----------:|:-----:|
| Rust formula engine (300+ functions) | STRONG | STRONG | Stable — AI-generated formulas threaten simple calcs but not complex ones |
| Calc + AI KB combination | STRONG | STRONG | Still unique. Embeddable adding AI but no KB/RAG. |
| MCP protocol support | STRONG | STRONG | More valuable as MCP ecosystem grows |
| Brand / awareness | WEAK | WEAK | Unchanged — zero marketing |
| Switching cost | MEDIUM | MEDIUM | Would increase if customers existed |

---

## Pricing Assessment

### Current State (Unchanged)
- Designed: Free/$19/$79/$249/custom
- Implemented: Only legacy $9.90/$49.90/$149.90 (calculator-only)
- Revenue: $79/mo from 1 customer (legacy pricing)

### Market Benchmark Update
- Hybrid pricing now dominant (43% of SaaS, heading to 61%)
- BL's designed model (subscription + AI query limits) aligns perfectly
- Taskade undercuts at $4-19/mo but without formula depth or AI KB
- Outgrow raised to $22/mo (validates upward pricing pressure)

### Pricing Confidence: HIGH
The designed pricing ($0/19/79/249) remains well-calibrated. No change needed. **Implementation is the blocker, not design.**

### AI Cost Update
| Model Tier | Mar 2026 Cost/Query | Apr 2026 Cost/Query | Trend |
|-----------|:---:|:---:|:---:|
| Haiku-class | $0.002-0.005 | $0.001-0.004 | Declining |
| Sonnet-class | $0.01-0.03 | $0.008-0.025 | Declining |
| Opus-class | $0.05-0.15 | $0.04-0.12 | Declining |

AI margins continue to improve. At Growth tier ($79/mo, 500 AI queries), estimated COGS is $2-4, yielding 95-97% margin on AI component.

---

## Product Progress Since Last Review

### Completed (March 24 - April 7)
1. **KB scoping** — API key-level data isolation for knowledge bases (critical security)
2. **Formula UX overhaul** — Onboarding-ready Test + Integration views
3. **Feature flags** — Full platform feature flag system (DB + Redis + Gateway + Admin UI + Module gating)
4. **Widget layout builder** — Completed (CMS-24)
5. **API key cleanup** — Design spec complete for gateway

### Assessment
Good engineering. Wrong priority order for business growth. KB scoping and feature flags are infrastructure for scale — scale that doesn't exist yet with 1 customer.

**Recommended reframe:** Every engineering hour should now answer: "Does this help acquire customer #2-100?"

---

## Recommended Actions (Priority Order)

### Immediate (This Week)

| # | Action | Effort | WHY NOW |
|---|--------|:------:|---------|
| 1 | `npm publish @coignite/sdk` | 2 hours | Zero developer discovery without it. Cheapest possible marketing. |
| 2 | Build 1-page landing site | 3-5 days | No acquisition path exists. Use Smart Calculators positioning. |
| 3 | Set up analytics (PostHog/Plausible) | 1 day | Measure from day one. |

### Short-Term (This Month — April)

| # | Action | Effort | WHY |
|---|--------|:------:|-----|
| 4 | Implement free tier (1 calc, 500 views, 10 AI) | 2-3 days | PLG requires it. Every competitor has one. |
| 5 | Create 5 calculator templates | 3-5 days | Empty canvas problem kills activation rate. |
| 6 | Ship lead capture v1 (email gate) | 3-5 days | #1 B2B marketing buyer purchase driver. |
| 7 | Implement new pricing tiers in Stripe | 2-3 days | Cannot monetize AI/KB without it. |

### Medium-Term (May-June — Q2)

| # | Action | Effort | WHY |
|---|--------|:------:|-----|
| 8 | Product Hunt launch | 2 days prep | "Smart Calculators — AI that explains your results" |
| 9 | AppSumo LTD launch ($99-499) | 1 week prep | Cash injection + user base. Frase did $800K. |
| 10 | MCP directory listings (mcp.so, Smithery) | 1 day | Developer awareness, MCP Registry prep. |
| 11 | 3 SEO articles | 3 days | "Excel calculator on website", "Outgrow alternative", "insurance calculator builder" |
| 12 | LinkedIn outreach (25 insurance agencies) | Ongoing | Validate ICP with real conversations. |

---

## Strategy Documents Updated

No strategy document updates this cycle — the March 24 strategy documents remain current. Market data confirms existing analysis. This report documents incremental intelligence only.

**Documents that need updating when GTM launches:**
- `docs/strategy/metrics.md` — needs creation (KPI tracking)
- `docs/strategy/sales-playbook.md` — needs creation (once first 10 customers exist)
- `docs/strategy/marketing.md` — needs creation (content calendar, channel plan)

---

## Next Review

**Recommended in:** 2 weeks (April 21, 2026)
**Focus areas:**
- Has landing page shipped? SDK published? Free tier live?
- If yes: early traffic/signup metrics
- If no: escalate urgency — market window assessment

**Market triggers to watch:**
- MCP Registry launch date announcement — must be listed on day one
- Taskade or Embeddable adding KB/RAG features — would narrow differentiation gap
- EU AI Act guidance updates specific to SaaS calculators
- Coherent Spark any signal of SMB pricing tier
- AppSumo marketplace trends for AI/calculator tools

---

## Sources

### Market & Industry
- [Morgan Stanley — AI Market Trends 2026](https://www.morganstanley.com/insights/articles/ai-market-trends-institute-2026)
- [Research Reports World — BI Platform Market](https://www.researchreportsworld.com/market-reports/business-intelligence-platform-market-500092)
- [TBlocks — BI Trends 2026](https://tblocks.com/articles/business-intelligence-trends/)
- [Scoop — BI Statistics 2026](https://scoop.market.us/business-intelligence-statistics/)
- [CData — Enterprise MCP Adoption 2026](https://www.cdata.com/blog/2026-year-enterprise-ready-mcp-adoption)
- [MCP Roadmap 2026](http://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
- [Pento — A Year of MCP](https://www.pento.ai/blog/a-year-of-mcp-2025-review)

### Competitor Intelligence
- [Taskade — Best Calculator Builders 2026](https://www.taskade.com/blog/best-calculator-builders)
- [Embeddable.co — AI Calculator Builder](https://embeddable.co/calculators)
- [Embeddable.co — Best Calculator Builders 2026](https://embeddable.co/blog/best-calculator-builders-2025)
- [Coherent — Platform](https://www.coherent.global/platform)
- [Coherent — Spark Assistant](https://www.coherent.global/blog/coherent-spark-assistant-excel-addin)

### Pricing Intelligence
- [Monetizely — 2026 SaaS/AI Pricing Guide](https://www.getmonetizely.com/blogs/the-2026-guide-to-saas-ai-and-agentic-pricing-models)
- [NxCode — SaaS Pricing Strategy 2026](https://www.nxcode.io/resources/news/saas-pricing-strategy-guide-2026)
- [Ibbaka — B2B SaaS Pricing Predictions 2026](https://www.ibbaka.com/ibbaka-market-blog/b2b-saas-and-agentic-ai-pricing-predictions-for-2026)
- [CloudIDR — LLM API Pricing 2026](https://www.cloudidr.com/llm-pricing)
- [PricePerToken — LLM Cost Comparison](https://pricepertoken.com)

### PLG & GTM
- [ProductLed — PLG Predictions 2026](https://productled.com/blog/plg-predictions-for-2026)
- [Salesmate — PLG 2026](https://www.salesmate.io/blog/what-is-product-led-growth/)
- [UserGuiding — State of PLG 2026](https://userguiding.com/blog/state-of-plg-in-saas)
- [Mixpanel — PLG Guide 2026](https://mixpanel.com/blog/product-led-growth/)

### Regulatory
- [CloudEagle — EU AI Act SaaS Governance](https://www.cloudeagle.ai/blogs/eu-ai-act-saas-governance-enterprise-compliance)
- [SecurePrivacy — EU AI Act 2026 Compliance](https://secureprivacy.ai/blog/eu-ai-act-2026-compliance)
- [ComplianceAndRisks — EU AI Act Requirements 2026](https://www.complianceandrisks.com/blog/eu-ai-act-compliance-requirements-for-companies-what-to-prepare-for-2026/)

### AppSumo & Launch
- [IBTimes — AppSumo Review 2026](https://www.ibtimes.com.au/appsumo-review-2026-lifetime-deals-marketplace-thrives-amid-ai-boom-offering-deep-discounts-1862819)
- [EcommerceParadise — AppSumo Review 2026](https://ecommerceparadise.com/appsumo-review-2026-the-best-place-to-find-lifetime-software-deals-for-ecommerce-entrepreneurs/)
