# Opportunity Backlog

**Last updated:** 2026-03-24

---

## Scoring: ICE (Impact / Confidence / Ease)

Scale 1-10 each. Score = (I + C + E) / 3.

---

## Quick Wins (Score > 7)

| # | Opportunity | Impact | Confidence | Ease | Score | Evidence |
|---|------------|:------:|:----------:|:----:|:-----:|----------|
| 1 | **Publish SDK to npm** | 7 | 10 | 10 | 9.0 | SDK exists, just needs `npm publish`. Zero developer discovery without it. |
| 2 | **Add free tier** | 9 | 9 | 7 | 8.3 | Every competitor has one. PLG requires it. 3-5x lower CAC. |
| 3 | **Landing page with live demo** | 9 | 9 | 6 | 8.0 | No organic discovery path exists. Must-have for any GTM motion. |
| 4 | **Enforce calls_per_month** | 6 | 10 | 8 | 8.0 | Revenue leakage. Already designed in CMS-08. Prerequisite for scaling. |
| 5 | **Product Hunt launch** | 8 | 7 | 8 | 7.7 | Calc+AI+MCP angle is unique. PH is best PLG launch channel. Low cost. |

---

## Strategic Bets (Score 5-7)

| # | Opportunity | Impact | Confidence | Ease | Score | Evidence |
|---|------------|:------:|:----------:|:----:|:-----:|----------|
| 6 | **AppSumo LTD launch** | 8 | 7 | 6 | 7.0 | $30K-150K revenue + 100-600 users. Calculator builders succeed on AppSumo. |
| 7 | **Account-Level MCP** | 9 | 7 | 5 | 7.0 | MCP ecosystem exploding. First "business intelligence MCP server" is land-grab. |
| 8 | **Template Gallery** | 7 | 8 | 5 | 6.7 | Reduces time-to-value. SEO magnet. Competitors have templates; we don't. |
| 9 | **Lead capture integrations** | 7 | 8 | 5 | 6.7 | Primary purchase driver for Outgrow/involve.me buyers. |
| 10 | **Widget Layout Builder** | 8 | 7 | 4 | 6.3 | Design flexibility is #1 complaint about calc builders. Major differentiator. |
| 11 | **SEO content campaign** | 7 | 7 | 5 | 6.3 | "How to build calculator" keywords. Compounds over time. |
| 12 | **"Smart calculators" (AI-augmented)** | 9 | 6 | 4 | 6.3 | New category: calculators that explain results via RAG. No competitor has this. |
| 13 | **Developer docs portal** | 6 | 9 | 5 | 6.7 | API products live or die by docs. OpenAPI + SDK quickstart. |

---

## Experiments (Score < 5)

| # | Opportunity | Impact | Confidence | Ease | Score | Hypothesis |
|---|------------|:------:|:----------:|:----:|:-----:|------------|
| 14 | **Directus marketplace extension** | 5 | 4 | 5 | 4.7 | Directus ecosystem as distribution channel. Would we learn if Directus users want BI? |
| 15 | **WASM formula engine** | 6 | 5 | 3 | 4.7 | Client-side formula execution. Would reduce latency and server costs. Unknown demand. |
| 16 | **White-label partner program** | 7 | 3 | 3 | 4.3 | Agencies reselling BL under their brand. Need PMF first. |
| 17 | **Vertical-specific solutions** | 7 | 3 | 3 | 4.3 | "BusinessLogic for Insurance" etc. Need usage data to pick verticals. |

---

## Avoid (Low Priority)

| # | Opportunity | Why Skip |
|---|------------|----------|
| 18 | Build mobile app | Web-first product. Mobile adds complexity, no demand signal. |
| 19 | Add dashboard/chart builder | Competes with Tableau/Looker. Not our strength. Stay focused. |
| 20 | Multi-language SDK (Python, Go) | TypeScript covers 80% of use cases. Premature optimization. |
| 21 | On-premise enterprise deployments | Massive support burden. Only consider at $1M+ ARR with clear demand. |

---

## Future Product Expansion: RPA / Virtual Workers

**Status:** NOT building now. Documented for when a client asks or market timing is right.

**Concept:** AI-powered RPA using Claude computer_use — vision-based desktop automation that replaces brittle selector-based RPA (UiPath, Automation Anywhere). Coignite deploys "virtual workers" that see screens and reason about tasks like humans.

**Why it matters:**
- RPA market ~$13B, under pressure from AI agents
- Traditional RPA is brittle (selectors break); AI computer_use is adaptive (vision-based)
- Gartner: 40% of enterprise apps will include task-specific AI agents by end of 2026
- Coignite's orchestration expertise (flows, AI, calculators) maps directly to this

**Architecture (compose, don't build from scratch):**

| Layer | Build? | Use |
|-------|--------|-----|
| Virtual desktops | NO | E2B Desktop Sandbox (Firecracker microVMs), Daytona, or Docker+Xvfb |
| AI agent | NO | Claude API computer_use tool |
| Orchestration | **YES** | Task queue, worker pool, credential vault, audit logging |
| Client dashboard | **YES** | Workflow templates, usage tracking, billing |

**Implementation phases:**
1. **POC** (2-3 weeks): One worker, one client workflow. E2B + Claude computer_use
2. **Multi-worker** (4-6 weeks): Task queue, sandbox lifecycle, credential mgmt, HITL checkpoints
3. **Productize** (6-12 weeks): Self-service portal, template library, multi-tenant, billing

**Key security:** Indirect prompt injection is the primary risk. Requires sandboxing, network allowlisting, and human-in-the-loop for sensitive actions (money, credentials, irreversible).

**Build triggers — start when ANY of these occur:**
- A client explicitly asks for RPA/automation of desktop workflows
- A client's pain point is clearly "I need someone to click through this system daily"
- AI computer_use reliability reaches >95% on standard business workflows
- A competitor in our space launches virtual workers first

**Pre-requisites before building:**
1. Which specific client has a workflow painful enough to pay for this today?
2. Pricing model decided (per-worker-hour? per-task? monthly retainer?)
3. Who builds this? (Must not be founder — conflicts with scaling goal)

**ICE Score:** Impact: 9 | Confidence: 4 | Ease: 3 | Score: 5.3 — Strategic bet, but not yet.

---

## Recommended Priority (Next 6 Months)

### This Quarter (Q2 2026)
1. Publish SDK to npm (#1)
2. Landing page (#3)
3. Free tier (#2)
4. Enforce usage limits (#4)
5. Developer docs (#13)
6. Product Hunt + AppSumo launch (#5, #6)

### Next Quarter (Q3 2026)
7. Template gallery (#8)
8. Lead capture (#9)
9. Account-level MCP (#7)
10. Widget layout builder (#10)
11. SEO content (#11)

### On Radar (Q4 2026+)
12. Smart calculators (#12) — TRIGGER: 50+ KB users showing interest in calc+AI combo
13. Directus extension (#14) — TRIGGER: 3+ requests from Directus community
14. WASM engine (#15) — TRIGGER: Performance complaints from high-volume API users
15. RPA / Virtual Workers — TRIGGER: Client asks for desktop automation, or AI computer_use hits >95% reliability
