# 05. Internal Route Audit Logging

**Service:** gateway
**Status:** planned
**Depends on:** GW-04

---

## Goal

Log all internal route usage for audit trail. When CMS extensions call through `/internal/*`, log the action, user context, and target service. Useful for debugging and security auditing.

---

## Key Tasks

- [ ] Add structured logging middleware for `/internal/*` routes
- [ ] Log: timestamp, source IP, X-User-Id, X-Account-Id, method, path, status code, latency
- [ ] Do NOT log request/response bodies (may contain sensitive data)
- [ ] Configurable log level (default: info, can set to debug for verbose)

## Key Files

- `services/gateway/internal/middleware/logging.go` — new or extend existing
- `services/gateway/internal/routes/router.go` — apply to internal routes
