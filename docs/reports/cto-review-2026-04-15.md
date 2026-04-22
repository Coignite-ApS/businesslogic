# CTO Technical Review Report

**Date:** 2026-04-15
**Reviewer:** CTO Review Agent
**Scope:** Full review (all sections, all services)
**Branch:** dev
**Commit:** f61e1529ac31e33e491788c45197709b6d9fbb4e

---

## Executive Summary

The BusinessLogic platform is architecturally mature with strong fundamentals: proper service isolation, HMAC-signed gateway forwarding, structured logging, OpenTelemetry instrumentation, graceful shutdown across all services, and a solid test suite (118 test files). The biggest risk is **169 `.unwrap()` calls in the Rust flow engine** — any one of these can panic and crash the service in production. The second systemic risk is **no migration rollback scripts**, which means any bad migration requires manual SQL to recover.

**Overall Risk Level:** MEDIUM

---

## Findings Summary

| Severity | Count | Top Categories |
|----------|-------|----------------|
| CRITICAL | 0 | — |
| HIGH     | 3 | Reliability, Security, Maintainability |
| MEDIUM   | 6 | Security, Performance, Reliability, Documentation |
| LOW      | 4 | Maintainability, Documentation |
| INFO     | 3 | Architecture, Code Quality |

---

## High Findings (Action Required)

### [F-001] 169 unwrap() calls in Rust flow engine
- **Severity:** HIGH
- **Category:** Reliability
- **Location:** `services/flow/crates/flow-engine/` — 22 source files
- **Description:** 169 `.unwrap()` calls across the flow engine crate. Each is a potential panic point that will crash the worker/trigger process. Highest concentration: `executor/mod.rs` (28), `nodes/ai/llm.rs` (22), `nodes/condition.rs` (13), `nodes/ai/kb/merge_rrf.rs` (12), `nodes/aggregate.rs` (12).
- **Impact:** A malformed input or unexpected None/Err value crashes the entire flow worker, killing all in-flight executions.
- **Recommendation:** Replace `.unwrap()` with `.map_err()?` or `.context()?` (anyhow). Prioritize `executor/mod.rs` and `llm.rs` first — these are hot paths.
- **Effort:** Medium (can be done incrementally per file)

### [F-002] No migration rollback scripts
- **Severity:** HIGH
- **Category:** Reliability
- **Location:** `migrations/` — all schemas (ai, formula, gateway, flow)
- **Description:** 17 forward migration SQL files exist. Zero rollback/down scripts. No `*rollback*`, `*down*`, or `*revert*` files found.
- **Impact:** A bad migration in production requires manual SQL intervention with no tested rollback path. Data loss risk.
- **Recommendation:** Add a matching `NNN_down.sql` for each migration. At minimum, create rollbacks for the most recent 5 migrations.
- **Effort:** Medium

### [F-003] v-html usage in Vue components without guaranteed sanitization
- **Severity:** HIGH
- **Category:** Security (XSS)
- **Location:**
  - `services/cms/extensions/local/project-extension-ai-assistant/src/components/markdown-renderer.vue:2`
  - `services/cms/extensions/local/project-extension-knowledge/src/components/ask-panel.vue:32`
  - `services/cms/extensions/local/project-extension-calculators/src/components/skill-tab.vue:71`
  - `services/cms/extensions/local/project-extension-formulas/src/components/code-block.vue:3`
  - `services/cms/extensions/local/project-extension-calculators/src/components/code-block.vue:3`
  - `services/cms/extensions/local/project-extension-calculators/src/components/mcp-snippets.vue:15`
- **Description:** 6 Vue components use `v-html` to render user-influenced content (markdown, AI responses, code snippets). While the calculators extension has a `dompurify-sanitization.test.ts`, the AI assistant and knowledge components lack visible DOMPurify integration.
- **Impact:** If any rendered content contains unsanitized HTML from user input or AI responses, stored XSS is possible within the CMS admin panel.
- **Recommendation:** Audit each `v-html` usage. Ensure all pass through DOMPurify before rendering. The `dompurify-sanitization.test.ts` in calculators is a good pattern to replicate.
- **Effort:** Small

---

## Medium Findings

### [F-004] No container resource limits in production compose
- **Severity:** MEDIUM
- **Category:** Reliability / Performance
- **Location:** `infrastructure/coolify/docker-compose.prod.yml`
- **Description:** Production Docker Compose uses `deploy.placement.constraints` for node affinity but does not set `resources.limits` (memory/CPU). No `mem_limit`, `cpus`, or `resources` blocks found.
- **Impact:** A runaway process (e.g., memory leak in Node.js, large flow execution) can consume all host resources and affect co-located services.
- **Recommendation:** Add `deploy.resources.limits` for each service. Example: `memory: 512M` for gateway, `memory: 1G` for AI/formula APIs, `memory: 2G` for flow worker.
- **Effort:** Small

### [F-005] innerHTML usage in Vue components
- **Severity:** MEDIUM
- **Category:** Security (XSS)
- **Location:**
  - `services/cms/extensions/local/project-extension-layout-builder/src/routes/builder.vue:261`
  - `services/cms/extensions/local/project-extension-ai-assistant/src/components/chatkit-wrapper.vue:24`
  - `services/cms/extensions/local/project-extension-calculators/src/components/template-editor.vue:118`
- **Description:** Direct `innerHTML = ''` assignments. While these appear to be clearing containers (not injecting user content), the pattern is risky and should use proper DOM APIs.
- **Recommendation:** Replace `container.innerHTML = ''` with `while (el.firstChild) el.removeChild(el.firstChild)` or `el.replaceChildren()`.
- **Effort:** Small

### [F-006] Missing README for ai-api and gateway services
- **Severity:** MEDIUM
- **Category:** Documentation
- **Location:** `services/ai-api/`, `services/gateway/`
- **Description:** `services/formula-api/README.md`, `services/cms/README.md`, `services/flow/README.md` exist. `services/ai-api/` and `services/gateway/` have no README.
- **Impact:** Onboarding friction. New developers have no service-level documentation for 2 of 5 services.
- **Recommendation:** Add README.md to ai-api and gateway covering: purpose, setup, env vars, endpoints, testing.
- **Effort:** Small

### [F-007] console.log in production code paths
- **Severity:** MEDIUM
- **Category:** Maintainability
- **Description:** 83 `console.log/error/warn` calls found across service source and test files. The production services (ai-api, formula-api) use Fastify's built-in Pino logger properly in server code, but `services/formula-api/src/routes/calculators.js` has 2 console calls in production paths.
- **Location:** `services/formula-api/src/routes/calculators.js`
- **Recommendation:** Replace remaining `console.*` calls with `req.log.*` or `app.log.*`.
- **Effort:** Small

### [F-008] Secrets read from env with empty-string fallbacks
- **Severity:** MEDIUM
- **Category:** Security
- **Location:**
  - `services/ai-api/src/config.js:91` — `adminToken: env.AI_API_ADMIN_TOKEN || env.ADMIN_TOKEN || ''`
  - `services/ai-api/src/config.js:92` — `gatewaySharedSecret: env.GATEWAY_SHARED_SECRET || ''`
- **Description:** Security-critical tokens fall back to empty string if not configured. If the gateway signing middleware receives an empty secret, it silently skips signature validation (confirmed in `signing.go:19`).
- **Impact:** A misconfigured deployment could run without inter-service auth, allowing unauthenticated requests to bypass gateway validation.
- **Recommendation:** Fail fast on startup if critical tokens are empty. Add a startup validation check that aborts if `GATEWAY_SHARED_SECRET`, `AI_API_ADMIN_TOKEN`, etc. are missing.
- **Effort:** Small

### [F-009] Internal endpoints skip auth at gateway
- **Severity:** MEDIUM
- **Category:** Security
- **Location:** `services/gateway/internal/middleware/auth.go:21`
- **Description:** `strings.HasPrefix(r.URL.Path, "/internal/")` skips auth entirely. The `internal_auth.go` middleware exists but must be applied separately per-route. If any `/internal/` route is accidentally exposed without the InternalAuth middleware, it's fully unauthenticated.
- **Impact:** Depends on which internal routes exist and how they're configured. Defense-in-depth concern.
- **Recommendation:** Consider applying InternalAuth as a blanket middleware for all `/internal/` routes at the router level, rather than relying on per-route configuration.
- **Effort:** Small

---

## Low Findings

### [F-010] Large source files exceeding 1000 lines
- **Severity:** LOW
- **Category:** Maintainability
- **Description:** Several files exceed 1000 lines:
  - `services/flow/crates/flow-engine/src/executor/mod.rs` — 1812 lines
  - `services/flow/crates/flow-trigger/src/main.rs` — 1590 lines
  - `services/cms/extensions/local/project-extension-calculator-api/src/index.ts` — 1411 lines
  - `services/cms/extensions/local/project-extension-calculators/scripts/generate-templates.ts` — 1244 lines
  - `services/cms/extensions/local/project-extension-ai-api/src/tools.ts` — 1213 lines
  - `services/formula-api/src/routes/calculators.js` — 1198 lines
  - `services/cms/extensions/local/project-extension-calculators/src/components/calculator-detail.vue` — 1100 lines
  - `services/cms/extensions/local/project-extension-knowledge-api/src/index.ts` — 1016 lines
- **Recommendation:** Extract sub-modules. Priority: `executor/mod.rs` (extract node execution into separate module) and `calculators.js` (extract CRUD, execution, streaming into separate route files).
- **Effort:** Medium

### [F-011] Only 2 TODOs in codebase
- **Severity:** LOW (positive)
- **Category:** Maintainability
- **Description:** Only 2 TODO comments found in entire codebase. This is healthy — technical debt is well-managed.

### [F-012] Alpine base images not pinned to SHA
- **Severity:** LOW
- **Category:** Security
- **Location:** All Dockerfiles use `alpine:3.20`, `node:22-alpine`, `rust:alpine`, `golang:1.26-alpine`
- **Description:** Base images are pinned to version tags but not to SHA digests. A compromised upstream tag could inject malicious code.
- **Recommendation:** Pin to SHA digests for production builds: `FROM node:22-alpine@sha256:abc123...`
- **Effort:** Small

### [F-013] No OpenAPI spec for gateway
- **Severity:** LOW
- **Category:** Documentation
- **Description:** OpenAPI specs exist for formula-api, ai-api, and cms. Gateway has none.
- **Recommendation:** Add OpenAPI spec for gateway public endpoints.
- **Effort:** Medium

---

## Info Findings

### [I-001] Strong test coverage
- **Category:** Code Quality
- **Description:** 118 test files across all services and packages. All major services have dedicated test suites:
  - formula-api: 23 test files (unit, integration, e2e, rate limit, auth)
  - ai-api: 33 test files (health, auth, KB, chat, widgets, embeddings, contracts)
  - gateway: 13 test files (Go tests covering auth, CORS, rate limit, security headers, permissions, crypto)
  - cms extensions: 20+ test files
  - packages: 12 test files (SDK, widget)
- Test quality includes security-specific tests (headers, auth, crypto, sanitization).

### [I-002] Excellent operational setup
- **Category:** Architecture
- **Description:** All services implement:
  - Health check endpoints with Docker healthchecks configured
  - Graceful shutdown with SIGTERM/SIGINT handlers
  - Structured logging (Pino for Node.js, zerolog for Go, tracing for Rust)
  - OpenTelemetry instrumentation (traces + metrics)
  - Back-pressure handling (@fastify/under-pressure)
  - Circuit breakers in gateway proxy

### [I-003] Good security fundamentals
- **Category:** Security
- **Description:** Positive findings:
  - No hardcoded secrets in source code
  - No `.env` files tracked in git
  - No `unsafe` blocks in Rust code
  - All Dockerfiles use non-root USER (except CMS which uses `node` user)
  - Security headers middleware on gateway + Helmet on Fastify services
  - HMAC-SHA256 gateway signing for service-to-service auth
  - Constant-time comparison for secret validation
  - Per-account CORS origin allowlists (not wildcard)
  - IP allowlist support
  - Rate limiting at gateway with in-memory fallback
  - Feature flags with deny-by-default pattern
  - DB SSL support with `sslmode` parameter parsing
  - No `eval()` or `new Function()` in production code

---

## Architecture Assessment

### Service Boundary Compliance
| Service | Schema Ownership | Boundary Violations | Coupling Score |
|---------|-----------------|---------------------|----------------|
| bl-cms | cms.* | 0 violations | LOW |
| bl-ai-api | ai.* | 0 violations | LOW |
| bl-formula-api | formula.* | 0 violations | LOW |
| bl-flow | flow.* | 0 violations | LOW |
| bl-gateway | gateway.* | 0 violations | LOW |

Schema ownership is properly enforced. Each service writes only to its own schema. Cross-service reads are done through defined interfaces.

### Technology Fitness
| Technology | Verdict | Notes |
|------------|---------|-------|
| Directus 11 | APPROPRIATE | Well-suited as back-office CMS. Extension system enables custom modules. |
| Fastify 5 | APPROPRIATE | Current major version. Helmet, under-pressure, multipart plugins used correctly. |
| Axum 0.8 + Tokio | APPROPRIATE | Correct for DAG execution with concurrent node processing. Tower middleware integration. |
| Go net/http | APPROPRIATE | Lightweight gateway needs no framework. Clean middleware chain pattern. |
| PostgreSQL | APPROPRIATE | Schema-per-service with pgx (Go), pg (Node), sqlx (Rust). Connection pooling configured everywhere. |
| Redis | APPROPRIATE | Used for caching, rate limiting, BullMQ queues, health push. Namespace compliance via key prefixes. |
| BullMQ | APPROPRIATE | Used in ai-api for async work. Appropriate for current scale. |

---

## Security Posture

### OWASP Top 10 Compliance
| # | Risk Category | Status | Details |
|---|--------------|--------|---------|
| A01 | Broken Access Control | PASS | Gateway validates API keys, forwards account context. Per-key permissions enforced. |
| A02 | Security Misconfiguration | PARTIAL | Empty-string secret fallbacks (F-008). Internal route auth gap (F-009). |
| A03 | Software Supply Chain | PASS | Dependencies are version-pinned. Lock files present. |
| A04 | Cryptographic Failures | PASS | HMAC-SHA256 signing, constant-time comparison, AES-256-GCM token encryption. |
| A05 | Injection | PASS | No raw SQL concatenation found. Parameterized queries throughout. |
| A06 | Vulnerable Components | PASS | Current Node.js 22, Go 1.26, Rust 2021 edition. Dependencies reasonably current. |
| A07 | Authentication Failures | PASS | API key auth with Redis-cached validation. Rate limiting protects against brute force. |
| A08 | Software & Data Integrity | PARTIAL | Docker images not SHA-pinned (F-012). |
| A09 | Logging & Monitoring | PASS | Structured logging, OpenTelemetry, request logging with no secret leakage. |
| A10 | Exceptional Conditions | PARTIAL | Rust unwrap() panics (F-001). Node.js error handling is solid. |

### Secrets Management: PASS
### Docker Security: PASS (non-root users, no privileged mode, health checks)
### Database Security: PASS (SSL support, parameterized queries, schema isolation)

---

## Code Quality Metrics

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Test files | 118 | >50 | OK |
| Files >1000 lines | 8 | 0 | REVIEW |
| Unresolved TODOs | 2 | <10 | OK |
| console.log in prod | ~2 | 0 | CLEANUP |
| unwrap() in Rust (non-test) | 169 | <20 | REVIEW |
| v-html usage | 6 | 0 | REVIEW |
| Codebase size | ~112K lines | — | INFO |

---

## Operational Readiness

| Capability | Status | Notes |
|-----------|--------|-------|
| Health checks | YES | All services + Docker healthchecks |
| Graceful shutdown | YES | SIGTERM/SIGINT handling with timeouts |
| Structured logging | YES | Pino, zerolog, tracing crate |
| Metrics/Observability | YES | OpenTelemetry traces + metrics, OTLP export |
| Database backups | YES | Rolling snapshots in infrastructure/db-snapshots/ (latest: 2026-04-15) |
| Migration rollbacks | NO | No rollback scripts exist (F-002) |
| Disaster recovery plan | PARTIAL | Snapshots exist, no documented recovery procedure |
| CI/CD pipeline | PARTIAL | Buddy CI/CD, pre-commit hooks, but no GitHub Actions visible |
| Back-pressure handling | YES | @fastify/under-pressure on Node.js services |
| Circuit breakers | YES | Gateway proxy with configurable thresholds |

---

## Recommendations (Priority Order)

### Must Fix Before Next Production Deploy
1. **[F-001]** Audit and replace `.unwrap()` calls in flow engine — start with `executor/mod.rs` and `llm.rs`
2. **[F-003]** Audit `v-html` in AI assistant and knowledge components for DOMPurify sanitization
3. **[F-008]** Add startup validation that fails fast when security-critical env vars are empty

### Should Fix Soon
4. **[F-002]** Create rollback migration scripts for at least the 5 most recent migrations
5. **[F-004]** Add container resource limits to production Docker Compose
6. **[F-009]** Apply InternalAuth as blanket middleware for all `/internal/` routes
7. **[F-007]** Replace remaining `console.*` calls with structured logger

### Nice to Have
8. **[F-006]** Add README.md to ai-api and gateway
9. **[F-010]** Extract large files into sub-modules
10. **[F-012]** Pin Docker base images to SHA digests
11. **[F-013]** Add OpenAPI spec for gateway

---

## What's Working Well

1. **Security fundamentals** — No hardcoded secrets, proper auth chain, HMAC signing, constant-time comparisons, non-root containers, security headers on every service
2. **Test coverage** — 118 test files including security-specific tests (auth, headers, crypto, sanitization)
3. **Operational maturity** — Health checks, graceful shutdown, structured logging, OpenTelemetry, back-pressure, circuit breakers
4. **Clean architecture** — Schema-per-service with zero boundary violations, minimal cross-service coupling, proper Redis namespacing
5. **Minimal tech debt** — Only 2 TODOs in the entire codebase

---

## Next Review

**Recommended in:** 4 weeks (or after flow engine unwrap cleanup)
**Focus areas:** Rust error handling audit, migration rollback testing, container resource tuning
**Triggered by:** Any new service addition, security incident, or major dependency upgrade
