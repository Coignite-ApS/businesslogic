# Scaling Guide

Performance tuning, vertical/horizontal scaling, and monitoring for production deployments.

## Latency model

Latency under load is dominated by queuing, not eval time:

```
latency ≈ queue_depth / num_workers * eval_time_per_formula
```

Single formula eval is ~2-3ms. Workers process one request at a time, synchronously.

### Expected latency by vCPU and concurrency

| vCPUs (workers) | 50 VUs | 200 VUs | 500 VUs |
|-----------------|--------|---------|---------|
| 1 | ~125ms | ~500ms | ~1250ms |
| 2 | ~63ms | ~250ms | ~625ms |
| 4 | ~31ms | ~125ms | ~313ms |

*Assumes 2.5ms avg eval time, all cache misses, steady-state queue.*

Zero errors under heavy load confirms the worker pool is working — the event loop stays responsive while formulas queue through workers.

---

## Vertical scaling (single instance)

Ranked by impact:

### 1. More vCPUs

Most impactful lever. Workers scale linearly with CPU cores. 4 vCPUs = 4 workers = half the queue = half the latency.

### 2. POOL_SIZE

Match to available vCPUs. More workers than CPUs causes context-switching overhead. On 2-vCPU: `POOL_SIZE=2` is optimal.

### 3. Client-side batching

`/execute/batch` with 50 formulas crosses the worker boundary once vs 50 individual `/execute` calls. Cuts structured-clone overhead and scheduling latency. Max 1000 formulas per batch.

### 4. CACHE_MAX_MEMORY_ITEMS

Cached responses skip workers entirely. Default is 50,000 items. Check `GET /server/stats` → instance → `cache.lru.size` for utilization. Increase if hitting cap.

### 5. MAX_QUEUE_DEPTH

Controls the rejection-vs-latency tradeoff. Default: `POOL_SIZE * 64`. Lower = faster rejection (503) under load. Higher = requests wait longer but fewer rejections.

For managed platforms with autoscaling, set to 2048+ (see [Managed platform autoscaling](#managed-platform-autoscaling-the-gotcha)).

### 6. MAX_HEAP_USED_BYTES

Safety net for memory. Set to ~78% of container memory. For 512MB container: `400MB`. Rejects with 503 when exceeded.

### 7. Calculator limits

Each calculator engine uses ~5-10MB memory. Tune these to control memory:

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_CALCULATORS` | `100` | Total calculators in server-side LRU |
| `MAX_CALCULATORS_PER_WORKER` | `10` | Per-worker engine cap (LRU eviction) |
| `CALCULATOR_TTL_SECONDS` | `1800` | Idle expiry (30min) |

Memory estimate: `MAX_CALCULATORS_PER_WORKER * POOL_SIZE * 10MB` = worst case. With 2 workers and 10 per worker: ~200MB for calculators.

---

## Horizontal scaling (multi-instance)

### Formula endpoints (stateless)

Formula endpoints (`/execute`, `/execute/batch`, `/execute/sheet`, `/parse/xlsx`) are fully stateless. Any instance handles any request. Load balancer can round-robin freely.

### Calculator routing (consistent hashing)

Calculator endpoints use **consistent hash routing** to ensure each calculator lives on exactly ONE instance. This prevents duplicate engines across instances — critical for memory-efficient horizontal scaling.

**How it works:**

1. Each instance registers itself in Redis with its `INTERNAL_URL` (via health-push snapshots)
2. Jump consistent hash maps `calculatorId` → deterministic instance owner
3. When a request hits the wrong instance, it's transparently proxied to the owner via internal Docker network
4. `X-Routed-By` header prevents proxy loops

**Request flow:**

```
Client → Cloudflare → Traefik (round-robin) → Instance A
  → hash("calc_123") → Instance B owns it
  → proxy via internal network to Instance B
  → Instance B executes → response back through A → client
```

**Proxy penalty:** ~1-2ms per hop. Only for misrouted requests — direct hits have zero overhead.

**Enabling routing:**

Set `INTERNAL_URL` on each instance to its Docker-internal address:

```bash
# Instance 1
INTERNAL_URL=http://excel-api-1:3000

# Instance 2
INTERNAL_URL=http://excel-api-2:3000
```

Without `INTERNAL_URL`, routing is disabled and all requests handled locally (backward compatible, single-instance mode).

### Instance failure and rebalancing

When an instance dies:

1. Health-push Redis key expires after ~45s (3x push interval)
2. Hash ring refreshes every 5s on surviving instances
3. Dead instance removed from ring → affected calculators remapped
4. Next request for a remapped calculator triggers rebuild from Redis recipe
5. Transparent to clients — no errors, just one rebuild penalty (~50-100ms)

**Key guarantee:** Calculators are reconstructable from Redis recipes. Instance death only causes a transient rebuild cost, never data loss.

### Scaling up/down

When adding or removing instances:

- Jump hash moves only ~1/(N+1) calculators per instance change (near-optimal rebalancing)
- New instance joins ring within 15s (health-push interval)
- Calculators gradually migrate as requests arrive — no bulk migration
- Stale engines on old instances expire via LRU TTL (no eager eviction needed)

### Redis required for multi-instance

Redis enables:
- **Calculator routing** — instance registry for hash ring
- **Cross-instance formula cache sharing** — LRU miss on instance A can be a Redis hit from instance B
- **Calculator persistence** — recipes stored in Redis, any instance can rebuild
- **Result cache sharing** — calculator execution results shared across instances
- **Cluster monitoring** — health snapshots aggregated via `/server/stats`

Without Redis, each instance is independent (no routing, no shared cache, no cluster monitoring).

---

## Calculator-specific scaling

### Memory and limits

Each calculator engine runs inside a worker thread. Memory per engine: ~5-10MB depending on sheet size.

- `MAX_CALCULATORS_PER_WORKER`: LRU eviction when full (least-recently-used engine destroyed)
- `MAX_CALCULATORS`: server-side LRU cap across all workers
- Worker TTL sweep runs every 30s, destroying calculators idle beyond `CALCULATOR_TTL_SECONDS`

### Capacity planning for calculators

With consistent hash routing, calculators are distributed evenly across instances:

| Instances | MAX_CALCULATORS per instance | Total cluster capacity |
|-----------|------------------------------|------------------------|
| 1 | 100 | 100 calculators |
| 3 | 100 | ~300 calculators |
| 5 | 100 | ~500 calculators |

Memory per instance: `(calculators_on_instance * ~10MB) + base (~50MB)`. With 100 calculators: ~1GB peak.

### Result caching

Two-layer result cache keyed by `{calculatorId}:{generation}:{inputHash}`:

| Layer | Size | TTL | Config |
|-------|------|-----|--------|
| LRU (in-memory) | `MAX_CALCULATORS * 100` entries | `CALCULATOR_RESULT_TTL_SECONDS` | Per-instance |
| Redis | Unlimited | `CALCULATOR_RESULT_TTL_SECONDS` | Shared |

The `X-Cache` response header shows `HIT` or `MISS` for observability.

### Generation counter

`PATCH /calculators/:id` with data changes (sheets, formulas, locale) bumps the generation counter. This invalidates all cached results for that calculator — stale results are never served.

### Failure recovery

Both scenarios are transparent when Redis is enabled:

- **Worker crash** → calculator engine lost → next execute auto-rebuilds from Redis recipe
- **LRU eviction** → calculator metadata evicted → next execute auto-rebuilds from Redis recipe
- **Instance death** → hash ring rebalances → calculator rebuilt on new owner from Redis

Concurrent rebuild requests are deduplicated (single in-flight rebuild per calculator ID).

Without Redis: worker crash or LRU eviction → 410 Gone → client must recreate.

---

## Managed platform autoscaling (the gotcha)

### The problem

Platform autoscalers (DO App Platform, AWS ECS, etc.) typically watch CPU %. The feedback loop breaks:

```
high load → queue fills fast → app 503s → workers go idle → CPU drops
→ autoscaler sees low CPU → no scale-up → proxy 504s most requests
```

The queue-depth cap rejects requests before workers saturate the CPU. The autoscaler never triggers.

### The fix

1. **Raise `MAX_QUEUE_DEPTH`** to `2048` or higher. Requests wait in-process instead of being rejected. Workers stay busy → CPU stays high → autoscaler triggers. At 2048 items with ~3ms/eval and 1 worker: ~6s drain time (well under proxy timeout).

2. **Set min instances to 2.** A single instance can't absorb a burst long enough for the autoscaler to react (typically 1-2 min).

3. **Set `MAX_HEAP_USED_BYTES`** to ~78% of container memory. Prevents OOM under sustained load.

### Health check config

```yaml
health_check:
  http_path: /ping
  initial_delay_seconds: 5
```

Use `/ping` (not `/health`) — it's a lightweight liveness check with no stats computation.

### Autoscaler CPU threshold

Verify it's 50% or lower. Default 80% is often too high for this workload — workers may queue enough to cause proxy timeouts before hitting 80% CPU.

---

## Monitoring

### /health (public)

Lightweight liveness check. No auth required.

```json
{"status": "ok", "ts": 1708000000000}
```

Use for load balancer health checks and uptime monitoring.

### /server/stats (admin, cluster-wide)

`GET /server/stats` requires `X-Admin-Token`. Returns per-instance metrics aggregated from Redis, with cluster totals:

```json
{
  "status": "ok",
  "ts": 1708000000000,
  "instanceId": "excel-api-1-a3f2",
  "cluster": {
    "instances": 3,
    "totalWorkers": 6,
    "totalQueuePending": 12,
    "totalQueueMax": 384,
    "totalCalculators": 45,
    "totalHeapUsedMB": 320.5
  },
  "instances": {
    "excel-api-1-a3f2": {
      "live": true,
      "cache": {"lru": {"size": 12345, "max": 50000}, "redis": "connected"},
      "queue": {"pending": 5, "max": 128},
      "calculators": {"size": 15, "max": 100},
      "capacity": {"totalWorkers": 2, "totalHeapUsedMB": 110}
    },
    "excel-api-2-b7c1": {
      "live": false,
      "ts": 1708000010000,
      "cache": {"lru": {"size": 8900, "max": 50000}, "redis": "connected"},
      "queue": {"pending": 3, "max": 128},
      "calculators": {"size": 15, "max": 100},
      "capacity": {"totalWorkers": 2, "totalHeapUsedMB": 105}
    }
  }
}
```

- `live: true` = current instance (always fresh data)
- `live: false` = other instances (from Redis snapshot, updated every 15s)
- Stale instance keys auto-expire after 45s (instance died)

### Key metrics and alert thresholds

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| `cluster.totalQueuePending / totalQueueMax` | >60% | >80% | Add instances or raise MAX_QUEUE_DEPTH |
| Instance heap usage | >60% container | >78% container | Reduce CACHE_MAX_MEMORY_ITEMS or MAX_CALCULATORS |
| `cache.redis` | `"disconnected"` | — | Check Redis connection, routing degrades |
| `cache.lru.size / cache.lru.max` | >90% | 100% | Raise CACHE_MAX_MEMORY_ITEMS or reduce TTL |
| `calculators.size / calculators.max` | >80% | 100% | Raise MAX_CALCULATORS or add instances |
| `cluster.instances` drops | — | Expected count drops | Check dead instances, they auto-expire in 45s |

---

## Env var quick reference

All scaling-related variables in one place:

| Variable | Default | Recommended (production) | Description |
|----------|---------|--------------------------|-------------|
| `POOL_SIZE` | CPU count | Match to vCPUs | Worker threads |
| `MAX_QUEUE_DEPTH` | `POOL_SIZE * 64` | `2048` (managed platforms) | Rejection threshold |
| `MAX_HEAP_USED_BYTES` | `0` (disabled) | `400MB` (512MB container) | Memory safety net |
| `CACHE_MAX_MEMORY_ITEMS` | `50000` | `50000`-`200000` | LRU cache size |
| `CACHE_TTL_SECONDS` | `3600` | `3600` | Formula cache TTL |
| `MAX_CALCULATORS` | `100` | `100`-`500` | Server-side calculator LRU |
| `MAX_CALCULATORS_PER_WORKER` | `10` | `10`-`20` | Per-worker engine cap |
| `CALCULATOR_TTL_SECONDS` | `1800` | `1800`-`3600` | Calculator idle expiry |
| `CALCULATOR_REDIS_TTL_SECONDS` | `86400` | `86400` (24h) | Recipe TTL in Redis |
| `CALCULATOR_RESULT_TTL_SECONDS` | `3600` | `3600` (1h) | Result cache TTL in Redis |
| `REDIS_URL` | *(none)* | **Required** for multi-instance | Redis connection |
| `REQUEST_TIMEOUT_MS` | `10000` | `10000` | Per-formula timeout |
| `INTERNAL_URL` | *(none)* | **Required** for routing | Internal URL (e.g. `http://excel-api-1:3000`) |
| `INSTANCE_ID` | `{hostname}-{random}` | Set for predictable IDs | Unique instance identifier |
| `HEALTH_PUSH_INTERVAL_MS` | `15000` | `15000` | Health snapshot push frequency |
| `HASH_RING_REFRESH_MS` | `5000` | `5000` | Hash ring rebuild frequency |

---

## Scaling tiers

### Small (<1K req/min)

- 1 instance, 1-2 vCPU
- No Redis needed, no routing
- Default env vars
- LRU cache handles repeated formulas

### Medium (1K-10K req/min)

- 2-3 instances, 2 vCPU each
- Redis required
- Calculator routing via `INTERNAL_URL`
- `MAX_QUEUE_DEPTH=2048`, `MAX_HEAP_USED_BYTES=400MB`
- Client batching recommended

### Large (10K+ req/min)

- 5-10 instances, 4 vCPU each
- Redis cluster for high availability
- Calculator routing distributes ~500+ calculators across instances
- `MAX_QUEUE_DEPTH=4096`, `CACHE_MAX_MEMORY_ITEMS=200000`
- Client batching essential
- Monitor cluster metrics via `/server/stats`
