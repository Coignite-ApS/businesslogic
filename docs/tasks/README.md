# BusinessLogic Platform — Improvements Backlog

**Predictable business intelligence for AI and humans.**

Improvements organized by service. Use `/improvements` to manage, or `/improvements <service>` for a specific service.

## Status Legend

- `idea` — Concept, not yet scoped
- `planned` — Scoped, ready to start
- `in-progress` — Active development
- `completed` — Done, pending removal
- `deferred` — Parked until preconditions met

---

## 🎯 Pricing v2 — Where to start

Pricing v2 code landed in waves on `dev`:
- **Wave 1 (2026-04-18)** — Stripe catalog + schema rebuild (tasks 14, 15, ai-api/19). Commits `bb9670c..da8461d`.
- **Wave 2 (2026-04-18, Sprint 1)** — wallet debit hook + calculator_slots + isolation E2E (tasks 18, 19, 26). Commits `6d23d9c..9101118`.

**Read these first** (in order):
1. **`docs/reports/session-2026-04-18-pricing-v2.md`** — full session log: timeline, locked decisions with rationale, schema state verification, decision log
2. **`docs/architecture/pricing-v2.md`** — system architecture: data model, Stripe sync flow, webhook routing, auth/quota enforcement, transitional patterns to refactor
3. **`docs/strategy/pricing.md`** — strategic rationale + roadmap
4. **`docs/pricing/businesslogic-api-pricing.md`** — operational spec (tier prices, slot rules, COGS, worked examples)
5. **`docs/operations/stripe-production-setup.md`** — production deployment runbook (when ready to ship)

**Sprint plan to ship v2 to production safely** (revised 2026-04-18 after Sprint 1 follow-ups surfaced):

| Sprint | Tasks | Goal | Status |
|---|---|---|---|
| **Sprint 1 — Make wallet actually work** | 18 wallet debit · 19 calc slots · 26 isolation E2E | Wallet depletes on AI use; honest slot enforcement; isolation guarantee | ✅ **shipped** |
| **Sprint 2 — Wallet correctness + security** (~3d) | 36 permission fix · 31 auto-reload table · 33 failed-debit reconcile · 34 slot reconcile/race · 35 CI pipeline | Close Sprint 1's follow-up gaps; make tests actually run on PR; close cross-account read leak | ✅ **shipped** (all 5) |
| **Sprint 3 — Production launch** (~1.5d) | 28 production deployment + smoke test · cms/37 empty-trial onboarding wizard | Real customers sign up + activate + check out via Stripe live mode | **deferred** — keep developing locally first, more testing before going to server |
| **Sprint 4 — Analytics + observability** (~3d, parallelizable) | 17 feature_quotas refresh · 20 usage_events emitter · 21 monthly_aggregates rollup · 27 gateway sub-limits | Per-key sub-limits enforced; usage events captured; admin reports accurate | planned |

**Sprint 2 ordering** (critical-first):
1. ✅ **Task 36** (ai_token_usage permission) — SECURITY. Cross-account read leak. Shipped 2026-04-19 (`a2c0388`).
2. ✅ **Task 31** (wallet_auto_reload_pending) — REVENUE. DB queue + ai-api enqueue + stripe ext consumer. Shipped 2026-04-19 (`94b25d0`).
3. ✅ **Task 33** (failed-debit reconciliation) — ACCOUNTING. DB queue + helper + 3 catch-branch wires + reconcile endpoint. Shipped 2026-04-19 (`51e14d0`).
4. ✅ **Task 34** (calc slot reconcile + race) — QUOTA. Advisory lock + orphan reconcile + uniqueness assertion. Shipped 2026-04-19 (`6dce523` + `b5abf3d`).
5. ✅ **Task 35** (CI pipeline) — CORRECTNESS. Buddy pipeline + CONTRIBUTING.md. Shipped 2026-04-19 (`fefcfe9` + `5957bf8`).

**Quality of life / tech debt** (parallelizable, any time):
- 16 Makefile container-name · 22 calls_per_month enforcement · 23 bl_flow_executions FK · 24 ledger partitioning (defer until 10M rows) · 25 counter table tracking (optional) · 29 per-tier RPS spec · 30 ledger compound index (defer until 10k+ rows/month) · 32 module_kind enum for chat · 37 extract shared test helpers · cms/36 UI polish

**Completed Pricing v2 tasks:** 14 (Stripe + code refactor), 15 (schema), 18 (wallet debit hook), 19 (calc slots), 26 (test coverage E2E — partial; CI pending), ai-api/19 (token usage column fix)

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
| 24 | Widget Layout Builder | completed | [cms/24-widget-layout-builder.md](cms/24-widget-layout-builder.md) |
| 25 | Calculator-API Gateway Auth Migration | completed | [cms/25-calculator-api-gateway-auth.md](cms/25-calculator-api-gateway-auth.md) |
| 26 | Calculators Code Snippets Update (X-Auth-Token → X-API-Key) | completed | [cms/26-calculators-code-snippets-update.md](cms/26-calculators-code-snippets-update.md) |
| 27 | AI-API & Knowledge-API Gateway Auth Migration | completed | [cms/27-ai-api-gateway-auth.md](cms/27-ai-api-gateway-auth.md) |
| 28 | Flow-Hooks Gateway Auth Migration | completed | [cms/28-flow-hooks-gateway-auth.md](cms/28-flow-hooks-gateway-auth.md) |
| 29 | Widget-API Auth Cleanup | completed | [cms/29-widget-api-auth-cleanup.md](cms/29-widget-api-auth-cleanup.md) |
| 30 | Formulas Integration Page Update (X-Auth-Token → X-API-Key) | completed | [cms/30-formulas-integration-update.md](cms/30-formulas-integration-update.md) |
| 31 | Widget Template Polish — Improve Widgets & Dialog UX | planned | [cms/31-widget-template-polish.md](cms/31-widget-template-polish.md) |
| 32 | KB Admin UI — Per-KB Feature Toggles | completed | [cms/32-kb-admin-ui-toggles.md](cms/32-kb-admin-ui-toggles.md) |
| 33 | Feature Flag Key Migration (calc → formula/calculator) | completed | [cms/33-feature-flag-key-migration.md](cms/33-feature-flag-key-migration.md) |
| 34 | AI-API Extension: /internal/calc → /internal/formula | completed | [cms/34-ai-api-internal-calc-path-fix.md](cms/34-ai-api-internal-calc-path-fix.md) |
| 35 | v-html Sanitization Audit (Round 2) | completed | [cms/35-v-html-sanitization-audit.md](cms/35-v-html-sanitization-audit.md) |
| 36 | Pricing v2 UI polish (wallet auto-reload, low-balance banner, PlanCards rewrite) | planned | [cms/36-pricing-v2-ui-polish.md](cms/36-pricing-v2-ui-polish.md) |
| 37 | Pricing v2 — Empty-trial onboarding wizard (post-signup module picker) | planned | [cms/37-pricing-v2-empty-trial-onboarding.md](cms/37-pricing-v2-empty-trial-onboarding.md) |

---

## AI API (`services/ai-api/`)

AI chat, knowledge base backend, embeddings, public API.

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 01 | AI Assistant — Public API + Widget | completed | [ai-api/01-public-api-widget.md](ai-api/01-public-api-widget.md) |
| 02 | AI Response Template with @mentions | completed | [ai-api/02-ai-response-template.md](ai-api/02-ai-response-template.md) |
| 03 | AI Name & Response Template Overrides | completed | [ai-api/03-ai-name-overrides.md](ai-api/03-ai-name-overrides.md) |
| 04 | Digital Twin / Second Brain (Personal AI Memory) | planned | [ai-api/04-digital-twin-second-brain.md](ai-api/04-digital-twin-second-brain.md) |
| 05 | Contextual Memory Intelligence (Digital Twin Brain) | planned | [ai-api/05-contextual-memory-intelligence.md](ai-api/05-contextual-memory-intelligence.md) |
| 06 | AI Partner Configuration (Behavioral Settings) | planned | [ai-api/06-ai-partner-configuration.md](ai-api/06-ai-partner-configuration.md) |
| 07 | Calculator Skill Memory (Closed Learning Loop) | planned | [ai-api/07-calculator-skill-memory.md](ai-api/07-calculator-skill-memory.md) |
| 08 | Budget Warning Injection for Tool Use | completed | [ai-api/08-budget-warning-injection.md](ai-api/08-budget-warning-injection.md) |
| 09 | Progressive Tool Loading | completed | [ai-api/09-progressive-tool-loading.md](ai-api/09-progressive-tool-loading.md) |
| 10 | AI Observability & Self-Improvement Dashboard | completed | [ai-api/10-ai-observability-dashboard.md](ai-api/10-ai-observability-dashboard.md) |
| 11 | Contextual Widgets for AI Assistant | completed | [ai-api/11-contextual-widgets.md](ai-api/11-contextual-widgets.md) |
| 12 | Observatory Improvements & Controls | planned | [ai-api/12-observatory-improvements.md](ai-api/12-observatory-improvements.md) |
| 13 | KB Embedding Dimension Mismatch Fix | completed | [ai-api/13-kb-embedding-dimension-mismatch.md](ai-api/13-kb-embedding-dimension-mismatch.md) |
| 14 | Contextual Retrieval (LLM chunk prefixes) | completed | [ai-api/14-contextual-retrieval.md](ai-api/14-contextual-retrieval.md) |
| 15 | Parent-Document Retrieval | completed | [ai-api/15-parent-doc-retrieval.md](ai-api/15-parent-doc-retrieval.md) |
| 16 | Reranker Integration (Cohere Rerank) | completed | [ai-api/16-reranker-integration.md](ai-api/16-reranker-integration.md) |
| 17 | Retrieval Quality Metrics Enhancement | completed | [ai-api/17-retrieval-quality-metrics.md](ai-api/17-retrieval-quality-metrics.md) |
| 18 | KB Re-index Endpoint | completed | [ai-api/18-kb-reindex-endpoint.md](ai-api/18-kb-reindex-endpoint.md) |
| 19 | AI Token Usage Column Mismatch (silent data loss) | completed | [ai-api/19-ai-token-usage-column-mismatch.md](ai-api/19-ai-token-usage-column-mismatch.md) |
| 20 | API Key → KB Scoping (data isolation) | completed | [ai-api/20-api-key-kb-scoping.md](ai-api/20-api-key-kb-scoping.md) |

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
| 07 | Direct Database Migration | completed | [formula-api/07-direct-db-migration.md](formula-api/07-direct-db-migration.md) |
| 08 | Replace console.log with Structured Logger | planned | [formula-api/08-console-log-cleanup.md](formula-api/08-console-log-cleanup.md) |

### Formula Engine — bl-excel (Rust)

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 01 | Spill Array Support | idea | [formula-api/engine/01-spill-array-support.md](formula-api/engine/01-spill-array-support.md) |
| 02 | OFFSET/INDIRECT in Aggregates | idea | [formula-api/engine/02-offset-indirect-aggregates.md](formula-api/engine/02-offset-indirect-aggregates.md) |
| 03 | Volatile Function Tracking | idea | [formula-api/engine/03-volatile-tracking.md](formula-api/engine/03-volatile-tracking.md) |
| 04 | Benchmark CI | idea | [formula-api/engine/04-benchmark-ci.md](formula-api/engine/04-benchmark-ci.md) |
| 05 | WASM Target | idea | [formula-api/engine/05-wasm-target.md](formula-api/engine/05-wasm-target.md) |
| 06 | Missing Array Functions | idea | [formula-api/engine/06-missing-array-functions.md](formula-api/engine/06-missing-array-functions.md) |
| 07 | Numeric Precision | idea | [formula-api/engine/07-numeric-precision.md](formula-api/engine/07-numeric-precision.md) |
| 08 | TEXT Format Engine | idea | [formula-api/engine/08-text-format-engine.md](formula-api/engine/08-text-format-engine.md) |
| 09 | Missing Function Analysis (~150 remaining) | completed | [formula-api/engine/09-missing-function-analysis.md](formula-api/engine/09-missing-function-analysis.md) |

---

## Flow Engine (`services/flow/`)

DAG workflow execution, triggers, workers.

| # | Improvement | Status | Doc |
|---|-------------|--------|-----|
| 01 | Replace Production unwrap() with Error Handling | completed | [flow/01-unwrap-error-handling.md](flow/01-unwrap-error-handling.md) |
| 02 | Agent Node — ReAct Loop | planned | [flow/02-agent-node.md](flow/02-agent-node.md) |
| 03 | MCP Client Node — External Tool Integration | planned | [flow/03-mcp-client-node.md](flow/03-mcp-client-node.md) |
| 04 | Flow Engine unwrap() Audit — Round 2 | completed | [flow/04-unwrap-audit-round2.md](flow/04-unwrap-audit-round2.md) |

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
| 07 | Fix MCP Calculator Auth Bypass | completed | [gateway/07-mcp-auth-bypass-fix.md](gateway/07-mcp-auth-bypass-fix.md) |
| 08 | Blanket InternalAuth for /internal/ Routes | completed | [gateway/08-internal-route-auth-blanket.md](gateway/08-internal-route-auth-blanket.md) |

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
| 08 | Unified Widget Foundation (ChatKit-Compatible bl-widget) | completed | [cross-cutting/08-unified-widget-foundation.md](cross-cutting/08-unified-widget-foundation.md) |
| 09 | API Key & Resource Management Cleanup | completed | [cross-cutting/09-api-key-resource-cleanup.md](cross-cutting/09-api-key-resource-cleanup.md) |
| 10 | Platform Feature Flags (DB + Redis + Gateway + Admin UI + Module Gating) | completed | — |
| 11 | Migration Rollback Scripts | completed | [cross-cutting/11-migration-rollbacks.md](cross-cutting/11-migration-rollbacks.md) |
| 12 | Container Resource Limits | planned | [cross-cutting/12-container-resource-limits.md](cross-cutting/12-container-resource-limits.md) |
| 13 | Startup Secret Validation (Fail-Fast) | completed | [cross-cutting/13-startup-secret-validation.md](cross-cutting/13-startup-secret-validation.md) |
| 14 | Pricing v2 — Stripe Product Catalog | planned | [cross-cutting/14-pricing-v2-stripe-catalog.md](cross-cutting/14-pricing-v2-stripe-catalog.md) |
| 15 | Pricing v2 — Directus Schema (DB Admin) | **completed (Inv 1 + Inv 2)** | [cross-cutting/15-pricing-v2-directus-schema.md](cross-cutting/15-pricing-v2-directus-schema.md) — see [Inv 1 report](../reports/db-admin-2026-04-18-pricing-v2-schema-064122.md) + [Inv 2 report](../reports/db-admin-2026-04-18-ai-token-usage-fk-fix-073027.md) |
| 16 | Snapshot Makefile container-name fix | planned | [cross-cutting/16-snapshot-makefile-container-fix.md](cross-cutting/16-snapshot-makefile-container-fix.md) |
| 17 | Pricing v2 — feature_quotas refresh job | planned | [cross-cutting/17-pricing-v2-feature-quotas-refresh-job.md](cross-cutting/17-pricing-v2-feature-quotas-refresh-job.md) |
| 18 | Pricing v2 — ai_wallet atomic debit hook (ai-api) | **completed** (`6d23d9c` + `0823b8b`) | [cross-cutting/18-pricing-v2-ai-wallet-debit-trigger.md](cross-cutting/18-pricing-v2-ai-wallet-debit-trigger.md) |
| 19 | Pricing v2 — calculator_slots compute on upload (formula-api) | **completed** (`272dd31` + `b70b07f` + `969f984`) | [cross-cutting/19-pricing-v2-calculator-slots-compute.md](cross-cutting/19-pricing-v2-calculator-slots-compute.md) |
| 20 | Pricing v2 — usage_events emitter pipeline | planned | [cross-cutting/20-pricing-v2-usage-events-emitter.md](cross-cutting/20-pricing-v2-usage-events-emitter.md) |
| 21 | Pricing v2 — monthly_aggregates rollup job | planned | [cross-cutting/21-pricing-v2-monthly-aggregates-job.md](cross-cutting/21-pricing-v2-monthly-aggregates-job.md) |
| 22 | Pricing v2 — calls_per_month enforcement (formula-api) | planned | [cross-cutting/22-pricing-v2-calls-per-month-enforcement.md](cross-cutting/22-pricing-v2-calls-per-month-enforcement.md) |
| 23 | bl_flow_executions account FK fix | planned | [cross-cutting/23-bl-flow-executions-account-fk.md](cross-cutting/23-bl-flow-executions-account-fk.md) |
| 24 | Pricing v2 — ai_wallet_ledger partitioning (LOW, deferred) | planned | [cross-cutting/24-pricing-v2-ai-wallet-ledger-partitioning.md](cross-cutting/24-pricing-v2-ai-wallet-ledger-partitioning.md) |
| 25 | Pricing v2 — counter tables Directus tracking (LOW, optional) | planned | [cross-cutting/25-pricing-v2-counter-tables-directus-tracking.md](cross-cutting/25-pricing-v2-counter-tables-directus-tracking.md) |
| 26 | Pricing v2 — test coverage hardening + account isolation E2E | **completed (partial — CI pending via 35)** (`24e1671` + `dd75873` + `9101118`) | [cross-cutting/26-pricing-v2-test-coverage.md](cross-cutting/26-pricing-v2-test-coverage.md) |
| 27 | Pricing v2 — Gateway per-API-key sub-limit enforcement | planned | [cross-cutting/27-pricing-v2-gateway-sublimits.md](cross-cutting/27-pricing-v2-gateway-sublimits.md) |
| 28 | Pricing v2 — Production deployment + smoke test | planned | [cross-cutting/28-pricing-v2-production-deployment.md](cross-cutting/28-pricing-v2-production-deployment.md) |
| 29 | Pricing v2 — Per-tier RPS spec lock + per-key RPS support | planned | [cross-cutting/29-pricing-v2-rps-spec.md](cross-cutting/29-pricing-v2-rps-spec.md) |
| 30 | ai_wallet_ledger compound index for monthly cap query (LOW, defer until scale) | planned | [cross-cutting/30-ai-wallet-ledger-index.md](cross-cutting/30-ai-wallet-ledger-index.md) |
| 31 | wallet_auto_reload_pending table + CMS Stripe consumer (Sprint 2 — revenue) | **completed 2026-04-19** | [cross-cutting/31-wallet-auto-reload-pending.md](cross-cutting/31-wallet-auto-reload-pending.md) |
| 32 | Extend module_kind enum to include 'chat' (analytics) | planned | [cross-cutting/32-module-kind-enum-chat.md](cross-cutting/32-module-kind-enum-chat.md) |
| 33 | Failed-debit reconciliation queue (Sprint 2 — accounting) | **completed 2026-04-19** | [cross-cutting/33-failed-debit-reconciliation.md](cross-cutting/33-failed-debit-reconciliation.md) |
| 34 | calculator_slots reconcile + concurrent-upload race fix (Sprint 2 — quota) | **completed 2026-04-19** | [cross-cutting/34-calculator-slots-reconcile-race.md](cross-cutting/34-calculator-slots-reconcile-race.md) |
| 35 | CI pipeline — run scripts/test-all.sh on PRs (Sprint 2 — test signal) | **completed 2026-04-19** | [cross-cutting/35-ci-pipeline-test-all.md](cross-cutting/35-ci-pipeline-test-all.md) |
| 36 | **Fix ai_token_usage Directus permission gap** (Sprint 2 — SECURITY) | **completed 2026-04-19** | [cross-cutting/36-ai-token-usage-permission-fix.md](cross-cutting/36-ai-token-usage-permission-fix.md) |
| 37 | Extract shared test helpers (hygiene) | planned | [cross-cutting/37-shared-test-helpers-workspace.md](cross-cutting/37-shared-test-helpers-workspace.md) |
| 38 | Audit AI KB Assistance policy — close remaining `{}` row filter gaps | completed | [cross-cutting/38-ai-kb-policy-filter-audit.md](cross-cutting/38-ai-kb-policy-filter-audit.md) |

---

## Recommended Build Order

Build & test locally first. Infrastructure/launch comes after all building blocks are in place.

### ~~Phase 1A — Foundation~~ COMPLETED
### ~~Phase 1B — Core Platform Sprint~~ COMPLETED
### ~~Phase 1B+ — Cost Optimization~~ COMPLETED
### ~~Phase 1C — Widget Foundation + AI Widgets~~ COMPLETED
### ~~Phase 1D — Monetization~~ PARTIALLY COMPLETED (cms/24 done)

### Phase 0 — Critical Fixes (dm/api-key-extraction branch)

Must ship before merging the API key extraction branch.

| # | Service | Task | Why |
|---|---------|------|-----|
| 1 | gateway/07 | Fix MCP Calculator Auth Bypass | **P0 security** — unauthenticated calculator execution |
| 2 | cms/33 | Feature Flag Key Migration | **P1** — bricks existing deploys, all renamed features denied |
| 3 | cms/34 | AI-API /internal/calc Path Fix | **P1** — AI assistant calculator tools return 404 |

### Phase 0B — CTO Review Fixes (2026-04-15)

Security and reliability fixes from CTO review. Must-fix before next production deploy.

| # | Service | Task | Priority | Why |
|---|---------|------|----------|-----|
| 1 | flow/04 | unwrap() Audit Round 2 | **P0** | 169 panic points crash worker, kill in-flight executions |
| 2 | cms/35 | v-html Sanitization Audit Round 2 | **P0** | XSS risk in AI assistant + knowledge components |
| 3 | cross-cutting/13 | Startup Secret Validation | **P1** | Misconfigured deploy silently skips HMAC signing |
| 4 | gateway/08 | Blanket InternalAuth for /internal/ | **P1** | Defense-in-depth gap on internal routes |
| 5 | cross-cutting/11 | Migration Rollback Scripts | **P1** | No rollback path for bad migrations |
| 6 | cross-cutting/12 | Container Resource Limits | **P2** | Runaway process can consume all host resources |
| 7 | formula-api/08 | console.log → Structured Logger | **P2** | Production logging hygiene |

### Phase 1D (remaining) — Monetization

| # | Service | Task | Why |
|---|---------|------|-----|
| 1 | cms/08 | Pricing & Billing | Tiers, tax, enforcement — can't monetize without it |

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

| Service | Planned | Idea | In-Progress | Completed | Total |
|---------|---------|------|-------------|-----------|-------|
| CMS | 14 | 0 | 0 | 20 | 34 |
| AI API | 1 | 0 | 0 | 10 | 11 |
| Formula API | 1 | 0 | 0 | 7 | 8 |
| Formula Engine | 0 | 8 | 0 | 1 | 9 |
| Flow | 2 | 0 | 0 | 2 | 4 |
| Gateway | 0 | 0 | 0 | 8 | 8 |
| Cross-Cutting | 2 | 0 | 0 | 11 | 13 |
| **Total** | **20** | **8** | **0** | **59** | **87** |
