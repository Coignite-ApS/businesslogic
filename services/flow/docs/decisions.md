# Architecture Decision Records (ADR)

This document records all major technology choices for the BusinessLogic Flow Engine. Each decision includes rationale, alternatives considered, and current status. Decisions are immutable once implemented; changes require a new ADR entry.

## Decision Table

| Decision | Choice | Status | Alternatives Considered | Why This Wins |
|----------|--------|--------|------------------------|---------------|
| **Core language** | Rust 2021 edition | ✓ Confirmed | Go, Node.js, C++ | No garbage collector = predictable <5ms step overhead. WASM-native plugin host. Existing Rust expertise (bl-excel). Single-binary deployment. |
| **Async runtime** | Tokio (multi-threaded) | ✓ Confirmed | async-std, smol, Embassy | Battle-tested work-stealing scheduler. 100K+ concurrent tasks. Largest Rust ecosystem. Axum (our HTTP framework) built on Tokio. |
| **HTTP framework** | Axum | ✓ Confirmed | Actix-web, Warp, Rocket | Tokio-native, composable tower middleware, type-safe extractors, most actively maintained modern framework. Fastest JSON serialization. |
| **Job queue** | Redis Streams | ✓ Confirmed | NATS JetStream, Apache Kafka, Bull.js, RabbitMQ | Already in BusinessLogic stack (Formula API + Directus both use Redis). Consumer groups prevent duplicate processing. Sub-millisecond latency. No new infrastructure. NATS JetStream strong alternative if greenfield project. |
| **DAG library** | petgraph 0.6+ | ✓ Confirmed | daggy, custom recursive descent | Best-in-class Rust graph library. Actively maintained by graph-rs team. Proven at workflow scale (Windmill, Temporal use similar). Rich API for topological sort, DFS, etc. |
| **WASM runtime** | Wasmtime 14+ | ✓ Confirmed | Wasmer, WasmEdge, WASM3 | Standards-first (Component Model support). Exceptional security (cargo vet audited, formal verification research). 3ms cold start, 88% native speed on unoptimized WASM. Used by Fastly, Shopify. |
| **Embedded JavaScript** | QuickJS (rquickjs crate) | ✓ Confirmed | Boa, Deno Core (V8), Node.js embedding | 8-16x faster startup than V8 (ideal for sub-second flows). Light memory footprint (~3MB). Proven in production (Windmill, Nextly). ES2020 compliance sufficient. Boa as future fallback if ES2024+ syntax needed. |
| **PostgreSQL client** | SQLx (async, compile-time verified) | Refined | SeaORM 1.0, Diesel, tokio-postgres raw | Compile-time checked SQL queries (type safety at build time, not runtime). Native async/await. Maximum control over SQL. Performance parity with hand-written. SeaORM 2.0 viable if ORM convenience wins out later. |
| **Redis client** | redis-rs + deadpool pool | ✓ Confirmed | fred, tokio-redis, lapin | Most mature Rust Redis client. Deadpool provides async connection pooling. Full support for Streams and Pub/Sub. Active maintenance. |
| **Serialization (internal)** | MessagePack (rmp-serde) | ✓ Confirmed | bincode, CBOR, JSON | ~2x faster serialization than JSON, ~30% smaller wire format. Serde-compatible (plug-and-play). Human-debuggable (not opaque binary like bincode). Good for Redis keys. |
| **Serialization (HTTP)** | JSON (serde_json) | ✓ Confirmed | MessagePack, Protocol Buffers, CBOR | HTTP standard. Wide client support. Debuggable in browser. Performance acceptable for I/O-bound flows. |
| **Flow editor UI** | Vue Flow (v1.48+) | ✓ Confirmed | Rete.js, custom SVG, Svelvet | Only mature Vue 3 DAG editor. Active community, 1+ releases/month. Integrates natively with Directus (Vue 3). Drag-and-drop, node alignment, panning. |
| **Observability** | tracing + OpenTelemetry + Sentry | ✓ Confirmed | log crate, custom logging, Datadog | Structured logging (fields as JSON). Distributed tracing across Trigger and Worker. Sentry integration for error alerting. No vendor lock-in (OTel standard). |
| **Metrics** | Prometheus (via prometheus crate) | ✓ Confirmed | StatsD, CloudWatch, custom | Standard time-series format. Works with Grafana. Scrape-based (pull) eliminates need for central collector. Active Rust ecosystem. |
| **Secret management** | PostgreSQL pgcrypto (encrypted columns) | ✓ Confirmed | Vault, AWS Secrets Manager, etcd | Secrets live in PostgreSQL with per-secret encryption key. Workers fetch at runtime, never logged. Simpler than external Vault (no new infra). Directus uses same pattern. Can upgrade to Vault if compliance requires. |
| **Configuration** | Env vars + `.env` file (dotenv crate) | ✓ Confirmed | TOML config files, Kubernetes ConfigMap | Standard for Rust services. Works in dev and Docker equally well. Secrets via env vars. No file I/O at startup. |
| **Testing** | cargo test + testcontainers | ✓ Confirmed | Custom Docker setup, mocking | Unit tests in Rust. Integration tests with real PostgreSQL and Redis (testcontainers spins up on demand). Fast iteration in CI. |
| **Formula API integration** | Keep Node.js/Fastify (unchanged) | ✓ Confirmed | Rewrite in Rust, embed bl-excel directly | Heavy compute already in Rust (napi-rs bl-excel). Node.js excels at I/O concurrency. Rewrite not justified. Direct embedding viable future optimization. Current design prioritizes stability. |
| **CLI tooling** | Cargo, cargo-watch, cargo-expand | ✓ Standard | Custom build scripts, Make | Rust standard. cargo-watch for dev. cargo-expand for macro debugging. Familiar to all Rust devs. |
| **Error handling** | Result<T, FlowError> with custom enum | ✓ Confirmed | anyhow, eyre, custom panic | Type-safe error propagation. FlowError variants map cleanly to HTTP status codes and audit trail. No dynamic dispatch. |
| **Versioning** | Semantic versioning (major.minor.patch) | ✓ Standard | Calendar versioning, auto-increment | Communicates API compatibility to consumers. Conventional Commits automation. Aligns with Directus versioning. |
| **Version bumping** | Automatic via `cargo-release` or manual | ✓ Confirmed | Manual git tags, CI automation | Keep `Cargo.toml` and git tags in sync. CI can automate on PR merge. Tag on main points to tested release. |

## Design Principles

These principles guide all architectural decisions and code contributions:

### Predictability Over Intelligence

The Flow Engine's core value is determinism. Given the same flow definition and input data, execution must produce identical results every time. This means:

- No randomization in node selection or evaluation order (except where explicitly random nodes exist).
- Immutable flow definitions stored in PostgreSQL; no runtime hot-reload.
- Comprehensive audit trails log every decision and its context.
- Error recovery is deterministic: retries follow fixed exponential backoff, not dynamic strategies.

This principle applies to AI integration as well. LLM calls are budget-tracked and circuit-broken—intelligence enhances the flow, but the flow structure is predictable.

### Reuse Existing Patterns

Rather than inventing new infrastructure, the Flow Engine reuses proven patterns from the Formula API and Directus:

- **Health push service** — Formula API pushes instance health to Redis periodically. Flow Trigger and Flow Worker do the same.
- **Jump Hash routing** — If multiple Trigger or Worker instances exist, Jump Hash (already in Formula API) determines which job goes to which worker. Consistent hashing, no coordination needed.
- **Rate limiting** — Same Redis-backed per-account rate limiter as Formula API. Account_ID → request quota.
- **Worker pool pattern** — Formula API uses worker threads for isolation. Flow Worker uses a Tokio task pool for the same reason.
- **Error type remapping** — Formula API remaps HyperFormula errors to standard Excel error types. Flow Engine remaps node errors to consistent types.

### Configuration Over Code

Flows replace hardcoded automation logic. Operational changes (adjust retry count, LLM budget, timeout) should not require code deployment. This means:

- All timeouts, retry limits, and budget thresholds are env vars or database-driven.
- Flow definitions are immutable data in PostgreSQL, versioned, and audited.
- Feature flags in flow definitions control behavior without redeployment (e.g., "skip email notifications" flag on a node).

### Three-Tier Node System for Extensibility

Nodes are implemented at three levels, each with trade-offs:

1. **Core nodes** (Rust, compiled in) — Highest performance, shipped with binary. HTTP, condition, loop, transform, formula, vector search, LLM, async task.
2. **Plugin nodes** (WASM) — Write once, run anywhere. Load at runtime. Type-safe via WASM component model. ~10% overhead vs native.
3. **Script nodes** (JavaScript) — Lowest friction for non-Rust developers. QuickJS sandbox. Slowest but acceptable for business logic.

This tiered approach allows:
- Core team to own performance-critical nodes (HTTP, formula).
- Partners to extend safely with WASM plugins (no Rust knowledge needed).
- Users to write simple transforms in JavaScript without deployment.

### Budget-Aware Execution

LLM integration is first-class in the Flow Engine. Costs must be visible and bounded:

- Every LLM call node includes a cost estimate (model, tokens, rate).
- Worker tracks cumulative cost per run. If cost exceeds account budget, circuit breaker stops further LLM calls.
- Execution context includes a `budget_remaining` field; nodes can check and adapt (use cheaper model, skip clarification, etc.).
- All costs are logged per-run and aggregated per-account for billing.

## Deferred Decisions (Future ADRs)

These decisions are intentionally deferred until more information is available:

| Area | Decision | Rationale |
|------|----------|-----------|
| **WASM plugin distribution** | Plugin registry (internal, public, or none) | Depends on adoption. Start with filesystem-based plugins, move to registry if team grows. |
| **Distributed execution** | Work stealing, consistent hashing, or leader-based coordination | Current single-threaded per-worker is sufficient. Revisit at 10K+ flows/sec scale. |
| **Knowledge base chunking** | Recursive splitting, semantic clustering, or fixed-size windows | Depends on document types. Start with recursive splitting, benchmark. |
| **LLM selection** | Use Claude for all, or router per-task | Start with Claude (contract in place). Route if cost or latency demands. |
| **Flow versioning** | Git-based (with sync) or database-only | Database-only for now. Add Git later if branching/merging becomes required. |

## Trade-offs & Known Limitations

### Node Execution is Sequential (Not Parallel)

All nodes in a flow execute on a single worker thread, in topological order. Parallel execution is not supported in v1.

**Why:** Simpler reasoning, deterministic, easier testing. Async I/O (HTTP, DB) provides concurrency within a node.

**Trade-off:** CPU-bound flows with multiple independent branches serialize unnecessarily.

**Future:** Explicit parallel nodes (fan-out/fan-in with Tokio tasks) when demand justifies.

### WASM Cold Start is ~3ms

Wasmtime loads and instantiates WASM modules on first use. Cached modules are much faster (<0.5ms), but first call pays the penalty.

**Why:** WASM is optional. Cache modules in memory after first load.

**Trade-off:** Very latency-sensitive flows with WASM nodes may see a spike on first execution.

**Future:** Pre-warm WASM modules during Trigger startup.

### LLM Costs Are Not Real-Time

Budget tracking and cost aggregation happen asynchronously (after execution completes). A run can exceed budget before it's stopped.

**Why:** Exact token count is unknown until LLM responds. Trade-off: allow slight overage for simplicity.

**Trade-off:** Budget enforcement is "soft" (reactive) not "hard" (preventive).

**Future:** Use cost estimation + hard circuit breaker if necessary.

### No Built-in Version Control for Flows

Flows are immutable in PostgreSQL, but there's no Git-like branching or merging.

**Why:** Simpler architecture. Directus handles audit trail (who changed what, when). Version numbers in database suffice for most use cases.

**Trade-off:** Large teams with multiple parallel flow development may find this limiting.

**Future:** Add Git sync if Directus team or customers demand it.

### Secrets Are Database-Backed, Not External Vault

API keys and credentials are stored encrypted in PostgreSQL, decrypted by workers at runtime.

**Why:** Simpler operations. No new infrastructure (Vault, AWS Secrets Manager). Database is already secured and backed up.

**Trade-off:** Secret rotation is manual. No audit log of secret access.

**Future:** Add Vault integration if compliance (SOC 2, HIPAA) requires it.

## Verification Checklist

When adding a new component or changing a core decision:

- [ ] New choice aligns with "Predictability over Intelligence"
- [ ] Reuse existing patterns from Formula API or Directus where possible
- [ ] Configuration is externalized (env vars, database flags, not hardcoded)
- [ ] If new node type, does it fit the 3-tier system?
- [ ] Budget/cost implications documented (if LLM-related)
- [ ] Error handling is typed (Result<T, E>, not panics)
- [ ] Observable: structured logging, spans, metrics added
- [ ] Tested: unit tests cover normal, edge, and error cases
- [ ] ADR updated or new ADR created if decision differs from this doc

## Historical Notes

**2026-01-15:** Initial ADR created. Rust + Tokio + Axum selected after 2-week evaluation vs. Go/Node.js.

**2026-02-01:** Redis Streams chosen over NATS JetStream (lower ops burden, already in stack).

**2026-02-15:** Wasmtime confirmed after Wasmer evaluation. Security + Component Model support decisive.

**2026-03-01:** QuickJS confirmed for JavaScript. Windmill production validation.

**2026-03-11:** Document published to team. First PR review cycle with new decisions.
