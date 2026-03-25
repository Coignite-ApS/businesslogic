# 05. Request Logging & Audit Trail

**Service:** gateway
**Status:** planned
**Depends on:** GW-04

---

## Goal

Two complementary logging concerns in the gateway:

1. **Public request logging** — every authenticated API call is recorded to `gateway.request_log` for billing (API call counts per account/month).
2. **Internal route audit logging** — structured logs for `/internal/*` calls from CMS extensions, for debugging and security auditing.

---

## Scope

### Public Request Logging (Billing)

Every authenticated request that passes through the gateway is logged synchronously to PostgreSQL after the response is sent.

- Fires on all routes **except** unauthenticated ones (health, metrics, `/public/*`)
- INSERT is fire-and-forget: failure must not block or slow the response
- No request or response bodies are logged (may contain sensitive data)
- Enables billing queries: API call counts per account per billing period

### Internal Route Audit Logging

Structured log line for every `/internal/*` request, used for security auditing and debugging when CMS extensions call backend services through the gateway.

- Log fields: timestamp, source IP, `X-User-Id`, `X-Account-Id`, method, path, status code, latency ms
- No request/response bodies
- Configurable log level (default: `info`; set `LOG_LEVEL=debug` for verbose)

---

## Database Schema

Migration file: `migrations/gateway/003_create_request_log.sql`

```sql
CREATE TABLE gateway.request_log (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID         NOT NULL,
  api_key_id      UUID,
  method          VARCHAR(10)  NOT NULL,
  path            VARCHAR(500) NOT NULL,
  status_code     INTEGER      NOT NULL,
  latency_ms      INTEGER      NOT NULL,
  request_size    INTEGER,
  response_size   INTEGER,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_request_log_account_month
  ON gateway.request_log (account_id, created_at);
```

---

## Key Tasks

- [ ] Create migration `migrations/gateway/003_create_request_log.sql`
- [ ] Add `RequestLogMiddleware` in `services/gateway/internal/middleware/logging.go`
  - Wraps `http.ResponseWriter` to capture status code and response size
  - Reads `account_id` and `api_key_id` from request context (set by auth middleware, GW-04)
  - Skips unauthenticated routes (health, metrics)
  - After handler returns: fire-and-forget goroutine does `INSERT INTO gateway.request_log`
  - INSERT errors logged at warn level only — never returned to caller
- [ ] Add `InternalAuditMiddleware` in the same file
  - Applies only to `/internal/*` router group
  - Logs structured JSON line: timestamp, ip, user_id, account_id, method, path, status, latency_ms
  - Respects `LOG_LEVEL` env var
- [ ] Apply `RequestLogMiddleware` to all authenticated route groups in `services/gateway/internal/routes/router.go`
- [ ] Apply `InternalAuditMiddleware` to the `/internal/*` route group
- [ ] Write unit tests for middleware (mock DB, assert INSERT fields; assert skip on unauthed routes)

---

## Key Files

- `services/gateway/internal/middleware/logging.go` — both middleware implementations
- `services/gateway/internal/routes/router.go` — middleware registration
- `migrations/gateway/003_create_request_log.sql` — new table + index

---

## Acceptance Criteria

- [ ] Authenticated request → row inserted in `gateway.request_log` with correct account_id, method, path, status, latency
- [ ] Unauthenticated request (health, metrics) → no row inserted
- [ ] DB INSERT failure → response still returns normally (fire-and-forget confirmed in tests)
- [ ] `/internal/*` request → structured log line written with all required fields
- [ ] Log level is respected (`LOG_LEVEL=debug` increases verbosity, `warn` suppresses info lines)
- [ ] No request/response bodies appear in logs or DB
- [ ] Migration runs cleanly against local dev DB
- [ ] Unit tests pass: `go test ./services/gateway/...`
