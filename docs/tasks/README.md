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
| 01 | Calculator Testing | planned | [cms/01-calculator-testing.md](cms/01-calculator-testing.md) |
| 02 | Cell Mapping UX | planned | [cms/02-cell-mapping-ux.md](cms/02-cell-mapping-ux.md) |
| 03 | Calculator Onboarding Wizard | planned | [cms/03-onboarding-wizard.md](cms/03-onboarding-wizard.md) |
| 04 | Embeddable Calculator Widget (Render Library) | completed | [cms/04-widget-render-library.md](cms/04-widget-render-library.md) |
| 06 | Lead Capture & CRM Integration | planned | [cms/06-lead-capture.md](cms/06-lead-capture.md) |
| 07 | Template Gallery & Showcase | planned | [cms/07-template-gallery.md](cms/07-template-gallery.md) |
| 08 | Pricing & Billing (Tax, Enforcement, Tiers, Lifetime) | planned | [cms/08-pricing-billing.md](cms/08-pricing-billing.md) |
| 09 | Event-Driven Communication & Client Data | planned | [cms/09-event-communication.md](cms/09-event-communication.md) |
| 10 | Real-time Stats via WebSockets | planned | [cms/10-realtime-stats.md](cms/10-realtime-stats.md) |
| 11 | Integration Tabs — Claude Skill & Cowork Plugin | planned | [cms/11-integration-tabs.md](cms/11-integration-tabs.md) |
| 12 | Unsaved Changes Navigation Guard | planned | [cms/12-unsaved-changes-guard.md](cms/12-unsaved-changes-guard.md) |
| 13 | OpenAPI Spec in Integration Tab | planned | [cms/13-openapi-integration-tab.md](cms/13-openapi-integration-tab.md) |
| 14 | Cowork Plugin Integration Research | planned | [cms/14-cowork-plugin-integration.md](cms/14-cowork-plugin-integration.md) |
| 15 | Claude Skill Tab Improvements | planned | [cms/15-claude-skill-tab.md](cms/15-claude-skill-tab.md) |
| 16 | Cloud File Sync (Google Drive, OneDrive, Dropbox, Box) | planned | [cms/16-cloud-file-sync.md](cms/16-cloud-file-sync.md) |
| 17 | Formula Dashboard & Statistics | planned | [cms/17-formula-dashboard.md](cms/17-formula-dashboard.md) |
| 18 | Admin Financials — Revenue, Spending & P/L Dashboard | planned | [cms/18-admin-financials.md](cms/18-admin-financials.md) |
| 19 | directus-extension-businesslogic (public npm) | planned | [cms/19-directus-extension-businesslogic.md](cms/19-directus-extension-businesslogic.md) |
| 20 | Account-Level MCP (UI) | planned | [cms/20-account-mcp.md](cms/20-account-mcp.md) |
| 21 | DOMPurify for All v-html Usage | planned | [cms/21-dompurify-v-html.md](cms/21-dompurify-v-html.md) |
| 22 | API Key Management UI | planned | [cms/22-api-key-ui.md](cms/22-api-key-ui.md) |
| 23 | Widget Client Gateway Mode | planned | [cms/23-widget-gateway-mode.md](cms/23-widget-gateway-mode.md) |
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
| 01 | AI Assistant — Public API + Widget | planned | [ai-api/01-public-api-widget.md](ai-api/01-public-api-widget.md) |
| 02 | AI Response Template with @mentions | planned | [ai-api/02-ai-response-template.md](ai-api/02-ai-response-template.md) |
| 03 | AI Name & Response Template Overrides | planned | [ai-api/03-ai-name-overrides.md](ai-api/03-ai-name-overrides.md) |
| 04 | Digital Twin / Second Brain (Personal AI Memory) | planned | [ai-api/04-digital-twin-second-brain.md](ai-api/04-digital-twin-second-brain.md) |
| 05 | Contextual Memory Intelligence (Digital Twin Brain) | planned | [ai-api/05-contextual-memory-intelligence.md](ai-api/05-contextual-memory-intelligence.md) |
| 06 | AI Partner Configuration (Behavioral Settings) | planned | [ai-api/06-ai-partner-configuration.md](ai-api/06-ai-partner-configuration.md) |

---

## Formula API (`services/formula-api/`)

Formula evaluation, calculator CRUD, MCP, execute endpoints.

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 01 | Account-Level Auth for Execute Endpoints | completed | [formula-api/01-execute-auth.md](formula-api/01-execute-auth.md) |
| 02 | OpenAPI Spec Completion | planned | [formula-api/02-openapi-completion.md](formula-api/02-openapi-completion.md) |
| 03 | Redis Error Logging | planned | [formula-api/03-redis-error-logging.md](formula-api/03-redis-error-logging.md) |
| 04 | MCP Error Code Mapping | planned | [formula-api/04-mcp-error-mapping.md](formula-api/04-mcp-error-mapping.md) |
| 05 | Graceful Shutdown Timeout | planned | [formula-api/05-shutdown-timeout.md](formula-api/05-shutdown-timeout.md) |
| 06 | Account-Level MCP, Skill & Plugin | planned | [formula-api/06-account-mcp.md](formula-api/06-account-mcp.md) |

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
| 01 | Replace Production unwrap() with Error Handling | planned | [flow/01-unwrap-error-handling.md](flow/01-unwrap-error-handling.md) |

---

## Gateway (`services/gateway/`)

Auth, rate limiting, routing, CORS.

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 01 | Fine-Grained Resource Permissions | planned | [gateway/01-resource-permissions.md](gateway/01-resource-permissions.md) |
| 02 | API Key Management Endpoints | planned | [gateway/02-api-key-management.md](gateway/02-api-key-management.md) |
| 03 | Widget Routes + Response Cache | planned | [gateway/03-widget-routes-cache.md](gateway/03-widget-routes-cache.md) |
| 04 | Internal Service Proxy Routes | planned | [gateway/04-internal-service-proxy.md](gateway/04-internal-service-proxy.md) |
| 05 | Internal Route Audit Logging | planned | [gateway/05-internal-route-logging.md](gateway/05-internal-route-logging.md) |

---

## Cross-Cutting

Infrastructure and multi-service concerns.

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 01 | Infrastructure & Deployment (Hetzner + Coolify) | planned | [cross-cutting/01-infrastructure.md](cross-cutting/01-infrastructure.md) |
| 02 | Security Hardening (SSH, Headers, DB SSL, Redis Auth, CORS) | planned | [cross-cutting/02-security-hardening.md](cross-cutting/02-security-hardening.md) |
| 03 | Node.js Process Reliability (Error Handlers, Structured Logging) | planned | [cross-cutting/03-node-process-reliability.md](cross-cutting/03-node-process-reliability.md) |
| 04 | Formula-API Gateway Auth Path | planned | [cross-cutting/04-formula-gateway-auth.md](cross-cutting/04-formula-gateway-auth.md) |

---

## Recommended Build Order

| Priority | Service | # | Improvement | Why |
|----------|---------|---|-------------|-----|
| 1 | cross-cutting | 01 | Infrastructure & Deployment | Hetzner + Coolify, 3-server setup |
| 2 | cms | 08 | Pricing — Tax & Compliance | Stripe Tax, EUR+USD, VAT — legal foundation |
| 3 | formula-api | 01 | Execute Auth | Per-formula tokens, encrypt at rest |
| 4 | cms | 08 | Pricing — Enforcement | calls_per_month not enforced |
| 5 | cms | 04 | Core Widget | THE missing product piece (completed) |
| 6 | gateway | 01 | Resource Permissions | Foundation for API key auth |
| 7 | gateway | 02 | API Key Management | CRUD for API keys |
| 8 | gateway | 03 | Widget Routes + Cache | Gateway-routed widget traffic |
| 9 | cross-cutting | 04 | Formula-API Gateway Auth | HMAC auth between gateway + formula |
| 10 | cms | 22 | API Key Management UI | User-facing key management |
| 11 | cms | 23 | Widget Gateway Mode | Widget uses API keys via gateway |
| 12 | cms | 24 | Widget Layout Builder | Visual drag-drop layout design |
| 12a | gateway | 04 | Internal Service Proxy Routes | CMS→services via gateway internal routes |
| 12c | cms | 25 | Calculator-API Gateway Auth | CMS→formula-api uses gateway auth |
| 12d | cms | 26 | Calculators Code Snippets | X-Auth-Token → X-API-Key in all snippets |
| 12e | cms | 27 | AI-API Gateway Auth | CMS→ai-api uses gateway auth |
| 12f | cms | 28 | Flow-Hooks Gateway Auth | CMS→flow uses gateway auth |
| 12g | cms | 29 | Widget-API Auth Cleanup | Remove token passthrough |
| 12h | cms | 30 | Formulas Integration Update | Formulas snippets → gateway |
| 13 | cms | 06 | Lead Capture | Makes widget a marketing tool |
| 14 | cms | 07 | Template Gallery | Marketing + onboarding + SEO |
| 15 | cms | 01 | Calculator Testing | Quality foundation |
| 16 | cms | 02 | Cell Mapping UX | Quick authoring UX win |
| 17 | cms | 20 | Account-Level MCP (UI) | Unified MCP endpoint |
| 18 | formula-api | 06 | Account-Level MCP (Backend) | Backend for unified MCP |
| 19 | ai-api | 01 | Public API + Widget | Public AI chat API |
| 20 | formula-api/engine | 09 | Missing Functions | ~150 remaining Excel functions |

---

## Totals

| Service | Planned | In-Progress | Completed | Total |
|---------|---------|-------------|-----------|-------|
| CMS | 24 | 0 | 5 | 29 |
| AI API | 6 | 0 | 0 | 6 |
| Formula API | 5 | 0 | 1 | 6 |
| Formula Engine | 8 | 0 | 1 | 9 |
| Flow | 1 | 0 | 0 | 1 |
| Gateway | 5 | 0 | 0 | 5 |
| Cross-Cutting | 4 | 0 | 0 | 4 |
| **Total** | **53** | **0** | **7** | **60** |
