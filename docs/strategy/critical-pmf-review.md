# Critical Product-Market Fit Review

**Date:** 2026-03-24
**Reviewer:** BizDev Strategy Agent (Critical Review Mode)
**Mandate:** Brutal honesty. Stress-test the vision. Find holes.

---

## Executive Summary

BusinessLogic has **impressive engineering depth** and a **genuinely unique technical combination** (Rust formula engine + AI KB + MCP + Flow engine + Gateway). The individual services are real, working software — not vaporware. However, **the product has almost zero market presence**, one paying customer at $79/mo (legacy pricing), no landing page for the new platform, no published SDK, and no free tier. The gap between technical capability and market traction is dangerously wide.

**Honest assessment:** PMF Level 0.5 — between Nascent (idea) and Developing (some users). The technology is at Level 2 maturity; the business is at Level 0.

**The core strategic risk is not "can we build it?" but "can we sell it before we run out of runway?"** The founder is building an ambitious 5-pillar platform with one customer and zero marketing. This is a classic technical founder trap: perfecting the product while ignoring distribution.

---

## 1. Vision Assessment — Grade: B-

### What Works

The 5-pillar vision (KB + Calculators + Flows + Guardrails + Digital Twin) is **intellectually coherent**. Each pillar does reinforce the others:
- KB makes calculators smarter (contextual AI on results)
- Flows chain KB + calculators into automation
- Guardrails validate outputs against KB policies
- Digital Twin makes it personal and sticky

The "business brain" metaphor is compelling internally. It tells a good story to investors and strategically-minded buyers.

### What Doesn't Work

**1. It's 5 products, not 1.**
A customer looking for a calculator builder doesn't care about guardrails. A compliance officer looking for AI guardrails doesn't care about embeddable widgets. An employee looking for a "second brain" doesn't care about formula engines. These are **different buyers with different budgets in different departments**.

Stripe works because payments is one job. Twilio works because communications is one job. "Business brain" is 5 jobs. The Salesforce analogy is flattering but misleading — Salesforce had $1B+ and 10+ years before becoming a platform. They started as CRM (one job) and expanded.

**2. "Business Brain" is not a category buyers search for.**
Nobody wakes up and Googles "business brain platform." They Google "calculator builder for website" or "AI knowledge base" or "OPA guardrails SaaS." Category creation requires massive marketing spend that a solo founder doesn't have.

**3. The 5 pillars have different readiness levels.**
- Calculators: PRODUCTION (working, one customer)
- AI KB: PRODUCTION (working, integrated)
- Gateway: PRODUCTION (working, proxying traffic)
- Flows: BUILT (code exists, not customer-facing)
- Guardrails: NOT BUILT (strategic analysis only)
- Digital Twin: NOT BUILT (task doc exists)

Selling a "5-pillar platform" when 2 pillars don't exist is premature. Sell what you have.

### Verdict

The vision is **directionally correct but operationally premature**. It should be the 3-year north star, not the current pitch. Today, BusinessLogic is a **smart calculator platform with AI** — that's what should be marketed and sold.

---

## 2. Value Proposition — Grade: B

### What's Genuinely Unique

The combination of these three things is real and no competitor has it:
1. **Rust-powered Excel formula engine** (300+ functions, sub-50ms)
2. **AI knowledge base with RAG** (contextual answers)
3. **MCP protocol support** (AI agent connectivity)

The "smart calculator" concept — a calculator that can explain its results using AI and company knowledge — is a **genuinely new thing**. I've confirmed no calculator builder offers this. This is a real differentiator.

### What's Commoditizable

- **AI KB/RAG alone**: Dozens of competitors (Guru, Glean, LangChain-based). BL's RAG is fine but not uniquely better.
- **MCP server alone**: Trivial to add (protocol is open, 18K+ servers exist). Not a moat.
- **Workflow engine alone**: n8n, Temporal, countless others. BL's Rust flow engine is technically impressive but not customer-visible.
- **Guardrails alone**: Guardrails AI, NeMo, Lakera all exist as OSS or cheap API.

### The "Duct Tape" Test

**Can someone replicate BL's value with Notion + Outgrow + n8n + a custom script?**

For 80% of use cases, YES. A business owner could:
- Put a simple calculator on their website with Outgrow ($14/mo)
- Store knowledge in Notion + Notion AI ($20/mo)
- Connect them with Zapier ($20/mo)
- Total: ~$54/mo

For the 20% that need COMPLEX Excel formulas (VLOOKUP, nested IF, financial functions), conditional logic, AND AI that explains results, AND API access, AND MCP — **no, the duct tape breaks down**. That 20% is the real target market.

### The "10x Better" Claim

Is BL 10x better than alternatives? Depends on the customer:

| Scenario | vs. Alternatives | BL Advantage |
|----------|-----------------|-------------|
| Simple ROI calculator on website | Outgrow does it fine | 1-2x (not enough to switch) |
| Complex insurance premium calc on website | Custom dev ($10-50K) or nothing | 50-100x cheaper/faster |
| Excel logic → API for partner integrations | Coherent Spark ($50K/yr) or custom build | 10-100x cheaper |
| Calculator + AI that explains results | Nothing exists | Infinite (category creation) |
| MCP-accessible business calculations | Nothing exists for SMB | First mover |

**BL is 10x better ONLY for complex formula users who also want AI.** For simple calculators, Outgrow is fine. For pure AI, Guru/Notion are fine.

### Verdict

Strong value prop for a narrow but real niche: **businesses with complex Excel logic who want to expose it digitally with AI assistance**. The challenge is that this niche may be smaller than the strategy documents suggest.

---

## 3. Target Audience — Grade: C+

### The Problem with the Current ICP

The strategy docs list three ICPs:
1. "Excel Expert" (insurance brokers, financial advisors, consultants)
2. "API Builder" (SaaS developers)
3. "AI-First Business" (enterprise deploying AI agents)

**This is three different products for three different buyers.** Each requires different messaging, different channels, different sales motions, and different onboarding. A solo founder cannot pursue all three simultaneously.

### Who Should Be FIRST

The "Excel Expert" ICP is the most actionable because:
1. They have an IMMEDIATE pain ("put this spreadsheet on my website")
2. They have budget authority (owner/founder decides)
3. The sale is simple (visual demo → signup → embed)
4. They're findable (LinkedIn, industry forums, Google search)
5. The existing product serves them (calculator builder + widget works TODAY)

The developer API play and enterprise MCP play should be deferred until there are 50+ paying "Excel Expert" customers providing revenue and case studies.

### How Specific Is the Buyer?

Not specific enough. "Insurance brokers, financial advisors, consultants, accountants" is still four verticals. The PMF playbook says: **pick ONE vertical, dominate it, expand.**

**Recommended first vertical: Insurance brokers.**
- Highest formula complexity (rating tables, multi-variable premiums)
- Documented pain ($24M spreadsheet errors, regulatory pressure)
- Coherent Spark validates the willingness-to-pay at $50K/year
- EU AI Act creates urgency for governance (future guardrails upsell)
- Small enough that word-of-mouth works (industry conferences, associations)

**Specific buyer:** Independent insurance agency owner (5-50 employees) who currently emails Excel rating sheets to clients and wants them online.

### Is the Pain Acute or Latent?

**Mostly latent for the general market.** Most businesses don't know they need a "business brain." They're not actively searching.

**Acute for insurance/financial:** Regulatory pressure, compliance requirements, and client expectations are forcing digital transformation. This is pull, not push.

### Verdict

Target audience is too broad. Narrow to ONE vertical (insurance) and ONE buyer (agency owner with complex Excel sheets). Everything else is premature.

---

## 4. PMF Status — Level 0.5 (Between Nascent and Developing)

### Evidence

| Signal | Status | Evidence |
|--------|--------|----------|
| Revenue | $79/mo (one customer, legacy pricing) | Pre-PMF |
| Organic demand | Zero inbound | No marketing presence |
| Retention | Unknown (1 customer) | Insufficient data |
| Word-of-mouth | None | No community, no social proof |
| Product usage | Unknown for new platform | Not launched |
| Sean Ellis Test | Cannot measure | Need >40 users to run test |
| Sales cycle | Unknown | No sales activity |

### Honest PMF Level

Using First Round's framework:

- **Level 0 (Nascent):** Product exists but no users know about it. **<-- BL is here for the new platform**
- **Level 1 (Developing):** Some users, learning what works. **<-- BL needs to get here in 90 days**

The LEGACY product (calculator-only) might be at Level 1 — it has one paying customer who's been retained. But the new platform (with AI, MCP, gateway) has zero users besides internal testing.

### What Would Move BL to Level 1

- 10+ free tier users creating calculators
- 3+ paid customers (any tier)
- Evidence of retention (>2 month customer lifetimes)
- One organic referral ("I heard about you from...")

### What Would Indicate Level 2

- 50+ paying customers
- <5% monthly churn
- Net revenue retention >100%
- Sean Ellis score >40% "very disappointed"

**Realistic timeline to Level 1: 60-90 days after launch. Level 2: 6-12 months.**

---

## 5. What's Missing — Ranked by Impact

| Rank | Gap | Impact | Effort | Status |
|------|-----|--------|--------|--------|
| 1 | **Landing page for new platform** | CRITICAL — zero discovery path exists | 1 week | NOT BUILT |
| 2 | **Free tier** | CRITICAL — PLG requires it, every competitor has it | 2-3 days | NOT IMPLEMENTED |
| 3 | **Templates** (5-10 industry calculators) | HIGH — "empty canvas" problem kills activation | 1-2 weeks | ZERO TEMPLATES |
| 4 | **Published SDK on npm** | HIGH — developer discovery is zero | 2 hours | SDK EXISTS, NOT PUBLISHED |
| 5 | **Usage limit enforcement** | HIGH — revenue leakage (calls_per_month not enforced) | 2-3 days | NOT ENFORCED |
| 6 | **Lead capture on widgets** | HIGH — primary purchase driver for B2B marketers | 1 week | NOT BUILT |
| 7 | **Developer documentation** | HIGH — API products die without docs | 1 week | PARTIAL (OpenAPI exists) |
| 8 | **Social proof** | HIGH — zero testimonials, case studies, examples | Requires customers | ZERO |
| 9 | **Onboarding flow** | MEDIUM — new user → first calculator → first embed in <5 min | 1 week | NOT BUILT |
| 10 | **Content/SEO** | MEDIUM — zero organic discovery | Ongoing | ZERO ARTICLES |
| 11 | **Analytics** | MEDIUM — can't measure what you can't track | 1 day | NOT SET UP |
| 12 | **Support channel** | LOW (for now) — who helps when stuck? | 1 day | NONE |

**The first 6 items are BLOCKING any GTM motion.** Without a landing page, free tier, and templates, there is nothing to launch.

---

## 6. What to Cut (or Defer)

### Cut Now (Remove from Near-Term Roadmap)

| Feature | Why Cut |
|---------|---------|
| **Digital Twin / Second Brain** | 0 customers. Build this when you have 100+. |
| **Guardrails (OPA)** | 0 customers in regulated industries. Build when insurance vertical proves demand. |
| **Flow visual editor** | Internal tool. Customers don't need flow-building UI until platform play is proven. |
| **Account-Level MCP** | Per-calculator MCP works. Account-level is a nice-to-have. |
| **WASM target for formula engine** | No demand signal. Optimization before product-market fit. |
| **Cloud File Sync** | Nice-to-have. No customer has asked for it. |
| **Real-time Stats via WebSockets** | Engineering candy. Simple refresh is fine. |
| **Directus marketplace extension** | Distraction. Directus community is small. |
| **Multi-language SDK** | TypeScript covers 80%+ of use cases. |

### Defer to Post-100-Customers

| Feature | Why Defer |
|---------|-----------|
| Widget Layout Builder (drag-drop) | Current widget works. Polish after demand proven. |
| A/B testing on calculators | Competitive parity feature, not differentiator. |
| White-label embedding | Agency/enterprise feature. Need PMF first. |
| Partner/channel program | Need product-market fit before channel strategy. |
| Enterprise sales motion | Sub-$10K ACV = PLG. Enterprise is premature. |

### Keep Building (Essential for Launch)

| Feature | Why Essential |
|---------|-------------|
| Landing page | Cannot acquire users without it |
| Free tier | PLG requires it |
| Templates (5-10) | Activation depends on it |
| Lead capture | Primary B2B marketing buyer need |
| Publish SDK to npm | 2 hours of work, enables developer discovery |
| Usage enforcement | Revenue protection |
| Developer docs | API products require it |

---

## 7. The Minimum Path to 100 Paying Customers

### The Wedge: "Smart Calculators for Insurance"

Don't sell a platform. Sell a specific solution to a specific pain:

**"Put your insurance rating sheets on your website — with AI that explains the results to your clients."**

This pitch works because:
1. Insurance brokers HAVE complex Excel sheets (premium calculators, coverage estimators)
2. They currently EMAIL these to clients (terrible UX, no tracking)
3. Compliance pressure means they need audit trails
4. "AI explains results" is a genuine differentiator vs. Outgrow/Calconic
5. Coherent Spark validates $50K/year willingness-to-pay at enterprise; BL offers this at $79-249/mo

### Step-by-Step Plan

**Month 1: Ship the Minimum Launchable Product**

| Week | Action | Deliverable |
|------|--------|-------------|
| 1 | Build landing page (focus on Smart Calculators positioning) | businesslogic.online shows new platform |
| 1 | Publish SDK to npm | @coignite/sdk discoverable |
| 1 | Set up analytics (Plausible or PostHog) | Measurement from day 1 |
| 2 | Implement free tier (1 calc, 500 views, 10 AI queries) | PLG funnel entry |
| 2 | Create 3 insurance calculator templates | Instant time-to-value for ICP |
| 3 | Ship lead capture on widgets (email gate) | Primary purchase driver |
| 3 | Create 2 more templates (SaaS ROI, Pricing) | Broader appeal |
| 4 | Enforce usage limits (soft → hard) | Revenue protection |
| 4 | Write 3 developer doc pages (quickstart, SDK, API reference) | Developer onboarding |

**Month 2: Launch and Learn**

| Week | Action | Expected Result |
|------|--------|----------------|
| 5 | Product Hunt launch ("Smart Calculators — AI that explains your results") | 500-2000 visitors, 50-200 signups |
| 5 | Post on r/SaaS, r/InsurancePros, r/Entrepreneur | Community feedback |
| 6 | LinkedIn outreach to 50 insurance agency owners | 5-10 demo calls |
| 6 | List MCP servers on mcp.so, Smithery | Developer awareness |
| 7 | Hacker News "Show HN" (formula engine angle) | Developer signups |
| 7 | First SEO article: "How to put your Excel calculator on your website" | Long-term organic |
| 8 | Analyze: who signed up? what templates used? what AI questions asked? | ICP validation |

**Month 3: Convert and Retain**

| Week | Action | Expected Result |
|------|--------|----------------|
| 9 | 10 customer discovery calls (from signups) | Pain validation |
| 9 | Build "vs Outgrow" comparison page | SEO capture |
| 10 | AppSumo LTD launch ($99-499 tiers) | $30-100K+ revenue, 100-500 users |
| 11 | Iterate on onboarding based on drop-off data | Improved activation |
| 12 | First case study from AppSumo user | Social proof |

**Target at 90 days:** 50+ free users, 10-20 paid customers (including AppSumo LTDs), $2K-8K MRR.

**Stretch target:** 100 paying customers if AppSumo performs well.

---

## 8. Recommended First Customer Profile

### Who to Find Tomorrow

**Profile:** Independent insurance agency owner or operations manager
- **Company:** 5-50 employees, $1-10M revenue
- **Location:** US or Europe
- **Current state:** Has Excel rating sheets for 3+ insurance products (auto, home, life, commercial)
- **Pain:** Clients call/email to get quotes. Agents manually enter data into spreadsheets. Slow, error-prone, doesn't scale.
- **Budget:** $79-249/mo from operations budget (justified by time savings and lead capture)
- **Tech level:** Can embed a script tag on their website (or their web person can)

### What to Show Them

**15-minute demo script:**

1. (2 min) "Show me one of your Excel rating sheets" → import it into BL (or use pre-built insurance template)
2. (3 min) Configure inputs (age, coverage amount, deductible) and outputs (monthly premium, annual premium)
3. (3 min) Click "Preview Widget" → show the calculator live on a test page
4. (3 min) Click "Ask AI" → "Why is this premium higher than average?" → AI answers using the company's KB
5. (2 min) Show lead capture: "Client fills in details, you get their email + calculation results"
6. (2 min) Show API endpoint: "Your CRM can call this same calculation programmatically"

**The "aha moment" is step 4** — when AI explains a calculator result using company knowledge. Nobody else can do this.

### Where to Find Them

| Channel | Approach | Expected Response |
|---------|----------|-------------------|
| LinkedIn Sales Navigator | Search: "insurance agency owner" + "independent" | Cold DM with demo video |
| Insurance industry associations (IIABA, PIA) | Sponsor or attend local chapter meetings | In-person demos |
| Reddit r/InsuranceAgent, r/InsurancePros | Post about spreadsheet pain → solution | Community interest |
| Google Ads (later) | "insurance calculator for website" keywords | High-intent traffic |
| Insurance software review sites | Get listed on G2/Capterra for "insurance calculator" | Inbound leads |
| AppSumo (broader reach) | "Smart Calculator" positioning | Volume signups |

---

## 9. 90-Day Action Plan

### Week 1-2: Foundation Sprint

| Day | Task | Owner |
|-----|------|-------|
| 1 | Publish @coignite/sdk to npm | Dev |
| 1 | Set up PostHog analytics on existing platform | Dev |
| 2-3 | Build landing page (Smart Calculators positioning) | Dev |
| 4-5 | Implement free tier (backend: create free plan, enforce limits) | Dev |
| 6-7 | Create 3 insurance calculator templates | Dev + domain research |
| 8-9 | Create SaaS ROI + Pricing calculator templates | Dev |
| 10-12 | Ship lead capture v1 (email gate on widget results) | Dev |
| 13-14 | Write developer quickstart doc + API reference | Dev |

### Week 3-4: Polish + Pre-Launch

| Task | Details |
|------|---------|
| Enforce usage limits | Soft warning at 80%, hard block at 100%+10% grace |
| "Powered by BusinessLogic" badge | On free tier widgets (viral loop) |
| Widget embed flow | Simple copy-paste code snippet from dashboard |
| Test end-to-end: signup → create calc → embed → AI chat → lead capture | Must work in <5 minutes |
| Record demo video (2 min) | For PH launch and LinkedIn outreach |
| Prepare PH launch assets | Description, screenshots, maker comment |

### Week 5-6: Launch Wave 1

| Task | Details |
|------|---------|
| Product Hunt launch | "Smart Calculators — AI-powered calculators that explain their results" |
| Reddit posts | r/SaaS, r/Entrepreneur, r/InsurancePros, r/webdev |
| Hacker News Show HN | Technical angle: "Rust formula engine + AI KB + MCP" |
| LinkedIn outreach (25 targets) | Insurance agency owners |
| List MCP on directories | mcp.so, Smithery, MCP Market |

### Week 7-8: Learn + Iterate

| Task | Details |
|------|---------|
| Analyze signup funnel | Where are users dropping off? |
| 5 customer discovery calls | From PH/Reddit signups |
| Fix top 3 onboarding friction points | Based on data |
| Build "vs Outgrow" comparison page | SEO play |
| First SEO article | "How to put your Excel calculator on your website" |
| LinkedIn outreach wave 2 (25 targets) | Refined pitch based on learnings |

### Week 9-10: AppSumo Prep + Launch

| Task | Details |
|------|---------|
| Prepare AppSumo listing | LTD tiers: $99 (Starter), $249 (Growth), $499 (Business) |
| AppSumo launch | Target: 100-600 LTD sales |
| Handle AppSumo support burst | LTD users need hand-holding |
| Collect 3 testimonials from early users | Social proof for landing page |

### Week 11-12: Consolidate + Plan Next

| Task | Details |
|------|---------|
| First case study | From happiest AppSumo or PH user |
| Revenue assessment | MRR trajectory, unit economics |
| Decide: double down on insurance vertical OR stay horizontal | Based on who's actually converting |
| Plan Q3 roadmap based on customer feedback | Templates? Layout builder? Lead integrations? |
| Update all strategy docs with learnings | Pricing, positioning, ICP validated or invalidated |

---

## 10. Risk Inventory

### Technical Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|-----------|
| Formula engine bugs on complex real-world Excel sheets | HIGH | MEDIUM | Template-first approach reduces surface area; testing framework exists |
| AI hallucination on calculator explanations | MEDIUM | HIGH | Constrain AI to KB context only; add disclaimer |
| Infrastructure costs spike with AI usage | MEDIUM | LOW | AI margins are 90%+ per cost analysis |
| Directus upgrade breaks extensions | MEDIUM | MEDIUM | Pin Directus version; base submodule pattern helps |

### Market Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|-----------|
| Market doesn't want "smart calculators" (solution looking for problem) | HIGH | MEDIUM | Validate with 10 discovery calls before over-investing |
| Outgrow/Calconic add AI features | MEDIUM | MEDIUM | Integration depth (KB + formula engine) is hard to replicate |
| LLM providers add calculator/widget features | HIGH | LOW | Commoditizes the AI layer but not the formula engine or vertical templates |
| MCP hype fades | LOW | LOW | MCP is a bonus, not the core value prop |
| Insurance vertical is too niche | MEDIUM | MEDIUM | Templates for other verticals reduce dependency |

### Execution Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|-----------|
| Solo founder building too much, shipping too little | CRITICAL | HIGH | This review's #1 recommendation: STOP building, START selling |
| Scope creep into Guardrails/Digital Twin before PMF | HIGH | HIGH | Defer these until 100 paying customers |
| No marketing/sales expertise | HIGH | HIGH | AppSumo handles distribution for launch; learn GTM from early users |
| Burnout from doing everything alone | HIGH | MEDIUM | Automate what's possible; outsource design/content |

### Financial Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|-----------|
| Runway insufficient for 6-12 month PMF timeline | HIGH | UNKNOWN | AppSumo LTDs provide upfront cash; Hetzner costs are low (~$57/mo) |
| One customer at $79/mo doesn't validate anything | MEDIUM | CERTAIN | Need 20+ customers at varied price points to validate |
| LTD pricing cannibalizes future recurring revenue | MEDIUM | MEDIUM | Cap LTD volume (300+200+100); ensure recurring plan is available |

### Competitive Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|-----------|
| Coherent Spark moves down-market to SMB | MEDIUM | LOW | Their DNA is enterprise ($50K+ deals); SMB is foreign to them |
| A well-funded startup builds the same stack | MEDIUM | MEDIUM | 24+ month engineering head start; ship and iterate faster |
| Calculator builders are too "boring" to attract VC | LOW | N/A | Bootstrapped path is viable at BL's cost structure |

---

## 11. The Hard Questions — Answered Directly

### 1. If you had to pick ONE pillar, which one?

**Calculators.** Without question.

- Only pillar with a paying customer
- Most tangible (visual demo in 30 seconds)
- Clearest pain point ("put my spreadsheet on my website")
- Shortest path to revenue
- AI KB becomes a *feature* of calculators ("AI explains results"), not a standalone pillar

### 2. Is "business brain" achievable by a small team?

**The full vision? No.** Five pillars with enterprise-grade guardrails, per-employee digital twins, a visual flow editor, and MCP infrastructure requires a 10-20 person team.

**A focused version? Yes.** Smart calculators with AI + API + MCP is achievable by one technical founder. That's the scope that matters now.

### 3. What's the MVP for 100 paying customers?

- Calculator builder with 300+ Excel functions (EXISTS)
- Embeddable widget (EXISTS)
- AI chat on calculator results (EXISTS)
- 5-10 industry templates (NEEDED)
- Lead capture (NEEDED)
- Free tier (NEEDED)
- Landing page (NEEDED)
- $0-249/mo pricing tiers (DESIGNED, NOT IMPLEMENTED)

Everything else is noise until 100 customers.

### 4. Is the founder building too much too fast?

**Yes.** The codebase has:
- 5 production services (Go gateway, Node.js AI API, Node.js Formula API, Rust Flow engine, Directus CMS)
- 13 CMS extensions
- A TypeScript SDK
- A Rust formula engine with 300+ functions
- 60 documented tasks across services
- Comprehensive strategy docs, architecture docs, migration plans

And **one customer at $79/mo**.

The engineering is A+. The distribution is F. The ratio is dangerous.

### 5. What should be CUT?

Immediate cuts (defer until 100+ customers):
- Digital Twin / Second Brain
- Guardrails / OPA
- Flow visual editor (for external users)
- Cloud File Sync
- Real-time WebSocket stats
- WASM formula engine target
- Account-Level MCP (per-calculator MCP is sufficient)
- Directus marketplace extension
- Multi-language SDKs
- Enterprise SSO/SAML

### 6. Is the pricing right?

**The new pricing tiers ($0/19/79/249/custom) are well-designed.** They align with competitor benchmarks and provide clear upgrade triggers. However:

- **$0 free tier is essential and not yet implemented.** This is blocking PLG.
- **$79/mo Growth tier is the sweet spot** — above commodity calculators, below rules engines, justified by AI.
- **$249/mo Business tier will only sell if templates + lead capture + white-label are in place.**
- **Would I pay $79/mo?** If I were an insurance broker with complex Excel sheets and wanted them online with AI chat — **yes, absolutely.** The alternative (custom development) costs $10-50K.

### 7. Who is the FIRST customer to find tomorrow?

**A US-based independent insurance agency with 10-30 employees.** Owner or operations manager. They have Excel rating sheets for auto/home/life insurance. Currently emailing these to clients.

Show them: their rating sheet as a live web widget with AI that explains the premium calculation.

Find them on LinkedIn (search "independent insurance agency owner" in your state) or at a local Independent Insurance Agents & Brokers of America (IIABA) chapter meeting.

---

## Unresolved Questions (Only the Founder Can Answer)

1. **Runway?** How many months of personal runway remain? This determines how aggressive the launch timeline needs to be.
2. **Existing customer relationship?** What does the $79/mo customer actually use? Have they been asked for feedback on the new platform? Would they beta test?
3. **Technical founder trap acknowledgment?** Is the founder willing to spend 50%+ of time on marketing/sales vs. building? Because that's what's needed.
4. **Insurance domain access?** Does the founder have any insurance industry connections? This vertical play requires domain credibility.
5. **AppSumo willingness?** LTDs are a Faustian bargain (upfront cash vs. lifetime revenue). Is the founder comfortable with this trade?
6. **Solo or team?** Is there a plan to hire a marketer/growth person? Distribution expertise is the biggest gap.
7. **Legacy vs. new?** Should the legacy product be migrated to new platform first, or run in parallel? The one paying customer's experience matters.
8. **Actual Excel import?** Can a user upload an .xlsx file and get a working calculator? Or do they have to manually recreate it? This is the difference between a "10-minute demo" and a "2-hour setup."
