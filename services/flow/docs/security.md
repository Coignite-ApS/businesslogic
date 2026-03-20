# Security and Resilience

The BusinessLogic Flow Engine is designed with defense-in-depth principles. This document covers the threat model, mitigations, sandboxing strategies, and operational resilience patterns.

## Threat Model

| Concern | Likelihood | Severity | Mitigation |
|---------|-----------|----------|-----------|
| **WASM sandbox escape** | Low | Critical | Wasmtime OS-level isolation (guard page at linear memory boundary). No filesystem/network access by default—capabilities granted explicitly per node. Formal verification of critical modules. Cargo vet for supply chain. |
| **QuickJS code injection** | Low | High | Sandboxed interpreter, no Node.js APIs. CPU timeout (100ms default per node). Memory limit (64MB per execution). No `eval()` or dynamic `require()`. |
| **Redis Stream message loss** | Low | Medium | Persistent mode (AOF or RDB). Unacked messages auto-reclaimed via XCLAIM after 30s timeout. Flow definitions stored in PostgreSQL (source of truth)—replays from trigger data on loss. |
| **Worker crash mid-execution** | Medium | Medium | Execution state checkpointed in Redis hash after each node. Other workers reclaim via XCLAIM. Resume from last completed node. Idempotent node implementations. |
| **LLM cost runaway** | Medium | High | 5-layer budget system: per-node limit, per-flow limit, per-account daily/monthly limit. Circuit breaker in LLM node. Hard cap enforced before API call. Cost pre-estimates from LLM SDK. |
| **Database credential exposure** | Low | Critical | Environment variables only, never in flow definitions. `$env` variable access filtered by allowlist. Credentials stored in Directus secrets manager (Phase 5). |
| **Webhook DDoS** | Medium | Medium | Cloudflare WAF rate limiting on public webhook endpoint. Per-account rate limiting in trigger service (50 req/sec default, 100K/month default). Webhook signature verification (HMAC-SHA256). Planned: per-IP rate limiting. |
| **Cross-account data leak** | Low | Critical | Every database query scoped by `account_id` at query level. WASM plugins receive scoped execution context only. Redis keys namespaced by account. No shared state between accounts. |
| **Flow definition tampering** | Low | Medium | Immutable audit log (`bl_flow_executions`). Directus permissions enforce read/write by role. Git-based versioning for infrastructure flows. |
| **Plugin memory exhaustion** | Medium | Medium | Memory limit (64MB default) enforced by WASM runtime. Per-account aggregate memory tracking. Eviction of least-recently-used plugins. |
| **Execution timeout bypass** | Low | Medium | Wasmtime module timeout (100ms default). OS-level signals (SIGALRM) as secondary. Forceful termination after timeout. No cleanup required—memory freed by runtime. |

## Authentication & Authorization

### Webhook Signature Verification (HMAC-SHA256)

All webhooks are verified with HMAC-SHA256 using the flow's webhook secret.

**Request Headers:**
```
X-Signature: sha256=<hex>
X-Timestamp: <unix epoch seconds>
```

**Message format:** `HMAC-SHA256(timestamp + "." + body, secret)`

**Verification flow:**
1. Extract `X-Signature` and `X-Timestamp` headers
2. Reject if timestamp is >5 minutes old (replay window)
3. Compute `HMAC-SHA256(timestamp_bytes + b"." + body_bytes, secret)`
4. Constant-time compare against provided signature
5. Reject with 401 if mismatch

### Admin Token

Management endpoints (`POST /flows/validate`, `GET /node-types`) require admin token via custom header:

```
X-Admin-Token: <token>
```

Token stored in environment variable `ADMIN_TOKEN`, never in database. If `ADMIN_TOKEN` is not set, management endpoints are unprotected (logged as warning at startup).

### Per-Calculator Token

Planned: Existing pattern from Formula API to be extended to flows.

```
# Not yet implemented for flow authentication.
# Currently, flows use account_id scoping + admin token.
```

### Account-Scoped Queries

Every database query includes implicit account scope:

```sql
-- Example: fetch flow
SELECT * FROM bl_flows WHERE id = $1 AND account_id = $2;

-- Example: fetch executions
SELECT * FROM bl_flow_executions
WHERE flow_id = $1 AND account_id = (SELECT id FROM accounts WHERE id = $2);
```

**Enforcement:** Use parameterized queries everywhere. Raw SQL forbidden.

## Sandboxing

### WASM Sandboxing

**Runtime:** Wasmtime with strict configuration.

**Memory Isolation:**
- Linear memory: 256MB max per module
- Guard page: 32KB unmapped region at end of linear memory (OS-level fault on overflow)
- No mmap access outside allocated region

**Capabilities (Explicit Grant):**
```rust
// By default: no capabilities
let mut linker = Linker::new(&engine);

// Grant only what's needed
if node.requires_http {
    add_http_module(&mut linker)?;
}
if node.requires_random {
    add_random_module(&mut linker)?;
}
// No filesystem, network, or environment access unless explicitly added
```

**Lifecycle:**
```rust
// Create instance (sandbox boundary)
let instance = Instance::new(&mut store, &module, &linker)?;

// Execute with timeout
let result = tokio::time::timeout(
    Duration::from_millis(100),
    async { instance.call(func, &args) }
).await;

// Automatic cleanup: Drop instance → freed by Wasmtime
```

**Verification:**
- Cargo vet all WASM dependencies
- Formal property checking for critical modules (TLA+)
- Fuzzing of parser and evaluator

### QuickJS Sandboxing

**Runtime:** QuickJS interpreter with strict configuration.

**Restrictions:**
```c
// No Node.js globals
JSRuntime *rt = JS_NewRuntime();
JS_SetMaxStackSize(rt, 256 * 1024);        // 256KB stack per execution

// No require(), import, or eval()
JS_SetClassProto(ctx, JS_EVAL_TYPE_GLOBAL, JS_NULL);

// No setTimeout, fetch, or other async APIs
JS_SetGlobalFunction(ctx, "setTimeout", JS_NULL);
JS_SetGlobalFunction(ctx, "fetch", JS_NULL);

// CPU timeout enforced at opcode level
JSValue script = JS_Eval(ctx, source, strlen(source),
                         "<input>", JS_EVAL_TYPE_GLOBAL);
```

**Module System:** Allowlisted only:
- `@stdlib/math` — Math functions
- `@stdlib/date` — Date utilities
- Custom flow modules (injected by engine)

**Memory Limits:**
- 64MB heap per execution
- GC runs every 10K allocations
- Execution killed if OOM

### External Node Sandboxing

HTTP, gRPC, and plugin calls are bounded:

**Timeouts:**
- HTTP request: 30s default (configurable per node)
- gRPC call: 30s default
- TCP connection: 5s

**Response Size Limits:**
- HTTP response body: 50MB max
- gRPC message: 50MB max
- Exceeded → error, execution continues or aborts per node config

**Connection Pooling:**
- HTTP: Keep-alive disabled (fresh connection per request)
- gRPC: Connection pool (max 100 per account)

## Resilience Patterns

### Graceful Shutdown

**Signal Handler:**
```rust
// On SIGTERM:
1. Stop accepting new work from Redis Streams
2. Finish current execution (up to 5 min timeout)
3. Checkpoint state to Redis
4. Close database connections
5. Exit with code 0
```

**Drain Period:** 5 minutes. After 5 min, force kill any remaining executions.

### Dead Letter Queue

**Flow:**
1. Execution fails (error or timeout)
2. Increment retry counter
3. If retries < max_retries: re-add to stream with backoff
4. If retries >= max_retries: move to DLQ stream: `dlq:flow:{flowId}`

**DLQ Message TTL:** 30 days. Operator must manually inspect and remediate.

**Monitoring:** Alert on DLQ size > 100 or age > 24h.

### Circuit Breaker

Applied per external service (HTTP endpoint, LLM provider, database):

**States:**
- **Closed (Normal):** Requests proceed
- **Open (Failure Threshold Exceeded):** Block requests, return error immediately
- **Half-Open (Testing):** Allow 1 request, observe result

**Thresholds:**
```rust
CircuitBreaker {
    failure_threshold: 50,          // % error rate
    failure_count: 10,              // consecutive failures
    success_threshold: 5,           // successes to close from half-open
    timeout: Duration::from_secs(60), // how long to stay open
}
```

**Example:**
```
HTTP endpoint fails 10 consecutive times
→ Circuit opens
→ New requests return error immediately
→ After 60s, circuit half-opens (allow 1 test request)
→ If succeeds, close circuit; if fails, stay open another 60s
```

**Alerting:** Alert when circuit opens on critical service (LLM, database).

### Health Push

Worker instances publish health snapshot every 15 seconds to Redis:

```json
{
  "worker_id": "worker-1",
  "instance": "https://flow-engine-1:8080",
  "timestamp": "2025-01-15T10:30:00Z",
  "status": "healthy",
  "active_executions": 3,
  "memory_mb": 256,
  "cpu_percent": 45.2
}
```

**TTL:** 45 seconds. Missing heartbeat → instance considered dead.

**Recovery:** Other workers check for stale instances and reclaim unacked messages via XCLAIM.

**Monitoring:** Dashboard shows active worker count and instance health.

## Execution Checkpointing

**Purpose:** Recover from worker crashes mid-execution.

**Checkpoint Format** (Redis hash, TTL 24h):
```json
{
  "execution_id": "uuid",
  "flow_id": "uuid",
  "account_id": "uuid",
  "state": {
    "current_node": "node-5",
    "completed_nodes": ["node-1", "node-2", "node-3"],
    "outputs": {
      "node-1": {...},
      "node-2": {...},
      "node-3": {...}
    },
    "variables": {
      "total": 100,
      "processed": 47
    }
  },
  "checkpoint_time": "2025-01-15T10:30:00Z"
}
```

**Checkpointing:**
1. After every node completes: update Redis hash
2. Before database write: check for uncommitted changes
3. On error: snapshot state for debugging

**Recovery:**
```rust
// Worker starts, checks Redis for checkpoints
if let Some(checkpoint) = redis.get(&format!("checkpoint:{execution_id}")) {
    // Resume from last completed node
    let next_node = find_successor(checkpoint.current_node);
    execute_from(next_node, checkpoint.state)?;
} else {
    // Fresh execution
    execute_from(entry_node, empty_state)?;
}
```

**Idempotency:** All node types must be idempotent:
- **HTTP node:** Retry same URL → same response
- **Database node:** SQL INSERT with UNIQUE constraint → idempotent error
- **Delay node:** Idempotent (just waits)

## Data Protection

### Credential Management

**Rule:** Never store credentials in flow definitions.

**Allowed:**
- Environment variable reference: `$env.API_KEY` (allowlisted)
- Secrets manager: `$secrets.stripe_api_key` (Phase 5)
- Inline literals in UI: stored via Directus, never shown to user after save

**Filtering:**
```rust
// On flow load, validate $env access
fn filter_env_access(variables: &[Variable]) -> Result<(), Error> {
    let allowlist = vec!["DATABASE_URL", "REDIS_URL"];
    for var in variables {
        if var.name.starts_with("$env.") {
            let key = &var.name[5..];
            if !allowlist.contains(&key) {
                return Err(Error::EnvAccessDenied(key.into()));
            }
        }
    }
    Ok(())
}
```

### Execution Context Cleanup

**TTL:** 24 hours

**Contents:**
- Checkpointed state
- Temporary variables
- Session tokens from HTTP calls

**Cleanup:**
```rust
// Every hour, scan for expired contexts
for key in redis.keys("checkpoint:*") {
    if redis.ttl(&key) < 0 {
        redis.del(&key);
    }
}
```

### Account Isolation

**Principle:** No query returns data from another account unless explicitly scoped.

**Enforcement:**
1. Add `account_id` to every table
2. Add index on `account_id` for filtering
3. Use parameterized queries with implicit account scope
4. Code review: every DB call must include `WHERE account_id = ?`

**Example Schema:**
```sql
CREATE TABLE bl_flows (
  ...
  account_id UUID NOT NULL,
  ...
);

CREATE INDEX idx_flows_account ON bl_flows(account_id);
```

**Example Query:**
```rust
// Always include account_id in WHERE clause
let flow = db.query(
    "SELECT * FROM bl_flows WHERE id = $1 AND account_id = $2",
    (flow_id, account_id)
).one().await?;
```

### RequiredRole Enforcement

Each node type declares a `required_role` (`Any` or `Admin`). Before execution or validation, `validate_flow_permissions()` checks all nodes in the flow graph against the caller's role.

- **Admin-only nodes:** `core:database`, `core:redis` (direct infrastructure access)
- **Any-user nodes:** all others (noop, http_request, transform, condition, etc.)
- **Enforcement:** `flow-engine/src/validation.rs` + `bl_node_types.required_role` column
- **Editor filtering:** `bl_node_permissions` table allows per-Directus-role overrides for palette visibility

## Rate Limiting

### Per-Account Rate Limiting (Implemented)

Redis-based counters enforced on webhook and manual trigger endpoints.

**RPS (requests per second):**
- Default: 50/s (configurable via `RATE_LIMIT_RPS`)
- Key: `rl:flow:rps:{account_id}:{epoch_seconds}` (TTL: 2s)

**Monthly quota:**
- Default: 100,000/month (configurable via `RATE_LIMIT_MONTHLY`)
- Key: `rl:flow:mo:{account_id}:{YYYY-MM}` (TTL: 35 days)

Both limits are checked atomically via INCR before enqueuing. Returns `429 Too Many Requests` with `Retry-After` header on RPS exceeded; `429` with monthly message on quota exceeded.

### Per-IP Rate Limiting (Planned)

Not yet implemented. Currently all rate limiting is per-account.

## Audit Logging

### Flow Execution Log

Every execution recorded in `bl_flow_executions`:
- Immutable: DELETE not allowed
- Indexed: `(flow_id, created_at DESC)` for quick lookup
- Fields: trigger_id, trigger_data, output, status, error, cost_estimate

### Flow Change Log

Directus native audit:
- Who deployed flow (user_id)
- When deployed (`deployed_at`)
- What changed (Directus diff tracking)

### Worker Logs

Structured logging to stdout/Sentry:
```json
{
  "timestamp": "2025-01-15T10:30:00Z",
  "level": "INFO",
  "execution_id": "uuid",
  "flow_id": "uuid",
  "node_id": "node-5",
  "message": "Node execution started",
  "duration_ms": 250,
  "cost_estimate": 0.001
}
```

## Security Checklist

Before deploying to production:

- [ ] All WASM dependencies audited via cargo vet
- [ ] Webhook signature verification enabled
- [ ] Admin token rotated (every 90 days)
- [ ] Circuit breaker thresholds tuned
- [ ] Rate limiting configured per account
- [ ] DLQ monitoring alerts set up
- [ ] Execution context TTL enforced
- [ ] Account isolation tests passing
- [ ] Credentials never in flow definitions (code review)
- [ ] OWASP top 10 security scan passed
- [ ] Penetration testing completed (external contractor)
- [ ] Incident response playbook documented
- [ ] On-call rotation configured (PagerDuty)
