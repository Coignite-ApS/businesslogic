# 02. Security Hardening (CTO Review Findings)

**Status:** completed
**Source:** CTO Review 2026-03-23 — F-001, F-002, F-004, F-005, F-012

---

## Goal

Address all HIGH and MEDIUM security findings from the CTO review. These are pre-production blockers spanning infrastructure, Node.js services, Go gateway, and Redis.

---

## Key Tasks

### F-001: Restrict SSH in Terraform Firewalls (HIGH)
- [x] Create `var.admin_ips` variable in `infrastructure/terraform/variables.tf`
- [x] Replace `0.0.0.0/0` with `var.admin_ips` in `infrastructure/terraform/firewall.tf:30-36` and `:65-71`
- [ ] `terraform plan` to verify change (requires production credentials)

### F-002: Add Security Headers to All Services (HIGH)
- [x] Add `@fastify/helmet` to `services/formula-api/` — register in `src/server.js`
- [x] Add `@fastify/helmet` to `services/ai-api/` — register in `src/server.js`
- [x] Add `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security` headers in `services/gateway/` response middleware

### F-004: Enforce SSL on Database Connections (HIGH)
- [x] Add `?sslmode=require` to all production `DATABASE_URL` values in `infrastructure/coolify/docker-compose.prod.yml`
- [x] Update `services/ai-api/src/db.js` Pool config to pass `ssl: { rejectUnauthorized: false }` when `sslmode=require`
- [x] Update gateway `config.go:35` default DATABASE_URL to empty string (not hardcoded credentials)
- [x] Verify local dev still works with `sslmode=prefer` or no SSL

### F-005: Add Redis Authentication (MEDIUM)
- [x] Set `requirepass` in production Redis config
- [x] Update all `REDIS_URL` values to `redis://:password@host:6379` in production compose
- [ ] Verify BullMQ, rate limiter, and cache clients pass auth (requires production deployment)

### F-012: Fix CORS Origin Echo for Unauthenticated Requests (MEDIUM)
- [x] Update `services/gateway/internal/middleware/cors.go:16-33` — only echo Origin when auth passes
- [x] For unauthenticated endpoints (health, ping), set fixed origin or no CORS header
- [x] Add test for CORS behavior with nil account

---

## Key Files

- `infrastructure/terraform/firewall.tf`
- `infrastructure/terraform/variables.tf`
- `infrastructure/coolify/docker-compose.prod.yml`
- `services/formula-api/src/server.js`
- `services/ai-api/src/server.js`
- `services/ai-api/src/db.js`
- `services/gateway/internal/middleware/cors.go`
- `services/gateway/internal/config/config.go`

---

## Acceptance Criteria

- [x] SSH rules in Terraform reference `var.admin_ips`, not `0.0.0.0/0`
- [x] Both Fastify services return security headers (verify with `curl -I`)
- [x] Gateway returns X-Frame-Options + X-Content-Type-Options on all responses
- [x] Production DB connections use SSL
- [x] Production Redis requires authentication
- [x] CORS does not echo arbitrary origins for unauthenticated requests
- [x] All existing tests still pass
