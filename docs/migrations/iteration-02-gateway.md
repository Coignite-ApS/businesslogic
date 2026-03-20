# Iteration 2: Build bl-gateway (Go)

**Goal:** Centralise auth, rate limiting, and routing in a Go API gateway. Migrate formula-api public traffic through it first.

**Duration:** 3-4 weeks
**Risk:** Medium (new service handling real traffic)
**Rollback:** Cloudflare DNS revert to Traefik (bypasses gateway)

**Depends on:** Iteration 1 complete (bl-ai-api running)
**Branch:** `iteration/02-gateway` (from `dev` after iteration/01 merged)

---

## Development Workflow

**Git:** `git checkout dev && git merge iteration/01-ai-api && git checkout -b iteration/02-gateway`

**TDD for every step:**
1. Write tests first (`go test` for gateway, contract tests for endpoints)
2. Run tests — verify they fail
3. Implement minimum code to pass
4. Run `./scripts/test-all.sh` — no regressions
5. Commit: `git add <files> && git commit -m "feat(gateway): step 2.X - <desc>"`

---

## Step 2.1: Scaffold Go Gateway

**Directory:** `services/gateway/`

**Actions:**

1. Initialize Go module:
```bash
cd services/gateway
go mod init github.com/coignite-aps/bl-gateway
```

2. Create project structure:
```
services/gateway/
├── main.go                    # HTTP server, config, graceful shutdown
├── go.mod / go.sum
├── internal/
│   ├── config/
│   │   └── config.go          # Environment-based config
│   ├── middleware/
│   │   ├── auth.go            # API key validation (Redis + PG)
│   │   ├── ratelimit.go       # Sliding window rate limiting (Redis Lua)
│   │   ├── cors.go            # Per-key CORS + IP allowlist
│   │   ├── logging.go         # Structured request logging
│   │   └── requestid.go       # X-Request-ID generation/propagation
│   ├── proxy/
│   │   ├── proxy.go           # Reverse proxy with circuit breaker
│   │   └── health.go          # Backend health aggregation
│   ├── service/
│   │   └── keys.go            # API key lookup (Redis cache + PG fallback)
│   └── routes/
│       └── router.go          # Route resolution (/v1/ai/*, /v1/calc/*, etc.)
├── Dockerfile
├── .env.example
└── tests/
    ├── auth_test.go
    ├── ratelimit_test.go
    └── proxy_test.go
```

3. Dependencies:
```bash
go get github.com/rs/zerolog
go get github.com/redis/go-redis/v9
go get github.com/jackc/pgx/v5
go get github.com/prometheus/client_golang
```

4. Create Dockerfile:
```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o bl-gateway .

FROM alpine:3.20
RUN adduser -D -u 1000 appuser
COPY --from=builder /app/bl-gateway /usr/local/bin/
USER appuser
EXPOSE 8080
CMD ["bl-gateway"]
```

**Verification:**
- `cd services/gateway && go build .` succeeds
- `./bl-gateway` starts on port 8080
- `curl http://localhost:8080/health` returns 200

---

## Step 2.2: Implement API Key Authentication

**What:** Redis-cached API key validation with PostgreSQL fallback.

**Actions:**

1. API key format: `bl_{accountId}_{env}_{random32}`
2. Storage: SHA-256 hash in PostgreSQL `cms.api_keys` table
3. Lookup chain:
   - Redis LRU: `gw:key:{sha256(key)}` → cached account data (10min TTL)
   - PostgreSQL fallback: `SELECT * FROM cms.api_keys WHERE key_hash = $1`
   - Cache negative results for 1min (prevent brute force hammering DB)
4. Timing-safe comparison using `crypto/subtle.ConstantTimeCompare`
5. Return 401 if key missing, 403 if key invalid/expired

**Verification:**
1. Create test API key in database
2. Request with valid key → 200 proxied to backend
3. Request with invalid key → 403
4. Request without key → 401
5. Check Redis for cached key entry

---

## Step 2.3: Implement Rate Limiting

**What:** Port the formula-api's Redis Lua sliding window to Go.

**Actions:**

1. Same Lua scripts as formula-api (proven, battle-tested)
2. Per-key RPS: `rl:rps:{accountId}:{epoch_second}` (2s TTL)
3. Monthly quota: `rl:mo:{accountId}:{YYYY-MM}` (35d TTL)
4. In-memory fallback when Redis is down
5. Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
6. 429 + `Retry-After` on exceed

**Verification:**
1. Set rate limit to 5 RPS for test key
2. Send 5 requests/sec → all pass
3. Send 6th → 429 with Retry-After: 1
4. Kill Redis → requests still work (in-memory fallback)

---

## Step 2.4: Implement Route Resolution and Proxy

**What:** Route requests to backend services with circuit breaker.

**Routes:**
```
/v1/ai/*           → bl-ai-api:3200
/v1/calc/*          → bl-formula-api:3000
/v1/mcp/calc/*      → bl-formula-api:3000/mcp/*
/v1/mcp/ai/*        → bl-ai-api:3200/mcp/*
/v1/flows/webhook/* → bl-flow-trigger:3100/webhook/*
/admin/*            → bl-cms:8055/*
/health             → composite health check
```

**Actions:**

1. Use `httputil.ReverseProxy` for proxying
2. Circuit breaker: if backend returns 5xx 3 times in 30s, open circuit for 30s
3. Health aggregation: check each backend every 10s, cache result
4. Add X-Request-ID, X-Account-ID, X-Forwarded-For headers

**Verification:**
1. `curl http://localhost:8080/v1/calc/execute -H "X-API-Key: bl_..."` → proxied to formula-api
2. `curl http://localhost:8080/v1/ai/chat -H "X-API-Key: bl_..."` → proxied to ai-api
3. `curl http://localhost:8080/health` → shows all backend statuses
4. Stop bl-ai-api → circuit breaker opens → 503 instead of timeout

---

## Step 2.5: Implement CORS and IP Allowlist

**What:** Per-API-key CORS and IP restrictions.

**Actions:**

1. Read `allowed_origins` and `allowed_ips` from cached API key data
2. CORS: set `Access-Control-Allow-Origin` to matching origin
3. IP: check `CF-Connecting-IP` or `req.RemoteAddr` against CIDR list
4. Both null → allow all (like formula-api behavior)

**Verification:**
1. API key with `allowed_origins: ["https://app.example.com"]`
2. Request from `https://app.example.com` → allowed
3. Request from `https://evil.com` → 403
4. API key with `allowed_ips: ["203.0.113.0/24"]` → test with matching and non-matching IPs

---

## Step 2.6: Add Gateway to Docker Compose

**Actions:**

Add to `infrastructure/docker/docker-compose.dev.yml`:
```yaml
bl-gateway:
  build:
    context: ../../services/gateway
    dockerfile: Dockerfile
  ports:
    - "8080:8080"
  environment:
    - PORT=8080
    - REDIS_URL=redis://redis:6379
    - DATABASE_URL=postgresql://directus:directus@postgres:5432/directus
    - AI_API_URL=http://bl-ai-api:3200
    - FORMULA_API_URL=http://bl-formula-api:3000
    - FLOW_TRIGGER_URL=http://bl-flow-trigger:3100
    - CMS_URL=http://bl-cms:8055
    - LOG_LEVEL=debug
  depends_on:
    redis: { condition: service_healthy }
```

**Verification:**
```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d
curl http://localhost:8080/health
# Should show all backends healthy
```

---

## Step 2.7: Create API Key Management in CMS

**What:** Add API key CRUD to Directus so admins can create/manage keys.

**Actions:**

1. Create `cms.api_keys` table via migration:
```sql
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,  -- First 8 chars for identification: "bl_acc12"
  account_id UUID NOT NULL REFERENCES account(id),
  environment TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('live', 'test', 'dev')),
  name TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{"ai": true, "calc": true, "flow": false}',
  allowed_ips TEXT[],
  allowed_origins TEXT[],
  rate_limit_rps INT,
  monthly_quota INT,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_api_keys_key_hash ON api_keys (key_hash);
CREATE INDEX idx_api_keys_account ON api_keys (account_id);
```

2. Directus will auto-discover this table. Configure it in the admin UI with proper field display.

**Verification:**
1. Table exists in PostgreSQL
2. Directus shows api_keys in the admin UI
3. Can create, edit, revoke API keys through Directus

---

## Step 2.8: Load Test Gateway

**What:** Verify gateway performance with k6.

**Actions:**

Create `tests/k6/gateway.js`:
```javascript
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 50,
  duration: '30s',
};

export default function () {
  const res = http.get('http://localhost:8080/v1/calc/health', {
    headers: { 'X-API-Key': __ENV.API_KEY },
  });
  check(res, { 'status 200': (r) => r.status === 200 });
}
```

**Verification:**
- p95 latency < 5ms (gateway overhead)
- Zero errors at 50 VUs
- Memory usage stable (no leaks)

---

## Completion Checklist

- [ ] Go gateway scaffolded with health endpoint
- [ ] API key authentication with Redis cache + PG fallback
- [ ] Rate limiting with Lua scripts (same as formula-api)
- [ ] Route resolution to all backends
- [ ] Reverse proxy with circuit breaker
- [ ] CORS and IP allowlist per API key
- [ ] Request ID generation and propagation
- [ ] Structured logging (zerolog)
- [ ] Prometheus metrics endpoint
- [ ] Docker Compose includes gateway
- [ ] API key management table in CMS
- [ ] Load tested with k6
- [ ] All services accessible through gateway
- [ ] Formula-api calculator access works through gateway
