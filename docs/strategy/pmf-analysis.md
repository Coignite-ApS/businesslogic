# Product-Market Fit Analysis

**Date:** 2026-03-24 (v2 — expanded from calculator-only to full platform analysis)
**Status:** Strategic research — decision document
**Purpose:** Find PMF for BusinessLogic as a **business intelligence hub**, not just a calculator builder

---

## Executive Summary

BusinessLogic sits at the intersection of three exploding markets: **business rules engines** ($12B+ by 2026, 45% CAGR), **AI knowledge platforms** ($5B+), and **MCP infrastructure** (97M+ monthly SDK downloads). No single competitor spans all three.

**The market category we're creating:** *Programmable Business Intelligence* — a headless platform where companies store their business logic (formulas, knowledge, rules) once, then expose it everywhere: widgets, APIs, AI agents (MCP), and automated workflows.

**Key finding:** The original PMF analysis (v1) correctly identified B2B lead-gen calculators as the entry wedge. This v2 analysis confirms that entry point but reveals a **much larger opportunity** as the "logic layer" for businesses — analogous to what Stripe is for payments or Twilio for communications.

**Three concentric rings of opportunity:**
1. **Entry (now):** Embeddable calculators with AI chat — $500M-1B market, ready to ship
2. **Expansion (6-12mo):** Business rules + knowledge platform for regulated industries — $5-10B market
3. **Vision (12-24mo):** The "Business Brain" — MCP-native hub where all company logic lives, queryable by any AI agent — potentially $50B+ as AI agents become standard

**The killer insight:** Coherent Spark (the closest comparable) raised $89M to do Excel-to-API for insurance at $50-70K/year. BusinessLogic does the same thing PLUS AI knowledge base + MCP + embeddable widgets, at 1/100th the price. We're the Coherent Spark for SMBs.

---

## 1. Market Category Definition

### The Problem Space

Business logic is scattered across:
- **Spreadsheets** — 88% of spreadsheets contain errors; electricity company lost $24M from one cut-paste error
- **People's heads** — knowledge workers spend 30% of time searching for information
- **Custom code** — $10K-50K per custom calculator; weeks to modify
- **Disconnected SaaS tools** — 36% of organizations use 3+ knowledge management tools

The result: business logic is **trapped, fragile, and inaccessible to AI**.

### Where BusinessLogic Fits

BusinessLogic creates a **new category** at the intersection of three existing markets:

```
                    Business Rules Engines
                   (DecisionRules, GoRules, Decisions.com)
                    $12B market, enterprise-focused
                    $199-6,750/mo pricing
                           |
                           |
    AI Knowledge Platforms----+----Embeddable Calculator Builders
    (Guru, Notion AI, Glean)  |    (Outgrow, Calconic, ConvertCalculator)
    $5B+ market               |    $500M-1B market
    $25/seat/mo+              |    $14-720/mo pricing
                              |
                     BusinessLogic
                     "Programmable Business Intelligence"
                     Calc + KB + Rules + MCP + Widgets
```

**Category name options:**
1. "Programmable Business Intelligence" (API-first BI)
2. "Business Logic as a Service" (BLaaS)
3. "The Business Brain Platform"
4. "Headless Business Logic Layer"

**Recommended: "Business Brain"** for marketing, **"Business Logic Platform"** for enterprise/technical buyers.

### Market Sizing

| Layer | Market | Size (2026) | CAGR | BL Fit |
|-------|--------|-------------|------|--------|
| AI Agent Platforms | Agentic AI | $12B | 45.5% | HIGH — MCP-native |
| Business Rules Engines | Decision Intelligence | $12B+ | 12-15% | HIGH — formula engine is a rules engine |
| AI Knowledge Management | Enterprise KM | $5B+ | 20-25% | HIGH — KB + RAG built |
| Embedded Analytics | Self-serve BI | $44.5B | 11.4% | MEDIUM — widgets + API |
| Calculator Builders | Interactive content | $500M-1B | 15-20% | HIGH — core product |
| MCP Infrastructure | AI tool connectivity | $1.8B (est.) | 100%+ | HIGH — early mover |
| CPQ (Configure-Price-Quote) | Sales tools | $3.5B | 14% | MEDIUM — lighter alternative |

**Total addressable at intersection: $5-15B and growing**

---

## 2. Competitive Landscape — The White Space

### The Landscape Map

| Capability | BL | Coherent Spark | DecisionRules | GoRules | Guru | Outgrow | n8n | Voiceflow | Stack AI | Relevance AI |
|------------|:--:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Excel formula engine** | YES | YES | NO | NO | NO | NO | NO | NO | NO | NO |
| **300+ Excel functions** | YES | YES | NO | NO | NO | NO | NO | NO | NO | NO |
| **Embeddable widgets** | YES | NO | NO | NO | NO | YES | NO | NO | NO | NO |
| **AI knowledge base (RAG)** | YES | NO | NO | NO | YES | NO | NO | YES | YES | YES |
| **MCP server** | YES | NO | NO | NO | YES | NO | NO | NO | NO | NO |
| **REST API** | YES | YES | YES | YES | NO | NO | YES | YES | YES | YES |
| **Workflow/DAG engine** | YES | NO | NO | NO | NO | NO | YES | YES | YES | YES |
| **Decision tables** | NO | NO | YES | YES | NO | NO | NO | NO | NO | NO |
| **Lead capture** | PLANNED | NO | NO | NO | NO | YES | NO | NO | NO | NO |
| **Self-hosted option** | YES | NO | YES | YES | NO | NO | YES | NO | NO | NO |
| **Sub-$100/mo entry** | YES | NO | YES | YES | NO | YES | YES | YES | NO | YES |

### Key Competitors Deep Dive

**Coherent Spark** — The closest conceptual competitor
- Excel-to-API platform for insurance and banking
- $89M raised, 75+ customers (Pacific Life, Prudential)
- Pricing: $50K-70K/year (enterprise only)
- **Gap:** No AI/KB, no widgets, no MCP, no SMB pricing. Enterprise-only.
- **Our angle:** "Coherent Spark for the rest of us" — same Excel-to-API idea at 1/100th the price, plus AI + widgets + MCP

**DecisionRules** — Business rules engine
- Cloud-native rules engine with decision tables
- Pricing: EUR49-799/mo (Entrepreneur to Business+)
- **Gap:** No formula engine, no AI/KB, no embeddable widgets, no MCP
- **Our angle:** Rules + formulas + AI in one platform vs just rules

**GoRules** — Open-source rules engine
- Rust-based (like our formula engine), embeddable
- Flat-rate pricing (no per-evaluation fees)
- **Gap:** No Excel formula support, no AI/KB, no widgets
- **Our angle:** Full business logic stack vs just decision automation

**Guru** — AI knowledge management
- $25/seat/mo, 10-seat minimum ($250/mo floor)
- MCP server support (added 2025)
- **Gap:** No calculators, no formula engine, no widgets, internal-only (not customer-facing)
- **Our angle:** Knowledge + calculations + customer-facing distribution

**Outgrow/Calconic/ConvertCalculator** — Calculator builders
- $6-720/mo range
- **Gap:** Basic arithmetic, no AI, no API depth, no MCP, no knowledge base
- **Our angle:** 300+ Excel functions + AI chat + MCP + API

**n8n** — Workflow automation
- EUR24-800/mo, self-hosted free
- **Gap:** No formula engine, no calculator widgets, no knowledge base
- **Our angle:** Business logic + workflows integrated vs just workflow orchestration

**Stack AI / Relevance AI / Voiceflow** — AI agent builders
- $0-899/mo range
- **Gap:** No formula engine, no Excel compatibility, no embeddable calculators
- **Our angle:** Deterministic calculations + AI reasoning (not just AI)

### The White Space

BusinessLogic occupies the **ONLY position** combining:
1. Excel-grade formula engine (deterministic, auditable)
2. AI knowledge base (RAG, contextual)
3. Embeddable customer-facing widgets
4. MCP protocol for AI agent connectivity
5. API-first architecture
6. SMB-accessible pricing (<$300/mo)

**No competitor has more than 2 of these 6.** This is a genuine white space.

---

## 3. Ideal Customer Profile

### Primary ICP: "The Spreadsheet-Dependent Professional"

**Company profile:**
- Size: 5-200 employees
- Verticals: Insurance brokers, financial advisors, consulting firms, SaaS companies, manufacturing
- Revenue: $500K-50M/year
- Tech sophistication: Has a website, uses some SaaS tools, no dedicated dev team

**Buyer persona:**
- Title: Owner/founder, VP Operations, Head of Marketing, Revenue Operations
- Age: 30-55
- Pain trigger: "Can you put that calculator on our website?" or "Our agents keep emailing spreadsheets to clients" or "We need to make our pricing logic accessible without hiring developers"

**Current situation:**
- Has 1-20 critical Excel spreadsheets containing proprietary business logic
- Emails these spreadsheets to clients/partners, or manually enters data on their behalf
- Tried Outgrow/Calconic but hit formula limitations
- May have paid $10-50K for a custom web calculator that's now hard to maintain

**What they need (don't yet know they want):**
1. **Immediate:** Put their calculator on their website (entry wedge)
2. **Next:** Add AI chat so customers can ask questions about results
3. **Then:** Expose logic via API for partners/integrations
4. **Eventually:** Make all their business knowledge queryable by AI agents

### Secondary ICP: "The API-First Developer"

**Company profile:**
- Size: 10-500 employees (tech company)
- Building a product that needs calculation or knowledge retrieval capabilities
- Evaluating build vs. buy for formula engine or AI knowledge layer

**Buyer persona:**
- Title: CTO, Lead Engineer, Product Manager
- Pain trigger: "We need to add calculation/pricing logic to our product without building an engine from scratch"

### Tertiary ICP: "The AI-Forward Enterprise"

**Company profile:**
- Size: 200-5,000 employees
- Deploying AI agents across the organization
- Needs to connect proprietary business logic to AI assistants via MCP
- In insurance, finance, professional services, or manufacturing

**Buyer persona:**
- Title: VP Engineering, Chief Data Officer, Head of AI/Innovation
- Pain trigger: "Our AI agents can't access our proprietary calculations and knowledge"

### Trigger Events (When They Start Looking)

1. Website redesign includes "add an interactive calculator"
2. New compliance requirement means spreadsheets need audit trails
3. Competitor launches an AI-powered quoting tool
4. Executive mandate: "We need to be using AI"
5. Client/partner asks: "Can we get API access to your pricing?"
6. Key employee leaves and their spreadsheet knowledge goes with them
7. Error in a spreadsheet costs the company money

---

## 4. Top 3 Entry Use Cases

### Use Case #1: Embeddable Lead-Gen Calculators with AI Chat

**Pain:** B2B companies need interactive calculators (ROI, pricing, TCO) on websites for lead generation. Existing builders (Outgrow, Calconic) offer only basic arithmetic. Complex financial/insurance/engineering calcs require expensive custom development ($10-25K).

**How BL solves it:** Upload Excel or build with 300+ functions. Embed on any website. Add AI chat so leads can ask follow-up questions. Capture leads automatically.

**Why competitors can't match:**
- Outgrow: basic arithmetic only, per-lead pricing ($720/mo at scale)
- Calconic: limited formulas, no AI, stale product
- ConvertCalculator: FormulaScript but no AI, no MCP
- None have AI chat on calculator results

**Integration moat:** Calculator + AI KB creates a virtuous cycle — the AI explains calculator results using company knowledge. Competitors would need to build both a formula engine AND an AI KB to match.

**Market size:** $500M-1B (calculator builders) + premium from AI = $1-2B addressable
**Readiness:** HIGH — calculator engine, widget, AI chat all exist. Needs: lead capture, templates, landing page.
**Willingness to pay:** $29-249/mo proven by competitors. AI premium could push to $79-499/mo.

### Use Case #2: Spreadsheet-to-API for Regulated Industries

**Pain:** Insurance brokers, financial advisors, and manufacturers have critical business logic in Excel spreadsheets. They email these to clients, manually enter data, or pay $50K+ for custom web apps. Errors cost millions (documented: $24M loss from one cut-paste error). Compliance requires audit trails that spreadsheets can't provide.

**How BL solves it:** Import Excel logic into BusinessLogic. Expose as API. Embed as widget. Add AI that explains results and answers questions. Get full audit trail and access control.

**Why competitors can't match:**
- Coherent Spark does this but charges $50-70K/year (enterprise only). No AI, no widgets, no MCP.
- Rules engines (DecisionRules, GoRules) don't understand Excel formulas
- Calculator builders can't handle the formula complexity

**Integration moat:** Excel formula compatibility is a 12-18 month engineering moat (Rust engine with 300+ functions). Adding AI + MCP on top creates a 24+ month moat.

**Market size:** Insurance alone: $23.5B insurtech market. Financial services: $30B AI-in-fintech. Manufacturing CPQ: $3.5B. Total addressable: $5-10B.
**Readiness:** MEDIUM — formula engine exists, but Excel import workflow needs building. Domain-specific templates needed.
**Willingness to pay:** $79-499/mo for SMBs. $500-5,000/mo for mid-market. Coherent proves $50K+/year for enterprise.

### Use Case #3: MCP-Native Business Intelligence for AI Agents

**Pain:** Companies deploying AI agents (via Claude, ChatGPT, Cursor, etc.) can't connect their proprietary business logic. AI agents can't access company-specific calculations, pricing rules, or domain knowledge. The MCP ecosystem has 18,000+ servers but very few for business intelligence/calculations.

**How BL solves it:** One platform where you store your formulas, knowledge, and business rules. Expose everything via MCP. Any AI agent can now query your business logic — run calculations, search your knowledge base, execute workflows.

**Why competitors can't match:**
- Calculator builders have no AI layer, no MCP
- AI platforms (Stack AI, Relevance AI) have no formula engine
- Knowledge platforms (Guru) are internal-only, not customer-facing
- Rules engines don't have MCP support

**Integration moat:** Being the "business logic MCP server" is a first-mover land grab. Network effects: once clients connect AI agents to BusinessLogic, switching costs are high.

**Market size:** AI agent platforms: $12B in 2026 at 45.5% CAGR. MCP infrastructure: $1.8B (est.). Business intelligence tools market: $37.96B.
**Readiness:** HIGH for per-calculator MCP (exists). MEDIUM for account-level MCP (planned, task CMS-20 + formula-api-06).
**Willingness to pay:** Early. Developer tool pricing ($0-99/mo) initially, enterprise ($249-999/mo) as MCP matures.

---

## 5. The Killer Feature: "Smart Calculators" (Calculator + AI Chat)

Not the most complex feature. The one that gets people in the door.

### Why This Is the Door Opener

1. **Visually demonstrable** — 30-second demo: fill calculator, click "Ask AI", get contextual explanation. Instant "aha moment."
2. **Nobody else has it** — Zero calculator builders offer AI chat on results. This is a genuinely new thing.
3. **Bridges two buyer personas** — Marketing teams buy for lead gen. Operations teams buy for customer service. Same feature, different value prop.
4. **Natural expansion path:**
   - "I want AI chat on my calculator" (entry)
   - "Can the AI access our product docs too?" (KB upsell)
   - "Can our AI assistants use these calculations?" (MCP upsell)
   - "Can we chain this into automated workflows?" (Flow upsell)

### The Demo Script (30 seconds)

> "Here's a SaaS ROI calculator on a website. User fills in their current costs, team size, growth rate. Gets a result: '$47,000 annual savings.' But instead of just a number, they click 'Ask AI' and type: 'How does this compare to the industry average?' The AI responds with a contextual answer, pulling from the company's knowledge base. The lead is captured. The sales team gets a qualified prospect who already understands the value."

This single demo showcases: formula engine + AI KB + embeddable widget + lead capture. All four pillars in 30 seconds.

---

## 6. Messaging Framework

### For CTO / VP Engineering

**Headline:** "The headless business logic layer your team doesn't have to build"

**Message:** Your developers shouldn't be building formula engines or knowledge retrieval systems. BusinessLogic gives you a Rust-powered calculation API (300+ Excel functions, sub-50ms), AI knowledge base with RAG, and MCP endpoints — all behind a single API key. Self-hosted option available.

**Proof points:**
- 300+ Excel functions in Rust, benchmarkable performance
- Full REST API + TypeScript SDK + MCP protocol
- Self-hosted Docker deployment for data sovereignty
- Gateway with fine-grained API key permissions

**CTA:** "npm install @coignite/sdk — 3 lines to your first calculation"

### For Business Operations / RevOps

**Headline:** "Turn your spreadsheets into smart tools your team and clients can use"

**Message:** Your pricing models, ROI calculators, and business rules are trapped in Excel. BusinessLogic turns them into embeddable web calculators with AI chat — your clients get instant answers, your team stops emailing spreadsheets, and you get full analytics on who's using what.

**Proof points:**
- 300+ Excel functions — if it works in Excel, it works here
- Embeddable calculator widgets, live on any website in minutes
- AI chat explains results and answers follow-up questions
- Full audit trail (vs spreadsheet chaos)

**CTA:** "Embed your first calculator in 5 minutes — free"

### For Product Manager

**Headline:** "Add AI-powered calculations to your product without building an engine"

**Message:** Your product needs pricing logic, estimation tools, or domain-specific calculations. Don't spend 6 months building it. BusinessLogic gives you an API that runs Excel-grade formulas at sub-50ms, a knowledge base your users can query, and MCP so AI agents can access your product's intelligence.

**Proof points:**
- API-first: REST + SDK + MCP
- Sub-50ms formula execution (Rust engine)
- 300+ functions — financial, statistical, lookup, text, date, logical
- Knowledge base for domain-specific AI responses

**CTA:** "Add smart calculations to your product in a day, not a quarter"

### For Insurance / Finance Domain Buyer

**Headline:** "Your rating sheets and business rules, live on the web — with AI that explains the results"

**Message:** Stop emailing spreadsheets to clients. Stop paying $50K for custom quoting tools. BusinessLogic converts your Excel-based pricing models, rating tables, and calculation logic into secure web calculators that your clients and agents can use instantly. AI answers their questions. You keep your formulas private.

**Proof points:**
- Excel formula compatibility (not just basic math)
- Coherent Spark charges $50K/year for similar capabilities — we're 1/100th the price
- AI explains complex results in plain language
- API access for partner/distributor integrations
- Audit trail for compliance

**CTA:** "See your rating sheet as a live web calculator — 15-minute demo"

---

## 7. PMF Validation Plan (30-60 Days)

### Week 1-2: Foundation

| Action | Purpose | Success Metric |
|--------|---------|---------------|
| Rebuild landing page with "Smart Calculator" positioning | Test demand signal | >3% visitor-to-signup rate |
| Create 5 calculator templates (SaaS ROI, Pricing, TCO, Insurance Premium, Loan) | Reduce time-to-value | >40% of signups create a calculator |
| Ship "Ask AI" button on calculator results | Core differentiator | Track usage rate |
| Publish SDK to npm | Developer discovery | npm download count |
| Set up Plausible/PostHog analytics | Measure everything | Instrumented within week 1 |

### Week 2-3: Ship Lead Capture + Polish

| Action | Purpose | Success Metric |
|--------|---------|---------------|
| Add lead capture (email gate or "email detailed report") | #1 B2B marketing buyer need | >5% of calculator visitors submit email |
| Add "Powered by BusinessLogic" badge (free tier) | Viral distribution | Click-through rate on badge |
| Implement free tier (1 calc, 500 views, no AI) | PLG funnel entry | Signup volume |
| Create 3 comparison pages (vs Outgrow, Calconic, ConvertCalculator) | SEO + positioning | Organic traffic to comparison pages |

### Week 3-4: Distribution Blitz

| Channel | Action | Expected Result |
|---------|--------|----------------|
| Product Hunt | Launch with "Smart Calculators" angle | 500-2000 visitors, 50-200 signups |
| MCP directories | List on MCP.so, MCP Market, Smithery | Developer awareness, API signups |
| Hacker News | "Show HN: Smart Calculators" post | 200-1000 visitors |
| Reddit | r/SaaS, r/Entrepreneur, r/webdev | Community feedback, early users |
| LinkedIn | 50 cold outreach to B2B marketing managers | 5-10 demo calls |
| Insurance forums | Targeted posts about spreadsheet → web calculator | Vertical-specific interest |

### Week 4-6: Learn and Iterate

| Action | Purpose |
|--------|---------|
| Conduct 10 customer discovery calls | Understand actual vs assumed pain |
| Analyze: which templates get used most? | Identify highest-pain use case |
| Analyze: what AI questions do users ask? | Refine AI prompts, identify FAQ patterns |
| Identify top objection from non-converters | Remove the #1 blocker |
| Track: do AI-enabled calculators convert better? | Validate AI as differentiator |

### Questions to Ask in Discovery Calls

1. "What's in the spreadsheet you're trying to put on your website?"
2. "What did you try before? What broke?"
3. "If your calculator could explain its results to your clients, would that matter?"
4. "Would you pay extra for AI chat on your calculator?"
5. "Do you need your calculations accessible via API?"
6. "Have you heard of MCP? Would connecting your business logic to AI assistants matter?"

### PMF Success Criteria (60-day checkpoint)

| Signal | Green (PMF emerging) | Yellow (iterate) | Red (pivot) |
|--------|---------------------|-------------------|-------------|
| Weekly signups | >20/week | 5-20/week | <5/week |
| Calculator creation rate | >40% of signups | 20-40% | <20% |
| Embed rate | >20% of creators | 10-20% | <10% |
| AI chat engagement | >25% of calc views | 10-25% | <10% |
| Paid conversion (month 2) | >5% free→paid | 2-5% | <2% |
| Organic word-of-mouth signups | >10% of total | 5-10% | <5% |

---

## 8. Feature Roadmap Recommendation

### FIRST: Ship the Entry Wedge (Weeks 1-4)

| Priority | Feature | Status | Rationale |
|----------|---------|--------|-----------|
| P0 | Lead capture on calculators | NEEDED | #1 reason B2B marketers buy calculator builders |
| P0 | 5-10 calculator templates | NEEDED | Reduces time-to-value from hours to minutes |
| P0 | "Ask AI" on calculator results | PARTIAL | The killer differentiator — nobody else has it |
| P0 | New landing page | NEEDED | Current page describes legacy product |
| P0 | Free tier implementation | PARTIAL | Every competitor has free. PLG requires it |
| P0 | Publish SDK to npm | EXISTS | Zero developer discovery without it |

### SECOND: Prove the AI Premium (Weeks 4-8)

| Priority | Feature | Status | Rationale |
|----------|---------|--------|-----------|
| P1 | KB-connected AI on calculators | PARTIAL | Connects KB + calc pillars = unique value |
| P1 | Calculator analytics dashboard | PARTIAL | Marketers need conversion data |
| P1 | CRM integrations (HubSpot webhook) | NOT BUILT | Required for enterprise marketing teams |
| P1 | Comparison/competitor pages (SEO) | NOT BUILT | Capture "Outgrow alternative" searches |
| P1 | "Powered by BusinessLogic" badge | NOT BUILT | Viral growth loop for free tier |
| P1 | Usage limit enforcement | PARTIAL | Revenue protection. Already designed (CMS-08) |

### THIRD: Expand to Platform Play (Weeks 8-16)

| Priority | Feature | Status | Rationale |
|----------|---------|--------|-----------|
| P2 | Account-level MCP endpoint | PLANNED | Unified MCP = "business brain" story |
| P2 | Excel import → calculator | NOT BUILT | Killer onboarding hook. "Coherent Spark for SMBs" |
| P2 | Widget layout builder (drag-drop) | PLANNED | Design flexibility is top competitor complaint |
| P2 | Template gallery + showcase | PLANNED | SEO + onboarding + social proof |
| P2 | Developer docs portal | PARTIAL | API products die without docs |

### FOURTH: Vertical Expansion (Months 4-6)

| Priority | Feature | Status | Rationale |
|----------|---------|--------|-----------|
| P3 | Insurance-specific templates | NOT BUILT | Highest-pain vertical per research |
| P3 | Financial services templates | NOT BUILT | Highest-spend vertical |
| P3 | White-label embedding | NOT BUILT | Agency/enterprise unlock |
| P3 | A/B testing on calculators | NOT BUILT | Competitive parity with Outgrow |
| P3 | Multi-language calculators | NOT BUILT | European expansion |

---

## Appendix A: Competitive Pricing Landscape (Full)

### Calculator Builders
| Platform | Entry | Mid | Enterprise | Model |
|----------|-------|-----|-----------|-------|
| Outgrow | $14/mo | $115/mo | $720/mo | Per-lead |
| ConvertCalculator | Free | ~$60/mo | $120/mo | Per-visit |
| involve.me | $19/mo | $49/mo | $149/mo | Per-submission |
| Calconic | $6/mo | $17/mo | $55/mo | Per-impression |
| Elfsight | Free | Basic/Pro | Premium | Tiered |

### Business Rules Engines
| Platform | Entry | Mid | Enterprise | Model |
|----------|-------|-----|-----------|-------|
| DecisionRules | EUR49/mo | EUR449/mo | EUR799/mo | Per-call + seats |
| Decisions.com | $6,750/mo | Custom | Custom | Flat + seats |
| GoRules | Free | Paid | Custom | Flat (no per-eval) |
| Nected | Free | Custom | Custom | Tiered |

### AI/Knowledge Platforms
| Platform | Entry | Mid | Enterprise | Model |
|----------|-------|-----|-----------|-------|
| Guru | $250/mo (10 seats) | — | Custom | Per-seat |
| Relevance AI | $19/mo | $199/mo | $599/mo | Credits |
| Stack AI | $199/mo | $899/mo | Custom | Per-run |
| Voiceflow | $60/mo | $150/mo | Custom | Per-editor + credits |

### Spreadsheet-to-API
| Platform | Entry | Enterprise | Model |
|----------|-------|-----------|-------|
| Coherent Spark | $50K/year | $70K/year | Per-model (enterprise only) |
| SpreadsheetWeb | $36/mo | — | Subscription |

### Workflow/Automation
| Platform | Entry | Mid | Enterprise | Model |
|----------|-------|-----|-----------|-------|
| n8n | EUR24/mo | EUR60/mo | EUR800/mo | Per-execution |
| Retool | $12/user/mo | $65/user/mo | Custom ($94K+/yr) | Per-seat |

### BusinessLogic (Recommended)
| Tier | Price | Target | Key Limits |
|------|-------|--------|------------|
| Free | $0 | Eval/devs | 1 calc, 500 views, no AI, branded |
| Starter | $29/mo | Solo/small biz | 5 calcs, 5K views, basic AI, lead capture |
| Professional | $79/mo | Growing biz | 25 calcs, 50K views, full AI + KB |
| Business | $249/mo | Teams/agencies | Unlimited, API, MCP, white-label |
| Enterprise | $499+/mo | Mid-market | Custom, SLA, SSO, dedicated support |

**Pricing position:** Above commodity calculators ($6-55), at parity with mid-tier tools ($60-150), well below rules engines ($199-6,750) and enterprise spreadsheet-to-API ($50K+). The AI + formula engine combination justifies the premium over pure calculator builders.

---

## Appendix B: The "Business Brain" Vision

### The Long Game

Phase 1 (now): "Put your calculator on your website" — easy to understand, proven demand
Phase 2 (6mo): "Your business logic, accessible everywhere" — API + MCP + widgets
Phase 3 (12mo): "The brain of your business" — all knowledge, all rules, all logic in one place, queryable by any AI agent

### Why "Business Brain" Wins Long-Term

1. **MCP is becoming the standard** — 97M+ monthly SDK downloads, backed by Anthropic, OpenAI, Google, Microsoft. By 2027, every AI assistant will speak MCP. The company that IS the "business logic MCP server" wins.

2. **AI agents need deterministic logic** — LLMs hallucinate. For pricing, quoting, compliance, and financial calculations, you need deterministic execution. BusinessLogic provides the "ground truth" that AI agents query for exact answers.

3. **Knowledge + Calculation = Unique** — No other platform lets you store both factual knowledge (documents, policies, FAQs) AND computational logic (formulas, rules, calculations) in one place, then expose both to AI agents.

4. **The Salesforce parallel** — Salesforce's OSI (Open Semantic Interchange) initiative (Sep 2025) aims to create a universal standard for "business logic defined once, inherited everywhere." BusinessLogic is this concept, productized for SMBs.

### Who Gets This First

Early adopters of the "business brain" concept will be:
- Insurance brokers who need their rating logic + product knowledge accessible to AI
- Consulting firms who want their expertise queryable by clients and AI
- Financial advisors who need calculations + regulatory knowledge in one place
- SaaS companies who want their product's business logic available via MCP

---

## Key Sources

### Market & Industry
- [Salesforce — Ending Semantic Drift: Unified Business Logic Foundation](https://www.salesforce.com/blog/ending-semantic-drift-unified-business-logic-foundation/?bc=OTH)
- [CData — 2026: Year for Enterprise-Ready MCP Adoption](https://www.cdata.com/blog/2026-year-enterprise-ready-mcp-adoption)
- [MCP Roadmap 2026](http://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
- [Pento — A Year of MCP](https://www.pento.ai/blog/a-year-of-mcp-2025-review)
- [AI Agents Market Report — MarketsandMarkets](https://www.marketsandmarkets.com/Market-Reports/ai-agents-market-15761548.html)
- [Warmly — AI Agents Statistics 2026](https://www.warmly.ai/p/blog/ai-agents-statistics)
- [DemandSage — AI Agents Market Size](https://www.demandsage.com/ai-agents-market-size/)

### Competitors & Pricing
- [DecisionRules — Top 10 Business Rule Engines 2026](https://www.decisionrules.io/en/articles/top-10-business-rule-engines/)
- [DecisionRules Pricing](https://www.decisionrules.io/en/pricing/public-cloud/)
- [Decisions.com Pricing](https://decisions.com/pricing/)
- [GoRules Pricing](https://gorules.io/pricing)
- [Guru Pricing](https://www.getguru.com/pricing)
- [Relevance AI Pricing](https://relevanceai.com/pricing)
- [Stack AI Pricing](https://www.stackai.com/pricing)
- [Voiceflow Pricing](https://www.voiceflow.com/pricing)
- [n8n Pricing](https://n8n.io/pricing/)
- [Retool Pricing](https://www.akveo.com/blog/how-much-does-retool-cost-a-complete-guide-to-retool-pricing)
- [Coherent Spark Platform](https://www.coherent.global/platform/spark)
- [Coherent $75M Series B](https://www.coherent.global/blog/coherent-raises-75-million-series-b)

### Pain Points & Customer Research
- [Projective Group — Spreadsheet Risk Remediation](https://www.projectivegroup.com/spreadsheets-under-scrutiny-a-modern-approach-to-excel-risk-remediation/)
- [Oracle — 10 Common Spreadsheet Risks](https://www.oracle.com/business-analytics/spreadsheet-risks/)
- [Glean — Knowledge Silos Are Out](https://www.glean.com/perspectives/knowledge-silos-are-out-unified-search-is-in)
- [Moveworks — AI Enterprise Search vs Information Silos](https://www.moveworks.com/us/en/resources/blog/how-ai-enterprise-search-overcomes-information-silos)
- [ConsultingQuest — How AI is Changing Consulting Economics](https://consultingquest.com/insights/ai-impact-consulting-economics-value-sharing/)
- [Insurance Thought Leadership — Business Rules Engines](https://www.insurancethoughtleadership.com/going-digital/how-business-rules-engines-can-slash-time-market)

### Market Sizing
- [MCP.so — 18,905 MCP Servers](https://mcp.so/)
- [Zendesk — AI Knowledge Base Guide 2026](https://www.zendesk.com/service/help-center/ai-knowledge-base/)
- [Pylon — Best AI Knowledge Base Software 2026](https://www.usepylon.com/blog/best-ai-knowledge-base-software-2026-guide)
- [BBNTIMES — 5 Leading BRMS 2026](https://www.bbntimes.com/companies/5-leading-business-rules-management-solutions-brms-for-2026)
- [Molnify — Insurance Calculators](https://www.molnify.com/use-cases/insurance-calculators/)
