# BusinessLogic Platform — Improvements Backlog

**Predictable business intelligence for AI and humans.**

Improvements organized by service. Use `/improvements` to manage, or `/improvements <service>` for a specific service.

## Status Legend

- `planned` — Not started
- `in-progress` — Active development
- `completed` — Done, pending removal
- `deferred` — Parked until preconditions met

---

## CMS (`services/cms/`)

Back-office: admin UI, billing, Directus modules, widgets.

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 01 | Calculator Testing | completed | [cms/01-calculator-testing.md](cms/01-calculator-testing.md) |
| 02 | Cell Mapping UX | planned | [cms/02-cell-mapping-ux.md](cms/02-cell-mapping-ux.md) | <!-- partial: visual highlighting done -->
| 03 | Calculator Onboarding Wizard | planned | [cms/03-onboarding-wizard.md](cms/03-onboarding-wizard.md) |
| 04 | Embeddable Calculator Widget (Render Library) | completed | [cms/04-widget-render-library.md](cms/04-widget-render-library.md) |
| 06 | Lead Capture & CRM Integration | planned | [cms/06-lead-capture.md](cms/06-lead-capture.md) |
| 07 | Template Gallery & Showcase | planned | [cms/07-template-gallery.md](cms/07-template-gallery.md) |
| 08 | Pricing & Billing (Tax, Enforcement, Tiers, Lifetime) | planned | [cms/08-pricing-billing.md](cms/08-pricing-billing.md) |
| 09 | Event-Driven Communication & Client Data | planned | [cms/09-event-communication.md](cms/09-event-communication.md) |
| 10 | Real-time Stats via WebSockets | planned | [cms/10-realtime-stats.md](cms/10-realtime-stats.md) |
| 11 | Integration Tabs — Claude Skill & Cowork Plugin | completed | [cms/11-integration-tabs.md](cms/11-integration-tabs.md) |
| 12 | Unsaved Changes Navigation Guard | completed | [cms/12-unsaved-changes-guard.md](cms/12-unsaved-changes-guard.md) |
| 13 | OpenAPI Spec in Integration Tab | planned | [cms/13-openapi-integration-tab.md](cms/13-openapi-integration-tab.md) |
| 14 | Cowork Plugin Integration Research | planned | [cms/14-cowork-plugin-integration.md](cms/14-cowork-plugin-integration.md) |
| 15 | Claude Skill Tab Improvements | planned | [cms/15-claude-skill-tab.md](cms/15-claude-skill-tab.md) |
| 16 | Cloud File Sync (Google Drive, OneDrive, Dropbox, Box) | planned | [cms/16-cloud-file-sync.md](cms/16-cloud-file-sync.md) |
| 17 | Formula Dashboard & Statistics | planned | [cms/17-formula-dashboard.md](cms/17-formula-dashboard.md) |
| 18 | Admin Financials — Revenue, Spending & P/L Dashboard | planned | [cms/18-admin-financials.md](cms/18-admin-financials.md) |
| 19 | directus-extension-businesslogic (public npm) | planned | [cms/19-directus-extension-businesslogic.md](cms/19-directus-extension-businesslogic.md) |
| 20 | Account-Level MCP (UI) | completed | [cms/20-account-mcp.md](cms/20-account-mcp.md) |
| 21 | DOMPurify for All v-html Usage | completed | [cms/21-dompurify-v-html.md](cms/21-dompurify-v-html.md) |
| 22 | API Key Management UI | completed | [cms/22-api-key-ui.md](cms/22-api-key-ui.md) |
| 23 | Widget Client Gateway Mode | completed | [cms/23-widget-gateway-mode.md](cms/23-widget-gateway-mode.md) |
| 24 | Widget Layout Builder | planned | [cms/24-widget-layout-builder.md](cms/24-widget-layout-builder.md) |
| 25 | Calculator-API Gateway Auth Migration | completed | [cms/25-calculator-api-gateway-auth.md](cms/25-calculator-api-gateway-auth.md) |
| 26 | Calculators Code Snippets Update (X-Auth-Token → X-API-Key) | completed | [cms/26-calculators-code-snippets-update.md](cms/26-calculators-code-snippets-update.md) |
| 27 | AI-API & Knowledge-API Gateway Auth Migration | completed | [cms/27-ai-api-gateway-auth.md](cms/27-ai-api-gateway-auth.md) |
| 28 | Flow-Hooks Gateway Auth Migration | completed | [cms/28-flow-hooks-gateway-auth.md](cms/28-flow-hooks-gateway-auth.md) |
| 29 | Widget-API Auth Cleanup | completed | [cms/29-widget-api-auth-cleanup.md](cms/29-widget-api-auth-cleanup.md) |
| 30 | Formulas Integration Page Update (X-Auth-Token → X-API-Key) | completed | [cms/30-formulas-integration-update.md](cms/30-formulas-integration-update.md) |

---

## AI API (`services/ai-api/`)

AI chat, knowledge base backend, embeddings, public API.

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 01 | AI Assistant — Public API + Widget | completed | [ai-api/01-public-api-widget.md](ai-api/01-public-api-widget.md) |
| 02 | AI Response Template with @mentions | completed | [ai-api/02-ai-response-template.md](ai-api/02-ai-response-template.md) |
| 03 | AI Name & Response Template Overrides | planned | [ai-api/03-ai-name-overrides.md](ai-api/03-ai-name-overrides.md) |
| 04 | Digital Twin / Second Brain (Personal AI Memory) | planned | [ai-api/04-digital-twin-second-brain.md](ai-api/04-digital-twin-second-brain.md) |
| 05 | Contextual Memory Intelligence (Digital Twin Brain) | planned | [ai-api/05-contextual-memory-intelligence.md](ai-api/05-contextual-memory-intelligence.md) |
| 06 | AI Partner Configuration (Behavioral Settings) | planned | [ai-api/06-ai-partner-configuration.md](ai-api/06-ai-partner-configuration.md) |
| 07 | Calculator Skill Memory (Closed Learning Loop) | planned | [ai-api/07-calculator-skill-memory.md](ai-api/07-calculator-skill-memory.md) |
| 08 | Budget Warning Injection for Tool Use | completed | [ai-api/08-budget-warning-injection.md](ai-api/08-budget-warning-injection.md) |
| 09 | Progressive Tool Loading | completed | [ai-api/09-progressive-tool-loading.md](ai-api/09-progressive-tool-loading.md) |
| 10 | AI Observability & Self-Improvement Dashboard | in-progress | [ai-api/10-ai-observability-dashboard.md](ai-api/10-ai-observability-dashboard.md) |
| 11 | Contextual Widgets for AI Assistant | planned | [ai-api/11-contextual-widgets.md](ai-api/11-contextual-widgets.md) |
| 12 | Observatory Improvements & Controls | planned | [ai-api/12-observatory-improvements.md](ai-api/12-observatory-improvements.md) |

---

## Formula API (`services/formula-api/`)

Formula evaluation, calculator CRUD, MCP, execute endpoints.

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 01 | Account-Level Auth for Execute Endpoints | completed | [formula-api/01-execute-auth.md](formula-api/01-execute-auth.md) |
| 02 | OpenAPI Spec Completion | completed | [formula-api/02-openapi-completion.md](formula-api/02-openapi-completion.md) |
| 03 | Redis Error Logging | completed | [formula-api/03-redis-error-logging.md](formula-api/03-redis-error-logging.md) |
| 04 | MCP Error Code Mapping | completed | [formula-api/04-mcp-error-mapping.md](formula-api/04-mcp-error-mapping.md) |
| 05 | Graceful Shutdown Timeout | completed | [formula-api/05-shutdown-timeout.md](formula-api/05-shutdown-timeout.md) |
| 06 | Account-Level MCP | completed | [formula-api/06-account-mcp.md](formula-api/06-account-mcp.md) |
| 07 | Direct Database Migration | planned | [formula-api/07-direct-db-migration.md](formula-api/07-direct-db-migration.md) |

### Formula Engine — bl-excel (Rust)

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 01 | Spill Array Support | planned | [formula-api/engine/01-spill-array-support.md](formula-api/engine/01-spill-array-support.md) |
| 02 | OFFSET/INDIRECT in Aggregates | planned | [formula-api/engine/02-offset-indirect-aggregates.md](formula-api/engine/02-offset-indirect-aggregates.md) |
| 03 | Volatile Function Tracking | planned | [formula-api/engine/03-volatile-tracking.md](formula-api/engine/03-volatile-tracking.md) |
| 04 | Benchmark CI | planned | [formula-api/engine/04-benchmark-ci.md](formula-api/engine/04-benchmark-ci.md) |
| 05 | WASM Target | planned | [formula-api/engine/05-wasm-target.md](formula-api/engine/05-wasm-target.md) |
| 06 | Missing Array Functions | planned | [formula-api/engine/06-missing-array-functions.md](formula-api/engine/06-missing-array-functions.md) |
| 07 | Numeric Precision | planned | [formula-api/engine/07-numeric-precision.md](formula-api/engine/07-numeric-precision.md) |
| 08 | TEXT Format Engine | planned | [formula-api/engine/08-text-format-engine.md](formula-api/engine/08-text-format-engine.md) |
| 09 | Missing Function Analysis (~150 remaining) | completed | [formula-api/engine/09-missing-function-analysis.md](formula-api/engine/09-missing-function-analysis.md) |

---

## Flow Engine (`services/flow/`)

DAG workflow execution, triggers, workers.

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 01 | Replace Production unwrap() with Error Handling | completed | [flow/01-unwrap-error-handling.md](flow/01-unwrap-error-handling.md) |
| 02 | Agent Node — ReAct Loop | planned | [flow/02-agent-node.md](flow/02-agent-node.md) |
| 03 | MCP Client Node — External Tool Integration | planned | [flow/03-mcp-client-node.md](flow/03-mcp-client-node.md) |

---

## Gateway (`services/gateway/`)

Auth, rate limiting, routing, CORS.

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 01 | Fine-Grained Resource Permissions | completed | [gateway/01-resource-permissions.md](gateway/01-resource-permissions.md) |
| 02 | API Key Management Endpoints | completed | [gateway/02-api-key-management.md](gateway/02-api-key-management.md) |
| 03 | Widget Routes + Response Cache | completed | [gateway/03-widget-routes-cache.md](gateway/03-widget-routes-cache.md) |
| 04 | Internal Service Proxy Routes | completed | [gateway/04-internal-service-proxy.md](gateway/04-internal-service-proxy.md) |
| 05 | Request Logging & Audit Trail | completed | [gateway/05-internal-route-logging.md](gateway/05-internal-route-logging.md) |
| 06 | Account MCP Route | completed | [gateway/06-account-mcp-route.md](gateway/06-account-mcp-route.md) |

---

## Cross-Cutting

Infrastructure and multi-service concerns.

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 01 | Infrastructure & Deployment (Hetzner + Coolify) | planned | [cross-cutting/01-infrastructure.md](cross-cutting/01-infrastructure.md) |
| 02 | Security Hardening (SSH, Headers, DB SSL, Redis Auth, CORS) | completed | [cross-cutting/02-security-hardening.md](cross-cutting/02-security-hardening.md) |
| 03 | Node.js Process Reliability (Error Handlers, Structured Logging) | completed | [cross-cutting/03-node-process-reliability.md](cross-cutting/03-node-process-reliability.md) |
| 04 | Formula-API Gateway Auth Path | completed | [cross-cutting/04-formula-gateway-auth.md](cross-cutting/04-formula-gateway-auth.md) |
| 05 | Cedar Guardrails Engine (bl-policy) | planned | [cross-cutting/05-cedar-guardrails-engine.md](cross-cutting/05-cedar-guardrails-engine.md) |
| 06 | MCP Server — Expose BusinessLogic as AI Tool | planned | [cross-cutting/06-mcp-server.md](cross-cutting/06-mcp-server.md) |
| 07 | AI Safety Quick Fixes (4 items) | completed | [cross-cutting/07-ai-safety-quick-fixes.md](cross-cutting/07-ai-safety-quick-fixes.md) |
| 08 | Unified Widget Foundation (ChatKit-Compatible bl-widget) | planned | [cross-cutting/08-unified-widget-foundation.md](cross-cutting/08-unified-widget-foundation.md) |

---

## Recommended Build Order

Build & test locally first. Infrastructure/launch comes after all building blocks are in place.

### Phase 1A — Foundation (must complete before Account MCP sprint)

| # | Service | Task | Why |
|---|---------|------|-----|
| 1 | formula-api/07 | Direct Database Migration | Removes CMS dependency, consistent DB pattern across all services |

### Phase 1B — Core Platform Sprint (parallel after foundation)

| # | Service | Task | Why |
|---|---------|------|-----|
| 2 | formula-api/06 | Account-Level MCP (backend) | THE differentiator — "talk to your business brain" |
| 3 | gateway/06 | Account MCP Route | Gateway proxy for MCP traffic |
| 4 | cms/20 | Account-Level MCP (UI) | Config page, snippets, toggle MCP per calculator |
| 5 | ai-api/01 | Public AI API (Phase 1) | Opens AI pillar externally + fixes HMAC security gap |
| 6 | ai-api/03 | AI Name & Template Overrides | Branded AI responses per account |
| 7 | gateway/05 | Request Logging & Audit Trail | Billing + security audit trail |

### Phase 1B+ — Cost Optimization (parallel, quick wins)

| # | Service | Task | Why |
|---|---------|------|-----|
| 7b | cross-cutting/07 | AI Safety Quick Fixes (4 items) | Prompt caching, summarization, pricing safety, circuit breaker — 2-3 days |
| 7c | ai-api/08 | Budget Warning Injection | Graceful budget handling, cost savings, 2-3 days effort |
| 7d | ai-api/09 | Progressive Tool Loading | 30-50% token reduction on simple queries, 1 week effort |
| 7e | ai-api/10 | AI Observability Dashboard (Panels 1-3) | Cost, quality, tool usage — see what AI is doing. 1 week |

### Phase 1C — Widget Foundation + AI Widgets

| # | Service | Task | Why | Est. |
|---|---------|------|-----|------|
| 8 | cross-cutting/08 | Unified Widget Foundation | Shared component library — prerequisite for cms/24 and ai-api/11 | ~9-11 days |
| 9 | ai-api/11 | Contextual Widgets for AI Assistant | Rich inline widgets in chat — validates foundation before builder | ~5-7 days |

Phase 1C tasks are sequential: 08 first (foundation), then 11 (first consumer). 1A and 1B can run in parallel alongside.

### Phase 1D — Monetization

| # | Service | Task | Why |
|---|---------|------|-----|
| 10 | cms/08 | Pricing & Billing | Tiers, tax, enforcement — can't monetize without it |
| 11 | cms/24 | Widget Layout Builder | Drag-drop layout design — makes widgets sellable. Depends on cross-cutting/08. |

### Phase 2 — Growth & Distribution

| # | Service | Task | Why |
|---|---------|------|-----|
| 12 | cms/06 | Lead Capture & CRM | Turns widgets into marketing tools |
| 13 | cms/07 | Template Gallery | SEO + onboarding + showcase |
| 14 | cms/02 | Cell Mapping UX | Authoring UX improvement |
| 15 | cms/03 | Calculator Onboarding Wizard | Guided first-time creation flow |
| 16 | cms/09 | Event-Driven Communication | Platform events, email automation, webhooks |

### Phase 2B — Ecosystem & Distribution

| # | Service | Task | Why |
|---|---------|------|-----|
| 17 | cross-cutting/06 | MCP Server — BusinessLogic as AI Tool | Embed in agent ecosystem (Claude, Cursor, Hermes) |

### Phase 3 — Launch & Infrastructure

| # | Service | Task | Why |
|---|---------|------|-----|
| 12 | cross-cutting/02 | Security Hardening (finish) | 2 items need prod verification — complete on deploy |
| 13 | cross-cutting/01 | Infrastructure & Deployment | Hetzner + Coolify 3-server setup — deploy when ready |

### Phase 4 — Vision & Differentiation

| # | Service | Task | Why |
|---|---------|------|-----|
| 14 | ai-api/07 | Calculator Skill Memory (Learning Loop) | Platform gets smarter over time — foundation for Digital Twin |
| 15 | flow/02 | Agent Node — ReAct Loop | Adaptive AI workflows — LLM decides which tools to use |
| 16 | flow/03 | MCP Client Node | Extensibility — any MCP server becomes a flow tool |
| 17 | ai-api/04 | Digital Twin / Second Brain | Personal AI memory — the "second brain" pillar |
| 18 | ai-api/05 | Contextual Memory Intelligence | Knowledge graph for intelligent memory retrieval |
| 19 | ai-api/06 | AI Partner Configuration | AI as persistent partner, not stateless tool |
| 20 | cross-cutting/05 | Cedar Guardrails (Phase 1) | Enterprise policy enforcement — start foundation only |

### Phase 5 — Polish & Engine

| # | Service | Task | Why |
|---|---------|------|-----|
| 18 | formula-api/engine/01 | Spill Array Support | Dynamic array spill |
| 19 | formula-api/engine/06 | Missing Array Functions | FILTER, SORT, UNIQUE |
| 20 | formula-api/engine/02 | OFFSET/INDIRECT in Aggregates | Dynamic ranges |
| 21 | formula-api/engine/07 | Numeric Precision | IEEE 754 improvements |
| 22 | formula-api/engine/08 | TEXT Format Engine | Full TEXT function |
| 23 | cms/10 | Real-time Stats via WebSockets | Live usage metrics |
| 24 | cms/17 | Formula Dashboard | Formula analytics |
| 25 | cms/18 | Admin Financials | P/L dashboard |
| 26 | cms/11 | Integration Tabs | Claude Skill + Cowork tabs |
| 27 | cms/13 | OpenAPI in Integration Tab | Embedded API docs |
| 28 | cms/15 | Claude Skill Tab Improvements | UX refinements |
| 29 | cms/16 | Cloud File Sync | Drive, OneDrive, Dropbox, Box |
| 30 | cms/14 | Cowork Plugin Research | Integration research |
| 31 | cms/19 | directus-extension-businesslogic | Public npm extension |
| 32 | formula-api/engine/03 | Volatile Function Tracking | NOW, RAND recalculation |
| 33 | formula-api/engine/04 | Benchmark CI | Perf regression detection |
| 34 | formula-api/engine/05 | WASM Target | Browser-side formula eval |

---

## Totals

| Service | Planned | In-Progress | Completed | Total |
|---------|---------|-------------|-----------|-------|
| CMS | 16 | 0 | 13 | 29 |
| AI API | 5 | 1 | 4 | 10 |
| Formula API | 1 | 0 | 6 | 7 |
| Formula Engine | 8 | 0 | 1 | 9 |
| Flow | 2 | 0 | 1 | 3 |
| Gateway | 0 | 0 | 6 | 6 |
| Cross-Cutting | 3 | 0 | 5 | 8 |
| **Total** | **35** | **1** | **36** | **72** |
