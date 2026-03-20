# Infrastructure & Deployment

## 3-Server Hetzner Topology

Production infrastructure spans three dedicated servers in the Hetzner EU data center with a private network backbone.

### Server 1: ADMIN (Management & Proxy)

**Instance:** CPX21 (3 vCPU, 4GB RAM) — €8/month

**Role:** Management hub, frontend, reverse proxy

**Services:**
- **Coolify** (management UI, container orchestration) — Port :1234 (internal only)
- **Traefik** (reverse proxy, TLS termination, load balancing) — Port :80/:443 (public)
- **Directus** (Vue SPA + REST API, flows admin) — Port :8055 → routed via Traefik
- **Sentry** (error tracking & performance monitoring)

**Network:**
- Public IP: Assigned by Hetzner
- Private IP: 10.0.0.10 (Hetzner Private Network)
- Firewall: Accept 80/443 globally, 5432/6379 from S2 private IP only

**Architecture:**
```
Internet
  ↓ (80/443)
Cloudflare (DNS, WAF, DDoS, CDN)
  ↓
Hetzner Firewall (basic rules)
  ↓
Traefik (S1, public IP)
  ├─ Route /api/* → Directus :8055
  ├─ Route /flows/* → Directus :8055
  ├─ Route /execute/* → S3 (Formula API via internal proxy)
  └─ Route /stream/* → S3 (Flow Trigger via internal proxy)

Directus :8055 (S1 private)
  ├─ Vue SPA (static assets, Cloudflare cache)
  └─ REST API (calcs, flows, auth)
```

**Disk:** 40GB (OS + containers + flow definitions)

### Server 2: DATA (Database & Cache)

**Instance:** CPX21 (3 vCPU, 4GB RAM) — €8/month

**Role:** Persistence and hot data

**Services:**
- **PostgreSQL 16** — Port :5432 (private network only)
  - Full text search (tsvector)
  - pgvector extension (1536-dim vectors for embeddings)
  - Row-level security (RLS) for multi-tenancy
  - Streaming replication (optional, for HA)

- **Redis 7** — Port :6379 (private network only)
  - Flow definition cache (LRU, 5min TTL)
  - Execution result cache (1hr TTL)
  - Rate limiter state (per-account, daily reset)
  - Worker health tracking (15s heartbeat, 45s TTL)
  - Session store (optional)

**Network:**
- Private IP: 10.0.0.20
- No public IP
- Firewall: Accept 5432/6379 ONLY from S1 (10.0.0.10) and S3 (10.0.0.30) private IPs

**Storage:**
- PostgreSQL: 100GB SSD (scalable, store all schemas + audit logs)
- Redis: 4GB RAM (ephemeral, auto-rebuild from PostgreSQL on restart)

**Backup:**
- Daily pg_dump (compressed) → Hetzner Object Storage
- Before-deploy snapshot
- 30-day retention
- RDB snapshots (hourly, 7-day retention on local disk — recipes rebuild from PG)

### Server 3: COMPUTE (Formula & Flow Execution)

**Instance:** CPX31 (4 vCPU, 8GB RAM) — €15/month

**Role:** High-throughput formula evaluation and flow execution

**Services:**
- **Formula API** (Node.js) — Port :3000 (private, routed via Traefik on S1)
  - Evaluates Excel formulas via businesslogic-excel
  - Worker pool (4 threads, 10s timeout)
  - In-memory LRU cache for formula results
  - INTERNAL_URL: 10.0.0.30:3000 (for internal routing)

- **Flow Trigger** (Rust/Axum) — Port :3100 (private, routed via Traefik on S1)
  - WebSocket listener for real-time flow triggers
  - XREADGROUP consumer for Redis streams
  - Health endpoint (:3101/health)

- **Flow Workers** (Rust/Tokio) — Port :3110–3119 (private, auto-managed)
  - Parallel flow execution
  - Each worker runs 10–100 flows concurrently (configurable)
  - Auto-scaling: add replicas via docker-compose scale

**Network:**
- Private IP: 10.0.0.30
- No public IP
- All traffic via Traefik proxy on S1

**Memory allocation:**
- Formula API: 2GB (formula AST cache, worker threads)
- Flow Trigger: 1GB (stream consumer, connection pool)
- Flow Workers: 4GB total (redis client, formula workbooks in flight)

**Docker compose:**
```yaml
version: '3.8'
services:
  formula-api:
    image: businesslogic-excel:latest
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      POOL_SIZE: 4
      REQUEST_TIMEOUT_MS: 10000
      REDIS_URL: redis://10.0.0.20:6379
    mem_limit: 2g
    cpus: 2

  flow-trigger:
    image: businesslogic-flow-trigger:latest
    ports:
      - "3100:3100"
      - "3101:3101"
    environment:
      RUST_LOG: info
      DATABASE_URL: postgresql://user:pass@10.0.0.20:5432/businesslogic
      REDIS_URL: redis://10.0.0.20:6379
    mem_limit: 1g
    cpus: 1

  flow-worker:
    image: businesslogic-flow-worker:latest
    ports:
      - "3110-3119:3110"
    environment:
      RUST_LOG: info
      DATABASE_URL: postgresql://user:pass@10.0.0.20:5432/businesslogic
      REDIS_URL: redis://10.0.0.20:6379
      WORKER_ID: "{{ .Node.ID }}"
    deploy:
      replicas: 2
    mem_limit: 2g
    cpus: 1.5
```

## Server Sizing & Growth Path

Initial configuration targets ~100 accounts (1–10 active flows each, ~10 executions/day).

| Metric | Initial | Growth | Upgrade Trigger |
|--------|---------|--------|-----------------|
| **S1 (Admin)** | CPX21 (3v/4G) | CPX31 (4v/8G) | Directus RAM > 3GB or Traefik queue > 100 |
| **S2 (Data)** | CPX21 (3v/4G) | CPX31 (4v/8G) | PG > 50GB or pgvector search > 1M rows or Redis > 2GB |
| **S3 (Compute)** | CPX31 (4v/8G) | CPX51 (16v/32G) | Queue backlog > 1000 flows or p99 latency > 5s |
| **S4 (Compute 2)** | — | CPX31+ (horizontal) | Load spread: add second compute server with independent worker pool |

**Horizontal Scaling Example:**

When S3 queue backs up, spin up S4 on-demand:

```bash
# Hetzner API call (via Coolify or manual)
hcloud server create \
  --type cpx31 \
  --image ubuntu-22.04 \
  --network businesslogic-net \
  --name compute-2

# docker-compose on S4 identical to S3
# Jump hash routes flows to S3 or S4 based on flow_id
```

**Cost at each stage:**

| Stage | S1 | S2 | S3 | Monthly | Notes |
|-------|----|----|----|---------| -----|
| Initial (100 accts) | €8 | €8 | €15 | €31 + €4 backup | All in one |
| Growth (500 accts) | €15 | €15 | €15 | €45 + €4 backup | Upgrade S1 S2, add workers |
| Scale (2k+ accts) | €15 | €15 | €53 | €83 + €8 backup | CPX51 for compute |
| Enterprise HA | €15 | €30 | €106 | €151 + €15 backup | Dual data (replication), dual compute (active-active) |

## Networking & Security

### Hetzner Private Network

All server-to-server communication over encrypted private network (10.0.0.0/16):

```
S1 (10.0.0.10)  <--private--> S2 (10.0.0.20)  <--private--> S3 (10.0.0.30)
  ADMIN                         DATA                          COMPUTE
  public IP                     no public IP                  no public IP
```

**Benefits:**
- Zero data exposure to internet for database/cache
- Guaranteed low-latency inter-server traffic
- No egress charges (internal only)
- Encrypted tunnel via Hetzner infrastructure

### Firewall Rules

**S1 (ADMIN):**
```
INBOUND:
  80/TCP (http)         ← 0.0.0.0/0 (Cloudflare IPs + backups)
  443/TCP (https)       ← 0.0.0.0/0 (Cloudflare IPs)
  22/TCP (ssh)          ← Coolify management IP only
OUTBOUND:
  All (unrestricted)

S2 connectivity:
  5432/TCP              ← 10.0.0.30 (S3 private)
  6379/TCP              ← 10.0.0.30 (S3 private)
```

**S2 (DATA):**
```
INBOUND:
  5432/TCP (PostgreSQL) ← 10.0.0.10 (S1), 10.0.0.30 (S3)
  6379/TCP (Redis)      ← 10.0.0.10 (S1), 10.0.0.30 (S3)
  22/TCP (ssh)          ← Coolify management IP only
OUTBOUND:
  All to object storage (backups)
```

**S3 (COMPUTE):**
```
INBOUND:
  22/TCP (ssh)          ← Coolify management IP only
OUTBOUND:
  5432/TCP              → 10.0.0.20 (S2, PostgreSQL)
  6379/TCP              → 10.0.0.20 (S2, Redis)
  443/TCP               → Anthropic API, OpenAI API (external)
  53/UDP                → Hetzner DNS (10.0.0.1)
```

### TLS & Certificates

**Traefik (S1):**
- Automated Let's Encrypt provisioning
- Certificate renewal (renewal 30 days before expiry)
- Wildcard cert: `*.businesslogic.example.com`
- Cert stored in Traefik data volume (S1)

**Internal Traffic (S1 ↔ S2, S1 ↔ S3):**
- Unencrypted (private network is inherently secure)
- Option: Add TLS for defense-in-depth (requires cert distribution)

### Cloudflare Configuration

**DNS:**
```
businesslogic.example.com  A  <S1 public IP>
*.businesslogic.example.com  CNAME  businesslogic.example.com
```

**SSL/TLS:** Full Strict mode
- Encrypt all traffic to S1 (Traefik provides valid cert)
- Minimum TLS 1.2

**WAF:**
- OWASP ModSecurity rules (enabled)
- Rate limiting: 100 req/min per IP (protects against bruteforce)
- Challenge on suspicious traffic

**Page Rules:**
- `/api/*` → Cache Level: Bypass (always fresh)
- `/flows/*` → Cache Level: Standard (1 hour)
- `/static/*` → Cache Everything (30 days)

**Origins:**
- Primary: S1 public IP
- Backup: (future, for HA)

## Backup Strategy

### PostgreSQL Backups

**Method:** `pg_dump` compressed to Hetzner Object Storage (S3-compatible)

**Frequency:**
- Daily (00:00 UTC)
- Before every production deploy
- Manually on-demand

**Retention:** 30-day rolling window

**Restore test:** Weekly restore to staging environment (ensures backups are valid)

**Storage:** Hetzner Object Storage
- Bucket: `businesslogic-backups`
- Key naming: `pg-backup-{YYYY-MM-DD}T{HH}:{MM}Z.sql.gz`
- Cost: ~€5/month per 100GB stored

**Script (runs on S2 daily):**
```bash
#!/bin/bash
set -e

# Backup
pg_dump \
  --host=localhost \
  --username=postgres \
  --format=custom \
  --compress=9 \
  --verbose \
  businesslogic \
  > /tmp/backup-$(date +%s).sql.gz

# Upload
aws s3 cp /tmp/backup-*.sql.gz \
  s3://businesslogic-backups/ \
  --endpoint-url https://objectstorage.eu-central.hetzner.cloud

# Clean old backups (keep 30 days)
aws s3 ls s3://businesslogic-backups/ \
  --endpoint-url https://objectstorage.eu-central.hetzner.cloud \
  | awk '$1 ~ /[0-9]{4}-[0-9]{2}/ { print $4 }' \
  | while read file; do
    age=$(( ($(date +%s) - $(date -d "${file}" +%s)) / 86400 ))
    if [ $age -gt 30 ]; then
      aws s3 rm s3://businesslogic-backups/$file
    fi
  done
```

### Redis Snapshots

**Type:** RDB (Redis Database)

**Frequency:** Hourly (cron job on S2)

**Storage:** Local disk on S2 (`/var/lib/redis/snapshots/`)

**Retention:** 7 days (auto-cleanup by cron)

**Why local:** Redis contains ephemeral data (cache, session state, rate limiter). Data is reconstructed on startup from PostgreSQL or flows are re-triggered. No need for off-site storage.

**Auto-recovery:** On S2 restart, Redis loads latest snapshot. Flow workers reconnect and repopulate cache.

### Server Images

**Method:** Hetzner automated daily image snapshots

**Frequency:** Daily (00:30 UTC, after backups complete)

**Retention:** 7-day rolling window

**Cost:** ~€1.20 per server per month (€3.60 total)

**Use case:** Quick recovery from OS corruption, SSH key compromise, or failed upgrade

### WASM Plugins

**Storage:** Hetzner Object Storage (S3-compatible)

**Backup:** On upload (immutable)

**Retention:** Indefinite (plugins are referenced by hash, never deleted)

**Versioning:**
```
s3://businesslogic-plugins/
  └─ {account_id}/
      └─ {plugin_id}/
          └─ {git_commit_hash}.wasm
```

**Cost:** Negligible (WASM modules ~50KB–1MB each)

## Docker Deployment

### Image Strategy

**Multi-stage Dockerfile:**
- Build stage: Compile Rust, run tests
- Runtime stage: Alpine Linux (musl), minimal layers
- Final image: <500MB for both trigger and worker

**Build matrix:** GitHub Actions matrix compiles for:
- `linux-x64-musl` (Alpine, Docker preferred)
- `linux-arm64-gnu` (future: Hetzner ARM servers)

### Dockerfile Example (flow-worker)

```dockerfile
# Build stage
FROM rust:latest AS builder
WORKDIR /build
COPY . .
RUN cargo build --release --target x86_64-unknown-linux-musl

# Runtime stage
FROM alpine:latest
RUN apk add --no-cache ca-certificates libc6-compat
WORKDIR /app

COPY --from=builder /build/target/x86_64-unknown-linux-musl/release/flow-worker /app/

ENV RUST_LOG=info
EXPOSE 3110

HEALTHCHECK --interval=10s --timeout=3s \
  CMD wget --quiet --tries=1 --spider http://localhost:3110/health || exit 1

CMD ["/app/flow-worker"]
```

### docker-compose.prod.yml

```yaml
version: '3.8'

services:
  formula-api:
    image: businesslogic-excel:${VERSION}
    container_name: formula-api
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      POOL_SIZE: ${FORMULA_POOL_SIZE:-4}
      REQUEST_TIMEOUT_MS: ${FORMULA_TIMEOUT_MS:-10000}
      REDIS_URL: ${REDIS_URL}
      CACHE_TTL_SECONDS: 3600
    volumes:
      - formula-cache:/tmp/cache
    mem_limit: 2g
    cpus: 2.0
    restart: unless-stopped
    networks:
      - internal

  flow-trigger:
    image: businesslogic-flow-trigger:${VERSION}
    container_name: flow-trigger
    ports:
      - "3100:3100"
      - "3101:3101"
    environment:
      RUST_LOG: ${RUST_LOG:-info}
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      TRIGGER_PORT: 3100
      HEALTH_PORT: 3101
    mem_limit: 1g
    cpus: 1.0
    restart: unless-stopped
    depends_on:
      - flow-worker
    networks:
      - internal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3101/health"]
      interval: 10s
      timeout: 3s
      retries: 3

  flow-worker:
    image: businesslogic-flow-worker:${VERSION}
    environment:
      RUST_LOG: ${RUST_LOG:-info}
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      WORKER_POOL_SIZE: ${WORKER_POOL_SIZE:-10}
      MAX_CONCURRENT_FLOWS: ${MAX_CONCURRENT_FLOWS:-100}
    mem_limit: 2g
    cpus: 1.5
    restart: unless-stopped
    deploy:
      replicas: ${WORKER_REPLICAS:-2}
    networks:
      - internal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3110/health"]
      interval: 10s
      timeout: 3s
      retries: 3

  # (Optional) PostgreSQL local mirror for staging
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - internal
    restart: unless-stopped

volumes:
  formula-cache:
  postgres-data:

networks:
  internal:
    driver: bridge
```

### Environment File (.env)

```bash
# Versions
VERSION=0.1.0

# Services
FORMULA_POOL_SIZE=4
FORMULA_TIMEOUT_MS=10000
WORKER_REPLICAS=2
WORKER_POOL_SIZE=10
MAX_CONCURRENT_FLOWS=100

# Databases
DATABASE_URL=postgresql://user:password@10.0.0.20:5432/businesslogic
REDIS_URL=redis://10.0.0.20:6379

# Logging
RUST_LOG=info

# Security
POSTGRES_PASSWORD=<random-strong-password>
```

## CI/CD Pipeline

### GitHub Actions Workflow

```yaml
name: Build & Deploy

on:
  push:
    branches: [ main, dev ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo test --release
      - run: cargo clippy -- -D warnings

  build:
    needs: test
    runs-on: ubuntu-latest
    strategy:
      matrix:
        target:
          - x86_64-unknown-linux-musl
          - aarch64-unknown-linux-musl
    steps:
      - uses: actions/checkout@v3
      - run: docker build -t businesslogic-flow-trigger:${GITHUB_SHA} .
      - run: docker build -t businesslogic-flow-worker:${GITHUB_SHA} . --target worker
      - run: docker push registry.example.com/businesslogic-flow-trigger:${GITHUB_SHA}
      - run: docker push registry.example.com/businesslogic-flow-worker:${GITHUB_SHA}

  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: |
          # SSH to S3, pull new images, restart services
          ssh root@10.0.0.30 "cd /app && docker-compose pull && docker-compose up -d"
```

### CalVer Versioning

Release version scheme: `YYYY.0M.PATCH`

```bash
# Example: 2026.03.0 (March 2026, patch 0)
# Bumped to 2026.03.1 for hotfixes
# Next major release: 2026.04.0 (April)
```

## Scaling Patterns

Reused from Formula API architecture for consistency:

### Worker Health Push

Every worker pushes heartbeat to Redis every 15 seconds:

```rust
async fn health_push_loop(worker_id: String, redis: &Redis) {
    loop {
        redis.set_ex(
            &format!("worker:{}:health", worker_id),
            json!({
                "uptime_seconds": uptime(),
                "flows_executing": current_flow_count(),
                "memory_mb": memory_usage(),
                "timestamp": now_unix()
            }),
            45  // 45-second TTL
        ).await.ok();
        sleep(Duration::from_secs(15)).await;
    }
}
```

**Benefit:** Trigger can route flows only to healthy workers (ignore workers with stale health)

### Jump Hash Routing

Route flows to consistent worker for cache affinity:

```rust
fn select_worker(flow_id: &str, workers: &[WorkerId]) -> WorkerId {
    let hash = consistent_hash(flow_id);
    workers[hash % workers.len()]
}
```

**Benefit:** If flow 123 references calculator ABC, it always routes to same worker. Calculator remains cached in memory.

### Rate Limiting

Two-tier Redis Lua script:

**Per-account RPS:**
```lua
local key = "rate:account:" .. account_id
local count = redis.call('INCR', key)
if count == 1 then redis.call('EXPIRE', key, 1) end
if count > account.rps_limit then return 0 else return 1 end
```

**Monthly budget:**
```lua
local key = "budget:" .. account_id .. ":" .. current_month
local cost = redis.call('GET', key) or 0
if cost + new_cost > account.monthly_limit then return 0 else return 1 end
```

**Benefit:** Rate limit enforced in Redis before reaching application layer (prevents connection surge)

### Backpressure

Flow Trigger monitors Tokio task queue:

```rust
async fn check_backpressure(executor: &TaskExecutor) -> bool {
    let queue_depth = executor.pending_count();
    let memory_mb = get_memory_usage();

    if queue_depth > 1000 || memory_mb > 7500 {
        // Stop consuming from Redis stream
        return true;
    }
    false
}
```

**Benefit:** If workers fall behind, Trigger stops pulling new flows from Redis. Prevents unbounded queue growth.

### Dual-Layer Cache

**Layer 1: LRU (Flow Trigger)**
- Flow definitions (5min TTL)
- Calculator schemas (1hr TTL)
- Embedded in Trigger process, nanosecond access

**Layer 2: Redis (Shared)**
- Execution results (1hr TTL)
- Cross-instance cache hits
- ~1ms access latency

**Layer 3: PostgreSQL (Authoritative)**
- All data stored durably
- ~5–10ms access latency
- Rebuild cache on miss

**Benefit:** Frequently-used flows/calculators served from memory. Rare misses refill from PG.

## Monitoring & Alerts

### Key Metrics

| Metric | Alert Threshold | Action |
|--------|-----------------|--------|
| S1 CPU > 80% | 5min avg | Page on-call, consider upgrade |
| S2 PG disk > 80% | Immediate | Cleanup old backups, add storage |
| S3 queue depth > 1000 | 2min avg | Page on-call, scale workers |
| Flow p99 latency > 5s | 5min avg | Profile, identify bottleneck |
| Account spend > monthly limit | Immediate | Disable new flows, notify user |
| Backup age > 24h | Immediate | Check S2 cron, restart process |

### Dashboards

- **Operational:** CPU, memory, disk on all servers
- **Database:** Slow queries, replication lag, connections
- **API:** Request rate, latency percentiles, error rate
- **Flows:** Execution count, duration, cost
- **Cache:** Hit rate, evictions, memory usage

### Logging

- **Application logs:** JSON to stdout (Traefik collects via Docker logging driver)
- **Flow execution logs:** DatabaseLoggingNode captures inputs, outputs, duration
- **Audit logs:** All auth events, permission changes, calculator updates
- **Retention:** 30 days hot (PostgreSQL), 1 year cold (S3 archive)

## Disaster Recovery

### RTO/RPO Targets

| Failure | RTO | RPO | Recovery |
|---------|-----|-----|----------|
| S1 crashes | 2h | 0 (stateless) | Restore from image snapshot |
| S2 crashes | 2h | 24h | Restore latest PG backup from S3 |
| S3 crashes | 1h | 0 (stateless) | Restore from image snapshot |
| Region outage | 24h | 24h | Failover to secondary region (future) |

### Failover Procedure

**S1 down:**
1. Create new instance from latest snapshot
2. Restore Traefik config from Git
3. DNS switch (5min propagation)

**S2 down:**
1. Create new instance
2. Restore PostgreSQL from latest backup
3. Restore Redis from local snapshot
4. Retry failed flows from log

**S3 down:**
1. Create new instance from snapshot
2. Flows re-trigger automatically from Redis queue
3. No data loss (results cached, formulas in PG)

## Cost Analysis

**Monthly base:**
- S1: €8
- S2: €8
- S3: €15
- **Subtotal: €31**

**Monthly services:**
- Backups (pg_dump + object storage): €4
- Hetzner snapshots: €3.60
- Bandwidth egress: ~€1–5 (depends on traffic)
- **Subtotal: €8–12**

**Total: ~€39–43/month**

**Scaling costs:**
- 10x flows: Add workers (€15–53 per additional server)
- 100x flows: Add second data server (€8), upgrade compute (€15→€53)
- **1000x flows: Dual-region setup (~€150/month)**

## References

- [Hetzner Cloud Docs](https://docs.hetzner.cloud/)
- [Traefik Configuration](https://doc.traefik.io/traefik/)
- [PostgreSQL Backup Best Practices](https://www.postgresql.org/docs/current/backup.html)
- [pgvector Scaling](https://github.com/pgvector/pgvector)
- [Kubernetes Alternative](https://businesslogic.example.com/docs/k8s-deployment) (future)
