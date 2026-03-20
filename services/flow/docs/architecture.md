# BusinessLogic Flow Engine — System Architecture

## System Overview

The Flow Engine is an ultra-fast Rust workflow orchestration system designed for businesslogic.online. It replaces scattered, hard-to-maintain standalone code with visual, configurable flows that are version-controlled, tested, and executed at scale.

The Flow Engine sits alongside three other core platform components:

- **Directus CMS** (Server 1) — Admin UI for workflow design, user management, and content editing
- **Excel Formula API** (Server 3) — Handles all calculation operations via napi-rs Rust bindings (formerly HyperFormula)
- **Formula Core / bl-excel** (Server 3, embedded) — Pure Rust Excel formula engine for high-throughput calculation
- **Flow Engine** (Server 3) — Orchestrates automation, AI pipelines, knowledge base operations, and business logic

The platform's core principle is predictability: same inputs always produce the same outputs. The Flow Engine enforces this through deterministic DAG execution, immutable flow definitions, and comprehensive audit trails.

## System Topology & Deployment

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Cloudflare (DNS + CDN + WAF + TLS)              │
└─────────────────────────────────────────────────────────────────────┘
         │                           │                          │
         ↓                           ↓                          ↓
    Server 1                    Server 2                  Server 3
    (Admin)                     (Data)                    (Compute)
    ─────────────────────────────────────────────────────────────────
    Coolify                     PostgreSQL 16             Formula API
    Traefik                     + pgvector                (Node.js/Fastify)
    Directus                    :5432 (private)           :3000
    (Vue + API)
    :8055                       Redis 7                   Flow Trigger
                                :6379 (private)           (Rust/Axum)
                                                          :3100

                                                          Flow Workers
                                                          (Rust/Tokio)
                                                          Multi-threaded
                                                          consumer group

    ┌──────────────────────────────────────────────────────────────┐
    │  Hetzner Private Network (10.0.0.0/16) — Data + Pub/Sub only │
    └──────────────────────────────────────────────────────────────┘
```

**Network Configuration:**
- Server 1 (Admin) connects to Servers 2 & 3 via VPN overlay or jump host
- Server 2 (Data) is private network only — no direct internet access
- Server 3 (Compute) has single public IP for inbound traffic; connects to Server 2 over private network
- Cloudflare sits in front of all public endpoints for DDoS protection, WAF, and TLS termination

## Component Architecture

```
┌────────────────────────────────┐
│    Directus CMS (Server 1)     │
│   ┌──────────────────────────┐ │
│   │ Flow Designer UI (Vue)   │ │
│   │ User Management          │ │
│   │ Content Editing          │ │
│   └──────────────┬───────────┘ │
│                  │ REST API     │
└──────────────────┼──────────────┘
                   │
              (HTTP/REST)
                   │
     ┌─────────────┴──────────────┐
     ↓                            ↓
┌──────────────────────────┐  ┌──────────────────────────┐
│  PostgreSQL 16 (Server 2)│  │  Redis 7 (Server 2)      │
│  ┌────────────────────┐  │  │  ┌────────────────────┐  │
│  │ Flow definitions   │  │  │  │ Streams (Job Q)    │  │
│  │ Execution history  │  │  │  │ PubSub (Events)    │  │
│  │ pgvector (KB)      │  │  │  │ Cache + Sessions   │  │
│  │ Audit log          │  │  │  │ Consumer groups    │  │
│  └────────────────────┘  │  │  └────────────────────┘  │
└──────────────────────────┘  └──────────────────────────┘
     ↑                            ↑         ↓
     │                            │         │
     └────────────────────────────┴─────────┘
              (Private Network)
                   ↑ │
         ┌─────────┘ │
         │           ↓
     ┌────────────────────────────────────────────────────┐
     │           Server 3 (Compute)                       │
     │  ┌────────────────────────────────────────────┐   │
     │  │ Flow Trigger (Axum HTTP Server)            │   │
     │  │ :3100                                      │   │
     │  │ • HTTP API: CreateRun, TriggerRun          │   │
     │  │ • Redis Streams producer                   │   │
     │  │ • Auth + rate limiting                     │   │
     │  └────────────────────────────────────────────┘   │
     │           │                                        │
     │           ↓ (Redis Streams)                        │
     │  ┌────────────────────────────────────────────┐   │
     │  │ Flow Workers (Tokio multi-threaded)        │   │
     │  │ • Redis Streams consumer group             │   │
     │  │ • Calls flow-engine DAG executor           │   │
     │  │ • Handles retries, circuit breakers        │   │
     │  │ • Budget tracking (LLM cost limits)        │   │
     │  └────────────────────────────────────────────┘   │
     │           │                                        │
     │           ↓                                        │
     │  ┌────────────────────────────────────────────┐   │
     │  │ Formula API (Node.js/Fastify)              │   │
     │  │ :3000                                      │   │
     │  │ • Calculator CRUD + execute (unchanged)   │   │
     │  │ • MCP tools (unchanged)                    │   │
     │  └────────────────────────────────────────────┘   │
     │           │                                        │
     │           ↓ (via napi-rs)                         │
     │  ┌────────────────────────────────────────────┐   │
     │  │ Formula Core (Rust) — bl-excel             │   │
     │  │ • Excel function evaluation                │   │
     │  │ • Cell reference resolution                │   │
     │  │ • Cycle detection                          │   │
     │  └────────────────────────────────────────────┘   │
     │                                                    │
     └────────────────────────────────────────────────────┘
```

**Data Flow for a Typical Execution:**

1. User triggers a flow via Directus UI or HTTP API to Flow Trigger
2. Flow Trigger validates request, checks rate limits, and publishes to Redis Streams
3. Flow Worker(s) pull from consumer group, lock execution, and fetch flow definition from PostgreSQL
4. Worker executes the DAG: evaluates each node, handles branching, may call Formula API for calculations
5. During execution, worker tracks: duration, node outputs, LLM cost, errors, and persists to PostgreSQL
6. Worker publishes completion event to Redis Streams (for live UI updates via Server 1)
7. Results stored in PostgreSQL; Client retrieves via REST API with eventual consistency

## Cargo Workspace Structure

The Flow Engine is organized as a **single Cargo workspace** with four independent crates, each with a specific responsibility.

```
businesslogic-flow/
├── Cargo.toml                    # Workspace root (members + shared deps)
├── Cargo.lock                    # Locked dependencies
├── docs/                         # Architecture, decisions, design patterns
├── flow-common/                  # Shared types and traits
│   ├── src/
│   │   ├── lib.rs               # Public API
│   │   ├── types/               # CellAddress, NodeId, RunId, FlowError
│   │   ├── node.rs              # Node definition, input/output schema
│   │   ├── dag.rs               # DAG structure, topological operations
│   │   └── serde.rs             # MessagePack + JSON serialization
│   └── Cargo.toml
│
├── flow-engine/                  # DAG executor and node registry
│   ├── src/
│   │   ├── lib.rs               # Public API
│   │   ├── executor/mod.rs      # DAG parallel execution (JoinSet)
│   │   ├── dag.rs               # DAG building, topological sort
│   │   ├── state.rs             # Execution state, reference tier
│   │   ├── validation.rs        # Flow permission validation (RequiredRole checks)
│   │   ├── nodes/               # Built-in node implementations
│   │   │   ├── mod.rs           # NodeRegistry (handlers + metadata HashMaps)
│   │   │   ├── noop.rs          # Pass-through
│   │   │   ├── http_request.rs  # HTTP client
│   │   │   ├── condition.rs     # If/Then/Else branching
│   │   │   ├── loop_node.rs     # For/While loops with iterations
│   │   │   ├── transform.rs     # JSON path, templating, type coercion
│   │   │   ├── formula.rs       # formula_eval + calculator nodes
│   │   │   ├── database.rs      # PostgreSQL queries (Admin only)
│   │   │   ├── redis_node.rs    # Redis operations (Admin only)
│   │   │   ├── delay.rs         # Timed delays
│   │   │   ├── aggregate.rs     # Collect/merge/reduce
│   │   │   ├── expression.rs    # Shared expression resolver
│   │   │   ├── script.rs        # QuickJS sandbox (feature: scripting)
│   │   │   └── ai/              # AI nodes (feature: ai-nodes)
│   │   │       ├── llm.rs       # LLM calls (Claude, GPT, Gemini)
│   │   │       ├── embedding.rs # Vector embeddings
│   │   │       └── vector_search.rs # pgvector search
│   │   └── plugins/             # Plugin host (feature: wasm-plugins)
│   │       ├── wasmtime.rs      # Wasmtime WASM runtime
│   │       └── loader.rs        # WASM module discovery and loading
│   └── Cargo.toml
│
├── flow-trigger/                 # HTTP API + Redis Streams producer
│   ├── src/
│   │   ├── main.rs              # Axum app setup, routes, handlers, background tasks
│   │   └── rate_limit.rs        # Per-account RPS + monthly Redis counters
│   └── Cargo.toml
│
├── flow-worker/                  # Redis Streams consumer + executor
│   ├── src/
│   │   ├── main.rs              # Worker startup, signal handling
│   │   ├── config.rs            # Env vars, POOL_SIZE, timeout
│   │   ├── worker.rs            # Main loop: pull, execute, ack
│   │   ├── executor_bridge.rs   # Call flow-engine, handle results
│   │   ├── db.rs                # PostgreSQL queries, run updates
│   │   ├── redis.rs             # Streams, consumer group, events
│   │   ├── budget.rs            # LLM cost tracking, circuit breaker
│   │   ├── retry.rs             # Exponential backoff, max attempts
│   │   └── errors.rs            # Worker-specific error handling
│   └── Cargo.toml
│
└── formula-core/                 # FUTURE: Extracted from bl-excel
    ├── src/
    │   ├── lib.rs               # Formula evaluation
    │   └── ...                  # (Same structure as bl-excel)
    └── Cargo.toml
```

## Crate Dependency Graph

```
flow-trigger ─────┐
                  │
                  └─→ flow-common
                  ↗
flow-worker ─────┤
                  │
                  └─→ flow-engine
                      │
                      ├─→ flow-common
                      │
                      └─→ formula-core (future)

Legend:
─→ depends on
```

**Detailed Dependency Rationale:**

- **flow-common** has zero async/I/O dependencies. It's purely data structures, making it a stable foundation that can be safely used in any async runtime or even synchronous code.
- **flow-engine** depends on flow-common only. The DAG executor is pure logic, making it testable in isolation. Formula integration happens via trait (formula-core is optional).
- **flow-trigger** depends on flow-common for data types. It's the public HTTP boundary—routes, handlers, and serialization. No DAG execution logic.
- **flow-worker** ties everything together: it pulls jobs from Redis, calls flow-engine to execute, and updates PostgreSQL. It's where async I/O orchestration happens.
- **formula-core** (future) will be extracted from bl-excel. When available, both flow-engine and flow-worker will depend on it for local formula evaluation.

## Feature Flags

Feature flags allow conditional compilation and dependency inclusion, keeping the binary size minimal for use cases that don't need all components.

**flow-engine features:**

- `core-nodes` (default, enabled) — Includes all built-in node implementations (HTTP, condition, loop, transform, formula, vector search, LLM, async task). Disable if you want to supply only custom WASM nodes.
- `wasm-plugins` (default, enabled) — Wasmtime WASM runtime for plugin nodes. Adds ~2MB to binary. Disable for environments where WASM is not needed.
- `scripting` (disabled by default) — QuickJS JavaScript engine for inline scripts. Adds ~500KB. Enable only if flows require embedded JS.

**Example usage in Cargo.toml:**

```toml
# Minimal: core engine only, no plugins
businesslogic-flow = { path = "flow-engine", default-features = false }

# Production: all features enabled
businesslogic-flow = { path = "flow-engine", features = ["core-nodes", "wasm-plugins", "scripting"] }
```

**flow-trigger and flow-worker** have no public feature flags, but they implicitly inherit flow-engine's flags through their dependencies.

## How the Flow Engine Fits in the Platform

The BusinessLogic platform has four major subsystems, each with a distinct responsibility:

1. **Directus CMS (Server 1)** — Admin UI, user management, content editing. Pure Node.js/Vue. Makes REST calls to downstream systems.
2. **Formula API (Server 3, Node.js)** — Handles API requests for calculator CRUD, formula evaluation, and MCP tool exposure. Already optimized for I/O with worker pools. Calculation heavy-lifting delegated to bl-excel (Rust napi-rs).
3. **Flow Engine (Server 3, Rust)** — New. Orchestrates automation, AI pipelines, and knowledge base operations. Calls Formula API for calculations, PostgreSQL for state, and LLM APIs for intelligence.
4. **Excel Formula Engine / bl-excel (Server 3, Rust)** — Handles all cell-level computation via napi-rs bindings. Called by Formula API and (eventually) flow-worker.

**Why not rewrite Formula API in Rust?** Formula API is already heavily optimized for the job it does: handle HTTP I/O concurrency with worker pools. The expensive computation (formula evaluation) is already pushed down to Rust (bl-excel). A complete Node.js-to-Rust rewrite would sacrifice proven reliability for marginal gains. Instead, we add the Flow Engine as a new capability.

**What does the Flow Engine handle that Formula API doesn't?**

- Complex multi-step workflows with branching, looping, and state management
- AI integration (Claude, GPT, etc.) with cost tracking and circuit breakers
- Knowledge base operations (pgvector semantic search, document chunking, citation)
- Long-running async operations (webhooks, background jobs, polling)
- Event-driven triggers (HTTP, timer, database change)

**What stays in Formula API?**

- Calculator CRUD, formula parsing, error remapping
- MCP tool exposure (unchanged)
- Sheet evaluation (single, batch, multi-sheet)
- Cycle resolution, named expressions
- Performance is critical here; the API is stateless and optimized for throughput

**Flow Engine + Formula API Together:**

When a flow needs to evaluate a formula, the flow-worker makes an HTTP call to Formula API (:3000). This decouples concerns: Formula API stays a pure HTTP service, Flow Engine handles orchestration logic. If Formula API goes down, flows can fail gracefully with retries and circuit breakers.

Alternatively, in a future optimization, formula-core (extracted from bl-excel) could be compiled into flow-engine directly, eliminating the HTTP round-trip. But this is a future refinement; the current design prioritizes stability and separation of concerns.

## Data Consistency & Ordering Guarantees

The Flow Engine operates with eventual consistency across three persistence layers:

1. **PostgreSQL (strong consistency)** — Flow definitions, execution history, audit log. Single source of truth.
2. **Redis Streams (at-least-once semantics)** — Job queue. Messages stay in stream until consumer acknowledges. Consumer group ensures no duplicate processing per logical worker group.
3. **Redis Pub/Sub (at-most-once, live updates)** — Flow progress events for browser UI. If a client misses an event, they can fetch full state from PostgreSQL.

**Execution Ordering:**

- All nodes in a flow execute in topological order (predecessors before successors).
- Within a node, inputs are resolved sequentially.
- Parallel node execution is not supported in v1; all nodes run on a single worker thread (simpler reasoning, easier testing).
- Future versions may support explicit parallel nodes with Tokio task spawning and join semantics.

**Idempotency & Retries:**

- Each execution (Run) has a unique ID (UUID) and is stored in PostgreSQL before execution begins.
- If a worker crashes mid-execution, another worker can pick up the same job from Redis Streams (by redelivering the message).
- Nodes must be idempotent or declare themselves non-idempotent (flag in node definition). Non-idempotent nodes abort the flow if encountered during a retry.
- LLM calls include a run-scoped ID to prevent duplicate charges during retries.

## Security Model

The Flow Engine enforces security at multiple levels:

1. **Authentication (Directus)** — All flows and runs are associated with a user. Flow access is controlled via Directus role-based access control.
2. **Authorization (Flow Trigger)** — Flow Trigger validates JWT tokens from Directus. Only flows the user has access to can be triggered.
3. **Sandbox (Execution)** — Built-in nodes are type-safe and bounded. WASM and JavaScript nodes run in sandboxed runtimes with resource limits (memory, CPU time).
4. **Secret Management** — API keys, LLM credentials, and database passwords stored in PostgreSQL (encrypted at rest via pgcrypto). Workers fetch decrypted secrets at runtime, never logged.
5. **Audit Trail** — Every execution, decision, and error is logged with timestamps, user ID, and node context.

## Observability & Monitoring

The Flow Engine is designed for deep visibility:

1. **Structured Logging** — All logs use `tracing` crate with structured fields (flow_id, run_id, node_id, duration_ms, error). Sent to Sentry for error tracking.
2. **Distributed Tracing** — OpenTelemetry instrumentation across flow-trigger and flow-worker. Each run generates a trace span with child spans per node.
3. **Metrics** — Prometheus-compatible metrics: execution count, duration histogram, error rate, queue depth, worker utilization.
4. **Health Checks** — Flow Trigger and Flow Worker expose `/health` endpoints. Health push service updates Redis with instance status periodically.

## Performance Characteristics

Based on design and initial benchmarks:

- **Node execution overhead:** <5ms per node (DAG dispatch + input resolution + output storage)
- **HTTP node round-trip:** ~50-200ms (network + server processing)
- **LLM API call:** 1-30s (depends on prompt and model)
- **Formula evaluation:** <10ms per formula (already optimized in bl-excel)
- **Flow throughput (single worker):** ~100-500 flows/second (mostly I/O-bound, depends on node types)
- **Worker pool:** Scales linearly with CPU count. 16-core machine handles ~8000 flows/second (assuming mix of fast nodes)
- **Memory per run:** ~100KB (flow definition + execution state). 100K concurrent flows = ~10GB.

## Future Extensibility

The Flow Engine is designed to grow:

1. **Parallel nodes** — Tokio task group for fan-out/fan-in patterns
2. **Subflows** — Flows calling other flows (recursion with depth limit)
3. **Custom node library** — Built on WASM plugin host for type-safe extensibility
4. **Database triggers** — PostgreSQL logical replication → Flow Trigger (database-driven workflows)
5. **Knowledge base agent** — Agentic loop: query KB, evaluate, refine, loop until answer
6. **Formula core extraction** — Move bl-excel into flow-engine for direct (non-HTTP) formula evaluation
7. **Distributed execution** — Flows split across multiple workers with work stealing and load balancing

None of these require architectural changes; they're natural extensions of the current design.
