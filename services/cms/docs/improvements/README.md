# Businesslogic Platform — Improvements Backlog

**Predictable business intelligence for AI and humans.**

Turn your Excel models and company documents into deterministic, AI-accessible business tools — embeddable, API-accessible, EU-sovereign.

## Platform Pillars

| Pillar | Source | Query | Guarantee |
|--------|--------|-------|-----------|
| **Calculators** | Excel models | Send inputs → get outputs | Same inputs = same outputs, always |
| **Knowledge Bases** | Company documents | Ask question → get answer + citations | Grounded in YOUR docs, not LLM training data |

Both exposed via: embeddable widgets, REST API, MCP for AI agents.

## Status Legend
- `planned` — Not started
- `in-progress` — Active development
- `completed` — Done, pending documentation & removal
- `deferred` — Parked until preconditions met

## Recommended Build Order

| Priority | # | Project | Why |
|----------|---|---------|-----|
| 1 | 16 | Infrastructure & Deployment | Hetzner + Coolify, 3-server setup, migrate from DO |
| 2 | 14.0 | Pricing — Tax & Compliance | Stripe Tax, EUR+USD, VAT, invoicing — legal foundation |
| 3 | 04 | Formula API Auth + Token Encryption | Per-formula tokens for /execute, encrypt all tokens at rest, account FK on calls |
| 4 | 14A | Pricing — Fix Enforcement Gaps | calls_per_month not enforced, no usage warnings |
| 5 | 07a | Core Widget (basic) | THE missing product piece |
| 6 | 07b | Full Widget Components | Charts, animations — needed for polished layouts |
| 7 | 08 | Widget Layout Builder | Design showcase-ready calculator layouts |
| 8 | 10 | Lead Capture & Webhooks | Makes widget a marketing tool |
| 9 | 11 | Template Gallery | Marketing + onboarding + SEO |
| 10 | 14B | Pricing — New Tiers + Add-ons | Evolve for full platform before Knowledge launch |
| 11 | 15 | Event Communication | Lifecycle emails, event capture, client data export |
| 12 | 01 | Calculator Testing | Quality foundation |
| 13 | 02 | Cell Mapping UX | Quick authoring UX win |
| ~~14~~ | ~~12~~ | ~~Knowledge Base~~ | ~~Pillar two — document upload, chunking, pgvector search~~ |
| ~~15~~ | ~~13~~ | ~~Knowledge Retrieval~~ | ~~Answer generation, citations, combined MCP~~ |
| ~~16~~ | ~~14D~~ | ~~Pricing — Knowledge & AI Metering~~ | ~~Ships with #12/#13~~ |
| 17 | 06 | Account-Level MCP | Unified endpoint: calculators + knowledge bases |
| 18 | 03 | Onboarding Wizard | Reduces new-user friction |
| 19 | 17 | Real-time Stats via WebSockets | Replace 5s polling with WS subscriptions |
| 20 | 30A | AI Assistant — Core Chat + Tools | AI chatbot module, Claude API proxy, calculator tools |
| 21 | 30B | AI Assistant — Billing + Token Control | Token metering, Stripe packs, audit logging |
| 22 | 30C | AI Assistant — Creation Tools + Prompts | Calculator creation/deploy tools, file upload, prompt templates |
| 23 | 30D | AI Assistant — Security + Admin Dashboard | Rate limiting, prompt injection defense, admin analytics |
| 24 | 30E | AI Assistant — Public API + Widget | Public chat API, `<bl-assistant>` web component |
| — | 31 | directus-extension-businesslogic | Public npm extension — not prioritized, separate phase |

## Phase 0 — Foundation (Tax, Billing, Infrastructure)

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 16 | Infrastructure & Deployment (Hetzner + Coolify) | planned | [16-infrastructure.md](16-infrastructure.md) |
| 14.0 | Stripe Tax, VAT OSS, EUR+USD Pricing, Sequential Invoicing | planned | [14-pricing-billing.md](14-pricing-billing.md) (Phase 0) |

## Phase 1 — Security & Widget Foundation

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 04 | Formula API Auth + Token Encryption | completed | [04-formula-api-security.md](04-formula-api-security.md) |
| 14A | Pricing — Enforce Limits & Usage Warnings | planned | [14-pricing-billing.md](14-pricing-billing.md) (Phase A) |
| 07 | Embeddable Calculator Widget (Render Library) | planned | [07-widget-render-library.md](07-widget-render-library.md) |
| 08 | Widget Layout Builder (Directus Module) | planned | [08-widget-layout-builder.md](08-widget-layout-builder.md) |
| 18 | Integration Tabs — Claude Skill & Cowork Plugin | planned | [18-integration-tabs.md](18-integration-tabs.md) |
| 21 | Cowork Plugin Integration Research | planned | [21-cowork-plugin-integration.md](21-cowork-plugin-integration.md) |
| 22 | Claude Skill Tab Improvements | planned | [22-claude-skill-tab.md](22-claude-skill-tab.md) |

## Phase 2 — Go-to-Market

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 10 | Lead Capture & CRM Integration | planned | [10-lead-capture.md](10-lead-capture.md) |
| 11 | Template Gallery & Showcase | planned | [11-template-gallery.md](11-template-gallery.md) |
| 14B | Pricing — New Tiers + Add-ons | planned | [14-pricing-billing.md](14-pricing-billing.md) (Phase B-C) |
| 15 | Event-Driven Communication & Client Data | planned | [15-event-communication.md](15-event-communication.md) |

## Phase 3 — Knowledge Platform

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 12 | Knowledge Base — Document Upload & Management | completed | [12-knowledge-base.md](12-knowledge-base.md) |
| 13 | Knowledge Retrieval — Search, Citations & Answers | completed | [13-knowledge-retrieval.md](13-knowledge-retrieval.md) |
| 14D | Pricing — Knowledge & AI Metering | completed | [14-pricing-billing.md](14-pricing-billing.md) (Phase D) |
| 34 | Knowledge Base — Curated Q&A Pairs & Precision Statements | completed | [34-kb-curated-answers.md](34-kb-curated-answers.md) |
| 35 | Knowledge Base — Feedback Learning & Continuous Improvement | completed | [35-kb-feedback-learning.md](35-kb-feedback-learning.md) |
| 36 | Knowledge Base — Advanced Retrieval Pipeline | completed | [36-kb-advanced-retrieval.md](36-kb-advanced-retrieval.md) |

## Phase 4 — Calculator Authoring & Platform

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 01 | Calculator Testing | planned | [01-calculator-testing.md](01-calculator-testing.md) |
| 02 | Cell Mapping UX | planned | [02-cell-mapping-ux.md](02-cell-mapping-ux.md) |
| 03 | Calculator Onboarding Wizard | planned | [03-onboarding-wizard.md](03-onboarding-wizard.md) |
| 05 | Admin Dashboard | completed | — |
| 32 | Admin Financials — Revenue, Spending & P/L Dashboard | planned | [32-admin-financials.md](32-admin-financials.md) |
| 06 | Account-Level MCP | planned | [06-account-mcp.md](06-account-mcp.md) |
| 17 | Real-time Stats via WebSockets | planned | [17-realtime-stats.md](17-realtime-stats.md) |
| 19 | Unsaved Changes Navigation Guard | planned | [19-unsaved-changes-guard.md](19-unsaved-changes-guard.md) |
| 20 | OpenAPI Spec in Integration Tab | planned | [20-openapi-integration-tab.md](20-openapi-integration-tab.md) |
| 24 | Rename Configuration → Configure, Integration → Integrate | completed | [24-rename-tabs.md](24-rename-tabs.md) |
| 26 | Test/Live Tabs in Topbar | completed | [26-test-live-topbar-tabs.md](26-test-live-topbar-tabs.md) |
| 27 | Go Live Button on Test Page | completed | [27-go-live-button.md](27-go-live-button.md) |
| 28 | Cloud File Sync (Google Drive, OneDrive, Dropbox, Box) | planned | [28-cloud-file-sync.md](28-cloud-file-sync.md) |
| 29 | Formula Dashboard & Statistics | planned | [29-formula-dashboard.md](29-formula-dashboard.md) |

## Phase 5 — Growth

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 14E | Pricing — Lifetime Deals | planned | [14-pricing-billing.md](14-pricing-billing.md) (Phase E) |

## Phase 6 — AI Assistant

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 30A | AI Assistant — Core Chat + Tools | completed | [30-ai-assistant.md](30-ai-assistant.md) (Phase A) |
| 30B | AI Assistant — Billing + Token Control | completed | [30-ai-assistant.md](30-ai-assistant.md) (Phase B) |
| 30C | AI Assistant — Creation Tools + Prompts + Files | completed | [30-ai-assistant.md](30-ai-assistant.md) (Phase C) |
| 30D | AI Assistant — Security + Admin Dashboard | completed | [30-ai-assistant.md](30-ai-assistant.md) (Phase D) |
| 30E | AI Assistant — Public API + Widget | planned | [30-ai-assistant.md](30-ai-assistant.md) (Phase E) |
| 23 | AI Response Template with @mentions | planned | [23-ai-response-template.md](23-ai-response-template.md) |
| 25 | AI Name & Response Template Overrides | planned | [25-ai-name-overrides.md](25-ai-name-overrides.md) |
| 33 | Knowledge Base × AI Assistant Isolation | completed | [33-kb-ai-isolation.md](33-kb-ai-isolation.md) |
| 37 | Knowledge Base — AI-Assisted Management | completed | [37-kb-ai-management.md](37-kb-ai-management.md) |

## Phase 7 — Distribution & Ecosystem

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 31 | directus-extension-businesslogic (public npm) | planned | [31-directus-extension-businesslogic.md](31-directus-extension-businesslogic.md) |

## Deferred Backlog

| Improvement | Precondition | Doc |
|-------------|-------------|-----|
| Email Automation | Knowledge platform live + validated use case | [deferred/email-automation.md](deferred/email-automation.md) |

## Dropped Projects

| Name | Reason |
|------|--------|
| Cloud Desktop Calculator Skill | Too vague; API-based creation already possible |
| AI Guardrails (standalone) | Absorbed into #13 — confidence scoring, "I don't know", citation validation |
| #09 AI Calculator Builder | Absorbed into #30 AI Assistant — creation pipeline becomes tool chains in conversation |

## Competitive Position

```
                    STRUCTURED COMPUTATION
                          (high)
                            |
      CPQ (Salesforce,      |         ★ BUSINESSLOGIC ★
       DealHub, SAP)        |      Calculator + Knowledge +
      closed, CRM-locked    |      MCP, open, composable,
                            |      EU-sovereign
CLOSED ─────────────────────|─────────────── OPEN/API/MCP
                            |
      RFP Tools             |      Agent Frameworks
   (Responsive, Loopio)     |      (LangChain, LlamaIndex)
    text-only, no calc      |      DIY, no product
                            |
                    KNOWLEDGE RETRIEVAL
                          (high)
```

No competitor combines: Excel-native computation + document knowledge retrieval + embeddable widgets + MCP for AI agents + self-hostable EU infrastructure.

## Architecture Overview

```
Account
  ├── Calculators (Excel → API → Widget → MCP tool)
  │     ├── calculator_configs (sheets, formulas, I/O schema)
  │     ├── calculator_layouts (widget JSON config)
  │     └── calculator_leads (conversion data)
  │
  ├── Formula Tokens (API keys for /execute endpoints)
  │     └── formula_tokens (encrypted, auto-created on account creation)
  │
  ├── Knowledge Bases (Docs → pgvector → Search → MCP tool)
  │     ├── kb_documents (uploaded files)
  │     └── kb_chunks (text + embeddings + metadata)
  │
  ├── Account API Keys (MCP auth, resource-scoped)
  │     └── account_api_keys (key → [calculators, knowledge bases])
  │
  ├── AI Assistant (Claude API proxy, token-metered conversations)
  │     ├── ai_conversations (messages, token counts)
  │     ├── ai_token_usage (per-request metering)
  │     ├── ai_token_balances (account budgets)
  │     └── ai_prompts (predefined templates)
  │
  └── Subscription (Stripe billing, usage limits)

Distribution:
  ├── Embeddable Widget: <bl-calculator>, <bl-knowledge>
  ├── REST API: /calc/execute, /calc/formula/execute, /calc/kb/search, /calc/kb/ask
  └── MCP: /mcp/account/{id} → tools/list, tools/call
```
