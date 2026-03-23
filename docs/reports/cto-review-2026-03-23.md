# CTO Technical Review Report

**Date:** 2026-03-23
**Reviewer:** CTO Review Agent
**Scope:** Full review (all services, all sections)
**Branch:** dev
**Commit:** 28a52fae69c7f0a0c048be74677e41513b4e23eb

---

## Executive Summary

The BusinessLogic platform is a well-architected monorepo with strong fundamentals: multi-stage Docker builds with non-root users, timing-safe token comparison, parameterized queries throughout, proper schema separation, and comprehensive OpenTelemetry instrumentation. The codebase is in active development with 42 planned tasks. The biggest risks are: SSH open to the world in production Terraform, no security headers (Helmet/CSP) on any Node.js service, missing `unhandledRejection` handlers in Node.js services, and PostgreSQL connections without SSL enforcement. None are actively exploitable in the current architecture (behind Cloudflare + private network), but they must be fixed before public production launch.

**Overall Risk Level:** MEDIUM

---

## Findings Summary

| Severity | Count | Top Categories |
|----------|-------|----------------|
| CRITICAL | 0 | — |
| HIGH     | 4 | Security, Reliability |
| MEDIUM   | 8 | Security, Architecture, Maintainability |
| LOW      | 5 | Performance, Documentation, Code Quality |
| INFO     | 4 | Good patterns to note |

---

## High Findings (Immediate Action Required)

### [F-001] SSH Open to All IPs in Production Firewall

- **Severity:** HIGH
- **Category:** Security
- **Location:** `infrastructure/terraform/firewall.tf:30-36` and `:65-71`
- **Description:** Both gateway and internal firewalls allow SSH (port 22) from `0.0.0.0/0` and `::/0`. Comments say "restricted to admin IPs in production" but the code allows all.
- **Evidence:** `source_ips = ["0.0.0.0/0", "::/0"]` on SSH rules in both firewall resources.
- **Impact:** Any IP can attempt SSH brute-force against all 5 production servers.
- **Recommendation:** Replace with a Terraform variable `var.admin_ips` containing specific admin CIDRs. Example: `source_ips = var.admin_ips`.
- **Effort:** Small

### [F-002] No Security Headers on Any Node.js Service

- **Severity:** HIGH
- **Category:** Security
- **Location:** `services/formula-api/src/server.js`, `services/ai-api/src/server.js`
- **Description:** Neither Fastify service sets security headers (X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, Content-Security-Policy). No Helmet.js or equivalent.
- **Evidence:** Grep for `helmet|x-frame-options|x-content-type|strict-transport` returns zero results in services/.
- **Impact:** Missing headers expose users to clickjacking, MIME-type confusion, and downgrade attacks when services are accessed directly.
- **Recommendation:** Add `@fastify/helmet` to both services with sensible defaults. The gateway should also set `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff`.
- **Effort:** Small

### [F-003] No unhandledRejection/uncaughtException Handlers

- **Severity:** HIGH
- **Category:** Reliability
- **Location:** `services/formula-api/src/server.js`, `services/ai-api/src/server.js`
- **Description:** Neither Node.js service registers `process.on('unhandledRejection')` or `process.on('uncaughtException')`. An unhandled promise rejection in Node.js 22+ causes process exit by default, but without logging context.
- **Evidence:** Only `SIGTERM` and `SIGINT` handlers exist. No rejection handlers.
- **Impact:** Silent crashes in production without diagnostic information.
- **Recommendation:** Add `process.on('unhandledRejection', (reason, promise) => { logger.fatal({ reason, promise }, 'unhandled rejection'); process.exit(1); })` and similarly for `uncaughtException`.
- **Effort:** Small

### [F-004] No Database Connection SSL Enforcement

- **Severity:** HIGH
- **Category:** Security
- **Location:** `services/ai-api/src/db.js:13`, gateway config defaults, Coolify prod compose
- **Description:** Database connections use plain connection strings without `sslmode=require`. In the Coolify production compose, connections traverse the private network (10.0.0.x) unencrypted.
- **Evidence:** `new Pool({ connectionString: databaseUrl, max: 20 })` in ai-api/src/db.js. No `?sslmode=require` in any DATABASE_URL in production config. Gateway defaults: `postgresql://directus:directus@localhost:5432/directus`.
- **Impact:** Database traffic (including credentials) transmitted in cleartext over the private network. If an attacker gains access to any server in the network, they can sniff credentials.
- **Recommendation:** Enable `sslmode=require` on all production database URLs. Configure PostgreSQL to require SSL connections. For local dev, `sslmode=prefer` is acceptable.
- **Effort:** Medium

---

## Medium Findings

### [F-005] Redis Connections Without Authentication

- **Severity:** MEDIUM
- **Category:** Security
- **Location:** `infrastructure/coolify/docker-compose.prod.yml:39-49`
- **Description:** Production Redis has no password configured (`redis://10.0.0.20:6379`). While on a private network, defense-in-depth requires Redis AUTH.
- **Recommendation:** Set `requirepass` in Redis config and update all `REDIS_URL` values to `redis://:password@host:6379`.
- **Effort:** Small

### [F-006] v-html Usage Without DOMPurify in Some Components

- **Severity:** MEDIUM
- **Category:** Security
- **Location:** Multiple Vue components (6 instances)
- **Description:** `v-html` is used in `markdown-renderer.vue`, `ask-panel.vue`, `code-block.vue` (2x), `mcp-snippets.vue`, `skill-tab.vue`. The AI assistant component uses DOMPurify (good), but other components using `v-html` with `marked` output may not sanitize.
- **Evidence:** `project-extension-ai-assistant` depends on `dompurify`. Other extensions using `v-html` with `marked` or `highlight.js` don't list DOMPurify as a dependency.
- **Impact:** XSS if user-controlled content reaches these renderers (low probability in CMS admin context, but medium in public-facing scenarios).
- **Recommendation:** Ensure all `v-html` usage passes through DOMPurify. Add it as a dependency to extensions that render user/AI content.
- **Effort:** Small

### [F-007] Large Files Indicate Refactoring Needed

- **Severity:** MEDIUM
- **Category:** Maintainability
- **Location:** Multiple files exceeding 1000 lines
- **Description:** 8 files exceed 1000 lines: `flow-engine/executor/mod.rs` (1662), `flow-trigger/main.rs` (1590), `calculator-api/index.ts` (1424), `calculators.js` (1302), `test.vue` (1284), `tools.ts` (1218), `knowledge-api/index.ts` (1014).
- **Impact:** Hard to review, test, and maintain. Higher bug density in large files.
- **Recommendation:** Split the largest files. `flow-trigger/main.rs` can be split into route modules. `calculator-api/index.ts` should split route handlers. `knowledge-api/index.ts` same.
- **Effort:** Medium

### [F-008] 157 unwrap() Calls in Rust Code

- **Severity:** MEDIUM
- **Category:** Reliability
- **Location:** `services/flow/crates/` — across all crates
- **Description:** 157 `.unwrap()` calls in Rust code. Most are in test code (acceptable), but several are in production paths like `flow-engine/src/nodes/formula.rs:215` and `flow-common/src/context.rs:212`.
- **Evidence:** `grep -rn "\.unwrap()" --include="*.rs" services/ | grep -v target | wc -l` returns 157. Non-test instances found in formula.rs, context.rs.
- **Impact:** Any `.unwrap()` in production code will panic and crash the worker/trigger process.
- **Recommendation:** Replace production `.unwrap()` with `.map_err()` or `?` operator. Keep `.unwrap()` only in tests and guaranteed-safe contexts.
- **Effort:** Medium

### [F-009] Test-to-Code Ratio Below Target

- **Severity:** MEDIUM
- **Category:** Maintainability
- **Location:** Project-wide
- **Description:** Code lines: ~64,365. Test lines: ~14,010. Ratio: 0.22:1. Target is >0.5:1.
- **Impact:** Insufficient test coverage for confident refactoring and deployment.
- **Recommendation:** Prioritize test coverage for gateway (only 4 test files), flow engine (tests in nodes but not executor), and CMS extensions (most modules have zero tests).
- **Effort:** Large (ongoing)

### [F-010] console.log Used for Production Logging

- **Severity:** MEDIUM
- **Category:** Maintainability
- **Location:** `services/formula-api/src/server.js:100`, `services/ai-api/src/server.js:72`, and others
- **Description:** Both Fastify services use `console.log` for request logging instead of the built-in Pino logger. Fastify ships with Pino; using console.log bypasses structured logging.
- **Evidence:** `console.log(\`${req.method} ${req.url} ${reply.statusCode} ${ms}ms\`)` in server.js request hooks.
- **Impact:** Production logs lack structure (no JSON, no log levels, no correlation IDs).
- **Recommendation:** Use `req.log.info()` instead of `console.log` to leverage Fastify's Pino integration.
- **Effort:** Small

### [F-011] PostgreSQL Credentials Hardcoded in Dev Compose Defaults

- **Severity:** MEDIUM
- **Category:** Security
- **Location:** `infrastructure/docker/docker-compose.dev.yml:35-37`, `infrastructure/coolify/docker-compose.prod.yml`
- **Description:** Dev compose has hardcoded `POSTGRES_USER: directus` / `POSTGRES_PASSWORD: directus`. Production compose correctly uses `${POSTGRES_PASSWORD}` variables.
- **Evidence:** Lines 35-37 of docker-compose.dev.yml.
- **Impact:** Low for dev (intentional), but production compose services still reference hardcoded default `postgresql://directus:directus@` in gateway config defaults (`config.go:35`).
- **Recommendation:** Ensure gateway config.go default DATABASE_URL does not contain real credentials. Use empty string as default.
- **Effort:** Small

### [F-012] CORS Allows Any Origin When No Account Context

- **Severity:** MEDIUM
- **Category:** Security
- **Location:** `services/gateway/internal/middleware/cors.go:16-33`
- **Description:** The CORS middleware echoes back any Origin header when `acct` is nil or has no `AllowedOrigins`. This means unauthenticated requests (or requests with invalid API keys that fail auth) get CORS headers.
- **Evidence:** `allowed := true` at line 17. If `acct == nil || len(acct.AllowedOrigins) == 0`, any origin is allowed.
- **Impact:** Browsers can make cross-origin requests to the gateway from any domain for unauthenticated endpoints.
- **Recommendation:** Only echo origin for requests that pass auth. For unauthenticated endpoints (health), set a fixed origin or no CORS header.
- **Effort:** Small

---

## Low Findings

### [F-013] No npm audit / cargo audit in CI

- **Severity:** LOW
- **Category:** Security
- **Location:** Project-wide
- **Description:** No CI/CD pipeline configuration found (no `.github/workflows/`, `.gitlab-ci.yml`, etc.). The project uses Buddy (per memory), but no dependency audit step is visible.
- **Recommendation:** Add `npm audit --omit=dev` and `cargo audit` to the build pipeline.
- **Effort:** Small

### [F-014] Docker Base Images Not Pinned to SHA

- **Severity:** LOW
- **Category:** Security
- **Location:** All Dockerfiles
- **Description:** Base images use version tags (`node:22-alpine`, `golang:1.26-alpine`, `rust:alpine`, `alpine:3.20`) but not SHA256 digests.
- **Impact:** Supply chain risk if a tag is overwritten.
- **Recommendation:** Pin to SHA for production builds. Tags are fine for dev.
- **Effort:** Small

### [F-015] No Resource Limits in Dev Compose

- **Severity:** LOW
- **Category:** Reliability
- **Location:** `infrastructure/docker/docker-compose.dev.yml`
- **Description:** No `mem_limit` or `cpus` configured for any service. Production compose also lacks `resources.limits`.
- **Recommendation:** Add resource limits in production compose to prevent runaway containers.
- **Effort:** Small

### [F-016] Flow Engine Missing README

- **Severity:** LOW
- **Category:** Documentation
- **Location:** `services/flow/`
- **Description:** Flow service has `README.md`, `INDEX.md`, `KEY_INSIGHTS.txt`, `RESEARCH_SUMMARY.md`, `TECHNICAL_REPORT.md` — too many docs. Other services have standard README.md.
- **Recommendation:** Consolidate into a single README.md.
- **Effort:** Small

### [F-017] Gateway Test Coverage Sparse

- **Severity:** LOW
- **Category:** Maintainability
- **Location:** `services/gateway/tests/`
- **Description:** Only 4 test files (auth, cors, proxy, ratelimit) plus 1 telemetry test. No test for the router, health checker, or key service.
- **Recommendation:** Add tests for `routes/router.go`, `proxy/health.go`, and `service/keys.go`.
- **Effort:** Medium

---

## Positive Findings (INFO)

### [I-001] Excellent Docker Security Practices

All Dockerfiles use multi-stage builds, non-root users (`USER appuser`), and minimal base images. The formula-api Dockerfile properly handles npm tokens via Docker secrets. The flow Dockerfile handles GitHub tokens similarly. This is above-average for the industry.

### [I-002] Timing-Safe Token Comparison Everywhere

Both the gateway (`crypto/subtle.ConstantTimeCompare`), ai-api (`timingSafeEqual`), and formula-api (`timingSafeEqual` via SHA-256 hashing) implement timing-safe token comparison. This prevents timing-based side-channel attacks on authentication.

### [I-003] Parameterized Queries Throughout

All database queries use parameterized statements (`$1`, `$2`, etc.) in ai-api, formula-api, gateway, and flow engine. No raw SQL string concatenation found. This effectively eliminates SQL injection.

### [I-004] Comprehensive OpenTelemetry Integration

All 5 services (formula-api, ai-api, gateway, flow-trigger, flow-worker) integrate OpenTelemetry for distributed tracing and metrics. The infrastructure includes an OTel Collector and Grafana dashboards. This is production-grade observability.

---

## Architecture Assessment

### Service Boundary Compliance

| Service | Schema Ownership | Boundary Violations | Coupling Score |
|---------|-----------------|---------------------|----------------|
| bl-cms | cms.* | 0 | LOW |
| bl-ai-api | ai.* | 0 | LOW |
| bl-formula-api | formula.* | 0 | LOW |
| bl-flow | flow.* | 0 | LOW |
| bl-gateway | gateway.* | 0 | LOW |

No cross-schema write violations found. Services read from other schemas as documented (e.g., ai-api reads `account` and `subscriptions` from cms schema). Architecture rules are well-enforced.

### Technology Fitness

| Technology | Verdict | Notes |
|------------|---------|-------|
| Directus 11.16.1 | APPROPRIATE | Solid CMS choice for back-office. Extension system working well with 14 extensions. |
| Fastify 5.2 | APPROPRIATE | Excellent for API services. Built-in validation, logging, backpressure (under-pressure). |
| Axum 0.8 + Tokio | APPROPRIATE | Rust justified for flow engine — DAG execution, WASM plugins, concurrent workers. |
| Go net/http | APPROPRIATE | Good for gateway. Minimal, fast. No framework needed for request proxying. |
| PostgreSQL 16 + pgvector | APPROPRIATE | Schema-per-service pattern is clean. pgvector enables vector search in-database. |
| Redis 7 | APPROPRIATE | Single instance sufficient at current scale. Namespacing properly implemented. |
| BullMQ | REVIEW | Used for KB ingestion in ai-api. Consider if flow engine can replace it (already has `FLOW_KB_INGEST` flag). |
| Coolify | APPROPRIATE | Suitable for current 5-server topology. Would need re-evaluation at >10 services. |

---

## Security Posture

### OWASP Top 10 Compliance

| # | Risk Category | Status | Details |
|---|--------------|--------|---------|
| A01 | Broken Access Control | PASS | Gateway validates API keys with per-key permissions. Services verify auth. Account ownership checked. |
| A02 | Security Misconfiguration | PARTIAL | Missing security headers [F-002], SSH open [F-001], Redis no auth [F-005] |
| A03 | Supply Chain Failures | PARTIAL | No npm audit in CI [F-013], images not pinned to SHA [F-014] |
| A04 | Cryptographic Failures | PASS | AES-256-GCM for token encryption, SHA-256 for key hashing, timing-safe comparison |
| A05 | Injection | PASS | All queries parameterized [I-003], no eval() in prod code (only Redis Lua script), no command injection |
| A06 | Vulnerable Components | PARTIAL | Node.js 22, Go 1.26, Rust 2021 all current. Dependencies need audit. |
| A07 | Authentication Failures | PASS | Token-based auth with cache + DB lookup. Brute-force mitigated by rate limiting. Key expiry and revocation supported. |
| A08 | Data Integrity | PARTIAL | Docker secrets used properly. No lockfile verification in CI. |
| A09 | Logging & Monitoring | PARTIAL | OTel integrated [I-004]. Auth events logged. But console.log used [F-010]. |
| A10 | Exception Handling | PARTIAL | Good error handlers in Fastify. Missing unhandledRejection [F-003]. unwrap() in Rust [F-008]. |

### Secrets Management: PASS
No hardcoded secrets in source code. .env properly gitignored. Docker secrets used for build-time tokens.

### Docker Security: PASS
Multi-stage builds, non-root users, minimal images. Health checks on all services.

### Database Security: NEEDS WORK
No SSL enforcement [F-004], no Redis auth [F-005].

---

## Code Quality Metrics

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Test-to-code ratio | 0.22:1 | >0.5:1 | LOW |
| Files >500 lines | ~15 | <5 | REVIEW |
| Files >1000 lines | 8 | 0 | REVIEW |
| Unresolved TODOs | ~5 | <10 | OK |
| console.log in prod | ~25 | 0 | CLEANUP |
| unwrap() in Rust (prod) | ~15 | <5 | REVIEW |
| Test files | 51 | — | Good coverage breadth |
| Total source lines | ~64K | — | Moderate codebase |

---

## Operational Readiness

| Capability | Status | Notes |
|-----------|--------|-------|
| Health checks | YES | All services have /ping and/or /health endpoints. Docker healthchecks configured. |
| Graceful shutdown | YES | SIGTERM/SIGINT handlers in all services. App close + resource cleanup. |
| Structured logging | PARTIAL | Pino (Fastify), zerolog (Go), tracing (Rust) — but console.log used in hooks |
| Metrics/Observability | YES | OpenTelemetry across all services. Grafana dashboards. OTel Collector. |
| Database backups | PARTIAL | Snapshot dir exists with 1 snapshot. Rolling 5-copy policy documented but not automated. |
| Migration rollbacks | NO | No rollback scripts found in migrations/ |
| Disaster recovery plan | NO | No DR documentation found |
| CI/CD pipeline | PARTIAL | Using Buddy (external). No pipeline config in repo. |

---

## Recommendations (Priority Order)

### Must Fix Before Production

1. **[F-001]** Restrict SSH access in Terraform firewalls to specific admin IPs
2. **[F-002]** Add security headers (@fastify/helmet for Node.js, custom headers in Go gateway)
3. **[F-003]** Add unhandledRejection/uncaughtException handlers to both Node.js services
4. **[F-004]** Enforce SSL on all production PostgreSQL connections

### Should Fix Soon

5. **[F-005]** Add Redis authentication for production
6. **[F-006]** Add DOMPurify to all Vue components using v-html
7. **[F-008]** Replace production .unwrap() calls with proper error handling in Rust
8. **[F-010]** Replace console.log with structured Pino logging
9. **[F-012]** Fix CORS to not echo origin for unauthenticated requests
10. **[F-009]** Increase test coverage, especially gateway and CMS extensions

### Nice to Have

11. **[F-007]** Refactor files exceeding 1000 lines
12. **[F-013]** Add npm audit / cargo audit to CI pipeline
13. **[F-014]** Pin Docker base images to SHA256 digests for production
14. **[F-015]** Add resource limits to production Docker compose
15. **[F-016]** Consolidate flow engine documentation

---

## Next Review

**Recommended in:** 4-6 weeks (after production launch items are addressed)
**Focus areas:** Dependency audit results, SSL enforcement verification, test coverage improvements
**Triggered by:** Any security incident, major infrastructure change, or new service addition
