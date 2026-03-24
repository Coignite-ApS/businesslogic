# Positioning & Messaging

**Last updated:** 2026-03-24 (v2 — refined based on critical PMF review)

---

## Strategic Context

The critical PMF review (see `critical-pmf-review.md`) identified that BusinessLogic's positioning was too broad — trying to be 5 products for 3 audiences. This revision narrows the positioning to the **highest-confidence entry wedge** while preserving the long-term platform vision as a secondary narrative.

**Key insight:** Lead with "Smart Calculators" (tangible, demonstrable, unique). Let the platform story emerge naturally as customers discover they need KB, API, and MCP.

---

## Primary Positioning Statement (Launch)

**For** insurance brokers, financial advisors, and consultants with complex Excel spreadsheets
**Who** need to put their proprietary calculations on the web for clients and partners
**BusinessLogic is** a smart calculator platform
**That** turns Excel-grade formulas into embeddable web calculators with AI that explains the results
**Unlike** basic calculator builders (Outgrow, Calconic) that only handle simple arithmetic, or enterprise platforms (Coherent Spark) that cost $50K+/year
**BusinessLogic** runs 300+ Excel functions in a Rust engine, adds AI chat that answers questions about results using your company knowledge, and captures leads automatically.

## Secondary Positioning Statement (Developer/API)

**For** SaaS developers and technical teams
**Who** need formula evaluation, AI knowledge retrieval, or business logic in their products
**BusinessLogic is** a headless business logic API
**That** provides Excel-grade formula execution, RAG-powered knowledge search, and MCP protocol support via a single API key
**Unlike** building a custom formula engine or stitching together multiple services
**BusinessLogic** ships a TypeScript SDK, OpenAPI spec, and MCP server — add smart calculations to your product in a day, not a quarter.

---

## Tagline

**Primary:** "Smart Calculators — AI that explains your results"
**Secondary:** "Predictable Business Intelligence — for AI and Humans"
**Developer-facing:** "Excel-grade formulas. AI knowledge. One API."

The primary tagline is chosen for launch because:
1. "Smart Calculators" is concrete and searchable (vs. abstract "Business Intelligence")
2. "AI that explains your results" is the unique differentiator
3. It's demo-able in 30 seconds

---

## Key Messages (Priority Order)

### Message 1 (Lead): "Calculators that explain themselves"
- **Pain:** Business calculators on websites just spit out numbers. Users don't understand the result and bounce.
- **Solution:** BusinessLogic calculators have built-in AI chat. Users get a result AND can ask "why is this number so high?" and get an answer grounded in your company's knowledge.
- **Proof:** No calculator builder offers AI chat on results. The AI uses RAG (retrieval-augmented generation) to answer from YOUR knowledge base, not generic training data.
- **Audience:** B2B marketers, insurance agencies, financial advisors
- **CTA:** "See a demo — your calculator, with AI that talks"

### Message 2: "Excel formulas, not toy math"
- **Pain:** Calculator builders like Outgrow and Calconic only handle basic arithmetic. Real business calculations need VLOOKUP, nested IF, SUMPRODUCT, financial functions, conditional logic.
- **Solution:** BusinessLogic runs 300+ Excel functions in a Rust-powered engine. If your formula works in Excel, it works here.
- **Proof:** Rust engine benchmarked at sub-50ms. Functions include financial (PMT, NPV, IRR), statistical (STDEV, PERCENTILE), lookup (VLOOKUP, INDEX/MATCH), and more.
- **Audience:** Anyone who's been frustrated by calculator builder formula limitations
- **CTA:** "Upload your Excel formulas — try free"

### Message 3: "Capture leads, not just clicks"
- **Pain:** Website calculators generate engagement but don't capture the lead. Users calculate and leave.
- **Solution:** Gate results behind email capture. Send detailed reports. Push leads to your CRM.
- **Proof:** Lead capture is the #1 reason B2B marketers buy Outgrow. We match this plus add AI.
- **Audience:** B2B marketing managers, growth teams
- **CTA:** "Turn your calculator into a lead machine"
- **Status:** PLANNED — ship before launch

### Message 4 (Developer): "Business logic as an API"
- **Pain:** Developers rebuild calculation logic from scratch for every project.
- **Solution:** REST API + TypeScript SDK + MCP server. Formula evaluation, AI knowledge search, and embeddings via one API key.
- **Proof:** Published SDK on npm. OpenAPI spec. Per-calculator MCP endpoints.
- **Audience:** SaaS developers, integration partners
- **CTA:** "npm install @coignite/sdk"

### Message 5 (Future): "Connect your business logic to AI agents"
- **Pain:** AI agents can't access proprietary business calculations and knowledge.
- **Solution:** MCP-native platform. Any AI assistant can query your calculators and knowledge base.
- **Proof:** Per-calculator MCP endpoints. Works with Claude, ChatGPT, Cursor, and any MCP client.
- **Audience:** AI-first companies, forward-looking CTOs
- **CTA:** "Your first MCP-connected calculator in 5 minutes"

---

## Differentiation Matrix

| Claim | Evidence | Why Competitors Can't Match |
|-------|---------|----------------------------|
| AI chat on calculator results | KB-grounded AI explains outputs | Requires both a formula engine AND an AI KB — no competitor has both |
| 300+ Excel functions | Rust engine, VLOOKUP/IF/PMT/NPV/IRR | 12-18 months to replicate from scratch |
| Coherent Spark for SMBs | Same Excel-to-API idea at 1/100th the price | Coherent Spark's DNA is enterprise ($50K+ deals) |
| MCP-native business logic | Per-calculator MCP server | Calculator builders have no AI/MCP layer |
| Self-hosted option | Full Docker deployment | Most competitors are SaaS-only |

---

## Messaging by Audience

### For Insurance Agency Owner
- **Lead with:** "Put your rating sheets online. Clients get instant quotes. AI explains the premium."
- **Avoid:** Technical jargon, API, MCP, architecture
- **Demo:** Import Excel sheet → preview widget → AI chat → lead capture
- **CTA:** "See your rating sheet as a live web calculator — free"
- **Objection handling:**
  - "Is my formula data secure?" → Yes, formulas are never exposed to the client. Only inputs/outputs are visible.
  - "Can my clients see the Excel?" → No. They see a clean form. Your proprietary logic stays hidden.
  - "How hard is it to set up?" → 15 minutes with a template. Or we'll set it up for you (first 10 customers).

### For B2B Marketing Manager
- **Lead with:** "Interactive calculators that capture leads AND explain results with AI"
- **Avoid:** Formula engine details, technical architecture
- **Demo:** SaaS ROI template → embed on landing page → lead capture → AI explains ROI breakdown
- **CTA:** "Embed your first calculator in 5 minutes — free"

### For Developer / CTO
- **Lead with:** API quality, SDK, MCP, Rust engine performance benchmarks
- **Avoid:** "no-code" messaging, marketing framing
- **Demo:** SDK code snippet → API call → result in 3 lines
- **CTA:** "npm install @coignite/sdk — 3 lines to your first calculation"

### For AI-First Buyer (Defer Until Post-Launch)
- **Lead with:** MCP support, knowledge base, business logic accessibility for AI agents
- **Avoid:** Calculator-centric framing
- **CTA:** "Connect your business intelligence to AI agents via MCP"

---

## Competitive Positioning

### vs. Outgrow / Calconic / ConvertCalculator
"They build quiz-style calculators with basic math. We run 300+ Excel functions and add AI that explains results. If your calculation needs VLOOKUP or nested IF statements, they can't help you."

### vs. Coherent Spark
"They charge $50K+/year and only serve enterprises. We deliver the same Excel-to-API capability at $79/mo, plus embeddable widgets, AI chat, and MCP — all designed for SMBs."

### vs. Custom Development
"A custom web calculator costs $10-50K and takes weeks. BusinessLogic does it in minutes with more formula power, AI built in, and zero maintenance."

### vs. "Just Use Excel + ChatGPT"
"You can copy-paste between Excel and ChatGPT. Or you can have a live calculator on your website that clients use 24/7, with AI that answers their questions, and leads captured automatically. Which one grows your business?"

---

## Landing Page Structure (Recommended)

1. **Hero:** "Smart Calculators — AI that explains your results"
   - Subhead: "Turn Excel spreadsheets into embeddable web calculators with built-in AI chat. 300+ functions. Lead capture. Free to start."
   - CTA: "Try Free" / "Watch Demo"

2. **Problem:** "Your calculations are trapped in spreadsheets"
   - Stat: 88% of spreadsheets contain errors
   - Visual: Email chain of spreadsheets vs. clean web widget

3. **How It Works:** 3 steps
   - Create (import Excel or use template)
   - Customize (configure inputs, outputs, widget design)
   - Embed (copy-paste code snippet)

4. **Differentiator:** "The only calculator that talks"
   - Demo: Calculator with AI chat explaining results
   - Badge: "Powered by 300+ Excel functions + AI knowledge base"

5. **Templates:** "Start in minutes, not hours"
   - Insurance Premium, SaaS ROI, Pricing Calculator, TCO, Loan Estimator

6. **For Developers:** "Or use it as an API"
   - Code snippet: 3-line SDK example
   - MCP: "Connect to Claude, ChatGPT, any AI assistant"

7. **Pricing:** Free / Starter ($19) / Growth ($79) / Business ($249)

8. **Social Proof:** (When available) Testimonials, case studies, logos

9. **CTA:** "Embed your first calculator — free"
