# Deployment

## Docker

### Build

```bash
docker build -t formula-api .
```

The Dockerfile uses:
- Multi-stage build (builder + production)
- `node:22-alpine` base
- Non-root user (`appuser`)
- V8 flags: `--max-old-space-size=512 --max-semi-space-size=64`
- Production deps only

### Run

```bash
docker run -d -p 3000:3000 --name formula-api formula-api
```

With Redis:

```bash
docker run -d -p 3000:3000 \
  -e REDIS_URL=redis://your-redis:6379 \
  -e POOL_SIZE=2 \
  --name formula-api formula-api
```

---

## Hetzner + Coolify (recommended)

Production deployment with Cloudflare in front. Supports multi-instance horizontal scaling with calculator routing.

### Architecture

```
Client → Cloudflare (CDN/WAF) → Hetzner VPS
  → Coolify (Traefik reverse proxy, round-robin)
    → excel-api-1:3000
    → excel-api-2:3000
    → excel-api-N:3000
  → Redis (shared state)
```

### Prerequisites

- Hetzner VPS with Coolify installed
- Redis instance (Coolify-managed or external)
- Cloudflare DNS pointing to Hetzner IP
- Docker image pushed to registry (or Coolify builds from Git)

### Coolify setup

1. Create a new **Service** in Coolify
2. Add the formula API as a Docker container
3. Scale to desired instance count

### Instance configuration

Each instance needs a unique `INSTANCE_ID` and `INTERNAL_URL`. Coolify service names are predictable — use them for internal networking.

**Instance 1:**
```env
INSTANCE_ID=excel-api-1
INTERNAL_URL=http://excel-api-1:3000
```

**Instance 2:**
```env
INSTANCE_ID=excel-api-2
INTERNAL_URL=http://excel-api-2:3000
```

**Shared env vars (all instances):**
```env
PORT=3000
POOL_SIZE=2
REDIS_URL=redis://redis:6379
ADMIN_TOKEN=your-admin-token
MAX_QUEUE_DEPTH=2048
MAX_HEAP_USED_BYTES=400MB
```

### How calculator routing works

With `INTERNAL_URL` set, instances form a hash ring via Redis. Each calculator is owned by exactly one instance (determined by consistent hashing on `calculatorId`). Misrouted requests are transparently proxied to the owner.

- **No load balancer configuration needed** — Traefik round-robins freely, the app self-routes
- **Proxy penalty:** ~1-2ms for misrouted requests (internal Docker network hop)
- **Failure recovery:** dead instance removed from ring in ~45s, calculators rebuilt on survivors

Without `INTERNAL_URL`, each instance operates standalone (no routing). Safe for single-instance deploys.

### Health checks

Configure Coolify/Traefik health check:

```yaml
health_check:
  http_path: /ping
  interval: 10s
  timeout: 5s
```

Use `/ping` — lightweight, no auth, no computation.

### Monitoring

`GET /server/stats` (with `X-Admin-Token`) returns cluster-wide metrics:

```bash
curl -H "X-Admin-Token: your-token" https://api.example.com/server/stats
```

Returns per-instance snapshots + cluster aggregates. See [Scaling Guide](scaling.md#monitoring) for details.

### Scaling checklist

1. Set `INTERNAL_URL` on each instance (Docker service name + port)
2. Set unique `INSTANCE_ID` per instance
3. Point all instances to same Redis
4. Set `ADMIN_TOKEN` (same across all instances)
5. Verify `/server/stats` shows all instances in `cluster.instances`
6. Monitor `calculators.size` per instance — should be roughly balanced
7. Scale by adding instances in Coolify — hash ring auto-rebalances

### Cloudflare configuration

- **SSL/TLS:** Full (strict) — Coolify/Traefik handles certs via Let's Encrypt
- **Proxy status:** Proxied (orange cloud) for DDoS protection
- **Cache:** Bypass for API routes (POST requests aren't cached by default)
- **Firewall rules:** Optional — rate limit by IP at the edge

### Redis

Coolify can manage a Redis instance directly. Alternatively, use Hetzner's managed Redis or any external Redis.

Redis handles:
- Formula cache sharing across instances
- Calculator recipe persistence (rebuild on instance restart)
- Calculator result cache sharing
- Instance health registry (hash ring + `/server/stats`)
- Rate limit counters (shared across instances)
- Account limit caching

**Sizing:** Redis memory usage is primarily calculator recipes (~10-50KB each) and cached results. 100 calculators + 50K formula cache entries ≈ ~50MB.

---

## Single Server / VPS

```bash
docker build -t formula-api .
docker run -d -p 3000:3000 --restart always --name formula-api formula-api
```

Put behind a reverse proxy (nginx/caddy/traefik) for TLS. No `INTERNAL_URL` needed — single instance operates standalone.

See [Scaling Guide](scaling.md) for performance tuning.
