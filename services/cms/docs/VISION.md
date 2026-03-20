# Businesslogic — Platform Vision

## Mission

Make business intelligence predictable, accessible, and AI-ready.

LLMs are powerful but unpredictable. Businesses need standardized, verifiable outputs — whether that's a calculation, a policy answer, or an RFQ response. Businesslogic is the layer that makes business knowledge **deterministic and reusable** across any channel.

## Core Principle

**Predictability over intelligence.** We don't compete with AI — we make AI reliable by grounding it in verified business data.

- Calculator says 500 units = €12,450 → same answer every time, from your Excel model
- Knowledge Base says "EU delivery: 4-6 weeks" → sourced from your logistics policy, page 12
- Combined: "RFQ for 500 units to Germany: €12,450, 4-6 weeks, net 30 terms" → deterministic calculation + grounded knowledge + correct every time

## Platform Pillars

### 1. Calculators (Structured Computation)
Turn Excel models into live, API-accessible business calculators. The Excel spreadsheet is the source of truth — no translation, no drift. When the analyst updates the model, the calculator updates.

### 2. Knowledge Bases (Structured Knowledge)
Turn company documents into searchable, citable knowledge. Every answer traces back to a specific document, page, and section. Confidence scoring ensures "I don't know" when sources don't support an answer.

### 3. Distribution (Multi-Channel Access)
Both pillars are accessible through the same channels:
- **Embeddable widgets** — interactive calculators and knowledge search on any website
- **REST API** — programmatic access for internal tools, automation, integrations
- **MCP (Model Context Protocol)** — AI agents (Claude, ChatGPT, Gemini, Copilot) can use calculators and knowledge as tools

## Who We Serve

B2B companies that need standardized business operations:
- **Sales teams** — consistent pricing, instant RFQ responses, accurate quotes
- **Marketing teams** — interactive ROI calculators, lead-generating tools
- **Operations** — standardized processes, policy lookup, compliance answers
- **Partners/customers** — self-service calculators and knowledge on embedded widgets

## Competitive Edge

1. **Excel fidelity + Knowledge retrieval** — no competitor combines real Excel formula execution with document-grounded knowledge retrieval
2. **MCP-native** — every calculator and knowledge base is automatically an AI tool
3. **EU-sovereign, self-hostable** — Directus + PostgreSQL + Docker = deploy anywhere, GDPR-ready
4. **Deterministic** — calculators are exact; knowledge answers are grounded and cited; confidence scoring prevents hallucination
5. **Open/composable** — REST API + MCP + widgets, not locked into a CRM or proprietary platform

## What We Are NOT

- Not a chatbot platform — we provide the grounded data layer that makes chatbots reliable
- Not a CRM — we integrate with CRMs via webhooks and native connectors
- Not a generic AI tool — we are specifically about making business logic predictable
- Not just calculators — calculators are pillar one, knowledge is pillar two, the platform is the combination

## Long-Term Direction

### Near-Term (shipping now)
- Embeddable calculator widgets with lead capture
- Template gallery as marketing + onboarding
- Account-level MCP for AI agent access

### Medium-Term
- Knowledge Bases with pgvector + citation-backed retrieval
- Combined calculator + knowledge MCP (one endpoint, all business intelligence)
- Knowledge widgets (`<bl-knowledge>`) embeddable alongside calculator widgets

### Future Possibilities (think out of the box)
- **Workflow Automation**: Calculator output → triggers next action (send email, create invoice, update CRM). Calculators become decision nodes in business workflows.
- **Approval Chains**: Knowledge answers above confidence threshold auto-send; below threshold queue for human review. Gradual automation with safety.
- **Version-Controlled Business Logic**: Git-like versioning for calculator models and knowledge bases. Audit trail: "Who changed the pricing model? When? What was the old result?"
- **Comparative Analysis**: Run same inputs through multiple calculator versions. A/B test business logic changes before deploying.
- **Multi-Language Knowledge**: Same knowledge base, answers in the customer's language. The source documents are in Danish, the answer is generated in German for the German customer.
- **Scheduled Re-Computation**: Calculators that run on a schedule (daily pricing updates, weekly KPI reports) and push results to dashboards or notifications.
- **Calculator Chaining**: Output of one calculator feeds into another. Build complex business processes from composable calculation steps.
- **Industry Packs**: Pre-built calculator + knowledge base bundles for specific industries (construction estimating pack, SaaS metrics pack, HR compliance pack).
- **Partner/Reseller Portal**: White-label the entire platform for consultancies and agencies who build calculators for their clients.
- **Compliance Certification**: Knowledge Bases that can prove "this answer came from this version of this document on this date" — audit-ready for regulated industries.
