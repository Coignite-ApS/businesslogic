# Competitive Analysis

**Last updated:** 2026-04-07

---

## Competitive Position Summary

BusinessLogic has **no direct competitor** offering the full stack: Excel-grade formula engine + AI knowledge base + embeddable widgets + MCP protocol + workflow automation. Competitors exist in segments.

---

## Direct Competitors (Calculator Builders)

| Competitor | Pricing | Calculators | AI | API | KB/RAG | MCP | Lead Capture | Strength | Weakness |
|-----------|---------|:-----------:|:--:|:---:|:------:|:---:|:------------:|----------|----------|
| **Calconic** | Free-$79/mo | YES | NO | NO | NO | NO | Basic | Cheap, simple, WordPress | No AI, no API, stale product |
| **Outgrow** | $14-65/mo | YES | NO | NO | NO | NO | YES (strong) | CRM integrations, A/B test | No formulas, no AI, per-lead pricing |
| **ConvertCalculator** | Free-$18+/mo | YES | NO | Partial | NO | NO | Basic | Free tier, pricing focus | Limited formulas, no AI |
| **involve.me** | Free-$83/mo | YES | Partial | NO | NO | NO | YES | Multi-format, Stripe pay | Jack of all trades, no depth |
| **Embeddable.co** | Free-paid | YES | Partial | NO | NO | NO | YES | Modern UX, AI-assisted builder | No formula engine, no KB |
| **Calculoid** | $19+/mo | YES | NO | NO | NO | NO | Basic | PDF reports, payments | Limited, dated |
| **uCalc** | Free-$9.99/mo | YES | NO | NO | NO | NO | Basic | Cheapest | Minimal features |
| **Taskade** | Free-$19/mo | Partial | YES | YES | NO | NO | NO | AI "vibe coding" builder, zero marginal cost | No formula engine, no KB/RAG, no MCP |
| **Embeddable.co** | Free-paid | YES | YES | NO | NO | NO | YES | AI editor suggestions, plain-English formulas, modern UX | No formula engine, no KB, no MCP |
| **BusinessLogic** | $9.90-149.90/mo | YES | YES | YES | YES | YES | Planned | Full stack, Rust engine | 1 customer, no marketing |

---

## Adjacent Competitors (AI/KB/RAG Platforms)

| Competitor | Focus | Pricing | vs BusinessLogic |
|-----------|-------|---------|-----------------|
| **LangChain** | RAG framework | Free (OSS), LangSmith paid | Developer tool, not end-user product. $1.1B valuation. |
| **LlamaIndex** | Document ingestion + retrieval | Free (OSS) | Framework, not platform. 35% retrieval accuracy boost in 2025. |
| **Pinecone** | Vector database | Usage-based | Infrastructure layer. Sub-100ms latency at scale. |
| **Personal AI** | Personal knowledge | $15-40/mo | Consumer-focused. No calculators, no formulas. |

These are not direct competitors but could become so if they add calculator/formula capabilities (unlikely — different market focus).

---

## Substitutes (What Customers Do Today)

| Substitute | Cost | Pain Point | BL Advantage |
|-----------|------|-----------|-------------|
| Excel + email | Free | Manual, doesn't scale, no embedding | Automated, embeddable, trackable |
| Excel + ChatGPT | $20/mo | Copy-paste, no persistence, no embedding | Integrated, persistent, embeddable |
| Custom-built calculator (developer) | $5K-50K | Expensive, slow, hard to maintain | No-code, instant, maintainable |
| Tableau/Power BI + manual analysis | $70+/user/mo | Expensive, complex, not embeddable for clients | Simpler, cheaper, embeddable, AI-augmented |
| Google Sheets embed | Free | Ugly, limited interactivity, exposes formulas | Professional, interactive, formulas hidden |

---

## Moat Assessment

| Moat Type | Strength | Details |
|-----------|----------|---------|
| **Technical (Formula Engine)** | STRONG | Rust-powered, 300+ Excel functions, 12-18 months to replicate |
| **Combination (Calc + AI + MCP)** | STRONG | No competitor has all three. Would require 3 acquisitions to match. |
| **Network (MCP ecosystem)** | DEVELOPING | Early MCP adopter. Network effects strengthen as more AI clients connect. |
| **Switching Cost** | MEDIUM | Once formulas and KBs are configured, migration is painful. |
| **Brand** | WEAK | Unknown. No marketing presence. Must build. |
| **Scale** | WEAK | 1 customer. No data advantage yet. |

---

## Competitor Moves to Watch

1. **Taskade Genesis "vibe coding"** — AI-generates working calculators from text prompts. Zero marginal cost per visitor. Pricing at $4-19/mo undercuts everyone. Threat: commoditizes simple calculators. Defense: no formula engine (VLOOKUP, financial functions), no KB/RAG, no MCP.
2. **Embeddable.co AI editor** — Now offers AI editor suggestions + plain-English formula creation. Charts/graphs in results. HubSpot/Stripe integrations. Threat: narrowing design gap. Defense: no Rust formula engine, no KB, no MCP.
3. **Coherent Spark Assistant** — New Excel add-in for enterprise users. Salesforce AppExchange + AWS Marketplace listings. Duck Creek insurance partnership. Threat: low for SMB (still $50K+/year). Watch for any SMB pricing signal.
4. **Outgrow price increase** — Raised from $14/mo to $22/mo entry. No AI features added. Falling behind. Threat: declining.
5. **MCP Registry** — Central discovery service for MCP servers in development. When it launches, BL MUST be listed. First-mover advantage for "business logic MCP" category.
6. **EU AI Act** — August 2, 2026 enforcement. <30% of EU SMEs compliant. Creates urgency for AI tools with audit trails and transparency — BL's deterministic formulas are naturally compliant.
