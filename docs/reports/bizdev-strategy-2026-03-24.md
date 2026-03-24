# Business Development & Strategy Report

**Date:** 2026-03-24
**Reviewer:** BizDev Strategy Agent
**Scope:** Full strategic review
**Branch:** dev
**Last Commit:** a72850f (docs: mark CMS-01, AI-02 completed)

---

## Executive Summary

BusinessLogic occupies an emerging niche at the intersection of **embeddable calculators**, **AI knowledge bases**, and **workflow automation** -- a combination no single competitor offers today. The calculator builder market ($5-15/mo ARPU, commoditizing) is too small alone, but becomes defensible when combined with AI-powered business intelligence delivered through MCP, APIs, and embeddable widgets. The biggest strategic opportunity is positioning as a **"Predictable Business Intelligence" platform** that lets businesses expose their proprietary logic (formulas, knowledge, workflows) as AI-accessible tools. The biggest risk is that the product spans three categories without achieving PMF dominance in any one. Pricing should shift from calculator-centric tiers to a **platform pricing model** with AI/KB as the value driver and calculators as the entry wedge.

---

## Market Position

**Overall Assessment:** DEVELOPING

| Dimension | Rating (1-5) | Key Insight |
|-----------|:---:|-------------|
| Product-Market Fit | 2 | Strong calculator product, but AI+KB+MCP capabilities not yet monetized. One paying customer. |
| Competitive Position | 3 | Unique capability combination. No direct competitor offers calculators + AI KB + MCP + workflows together. |
| Pricing Competitiveness | 2 | Current pricing ($9.90-$149.90) is calculator-only. New AI/KB features need pricing that captures their higher value. |
| GTM Effectiveness | 1 | No visible GTM motion. No marketing site content found, no PLG funnel, no developer documentation portal. |
| Growth Trajectory | 2 | Excellent architecture (5-service mesh), comprehensive SDK, MCP support. But revenue is pre-scale (1 customer). |

---

## Key Findings

### Opportunities (Act On)

1. **MCP-native business intelligence** — Confidence: HIGH — Impact: Category-defining
   - MCP ecosystem grew from 100K to 8M+ server downloads in 6 months. 97M monthly SDK downloads. First-class support in Claude, ChatGPT, Cursor, Gemini, VS Code, Copilot.
   - BusinessLogic already has MCP endpoints for calculators and plans account-level MCP. This is a massive early-mover advantage.
   - By 2026, Gartner predicts 40% of enterprise apps will include task-specific AI agents. MCP is the connectivity layer.

2. **"Formula-as-a-Service" API positioning** — Confidence: HIGH — Impact: New revenue stream
   - No competitor offers Excel-formula evaluation as a programmatic API with AI augmentation. The Rust-powered formula engine is a genuine technical moat.
   - Developer API use case (embed formulas in apps) is distinct from and higher-value than the widget/marketing calculator use case.

3. **AI Knowledge Base + Calculator convergence** — Confidence: MEDIUM — Impact: Strong differentiator
   - Competitors like Outgrow/Calconic offer dumb calculators. BusinessLogic can offer calculators that pull from knowledge bases, answer follow-up questions, and adapt via AI.
   - "Smart calculators" that explain their results using RAG + AI is a genuinely new category.

4. **Lifetime Deal launch for initial traction** — Confidence: HIGH — Impact: 100-600 paying users
   - AppSumo/ProductHunt LTDs at $99-$499 would generate initial user base, feedback loop, and social proof.
   - Calculator builders perform well on AppSumo (Calconic, involve.me both launched there).

### Risks (Watch / Mitigate)

1. **Feature sprawl across three categories** — Probability: HIGH — Impact: Delayed PMF
   - Product spans calculators, AI chat/KB, and workflow automation. Each is a separate market with separate buyers.
   - Risk of being "good at everything, great at nothing" — the classic platform trap for early-stage products.
   - **Mitigation:** Choose a beachhead segment. Recommend: "AI-augmented calculators for B2B SaaS" as primary entry, expand to KB and flows after PMF.

2. **Pre-revenue with enterprise architecture** — Probability: MEDIUM — Impact: Runway burn
   - 5-service architecture, Hetzner infra (~EUR57/mo), and sophisticated tooling — but only 1 paying customer at $149.90/mo.
   - Over-engineering risk: effort spent on architecture vs. customer acquisition.
   - **Mitigation:** The EUR57/mo cost is negligible. Architecture pays dividends when scaling. But GTM must start NOW.

3. **Calculator market commoditization** — Probability: HIGH — Impact: Pricing pressure
   - Calconic ($5-79/mo), uCalc ($9.99/mo), Outgrow ($14-65/mo) are cheap. AI-powered builders (Taskade, Embeddable) are entering.
   - Pure calculator pricing is a race to the bottom.
   - **Mitigation:** Don't compete on calculators alone. Price on the AI/KB/API platform value.

4. **EU AI Act compliance** — Probability: LOW-MEDIUM — Impact: Legal risk if unaddressed
   - Full enforcement August 2, 2026. BusinessLogic's AI features (chat, KB search, embeddings) are likely "limited risk" (transparency obligations only) unless used in high-risk contexts (credit, employment).
   - **Mitigation:** Add AI Act transparency disclosures. Document AI system behavior. Low engineering effort.

### Gaps (Close)

1. **No marketing site / public landing page** — Customer impact: Zero organic discovery — Recommendation: Build a conversion-focused landing page with calculator demos, pricing, and API docs.

2. **No developer documentation portal** — Customer impact: Can't evaluate API without signup — Recommendation: Publish OpenAPI spec + SDK docs on a public docs site. Essential for developer-first PLG.

3. **Pricing not enforced (calls_per_month)** — Customer impact: Revenue leakage — Recommendation: Implement usage enforcement before scaling. Already documented in CMS-08.

4. **No onboarding flow** — Customer impact: High churn risk — Recommendation: Build calculator onboarding wizard (CMS-03 planned) + first-value-in-5-minutes experience.

5. **SDK at v0.1.0, not published to npm** — Customer impact: Developers can't integrate — Recommendation: Publish @coignite/sdk to npm and create getting-started guide.

---

## Competitive Intelligence

### Direct Competitors (Calculator + AI/BI)

No single competitor combines all of BusinessLogic's capabilities. Competitors exist in segments:

| Competitor | Segment | Pricing | Strength | Weakness vs BL |
|-----------|---------|---------|----------|----------------|
| **Calconic** | Calculator widgets | Free-$79/mo | Simple, cheap, WordPress plugin | No AI, no API, no KB |
| **Outgrow** | Lead-gen calculators | $14-65/mo | CRM integrations, A/B testing | No formula engine, no AI |
| **ConvertCalculator** | Pricing calculators | From $18/mo | Free tier, pricing focus | No AI, no API, limited formulas |
| **Embeddable.co** | Widget builder | Free-paid | AI-assisted builder, modern UX | No formula engine, no KB, no API |
| **involve.me** | Interactive content | Free-$83/mo | Multi-format (quiz, calc, form) | No AI chat, no knowledge base |

### Adjacent Competitors (AI/KB/RAG)

| Competitor | Segment | Pricing | Strength | Weakness vs BL |
|-----------|---------|---------|----------|----------------|
| **LangChain/LlamaIndex** | RAG frameworks | Free (OSS) | Huge community, flexible | Developer tool, not end-user product |
| **Pinecone** | Vector DB | Usage-based | Market-leading vector DB | Infrastructure, not application layer |
| **Personal AI** | Personal KB | $15-40/mo | Consumer-friendly | No calculator, no formula engine |

### Substitutes

- **Manual spreadsheets + ChatGPT** — Most common "competitor." Users build Excel sheets and paste into ChatGPT. BusinessLogic automates this.
- **Custom-built internal dashboards** — Engineering teams build their own. BL reduces this to configuration.
- **Traditional BI (Tableau, Power BI)** + manual analysis — Expensive, complex, not embeddable.

### Key Competitive Insight

BusinessLogic's moat is the **combination**: Excel-grade formula engine (Rust) + AI knowledge base (RAG) + embeddable widgets + MCP protocol + workflow automation. Competitors would need to build or acquire 3-4 separate capabilities to match this. The formula engine alone (Rust, 300+ Excel functions) would take 12-18 months to replicate.

---

## Pricing Assessment

### Current Model: Underpriced for Value, Overpriced for Calculators Alone

| Issue | Detail |
|-------|--------|
| Calculator-only pricing competes with $5-19/mo tools | BL's $9.90 Basic is in the commodity range |
| AI/KB/MCP not priced at all | These are the high-value features with no monetization plan |
| Only 1 customer at $149.90/mo | Insufficient data for pricing validation |
| calls_per_month not enforced | Usage limits exist on paper but aren't implemented |

### Recommended Pricing Strategy

**Model: Hybrid (Platform subscription + usage-based AI)**

The proposed tiers in CMS-08 (Starter $19, Growth $79, Business $249) are well-researched and appropriate. Key adjustments recommended:

1. **Rename to emphasize AI platform, not calculators** — Buyers paying $79-249/mo expect AI-powered intelligence, not just widgets.

2. **AI credits as the primary value metric** — The market is moving to credit-based models (126% YoY growth in credit-based pricing). AI queries should be the expansion lever, not calculator count.

3. **Free tier for developers** — API access with rate limits (100 calls/day, 10 AI queries/day). Essential for PLG and SDK adoption. Competitors offer free tiers.

4. **Enterprise pricing** — $500-2000/mo for white-label, SSO, SLA, dedicated support. This is where B2B SaaS margin lives.

| | **Free** | **Starter** | **Growth** | **Business** | **Enterprise** |
|---|---|---|---|---|---|
| Price | $0 | $19/mo | $79/mo | $249/mo | Custom |
| Target | Developers/Eval | Solo/Freelancer | Growing business | Team/Agency | Large org |
| Calculators | 1 | 3 | 15 | 50 | Unlimited |
| API calls/mo | 500 | 5,000 | 50,000 | 500,000 | Custom |
| AI queries/mo | 10 | 50 | 500 | 5,000 | Custom |
| Knowledge Bases | 0 | 0 | 3 | 10 | Custom |
| MCP access | No | Per-calc | Per-calc | Account-level | Account-level |
| Widget embed | Yes (branded) | Yes | Yes (unbranded) | White-label | White-label |

### AI Inference Cost Analysis

- AI inference costs dropping 50x/year median. Claude Opus 4.5: $5/$25 per M tokens. Haiku-class: $0.25/$1.25.
- At $0.01-0.05 per AI query (using mid-tier models), 500 queries/mo costs BL $5-25 in COGS.
- Growth tier at $79/mo with 500 AI queries = healthy 68-93% gross margin on AI.
- **Key insight:** Falling inference costs mean AI margins will only improve over time. Price on value, not cost.

---

## Jobs to Be Done Analysis

### Core Functional Jobs

1. **"I want to turn my Excel expertise into a product"** — When a consultant/business has proprietary calculations, they want to embed them on a website for clients to use, so they can scale their expertise beyond 1:1 delivery.

2. **"I want my AI to know my business logic"** — When a business has domain knowledge and formulas, they want AI that understands their specific calculations and data, so customers get accurate, contextual answers.

3. **"I want to expose my business logic as an API"** — When a developer or SaaS company needs calculation/intelligence capabilities, they want a programmable API, so they can integrate into their own products.

### Emotional Jobs
- **Confidence:** "I trust the numbers because they come from my own formulas, not a black box."
- **Authority:** "I look like I have a sophisticated tech platform, even though I'm a small business."

### Related Jobs
- Lead capture from calculator users
- Analytics on how calculators are used
- Version control for business logic changes

---

## Go-to-Market Assessment

### Recommended GTM Model: Developer-First PLG + Content-Led Growth

| Model | Fit | Evidence |
|-------|-----|---------|
| **Product-Led Growth (PLG)** | HIGH | API-first product with SDK. Self-serve signup + free tier enables this. PLG achieves 3-5x lower CAC for SMB. |
| **Developer-First** | HIGH | TypeScript SDK, MCP endpoints, OpenAPI spec — natural developer product. |
| **Content-Led Growth** | HIGH | "How to build a pricing calculator" and "How to add AI to your business" are high-intent SEO topics. |
| **Sales-Led** | LOW (now) | Only for Enterprise tier. Don't invest in sales until $500K+ ARR. |
| **Partner/Channel** | MEDIUM (later) | Consultancies, agencies, and Directus ecosystem partners. Not yet. |

### Ideal Customer Profile (ICP)

**Primary: The "Excel Expert" SaaS-ifier**
- **Who:** Consultants, financial advisors, insurance brokers, accountants, real estate agents with proprietary calculations
- **Company size:** 1-50 employees
- **Trigger:** Client asks "can you put that calculator on our website?"
- **Budget:** $19-249/mo (self-serve), allocated from marketing or operations
- **Decision maker:** Owner/founder, no procurement process

**Secondary: The "API-First" Builder**
- **Who:** SaaS developers needing formula evaluation or AI KB in their product
- **Company size:** 5-200 employees (tech companies)
- **Trigger:** Building a feature that requires calculations or AI-augmented answers
- **Budget:** $79-249/mo or enterprise custom
- **Decision maker:** CTO/Lead developer

**Anti-ICP (avoid):**
- Large enterprises needing Tableau/Power BI replacement (too complex, long sales cycle)
- Consumers wanting personal finance calculators (low LTV, high support)
- Companies wanting generic chatbots without domain-specific knowledge (not our strength)

### Positioning Statement

**For** business professionals and developers
**Who** need to turn proprietary business logic into AI-powered tools
**BusinessLogic is** a predictable business intelligence platform
**That** lets you embed smart calculators, AI knowledge bases, and formula APIs into any application
**Unlike** basic calculator builders (Calconic, Outgrow) or generic AI platforms (ChatGPT, custom RAG)
**BusinessLogic** combines an Excel-grade formula engine with AI knowledge retrieval and MCP protocol support, so your business logic is accessible to both humans and AI agents.

---

## Recommended Actions (Priority Order)

### Immediate (This Sprint)

1. **Publish @coignite/sdk to npm** — The SDK exists and works. Publishing it makes the API real and discoverable. 1-2 hours of effort.
   - WHY: Developers can't evaluate BusinessLogic without this. Zero distribution without it.

2. **Enforce calls_per_month** — Revenue leakage. Already documented in CMS-08 Phase A.
   - WHY: Cannot sell usage-based pricing if usage isn't tracked.

3. **Build a landing page** — Conversion-focused page with live calculator demo, pricing, and "Try Free" CTA.
   - WHY: No organic discovery path exists. Every other competitor has a marketing site.

### Short-Term (This Quarter — Q2 2026)

4. **Launch on Product Hunt** — Calculator + AI KB + MCP angle. Unique enough to stand out.
   - WHY: Product Hunt is the best PLG launch channel for developer/business tools. Low cost, high signal.

5. **Implement free tier** — 1 calculator, 500 API calls, 10 AI queries. Essential for PLG funnel.
   - WHY: Every competitor offers a free tier. Without one, there's no way to build a pipeline.

6. **Publish developer docs** — OpenAPI spec, SDK quickstart, code examples, MCP integration guide.
   - WHY: Developer adoption requires docs. API products live or die by documentation quality.

7. **AppSumo Lifetime Deal launch** — Tier 1 ($99), Tier 2 ($249), Tier 3 ($499). Cap at 600 total.
   - WHY: Generates 100-600 users, $30K-150K one-time revenue, and massive feedback loop.

8. **SEO content: "How to build an AI calculator"** — 5-10 long-tail articles targeting calculator builder + AI keywords.
   - WHY: High-intent organic traffic. Calculator builder queries have low competition and clear purchase intent.

### Medium-Term (Q3 2026)

9. **Widget Layout Builder** (CMS-24) — Visual drag-drop design for embeddable widgets.
   - WHY: Design flexibility is the #1 complaint about calculator builders. This differentiates from Calconic/Outgrow.

10. **Account-Level MCP** (CMS-20 + Formula-06) — Unified MCP endpoint per account covering all calculators + KB.
    - WHY: MCP adoption is accelerating. Being the first "business intelligence MCP server" is a land-grab opportunity.

11. **Lead Capture integration** (CMS-06) — HubSpot, Salesforce, webhook integrations from calculator submissions.
    - WHY: Lead capture is the primary purchase driver for Outgrow/involve.me customers. Must-have for Growth/Business tiers.

12. **Template Gallery** (CMS-07) — Pre-built calculator templates by industry (insurance, real estate, SaaS pricing, financial planning).
    - WHY: Reduces time-to-value from hours to minutes. Doubles as SEO content and social proof.

---

## PMF Level Assessment

| Level | Description | Our Status |
|-------|-------------|------------|
| **Level 0: Nascent** | Idea stage | PAST |
| **Level 1: Developing** | Some users, learning | **CURRENT** — 1 customer, $149.90/mo, rich product but minimal distribution |
| Level 2: Strong | Clear demand, retention | TARGET: Reach with AppSumo launch + free tier |
| Level 3: Extreme | Market pull, viral growth | Aspirational |

**To reach Level 2:** Need 50+ paying customers, <5% monthly churn, and evidence of organic demand (inbound sign-ups without paid marketing). The LTD launch + free tier + content strategy should get there within 6-9 months.

---

## Strategy Documents Updated

- `docs/strategy/market-landscape.md` — Created
- `docs/strategy/competitive-analysis.md` — Created
- `docs/strategy/pricing.md` — Created
- `docs/strategy/positioning.md` — Created
- `docs/strategy/gtm.md` — Created
- `docs/strategy/opportunities.md` — Created

---

## Next Review

**Recommended in:** 8 weeks (after Q2 launch activities)
**Focus areas:** Post-launch metrics (signups, activation, retention), AppSumo feedback analysis, pricing validation from free tier conversion data
**Market triggers to watch:**
- MCP protocol major updates (any new capabilities that affect our integration)
- Competitor launches combining calculators + AI (Embeddable.co is closest)
- AI inference price drops below $1/M tokens for mid-tier models (changes AI margin calculus)
- EU AI Act enforcement details finalized (August 2026 deadline)

---

## Sources

- [Fortune Business Insights — BI Market](https://www.fortunebusinessinsights.com/business-intelligence-bi-market-103742) — $37.96B in 2026, 8.4% CAGR
- [Grand View Research — BI Software Market](https://www.grandviewresearch.com/industry-analysis/business-intelligence-software-market) — $81.45B by 2033
- [Mordor Intelligence — Embedded Analytics Market](https://www.mordorintelligence.com/industry-reports/embedded-analytics-market) — $150.4B by 2030, 13.88% CAGR
- [Monetizely — 2026 SaaS AI Pricing Guide](https://www.getmonetizely.com/blogs/the-2026-guide-to-saas-ai-and-agentic-pricing-models) — Credit-based pricing up 126% YoY
- [Bessemer — AI Pricing Playbook](https://www.bvp.com/atlas/the-ai-pricing-and-monetization-playbook) — Hybrid models report 38% higher revenue growth
- [Metronome — State of Usage-Based Pricing 2025](https://metronome.com/state-of-usage-based-pricing-2025) — 85% of SaaS leaders using usage-based
- [Taskade — Best Calculator Builders 2026](https://www.taskade.com/blog/best-calculator-builders) — Competitor pricing comparison
- [Capterra — Calconic Pricing](https://www.capterra.com/p/184774/Calconic/) — Free-$79/mo
- [Capterra — Outgrow Pricing](https://www.capterra.com/p/168229/Outgrow/pricing/) — $14-65/mo
- [Thoughtworks — MCP Impact 2025](https://www.thoughtworks.com/en-us/insights/blog/generative-ai/model-context-protocol-mcp-impact-2025)
- [CData — Enterprise MCP Adoption 2026](https://www.cdata.com/blog/2026-year-enterprise-ready-mcp-adoption) — 40% enterprise apps with AI agents by 2026
- [IntuitionLabs — AI API Pricing 2026](https://intuitionlabs.ai/articles/ai-api-pricing-comparison-grok-gemini-openai-claude) — Inference costs falling 50x/year
- [Epoch AI — LLM Inference Price Trends](https://epoch.ai/data-insights/llm-inference-price-trends) — GPT-4 equivalent from $20 to $0.40/M tokens
- [LegalNodes — EU AI Act 2026](https://www.legalnodes.com/article/eu-ai-act-2026-updates-compliance-requirements-and-business-risks) — Full enforcement August 2, 2026
- [Embeddable.co — Calculator Builder](https://embeddable.co/calculators) — Closest emerging competitor
