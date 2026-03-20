# BusinessLogic Platform Evolution Plan

**Version 1.0 · March 20, 2026 · Confidential — Coignite ApS**

---

## 1. Vision

Five independent services (Gateway, CMS, AI API, Formula API, Flow Engine) communicating over a private Hetzner network, each horizontally scalable, crash-isolated, and deployable independently. Directus becomes pure back-office. All public API traffic flows through a single Go gateway with unified auth, rate limiting, and observability.

### Guiding Principles

| Principle | Meaning |
|-----------|---------|
| Single Responsibility | Each service owns exactly one domain |
| Proven Patterns First | Reuse formula-api's worker pool, auth, caching before inventing |
| Rust for Compute, Node/Go for I/O | Use each language where it excels |
| Gateway for Public, Direct for Private | Public → gateway → service. Internal → direct HTTP |
| Budget Enforcement Everywhere | Every AI call has cost controls (5-layer system) |
| Observable by Default | OpenTelemetry traces + metrics from day one |

---

## 2. Target Architecture

See [`architecture-diagram.mermaid`](./architecture-diagram.mermaid) for the full visual.

### 2.1 Service Topology

| Service | Tech | Purpose | Public API | Scaling |
|---------|------|---------|------------|---------|
| **bl-gateway** | Go | Auth, rate limiting, routing | All public traffic | Stateless, per-CPU |
| **bl-cms** | Directus (Node.js) | Back-office, admin UI, data CRUD | Admin only | Single instance |
| **bl-formula-api** | Node.js + Rust | Formula eval, calculators, MCP | Via gateway | Worker pool + hash ring |
| **bl-ai-api** | Node.js (Fastify) | AI chat, KB search/ingest, embeddings | Via gateway | Worker pool |
| **bl-flow** | Rust (Axum + Tokio) | DAG workflows, AI orchestration | Via gateway (webhooks) | Consumer groups |

### 2.2 Communication Paths

**Public:** Client → Cloudflare → bl-gateway (auth + rate limit) → target service → response

**Internal:** Service → Service (direct HTTP over private 10.0.0.0/16, no gateway overhead)

**Async:** Service → Redis Streams → Consumer (flow workers, AI ingestion workers)

---

## 3. Database Communication Strategy

### 3.1 The Problem You're Asking About

> "Are all services communicating directly with the database? How do we ensure we don't have too many implementations of the same thing?"

This is a critical architectural question. Here's the analysis:

### 3.2 Current State: Direct Access (Correct Choice)

Every service connects directly to PostgreSQL and Redis. This is **the right choice** for our scale and for the following reasons:

| Alternative | Latency Penalty | Complexity | When It Makes Sense |
|-------------|-----------------|------------|---------------------|
| **Direct SQL** (current) | 0ms overhead | Low | <50 services, <10K QPS |
| Dedicated data service (REST/gRPC API) | +2-10ms per call | High | >50 microservices, multi-team org |
| Event sourcing / CQRS | +10-50ms | Very high | Financial systems, audit requirements |

At 5 services, a dedicated data access service would add latency and complexity with no benefit. Even companies like Shopify with thousands of services use direct DB access with schema ownership boundaries.

### 3.3 How to Avoid Duplication: Schema Ownership + Shared Libraries

The key is **each service owns its tables** and **shared access patterns live in libraries**:

```
┌─────────────────────────────────────────────────────────────┐
│                    PostgreSQL (single instance)               │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ schema: cms   │  │ schema: ai   │  │ schema: formula  │   │
│  │ ─────────     │  │ ─────────    │  │ ─────────        │   │
│  │ accounts      │  │ conversations│  │ calculators      │   │
│  │ users         │  │ kb_chunks    │  │ calc_results     │   │
│  │ subscriptions │  │ ai_usage     │  │ calc_stats       │   │
│  │ api_keys      │  │ ai_budgets   │  │                  │   │
│  │ kb_documents  │  │ ingest_jobs  │  │                  │   │
│  │ flow_defs     │  │              │  │                  │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐                          │
│  │ schema: flow  │  │ schema: gw   │                          │
│  │ ─────────     │  │ ─────────    │                          │
│  │ executions    │  │ rate_limits  │                          │
│  │ checkpoints   │  │ key_cache    │                          │
│  │ trigger_state │  │              │                          │
│  └──────────────┘  └──────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

**Rules:**
1. **Each service owns a schema** — only that service writes to its tables
2. **Cross-schema reads are allowed** — bl-ai-api can READ `cms.accounts` to check quotas, but never WRITE to it
3. **Shared read patterns** become thin npm/crate libraries (e.g., `@coignite/db-accounts` provides `getAccountById`, `getAccountLimits`)
4. **Migrations owned by service** — each service manages its own schema migrations
5. **Connection pooling** — each service uses its own connection pool (PgBouncer if needed at scale)

### 3.4 Shared Libraries for Common Patterns

To avoid reimplementing the same DB queries across services, extract thin shared libraries:

| Library | Language | Provides | Used By |
|---------|----------|----------|---------|
| `@coignite/db-accounts` | TypeScript | `getAccount()`, `checkQuota()`, `getSubscription()` | bl-ai-api, bl-formula-api, bl-gateway |
| `@coignite/db-ratelimit` | TypeScript | Redis rate limit Lua scripts, `checkRPS()`, `checkMonthly()` | bl-ai-api, bl-formula-api, bl-gateway |
| `@coignite/db-cache` | TypeScript | Two-layer cache (LRU + Redis), `get()`, `set()`, `invalidate()` | bl-ai-api, bl-formula-api |
| `bl-common` | Rust crate | Account validation, Redis rate limit, pgvector queries | bl-flow (trigger + worker) |

These libraries are **thin wrappers** (50-200 lines each), not full ORMs. They encapsulate specific query patterns and ensure consistent behaviour across services.

### 3.5 Redis Access Pattern

Same principle — direct access, but with key namespacing:

```
bl-gateway:   gw:key:{hash}       gw:rl:{accountId}:{second}
bl-ai-api:    ai:cache:{hash}     ai:budget:{accountId}:{day}     ai:queue:*
bl-formula:   fa:cache:{hash}     fa:calc:{id}                    fa:health:{instance}
bl-flow:      fl:stream:*         fl:checkpoint:{execId}          fl:budget:{accountId}
```

**No service reads another service's Redis keys** (except for cross-cutting rate limits managed by the shared library).

---

## 4. Efficiency and Speed Gains

### 4.1 Quantified Improvements

| Metric | Current | After Migration | Gain | How |
|--------|---------|-----------------|------|-----|
| **AI chat latency (p95)** | ~3s (event loop contention) | ~1.5s (dedicated workers) | **2x faster** | Worker pool isolates LLM streaming from other requests |
| **KB search (100K chunks)** | ~500ms (B-tree scan) | ~20ms (HNSW ANN) | **25x faster** | HNSW index: O(log n) instead of O(n) |
| **KB ingestion** | ~10 docs/min (sequential, no retry) | ~100 docs/min (parallel, queued) | **10x throughput** | BullMQ workers + parallelism + skip unchanged chunks |
| **Embedding cost** | $0.02/M tokens (OpenAI) | $0 (local ONNX) | **100% savings** | fastembed ONNX in flow engine / Rust napi-rs |
| **Re-index cost** | 100% chunks re-embedded | 10-20% (only changed) | **80-90% savings** | Content hash comparison before embedding |
| **CMS response time** | ~150ms p95 (contention) | ~50ms p95 (no AI load) | **3x faster** | AI workload removed from Directus process |
| **Crash blast radius** | AI bug → entire CMS down | AI bug → only AI API affected | **Full isolation** | Separate processes, separate servers |
| **Deploy independence** | AI change → CMS restart | AI change → only AI API restarts | **Zero CMS impact** | Independent services, independent deploys |
| **Concurrent AI users** | ~100 (shared event loop) | ~1,000 (dedicated 4-core server) | **10x capacity** | Dedicated S4 server with worker thread pool |
| **API auth overhead** | Per-service implementation | Single gateway check | **Consistent + faster** | Auth cached in gateway, not re-validated per service |

### 4.2 What Gets Slower (Honest Assessment)

| Metric | Impact | Why | Mitigation |
|--------|--------|-----|------------|
| Network hop (gateway → service) | +0.5-1ms | Extra proxy hop for public requests | Internal requests bypass gateway. <1ms is negligible vs 50ms+ API calls. |
| Development complexity | More repos/services to manage | 5 services instead of 1 | Monorepo with shared tooling (see Section 6) |
| Local dev setup | More containers to run | 5 services + DB + Redis | Docker Compose dev stack with all services |
| Deployment coordination | Must deploy in order sometimes | Schema changes affect multiple services | Migration contract tests (see Section 8) |

### 4.3 Why This Is Worth It

The gains compound. Today, a single slow AI chat session can degrade CMS response times for all admin users. With dedicated services, CMS admins get consistent ~50ms responses regardless of AI load. The AI API can independently scale to 4x workers during peak hours and scale back at night. KB searches go from 500ms to 20ms with a single HNSW index. And embedding costs drop to zero.

The total cost increase is ~€26/month for 10x capacity headroom. That's the best ROI in the entire plan.

---

## 5. Service Deep Dives

### 5.1 bl-gateway (Go)

**Why Go (not Rust or Node):**
- The gateway is pure I/O: parse header → Redis lookup → proxy to backend
- Go goroutines handle 100K+ concurrent connections at <4KB/goroutine
- Single static binary (~12MB), <100ms startup, trivial deployment
- Excellent `net/http` and `httputil.ReverseProxy` standard library
- Easier to hire for than Rust; faster iteration than Rust for business logic
- Not compute-intensive, so Rust's zero-cost abstractions don't help

**Responsibilities:**
- API key validation (SHA-256 hash lookup: Redis LRU → PostgreSQL fallback)
- Rate limiting (Redis Lua sliding window, same scripts as formula-api)
- CORS + IP allowlist per API key
- Route resolution (/v1/ai/* → bl-ai-api, /v1/calc/* → bl-formula-api, etc.)
- Request ID propagation (X-Request-ID generated at edge)
- Health aggregation (checks all backends, composite /health)
- Structured logging (zerolog → Loki)
- Prometheus metrics (/metrics endpoint)

**Resource estimate:** 0.5 vCPU, 256MB RAM for 10K RPS. Extremely lightweight.

### 5.2 bl-ai-api (Node.js/Fastify)

**Why Node.js (not Rust/Go):**
- I/O-bound: 99% of time waiting for Anthropic API (50-2000ms) and PostgreSQL (1-10ms)
- Anthropic SDK is TypeScript-native with streaming support
- SSE streaming trivial in Fastify
- Formula-api provides complete reference implementation (worker pool, caching, auth patterns)
- Team has deep Node.js expertise

**Public API endpoints (via gateway):**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | /v1/ai/chat | Streaming AI chat (SSE) |
| POST | /v1/ai/chat/sync | Non-streaming chat |
| POST | /v1/ai/kb/search | Hybrid search (vector + FTS + RRF) |
| POST | /v1/ai/kb/ask | Search + LLM answer generation |
| POST | /v1/ai/kb/ingest | Upload document (async, returns job ID) |
| GET | /v1/ai/kb/ingest/:jobId | Ingestion job status |
| POST | /v1/ai/embeddings | Generate embeddings |
| GET | /v1/ai/usage | Token usage and cost report |
| POST | /v1/ai/mcp/:kbId | MCP endpoint (JSON-RPC 2.0) |

**Architecture internals:**
- **Worker thread pool** (ported from formula-api): Chat pool (4 workers), Embed pool (2 workers), Ingest pool (2 BullMQ workers)
- **Backpressure:** MAX_QUEUE_DEPTH per pool. 503 when full.
- **5-layer budget system** (ported from flow engine): per-request, per-conversation ($1), daily/account ($10), monthly/account ($100), global ($500)
- **Two-layer cache:** L1 LRU (5min) + L2 Redis (1hr). Key: SHA-256(account + query + model + kb_id)
- **KB ingestion:** BullMQ with priority, retry (3x exponential), concurrency control, version hash skip

### 5.3 bl-flow (Rust — Evolution)

Already production-complete (Phases 1-5). Evolution:
- KB ingestion as flow: parse → chunk → embed (local ONNX, $0) → store
- KB search as flow: embed_query → vector_search → rerank → format
- AI chat tool execution as flow: each tool call triggers a micro-flow
- Composite flows: KB + calculator + LLM synthesis chains

### 5.4 bl-formula-api (Unchanged)

Already production-proven. Gets:
- Unified auth via gateway (API keys replace direct admin tokens for public access)
- Calculator access linked to API key permissions
- Same hash ring routing, same worker pool

### 5.5 bl-cms (Directus — Reduced Role)

**Stays in Directus:**
- Admin UI, user/account management, calculator definition CRUD, KB document management, flow definition CRUD, billing/subscriptions, API key management UI

**Moves out:**
- AI chat → bl-ai-api
- KB search/ask → bl-ai-api
- KB ingestion workers → bl-ai-api
- Rate limiting → bl-gateway
- Public API auth → bl-gateway

**Result:** CMS drops from ~1.5GB memory / 80% CPU peaks to ~512MB / 20% CPU. Crash risk eliminated.

---

## 6. Repository Structure

### 6.1 Recommendation: Hybrid Monorepo

**Current state:** 4 separate repos (polyrepo) with cross-dependencies via npm packages, git tags, and env vars.

**Problem with pure polyrepo at our scale:**
- Shared libraries (db-accounts, db-ratelimit, db-cache) need to be published, versioned, and synced across repos
- Docker Compose for local dev needs to reference all services
- Schema migrations span services but live in separate repos
- CI/CD duplication (each repo has its own workflow with similar patterns)

**Problem with pure monorepo:**
- Different languages (Go, Rust, Node.js) with different build tools
- CI would rebuild everything on every change
- businesslogic-excel is an npm package with its own release cycle

**Recommendation: Hybrid monorepo with `businesslogic-excel` staying separate**

```
businesslogic/                          # Main monorepo
├── .github/
│   └── workflows/
│       ├── gateway.yml                 # Build + deploy bl-gateway
│       ├── ai-api.yml                  # Build + deploy bl-ai-api
│       ├── formula-api.yml             # Build + deploy bl-formula-api
│       ├── flow.yml                    # Build + deploy bl-flow (trigger + worker)
│       ├── cms.yml                     # Build + deploy bl-cms
│       └── shared-libs.yml             # Test + publish shared libraries
│
├── services/
│   ├── gateway/                        # bl-gateway (Go)
│   │   ├── main.go
│   │   ├── go.mod
│   │   ├── Dockerfile
│   │   └── ...
│   │
│   ├── ai-api/                         # bl-ai-api (Node.js)
│   │   ├── src/
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── ...
│   │
│   ├── formula-api/                    # bl-formula-api (Node.js + Rust)
│   │   ├── src/
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── ...
│   │
│   ├── flow/                           # bl-flow (Rust workspace)
│   │   ├── crates/
│   │   │   ├── flow-common/
│   │   │   ├── flow-engine/
│   │   │   ├── flow-trigger/
│   │   │   └── flow-worker/
│   │   ├── Cargo.toml
│   │   ├── docker/
│   │   │   └── Dockerfile
│   │   └── ...
│   │
│   └── cms/                            # bl-cms (Directus + extensions)
│       ├── extensions/
│       ├── base/                       # git submodule (coignite-directus-base)
│       ├── docker-compose.yml
│       └── ...
│
├── packages/                           # Shared libraries
│   ├── db-accounts/                    # @coignite/db-accounts (TypeScript)
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── db-ratelimit/                   # @coignite/db-ratelimit (TypeScript)
│   │   └── ...
│   │
│   ├── db-cache/                       # @coignite/db-cache (TypeScript)
│   │   └── ...
│   │
│   └── bl-common/                      # bl-common (Rust crate, shared by flow)
│       ├── src/
│       └── Cargo.toml
│
├── infrastructure/                     # Terraform + deployment configs
│   ├── terraform/
│   │   ├── main.tf
│   │   ├── servers.tf
│   │   ├── networking.tf
│   │   ├── firewall.tf
│   │   ├── dns.tf
│   │   └── variables.tf
│   │
│   ├── docker/
│   │   ├── docker-compose.dev.yml      # Full local dev stack
│   │   ├── docker-compose.prod.yml     # Production reference
│   │   └── .env.example
│   │
│   └── coolify/
│       ├── README.md                   # Coolify setup instructions
│       └── service-configs/            # Per-service Coolify settings
│
├── migrations/                         # Database migrations (all schemas)
│   ├── cms/
│   ├── ai/
│   ├── formula/
│   ├── flow/
│   └── gateway/
│
├── docs/                               # Architecture documentation
│   ├── architecture-diagram.mermaid
│   ├── evolution-plan.md               # This document
│   ├── database-strategy.md
│   ├── migration-safety.md
│   └── adr/                            # Architecture Decision Records
│       ├── 001-hybrid-monorepo.md
│       ├── 002-go-gateway.md
│       ├── 003-ai-api-extraction.md
│       └── ...
│
├── scripts/                            # Shared tooling
│   ├── dev-setup.sh                    # One-command local dev setup
│   ├── migrate.sh                      # Run all pending migrations
│   └── health-check.sh                # Check all services
│
└── buddy.yml                           # Buddy CI/CD pipeline definition
```

**businesslogic-excel stays as a separate repo** because:
- It's an npm package with its own release cycle (v1.2.1, v1.3.0, etc.)
- It's also a Rust crate consumed by bl-flow via git tag
- Binary builds (napi-rs multi-platform) need their own CI matrix
- It has a different update cadence (engine improvements are independent)

### 6.2 Why Not Pure Monorepo?

The hybrid approach gives us:
- **Shared libraries** without publishing: packages/ are symlinked via npm workspaces / Cargo workspace paths
- **Per-service CI:** GitHub Actions workflows triggered by path filters (`services/gateway/**`)
- **Single dev setup:** `docker compose -f infrastructure/docker/docker-compose.dev.yml up`
- **Shared migrations:** All schemas in one place, ordered, tested together
- **But** bl-excel keeps independent release cycle and CI matrix

---

## 7. Deployment Strategy: Buddy + Terraform + Coolify

### 7.1 Three-Tool Strategy

| Tool | Responsibility | When Used |
|------|---------------|-----------|
| **Terraform** | Infrastructure provisioning (Hetzner servers, networks, firewalls, DNS) | On infra changes (rare) |
| **Buddy** | CI/CD pipeline (build, test, push images, trigger deploy) | On every push/merge |
| **Coolify** | Runtime orchestration (container management, health checks, rollback) | Continuous (manages running services) |

### 7.2 Terraform for Hetzner

Terraform manages the infrastructure layer. This is critical for reproducibility and disaster recovery.

```hcl
# infrastructure/terraform/servers.tf

resource "hcloud_server" "gateway" {
  name        = "bl-gateway"
  server_type = "cx22"
  image       = "ubuntu-22.04"
  location    = "nbg1"
  ssh_keys    = [hcloud_ssh_key.deploy.id]
  network {
    network_id = hcloud_network.private.id
    ip         = "10.0.0.5"
  }
  labels = { role = "gateway", env = "production" }
}

resource "hcloud_server" "cms" {
  name        = "bl-cms"
  server_type = "cx22"
  image       = "ubuntu-22.04"
  location    = "nbg1"
  network {
    network_id = hcloud_network.private.id
    ip         = "10.0.0.10"
  }
  labels = { role = "cms", env = "production" }
}

resource "hcloud_server" "data" {
  name        = "bl-data"
  server_type = "cx32"
  image       = "ubuntu-22.04"
  location    = "nbg1"
  network {
    network_id = hcloud_network.private.id
    ip         = "10.0.0.20"
  }
  labels = { role = "data", env = "production" }
}

resource "hcloud_server" "ai_compute" {
  name        = "bl-ai-compute"
  server_type = "cx32"
  image       = "ubuntu-22.04"
  location    = "nbg1"
  network {
    network_id = hcloud_network.private.id
    ip         = "10.0.0.40"
  }
  labels = { role = "ai-compute", env = "production" }
}

resource "hcloud_server" "compute" {
  name        = "bl-compute"
  server_type = "cpx31"
  image       = "ubuntu-22.04"
  location    = "nbg1"
  network {
    network_id = hcloud_network.private.id
    ip         = "10.0.0.30"
  }
  labels = { role = "compute", env = "production" }
}

# Private network
resource "hcloud_network" "private" {
  name     = "bl-private"
  ip_range = "10.0.0.0/16"
}

resource "hcloud_network_subnet" "services" {
  network_id   = hcloud_network.private.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = "10.0.0.0/24"
}

# Firewall: only gateway gets public access
resource "hcloud_firewall" "gateway" {
  name = "bl-gateway-fw"
  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "443"
    source_ips = ["0.0.0.0/0", "::/0"]  # Cloudflare IPs in production
  }
  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_firewall" "internal" {
  name = "bl-internal-fw"
  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "any"
    source_ips = ["10.0.0.0/16"]  # Private network only
  }
}
```

**What Terraform manages:** servers, networks, subnets, firewalls, SSH keys, DNS records (via Cloudflare provider), volumes (for PostgreSQL data).

**What Terraform does NOT manage:** container deployments (that's Coolify's job), application configuration (env vars in Coolify), SSL certificates (Cloudflare + Coolify/Traefik).

### 7.3 Buddy CI/CD Pipelines

Buddy gives us better control over deployment order, approval gates, and environment-specific pipelines than GitHub Actions alone.

**Pipeline structure:**

```yaml
# buddy.yml (conceptual — actual Buddy config is in their UI but exportable)

pipelines:

  # ── Per-service build + test ──────────────────────
  - name: "Build bl-gateway"
    trigger:
      - push to main
      - path: "services/gateway/**"
    steps:
      - action: "Go Test"
        commands: ["cd services/gateway && go test ./..."]
      - action: "Docker Build"
        dockerfile: "services/gateway/Dockerfile"
        tag: "${BUDDY_EXECUTION_REVISION_SHORT}"
        registry: "ghcr.io/coignite-aps/bl-gateway"
      - action: "Push to GHCR"
      - action: "Trigger Coolify Deploy"
        method: "webhook"
        url: "${COOLIFY_WEBHOOK_GATEWAY}"

  - name: "Build bl-ai-api"
    trigger:
      - push to main
      - path: "services/ai-api/**"
      - path: "packages/**"  # Rebuild if shared libs change
    steps:
      - action: "npm test"
        commands: ["cd services/ai-api && npm ci && npm test"]
      - action: "Docker Build"
        dockerfile: "services/ai-api/Dockerfile"
        tag: "${BUDDY_EXECUTION_REVISION_SHORT}"
      - action: "Push to GHCR"
      - action: "Contract Tests"
        commands: ["npm run test:contracts"]  # Verify API contracts
      - action: "Trigger Coolify Deploy"

  - name: "Build bl-flow"
    trigger:
      - push to main
      - path: "services/flow/**"
      - path: "packages/bl-common/**"
    steps:
      - action: "Cargo Test"
        commands: ["cd services/flow && cargo test --workspace"]
      - action: "Docker Build (trigger)"
        target: "trigger"
      - action: "Docker Build (worker)"
        target: "worker"
      - action: "Push to GHCR"
      - action: "Trigger Coolify Deploy"

  # ── Database migrations ────────────────────────────
  - name: "Run Migrations"
    trigger:
      - push to main
      - path: "migrations/**"
    steps:
      - action: "Test migrations against staging DB"
        commands: ["./scripts/migrate.sh --target staging --dry-run"]
      - action: "Approval Gate"
        type: "manual"  # Human approval before production migration
      - action: "Run production migrations"
        commands: ["./scripts/migrate.sh --target production"]

  # ── Shared libraries ───────────────────────────────
  - name: "Test Shared Libraries"
    trigger:
      - push to main
      - path: "packages/**"
    steps:
      - action: "Test all packages"
        commands: ["cd packages/db-accounts && npm test", "cd packages/db-ratelimit && npm test"]
```

**Why Buddy over pure GitHub Actions:**
- Visual pipeline editor for non-developers to understand deploy flow
- Built-in approval gates (important for database migrations)
- Better secrets management with Buddy Vault
- Native Docker layer caching (faster builds)
- Webhook integration with Coolify for deployment triggers
- Environment promotion: staging → production with one click

### 7.4 Coolify for Runtime

Coolify manages the actual running containers on each Hetzner server:

| Concern | How Coolify Handles It |
|---------|----------------------|
| Container lifecycle | Pull image → start → health check → route traffic |
| Health checks | HTTP GET /ping every 5s, restart on 3 failures |
| Rolling deploy | New container starts alongside old, old drains after health passes |
| Rollback | One-click revert to previous image tag |
| Environment variables | Per-service secrets stored in Coolify, injected at runtime |
| Resource limits | CPU/memory limits per container |
| Logs | Aggregated per service, accessible via Coolify UI |

### 7.5 Deployment Flow (End to End)

```
Developer pushes to main
        ↓
Buddy detects path change (e.g., services/ai-api/**)
        ↓
Buddy runs tests → builds Docker image → pushes to GHCR
        ↓
Buddy fires Coolify webhook (service-specific)
        ↓
Coolify pulls new image on target server (S4 for ai-api)
        ↓
Coolify starts new container, runs health check
        ↓
Health passes → Coolify drains old container (30s grace)
        ↓
Old container removed. Deploy complete.
        ↓
If health fails → Coolify keeps old container, alerts via webhook
```

---

## 8. Migration Safety: How Nothing Breaks

### 8.1 Core Principle: Proxy-First, Never Big-Bang

Every migration follows four steps:

1. **Deploy new service** alongside existing (both running, new is idle)
2. **Proxy:** Old endpoint forwards to new service (old code becomes thin proxy)
3. **Verify:** Run both in parallel, compare responses (shadow mode)
4. **Cutover:** Gateway routes to new service directly. Remove proxy.

This means at **no point** does the old system stop working. If the new service has a bug, the proxy falls back to local handling.

### 8.2 Contract Testing

Before any deploy, verify that services agree on their API contracts:

```
┌─────────────────────────────────────────────────┐
│              Contract Test Suite                  │
│                                                   │
│  Producer Tests (run by service being deployed):  │
│  ├─ "bl-ai-api responds to POST /v1/ai/chat     │
│  │   with SSE stream matching schema X"          │
│  ├─ "bl-ai-api responds to POST /v1/ai/kb/search│
│  │   with results matching schema Y"             │
│  └─ ...                                          │
│                                                   │
│  Consumer Tests (run by dependent services):      │
│  ├─ "bl-gateway can proxy /v1/ai/chat to ai-api" │
│  ├─ "bl-flow can call ai-api /v1/ai/embeddings" │
│  └─ ...                                          │
│                                                   │
│  Cross-Service Tests (run in staging):            │
│  ├─ "Chat → tool call → calculator → response"  │
│  ├─ "KB ingest → search → answer generation"    │
│  └─ "Flow trigger → execute → AI node → result" │
└─────────────────────────────────────────────────┘
```

### 8.3 Feature Flags

New services are deployed behind feature flags so they can be enabled/disabled per account:

| Flag | Default | Purpose |
|------|---------|---------|
| `ai_service_enabled` | false | Route AI requests to bl-ai-api instead of Directus |
| `gateway_enabled` | false | Route public traffic through bl-gateway |
| `flow_kb_ingest` | false | Use flow-based KB ingestion instead of embedded |
| `local_embeddings` | false | Use ONNX embeddings instead of OpenAI |
| `budget_enforcement` | false | Enable 5-layer budget limits |

**Rollout strategy:** Enable per-flag for internal accounts first → 10% of accounts → 50% → 100%. Disable immediately if errors spike.

### 8.4 Database Migration Safety

Database changes are the highest risk. Rules:

1. **Additive only:** New columns/tables/indexes. Never drop or rename in the same deploy.
2. **Backward compatible:** Old code must work with new schema. New code must work with old schema.
3. **Two-phase migration:**
   - Phase A: Add new column (nullable), deploy new code that writes to both old and new
   - Phase B (next deploy): Backfill old rows, switch reads to new column
   - Phase C (later): Drop old column (only after all services updated)
4. **Tested in staging:** Buddy pipeline runs migrations against staging DB with `--dry-run` before production
5. **Manual approval gate:** Production migrations require human approval in Buddy

### 8.5 Specific Migration Sequence

| Step | What | Risk | Rollback |
|------|------|------|----------|
| 1 | Add HNSW index (non-blocking `CONCURRENTLY`) | None — additive, non-locking | DROP INDEX |
| 2 | Add BullMQ tables | None — new tables, no existing code affected | DROP TABLE |
| 3 | Deploy bl-ai-api alongside Directus | None — bl-ai-api is idle until proxied to | Stop bl-ai-api container |
| 4 | Add proxy in Directus AI hook → bl-ai-api | Low — proxy failure falls back to local | Set `ai_service_enabled = false` |
| 5 | Shadow mode: compare responses for 1 week | None — responses logged, not served | Disable shadow logging |
| 6 | Deploy bl-gateway alongside Traefik | None — gateway is idle until DNS points to it | Remove gateway from DNS |
| 7 | Point Cloudflare to bl-gateway (10% traffic) | Medium — gateway handles real traffic | Revert Cloudflare to Traefik |
| 8 | Ramp to 100% through gateway | Medium | Revert Cloudflare |
| 9 | Disable Directus AI proxy, serve from bl-ai-api only | Low — already verified for weeks | Re-enable proxy |
| 10 | Remove AI extension code from Directus | None — code unused | Git revert |

### 8.6 Monitoring During Migration

| Signal | Threshold | Action |
|--------|-----------|--------|
| Error rate (any service) | >1% of requests | Pause rollout, investigate |
| Latency p95 | >2x baseline | Check for misconfiguration |
| AI budget spend | >2x daily average | Verify budget enforcement working |
| Redis memory | >80% of limit | Check for cache key leaks |
| PostgreSQL connections | >80% of pool | Check for connection leaks |
| Coolify health check failures | >3 in 5 minutes | Auto-rollback (Coolify handles this) |

---

## 9. Phased Implementation Timeline

### Phase 0: Foundation (Weeks 1-2)

| Task | Effort | Impact |
|------|--------|--------|
| Add HNSW index (`CREATE INDEX CONCURRENTLY`) | 0.5 day | 25x KB search speed |
| Add BullMQ for KB indexing | 3-5 days | Reliable ingestion |
| Document version hashing | 2 days | 80-90% re-index savings |
| Set up monorepo structure | 2-3 days | Foundation for all future work |
| Set up Terraform for Hetzner | 2 days | Reproducible infrastructure |
| Configure Buddy pipelines (per-service) | 1-2 days | Automated build/deploy |

### Phase 1: bl-ai-api (Weeks 3-6)

| Task | Effort |
|------|--------|
| Scaffold Fastify service, port chat endpoint with SSE | 3-4 days |
| Port 13 tools, KB search/ask, cost tracking | 3-4 days |
| Worker thread pool (from formula-api pattern) | 2-3 days |
| BullMQ ingestion workers with version hashing | 3-4 days |
| 5-layer budget system (from flow engine) | 2-3 days |
| Two-layer cache (LRU + Redis) | 1-2 days |
| Directus proxy mode + shadow testing | 2-3 days |
| Contract tests + integration tests | 2-3 days |

### Phase 2: bl-gateway (Weeks 7-10)

| Task | Effort |
|------|--------|
| Scaffold Go service, reverse proxy with health checks | 3-4 days |
| API key model (PostgreSQL + Redis cache) | 2-3 days |
| Rate limiting (port Lua scripts from formula-api) | 2 days |
| CORS, IP allowlist, request logging | 2-3 days |
| MCP routing | 1-2 days |
| Migrate formula-api public traffic through gateway | 2-3 days |
| Load testing (k6), circuit breaker tuning | 2-3 days |

### Phase 3: Public AI API (Weeks 11-14)

| Task | Effort |
|------|--------|
| OpenAPI spec, API key → account resolution | 2-3 days |
| Public chat endpoint through gateway | 2-3 days |
| Public KB endpoints through gateway | 2-3 days |
| MCP endpoint for KB | 2 days |
| Account-level MCP (unified calc + AI) | 3-4 days |
| TypeScript SDK, documentation | 3-4 days |

### Phase 4: Flow as AI Backend (Weeks 15-20)

| Task | Effort |
|------|--------|
| KB ingestion as flow (local ONNX embeddings) | 2-3 weeks |
| KB search as flow (budget per search) | 1-2 weeks |
| AI chat tool execution as flow | 2-3 weeks |
| Visual editor integration (Phase 6) | 4-6 weeks (parallel) |

### Phase 5: Hardening (Weeks 21-24)

| Task | Effort |
|------|--------|
| OpenTelemetry across all services | 1-2 weeks |
| k6 load testing, performance baselines | 1 week |
| Security audit, dependency scanning | 1 week |
| Chaos testing, runbook documentation | 1 week |

---

## 10. Hetzner Cost Projection

| Tier | Accounts | Monthly | Servers |
|------|----------|---------|---------|
| **Starter** | 1-100 | ~€57 | 5 servers (CX22 + CX22 + CX32 + CX32 + CPX31) |
| **Growth** | 100-500 | ~€120 | Upgrade S4 (AI) to CX42, add second formula node |
| **Scale** | 500-2K | ~€250 | Upgrade S3 (data) to CX52, duplicate S4+S5 |
| **Enterprise** | 2K+ | €500+ | Dedicated hosts, read replicas, multi-region |

---

## 11. Success Criteria

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| AI concurrent users | ~100 | 1,000+ | k6 sustained load test |
| KB search p95 | ~500ms | <50ms | PostgreSQL query logs |
| KB total chunks | ~50K | 5M+ | Production monitoring |
| Embedding cost | $0.02/M tokens | $0 | Monthly billing |
| Crash isolation | AI crash → CMS down | AI crash → only AI | Chaos test: kill bl-ai-api |
| Deploy independence | AI → CMS restart | AI → only AI restart | Buddy deploy logs |
| Infrastructure | €31/mo | €57/mo for 10x | Hetzner billing |
