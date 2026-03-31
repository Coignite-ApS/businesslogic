# Pricing Strategy

**Last updated:** 2026-03-24

---

## Current State

| Tier | Monthly | Yearly | Calculators | Calls/mo | RPS |
|------|---------|--------|:-----------:|:--------:|:---:|
| Basic | $9.90 | $99/yr | 1 | 10,000 | 10 |
| Premium | $49.90 | $499/yr | 5 | 100,000 | 50 |
| Professional | $149.90 | $1,499/yr | 25 | 1,000,000 | 200 |

**Issues:** Calculator-only pricing. AI/KB/MCP not monetized. calls_per_month not enforced. One customer ($149.90/mo).

---

## Market Pricing Benchmarks

### Calculator Builders
- Calconic: Free-$79/mo
- Outgrow: $14-65/mo
- ConvertCalculator: Free-$18+/mo
- involve.me: Free-$83/mo
- uCalc: Free-$9.99/mo

**Insight:** Pure calculator pricing clusters at $15-80/mo. BL's current $9.90-149.90 range is appropriate for calculators but leaves AI/KB value unpriced.

### AI/RAG Platforms
- Personal AI: $15-40/mo
- AI SaaS tools with KB: $50-500/mo typically
- Enterprise RAG: $500-5,000/mo

**Insight:** AI capabilities command 3-10x premium over pure widget tools.

### API Platforms (Developer Tools)
- Typical developer API: Free tier + $29-299/mo tiers
- Usage-based overage: $0.001-0.01 per API call

---

## Recommended Pricing Model

### Model: Hybrid Platform Subscription + AI Usage

| | **Free** | **Starter** | **Growth** | **Business** | **Enterprise** |
|---|---|---|---|---|---|
| **Monthly** | $0 | $19 | $79 | $249 | Custom |
| **Yearly** | — | $190/yr | $790/yr | $2,490/yr | Custom |
| **Target** | Eval/Dev | Solo | Growing biz | Team/Agency | Large org |
| **Calculators** | 1 | 3 | 15 | 50 | Unlimited |
| **API calls/mo** | 500 | 5,000 | 50,000 | 500,000 | Custom |
| **AI queries/mo** | 10 | 50 | 500 | 5,000 | Custom |
| **Knowledge Bases** | 0 | 0 | 3 | 10 | Custom |
| **KB Storage** | — | — | 500MB | 5GB | Custom |
| **MCP** | No | Per-calc | Per-calc | Account | Account |
| **Widget** | Branded | Yes | Unbranded | White-label | White-label |
| **Seats** | 1 | 1 | 3 | 10 | Custom |
| **Support** | Community | Email | Priority | Dedicated | SLA |

### Free Tier Rationale
- Essential for PLG. Every competitor has one.
- 500 API calls/mo + 10 AI queries costs BL <$0.50/mo in infrastructure
- Converts to paid when users hit limits or need more calculators

### Add-ons (Any Paid Tier)
| Add-on | Unit | Price/mo |
|--------|------|----------|
| +5 calculators | pack | $15 |
| +1 seat | per seat | $9 |
| +25,000 API calls | pack | $19 |
| +1 Knowledge Base | per KB | $19 |
| +1 GB KB storage | pack | $9 |
| +1,000 AI queries | pack | $15 |

### Lifetime Deal (Launch Only)
| LTD | One-time | Equivalent | Cap |
|-----|----------|-----------|-----|
| Tier 1 | $99 | Starter forever | 300 |
| Tier 2 | $249 | Growth forever | 200 |
| Tier 3 | $499 | Business forever | 100 |

---

## AI Cost Analysis

### Per-Query Costs (2026)
| Model Tier | Cost/query | Use Case |
|-----------|-----------|----------|
| Haiku-class | $0.002-0.005 | KB search, simple chat |
| Sonnet-class | $0.01-0.03 | Complex chat, tool use |
| Opus-class | $0.05-0.15 | Deep analysis (rare) |

### Margin by Tier (AI queries)
| Tier | AI queries | Est. COGS | Revenue | AI Margin |
|------|-----------|-----------|---------|-----------|
| Free | 10 | $0.05 | $0 | N/A (cost of acquisition) |
| Starter | 50 | $0.25 | $19 | 98.7% |
| Growth | 500 | $2.50 | $79 | 96.8% |
| Business | 5,000 | $25 | $249 | 90.0% |

**Key insight:** AI margins are excellent and improving. Inference costs decline ~50x/year. Price on value, not cost.

---

## Pricing Principles

1. **Free tier drives PLG** — zero-friction entry for developers and evaluators
2. **AI is the premium lever** — AI queries and KB are what justify $79-249/mo vs $15/mo calculator tools
3. **Credits > seats** — Market moving to usage-based. AI queries as the expansion metric.
4. **Enforce limits** — Soft limits (80% warning, 100% email, 10% grace) then hard block
5. **Stripe is source of truth** — All pricing metadata in Stripe, synced to platform
6. **Grandfather existing customers** — Current $149.90 customer keeps price. New customers get new tiers.
