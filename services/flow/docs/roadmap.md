# Roadmap

Comprehensive development roadmap for the BusinessLogic Flow Engine, from crate restructuring through production and beyond.

## Phase Plan

| Phase | Duration | Status | Deliverable |
|-------|----------|--------|------------|
| **0 — Crate Restructure** | 1–2 weeks | Skipped | Formula-core extraction deferred; flow engine uses HTTP calls to Formula API |
| **0.5 — Hetzner Migration** | 1–2 weeks | Complete | 3-server Hetzner topology active |
| **1 — Engine MVP** | 6–8 weeks | Complete (2026-03-07) | Sequential DAG execution, 4 core nodes, Redis Streams, PostgreSQL persistence, Docker + CI/CD |
| **2 — Parallel + Scale** | 4–6 weeks | Complete (2026-03-11), 106 tests | Parallel execution (JoinSet), loops, 9 core nodes, checkpointing, reference tier, XCLAIM recovery |
| **3 — AI Nodes** | 4–6 weeks | Complete (2026-03-11) | LLM, Embedding, Vector Search nodes. Budget system. AI feature flag |
| **4 — WASM + Infra** | 4–6 weeks | Complete (2026-03-12) | WASM plugin host, database/redis nodes, cron scheduler, DB event triggers, execution API |
| **5 — Access Control** | 1–2 weeks | Complete (2026-03-12), 190 tests | RequiredRole system, HMAC webhooks, rate limiting, admin auth, validation API, node types API, account scoping |
| **6 — Directus Editor** | 4–6 weeks | Next | Vue Flow editor, flow API extension, execution monitor |
| **7 — Production Hardening** | 3–4 weeks | Planned | OpenTelemetry, Sentry, load testing, security audit |
| **8 — AI Calculator Builder** | 6–8 weeks | Planned | Project #09 as multi-agent flow |

**Total Timeline:**
- **Months to Production (Phase 5):** 18–26 weeks (~4.5–6.5 months)
- **Full Platform (through Phase 6):** 24–36 weeks (~6–9 months)

## Detailed Phase Breakdown

### Phase 0: Crate Restructure (1–2 weeks)

**Goal:** Extract formula computation into reusable crate. Enable both `businesslogic-excel` (napi) and `businesslogic-flow` to use the same logic.

**Deliverables:**

1. **New Workspace Structure:**
   ```
   /Volumes/Data/Code/businesslogic-excel/
   ├── Cargo.toml (workspace root)
   ├── crates/
   │   ├── formula-core/
   │   │   ├── Cargo.toml
   │   │   ├── src/
   │   │   │   ├── lib.rs
   │   │   │   ├── parser/
   │   │   │   ├── evaluator/
   │   │   │   ├── functions/
   │   │   │   └── types/
   │   │   └── tests/ (all 709 tests moved here)
   │   └── formula-napi/
   │       ├── Cargo.toml
   │       ├── src/
   │       │   └── lib.rs (thin wrapper around formula-core)
   │       └── package.json (napi config)
   └── Cargo.lock
   ```

2. **Module Extraction:**
   - Move `src/parser/`, `src/evaluator/`, `src/functions/` to `crates/formula-core/src/`
   - Keep types, traits, and errors in `crates/formula-core/src/types/`
   - Create public API: `mod parser`, `mod evaluator`, `mod functions`, `mod types` in `formula-core/src/lib.rs`

3. **napi-rs Adapter:**
   - `formula-napi` depends on `formula-core` as local dependency
   - Implements 6 entry points: `eval_single`, `eval_batch`, `eval_sheet`, `create_calculator`, `calculate`, `destroy_calculator`
   - All logic delegated to `formula-core`

4. **Testing:**
   - Run `cargo test --workspace` → all 709 tests pass
   - Side-by-side tests: same inputs to formula-core and napi → identical output
   - Performance: no regression vs. current bl-excel

5. **CI/CD:**
   - GitHub Actions: build both crates, test, publish formula-core to crates.io

**Tasks:**
- [ ] Plan module boundaries and visibility
- [ ] Create workspace Cargo.toml
- [ ] Move formula-core files, update use paths
- [ ] Wrap formula-napi around formula-core
- [ ] Run all tests
- [ ] Update CLAUDE.md with new structure
- [ ] Update CI to build both crates

### Phase 0.5: Hetzner Migration (1–2 weeks, parallel with Phase 0)

**Goal:** Move from DigitalOcean to Hetzner. Improve cost and reliability.

**Infrastructure:**

3 Hetzner Cloud servers:
- **flow-engine-1, flow-engine-2, flow-engine-3:** Rust workers (2 CPU, 4GB RAM, €5/mo each)

**Database:**
- PostgreSQL: Hetzner managed database (HA, backups, monitoring)
- Redis: Hetzner managed Redis (HA, replication)

**Load Balancing:**
- Cloudflare traffic routed via failover (3 A records, health checks)
- Workers register health status every 15s to Redis

**Deployment:**

1. Stand up Hetzner infrastructure
2. Deploy services in blue environment
3. Test: run smoke tests
4. DNS switch: Cloudflare → blue
5. Maintain DO as red environment for 1 week (rollback capability)
6. Decommission DO after stability confirmed

**Cost Savings:**
- DO: 3 VMs + PaaS DB ≈ $45/mo
- Hetzner: 3 servers + managed DB ≈ €15/mo (~$16 USD)

**Tasks:**
- [ ] Provision Hetzner infrastructure
- [ ] Deploy Docker containers
- [ ] Test failover and health push
- [ ] Switch DNS
- [ ] Monitor for 1 week
- [ ] Decommission DO

### Phase 1: Engine MVP (6–8 weeks)

**Goal:** Functional flow execution engine. Single worker, core nodes only.

**Core Nodes:**

1. **HTTP Node**
   - GET/POST/PUT/DELETE with headers, body, auth
   - Request timeout: 30s
   - Retry on 5xx with exponential backoff (max 3 retries)
   - Output: status, headers, body

2. **Transform Node**
   - JavaScript code execution (QuickJS sandbox)
   - Input: JSON object
   - Output: transformed JSON
   - Error: timeout (100ms), memory limit (64MB)

3. **Condition Node**
   - JavaScript boolean expression
   - Input: context
   - Output: true branch → next node(s), false branch → alternative path
   - Multiple conditions (switch-like)

4. **Formula Node**
   - Call formula-core evaluator
   - Input: formula string, variables
   - Output: result or error
   - No WASM yet (direct Rust call)

5. **Script Node**
   - QuickJS sandbox for multi-line scripts
   - Access to context, logger
   - Output: return value or side effects

6. **Start/End Nodes**
   - Entry point for flow
   - Captures input parameters
   - Exit point for result

**Triggers:**

1. **Webhook**
   - POST to `/flows/{flowId}/trigger` with HMAC signature
   - Parameters passed to Start node
   - Returns execution_id immediately

2. **Manual**
   - API call `/flows/{flowId}/trigger` with bearer token
   - Same as webhook but no signature

**Persistence:**

1. **Database** (PostgreSQL):
   - Flows: definitions (graph, trigger config, settings)
   - Executions: audit log (input, output, error, duration)

2. **In-Memory:**
   - Loaded flows cache (LRU, 10K max)
   - Dependency graphs compiled on load

**Architecture:**

```
src/
├── main.rs                      # Tokio server + worker loop
├── engine/
│   ├── executor.rs             # Single-threaded executor
│   ├── nodes/
│   │   ├── mod.rs
│   │   ├── http.rs
│   │   ├── transform.rs
│   │   ├── condition.rs
│   │   ├── formula.rs
│   │   └── script.rs
│   └── graph.rs                # Topological sort, validation
├── persistence/
│   ├── models.rs               # Flow, Execution structs
│   ├── postgres.rs             # SQLx queries
│   └── cache.rs                # LRU flow cache
├── sandbox/
│   ├── quickjs.rs              # QuickJS wrapper
│   └── timeout.rs              # Execution timeout handling
└── server/
    ├── routes.rs               # REST endpoints
    ├── webhook.rs              # Signature verification
    └── error.rs                # Error mapping
```

**Testing:**

- Unit tests for each node type (success, error, timeout)
- Integration tests: execute sample flows
- Side-by-side: same inputs to engine and HyperFormula (formula node) → same output
- Benchmarks: latency per node, memory usage

**Deliverables:**

- [ ] Engine can execute acyclic flows
- [ ] HTTP, Transform, Condition, Formula, Script nodes functional
- [ ] Webhook and manual triggers working
- [ ] Execution history in PostgreSQL
- [ ] Basic error handling (timeouts, exceptions)
- [ ] 95% test coverage
- [ ] Documentation: node reference, API docs

### Phase 2: Parallel + Scale (4–6 weeks)

**Goal:** Multi-worker execution with parallel branches. Full trigger support.

**New Nodes:**

1. **Loop Node**
   - Iterate over array
   - Output: looped executions (parallel)
   - Context: item, index, aggregated results

2. **Aggregate Node**
   - Merge results from parallel branches
   - Combine arrays, sum values, etc.

3. **Delay Node**
   - Sleep for duration (ms, seconds, etc.)
   - Resume execution after delay

4. **Calculator Node**
   - Call formula-api `/execute` endpoint
   - Input: calculator ID, parameters
   - Output: result or error
   - Uses existing per-calculator tokens

5. **Parallel Branch Node** (implicit)
   - Edges from Loop/Condition → multiple downstream nodes
   - Execute in parallel via Tokio tasks

**Triggers:**

1. **Schedule (Cron)**
   - Cron expression (e.g., `0 9 * * *`)
   - Runs at scheduled time, no input parameters
   - Stored in PostgreSQL, sync to trigger service

2. **Event-Based**
   - Trigger on Directus webhook (e.g., calculator.updated)
   - Event data passed as parameters
   - Stored in bl_flows.trigger_config

**Multi-Worker Architecture:**

```
Redis Streams Consumer Group:
- Topic: `flows:pending`
- Group: `flow-workers`
- 3 workers (flow-engine-1, -2, -3) consume from group
- Each worker processes message → executes flow → ACKs
- Unacked messages auto-reclaimed by other workers (XCLAIM)

Message Format:
{
  "execution_id": "uuid",
  "flow_id": "uuid",
  "account_id": "uuid",
  "trigger_data": {...}
}
```

**Parallel Execution:**

```rust
// Loop node with 100 items
let futures = items.iter().map(|item| {
    let context = context.clone().with(item);
    execute_downstream(context)
});

let results = futures::future::join_all(futures).await;
```

**Error Handling:**

1. **Retry Node**
   - Max retries: configurable (default 3)
   - Backoff: exponential (1s, 2s, 4s)
   - Jitter: ±10%

2. **Fallback Node**
   - Alternative path on error
   - Input: error from previous node
   - Output: fallback result or re-error

3. **Abort Node**
   - Stop execution, mark as failed
   - Optional error message

**Checkpointing:**

- After each node completes: snapshot state to Redis hash
- On worker crash: other worker resumes from last checkpoint
- Idempotency: all nodes must be safe to re-execute

**Testing:**

- Loop node: 10-item array, parallel execution
- Parallel branches: time execution, verify concurrency
- Calculator node: call formula-api, verify parity
- Multi-worker failover: kill worker mid-flow, verify recovery
- Stress test: 1000 concurrent flows

**Deliverables:**

- [ ] Multi-worker execution via Redis Streams consumer groups
- [ ] Loop, Aggregate, Delay, Calculator nodes functional
- [ ] Schedule and event-based triggers
- [ ] Error handling: retry, fallback, abort
- [ ] Execution checkpointing
- [ ] 98% test coverage
- [ ] Documentation: advanced flows, trigger setup

### Phase 3: Knowledge + AI Nodes (4–6 weeks)

**Goal:** Enable knowledge base integration and LLM-powered flows.

**New Nodes:**

1. **LLM Node**
   - Providers: OpenAI (GPT-4), Anthropic (Claude), open-source
   - Input: prompt template + variables
   - Output: generated text or structured JSON
   - Budget limit enforced (per-node, per-flow, per-account)
   - Circuit breaker on provider errors
   - Cost tracking: pre-estimate via token limits

2. **Embedding Node**
   - Providers: OpenAI embeddings (1536-dim), open-source
   - Input: text
   - Output: vector (1536 floats)
   - Batch processing for bulk documents

3. **Vector Search Node**
   - Query pgvector with semantic search
   - Input: query embedding
   - Output: top K similar chunks from kb_chunks
   - Integration with pgvector IVFFLAT index

4. **KB Ingest Node**
   - Triggered on kb_documents.created
   - Chunk large documents (e.g., every 500 tokens)
   - Generate embeddings via Embedding node
   - Store chunks in kb_chunks with embedding

**Budget System (5 Layers):**

```
Layer 1: Per-Node Limit (LLM node config)
  max_tokens: 1000
  max_cost: $0.10 per execution

Layer 2: Per-Flow Limit
  max_cost: $1.00 per execution

Layer 3: Per-Account Daily Limit
  daily_budget: $10.00

Layer 4: Per-Account Monthly Limit
  monthly_budget: $100.00

Layer 5: Global Ledger
  track actual spend
  alert at 50%, 80%, 100%
```

**Implementation:**

```rust
// Before LLM node executes:
1. Check Layer 1 (per-node) → sufficient tokens/cost?
2. Check Layer 2 (per-flow) → total cost OK?
3. Check Layer 3 (daily) → account daily budget OK?
4. Check Layer 4 (monthly) → account monthly budget OK?
5. If any layer exceeded: return error, don't call LLM
6. After execution: deduct actual cost from Layers 2–4
```

**Databases:**

```sql
-- Knowledge base documents
CREATE TABLE kb_documents (
  id UUID PRIMARY KEY,
  account_id UUID,
  source_uri VARCHAR(500),
  title VARCHAR(255),
  content TEXT,
  created_at TIMESTAMP
);

-- Embedding chunks
CREATE TABLE kb_chunks (
  id UUID PRIMARY KEY,
  document_id UUID,
  account_id UUID,
  content TEXT,
  embedding vector(1536),
  created_at TIMESTAMP
);

CREATE INDEX ON kb_chunks USING ivfflat (embedding vector_cosine_ops);
```

**Flows as Deliverables (Projects #12 & #13):**

1. **Project #12 — KB Ingest Flow:**
   - Trigger: kb_documents.created
   - Nodes: Document Splitter → Embedding → Store in kb_chunks
   - Cost: ~$0.002 per 1000 tokens

2. **Project #13 — KB Retrieval Flow:**
   - Trigger: manual or external
   - Input: query text
   - Nodes: Embedding → Vector Search → Format Results
   - Output: cited answer from documents

**Testing:**

- LLM node: mock API, verify prompt formatting
- Embedding node: verify vector dimensions
- Vector Search: pgvector query correctness
- Budget system: simulate spending, verify limits enforced
- KB ingest/retrieval flows: end-to-end test

**Deliverables:**

- [ ] LLM, Embedding, Vector Search nodes functional
- [ ] 5-layer budget system enforced
- [ ] pgvector integration tested
- [ ] KB ingest and retrieval flows delivered as first "product flows"
- [ ] Projects #12 and #13 complete
- [ ] Cost tracking accurate to $0.0001
- [ ] OpenTelemetry tracing for cost analysis

### Phase 4: Plugins + UI (4–6 weeks)

**Goal:** Custom node plugins and visual flow editor.

**WASM Plugin System:**

```rust
// Plugin interface (exported from WASM module)
#[no_mangle]
pub extern "C" fn execute(
    input: *const u8,
    input_len: usize,
    context: *const u8,
    context_len: usize,
) -> *const u8 {
    // Deserialize input, process, return output
}
```

**Wasmtime Host:**

```rust
use wasmtime::{Engine, Instance, Linker, Module, Store};

// Load plugin
let plugin = std::fs::read("user_plugin.wasm")?;
let module = Module::new(&engine, plugin)?;
let instance = Instance::new(&mut store, &module, &linker)?;

// Execute with timeout
let result = tokio::time::timeout(
    Duration::from_millis(100),
    async { instance.get_typed_func::<(i32, i32), i32>(&mut store, "execute")? }
).await?;
```

**Plugin SDK:**

Rust template with macros for easy node authoring:

```rust
use businesslogic_flow::plugin::{Node, Input, Output};

#[derive(Node)]
pub struct MyCustomNode {
    #[input]
    pub text: String,
    #[config]
    pub multiplier: u32,
}

#[action]
impl MyCustomNode {
    pub async fn execute(&self) -> Result<Output> {
        Ok(Output {
            result: self.text.repeat(self.multiplier as usize),
        })
    }
}
```

**Directus Flow Editor Extension:**

```
project-extension-flows/
├── FlowEditor.vue              # Main canvas
├── NodePalette.vue             # Drag-and-drop nodes (categorized)
├── NodePanel.vue               # Dynamic config forms
├── ExecutionMonitor.vue        # Real-time status overlay
└── composables/
    ├── useFlow.ts              # Flow CRUD
    ├── useFlowExecution.ts     # SSE connection
    └── useNodeTypes.ts         # Load bl_node_types
```

**Features:**

1. **Visual Editor:**
   - Drag nodes from palette
   - Connect edges (type validation)
   - Pan, zoom, minimap
   - Auto-layout suggestions
   - Copy/paste templates

2. **Node Configuration:**
   - Dynamic forms generated from `bl_node_types.settings_schema`
   - Real-time validation
   - Inline documentation

3. **Execution Monitor:**
   - Live overlay on canvas during execution
   - Node status: pending (gray), running (blue), complete (green), error (red)
   - Click node → see output and error
   - Execution history sidebar

4. **Deployment:**
   - Validate graph (cycle check, port types)
   - Deploy button → activate flow
   - Auto-save draft

**Flow API Extension:**

Routes for deployment and execution:
- `POST /flows/{flowId}/deploy` — validate + activate
- `POST /flows/{flowId}/trigger` — manual execution
- `GET /flows/{flowId}/executions/{executionId}/stream` — SSE status

Hooks for:
- Graph validation on save
- Node type sync on startup
- Webhook integration

**Testing:**

- Plugin: write sample WASM node, test execution
- Editor: drag-drop, validate graph, execute
- Monitor: real-time status updates via SSE
- API: deployment and execution flows

**Deliverables:**

- [ ] WASM plugin system functional
- [ ] Plugin SDK with examples
- [ ] Directus flow editor deployed
- [ ] Flow API extension with routes + hooks
- [ ] Execution monitor with real-time updates
- [ ] 100% test coverage
- [ ] Plugin documentation and tutorials

### Phase 5: Production Hardening (3–4 weeks)

**Goal:** Enterprise-ready deployment, monitoring, and security.

**Observability:**

1. **OpenTelemetry:**
   - Structured logging to stdout
   - Traces: per-execution, per-node
   - Metrics: execution count, error rate, latency, cost
   - Exporters: Jaeger (local dev), cloud provider (prod)

2. **Sentry Integration:**
   - Error tracking for unhandled exceptions
   - Performance monitoring (transaction sampling)
   - Release tracking

3. **Metrics Export:**
   - Prometheus format
   - Dashboards: Grafana
   - Alerts: PagerDuty (error rate > 5%, cost anomaly, worker down)

**Rate Limiting & Quota:**

1. **Webhook Endpoint:**
   - Per-IP: 10 req/sec
   - Per-account: 1000 req/sec

2. **Trigger API:**
   - Per-account: 100 req/sec

3. **Monthly Quota:**
   - Free: 1K executions/month
   - Pro: 10K executions/month
   - Enterprise: unlimited

**Load Testing:**

- Goal: sustain 1M ops/day (11.6 ops/sec sustained)
- Tools: k6 or locust
- Scenarios:
  - Constant load: 100 concurrent flows
  - Spike: 1000 concurrent flows
  - Soak: 1000 ops/sec for 1 hour

**Security Audit:**

1. Internal:
   - Code review for auth/WASM/sandboxing
   - Threat model validation
   - Dependency audit (cargo vet)

2. External:
   - Penetration testing by contractor
   - OWASP top 10 checklist
   - Formal security assessment

**Documentation:**

- Node reference: all node types, inputs/outputs, error codes
- API reference: all endpoints, request/response shapes
- Deployment guide: Hetzner, Docker, environment variables
- Security guide: threat model, credential management, audit logging
- Plugins: SDK guide, example plugin, testing
- Operational runbook: health checks, incident response, scaling

**Deployment Checklist:**

- [ ] All tests passing (100% coverage)
- [ ] OpenTelemetry integrated
- [ ] Sentry configured
- [ ] Rate limiting tested
- [ ] Load test passed (1M ops/day)
- [ ] Security audit passed
- [ ] Documentation complete
- [ ] Runbook reviewed and practiced
- [ ] On-call rotation configured
- [ ] Incident response plan reviewed

**Deliverables:**

- [ ] Production-ready deployment
- [ ] Enterprise SLA monitoring
- [ ] Full documentation suite
- [ ] Security certification (pass audit)

### Phase 6: AI Calculator Builder (6–8 weeks)

**Goal:** Implement Project #09 as a multi-agent flow using LLM nodes.

**Architecture:**

```
Flow: "AI Calculator Builder"
├── [Start] Input: requirements (text)
├── [LLM] Parse Requirements → structured spec
├── [Parallel]
│   ├── [LLM] Design Calculations
│   ├── [LLM] Design UI Layout
│   └── [LLM] Design Validation Rules
├── [Aggregate] Merge designs
├── [LLM] Build Calculator (prompt with all designs)
├── [Transform] Format output (JSON)
├── [HTTP] POST to /calculators/new (create)
├── [LLM] Generate Preview Code
├── [End] Output: calculator + preview
```

**Key Nodes:**

- **LLM Orchestrator Node:** Coordinates multi-agent LLM calls
- **Cost Control Node:** Tracks spend across all LLMs, enforces budget
- **Web Search Node:** Research user requirements, validate design patterns

**Budget Control:**

- Per-run budget: $0.50 (typical run uses $0.10–0.30)
- Circuit breaker: if LLM error > 3x, halt and manual review

**Deliverables:**

- [ ] Multi-agent orchestration working
- [ ] Calculator generation end-to-end tested
- [ ] Cost tracking accurate and within budget
- [ ] Preview feature working
- [ ] Project #09 delivered as a flow
- [ ] Full integration test with formula-api

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **formula-core extraction breaks napi compatibility** | Low | High | All 709 API tests validate extraction. Extraction is mostly file moves + use path updates. Build script smoke test in CI. |
| **Hetzner migration causes downtime** | Medium | Medium | Blue-green deployment: stand up Hetzner fully, run smoke tests, DNS switch. Keep DO as rollback for 1 week. Announce maintenance window. |
| **WASM plugin cold start too slow** | Low | Low | 3ms cold start acceptable. Pre-warm plugins on worker startup for high-traffic accounts. Cache module instances in LRU. |
| **Redis Stream data loss** | Low | Medium | AOF persistence enabled (fsync every second). Flow definitions stored in PostgreSQL (source of truth). Executions replayable from trigger data. Test recovery procedures. |
| **LLM costs exceed budget** | Medium | Medium | 5-layer budget system strictly enforced. Circuit breaker on provider errors. Pre-estimates via token limits. Monthly alerts at 50%, 80%, 100%. |
| **Vue Flow doesn't meet UX needs** | Medium | Medium | Only mature Vue 3 option available. Custom node rendering fully supported. Worst case: fallback to custom SVG/Canvas rendering. UX testing early in Phase 4. |
| **PostgreSQL contention under load** | Low | Medium | Connection pooling via pgBouncer (100 connections). Read replicas for analytics queries. pgvector on separate schema/indexes. Monitor query times. |
| **LLM provider rate limiting** | Medium | Low | Exponential backoff in LLM node. Circuit breaker opens on 429 responses. Queue pending requests with priority. Alert on breaker state. |
| **Worker memory leak over time** | Low | High | Periodic health checks for RSS growth. Auto-restart workers weekly. Rust memory safety prevents most leaks. Use valgrind in CI for regression testing. |
| **Audit log grows too large** | Low | Low | Archive executions >90 days to cold storage (S3). Index on flow_id + created_at for fast filtering. Partition by time if needed. |

## Success Criteria

### Phase 1 Complete (2026-03-07)
- Sequential DAG execution, topological sort, back-edge loops
- 4 core nodes: noop, http_request, transform, condition
- Webhook + manual triggers
- Redis Streams job queue, PostgreSQL persistence
- Docker + CI/CD (GHCR)

### Phase 2 Complete (2026-03-11, 106 tests)
- Parallel execution via Tokio JoinSet
- 5 new nodes: formula_eval, calculator, loop, delay, aggregate
- Script node (QuickJS, behind `scripting` feature flag)
- CancellationToken propagation, reference tier (>64KB → Redis msgpack)
- Checkpointing (Redis HASH), XCLAIM recovery (XAUTOCLAIM every 60s)
- Budget pre-estimation via estimated_cost_usd

### Phase 3 Complete (2026-03-11)
- LLM, Embedding, Vector Search nodes (behind `ai-nodes` feature flag)
- 5-layer budget system enforced
- Provider abstraction for OpenAI/Anthropic

### Phase 4 Complete (2026-03-12)
- WASM plugin host (Wasmtime, behind `wasm-plugins` feature flag)
- Database + Redis nodes (require connection pools)
- Cron scheduler (60s poll, Redis SETNX dedup)
- DB event triggers (PostgreSQL LISTEN/NOTIFY)
- Execution status API (GET/SSE)

### Phase 5 — Access Control Complete (2026-03-12, 190 tests)
- RequiredRole system (`Any`/`Admin`) on node types
- Flow permission validation (`validation.rs`)
- HMAC-SHA256 webhook verification (X-Signature, X-Timestamp, 5min replay window)
- Per-account rate limiting (RPS + monthly via Redis)
- Admin auth (`X-Admin-Token` header)
- `POST /flows/validate` and `GET /node-types` endpoints
- Account-scoped execution queries
- `bl_node_permissions` table, `created_by`/`updated_by` on bl_flows

### Phase 6 (Next — Directus Editor)
- Vue Flow editor fully functional
- Execution monitor shows real-time status
- Flow API extension routes + hooks deployed

### Phase 7 (Planned — Production Hardening)
- OpenTelemetry + Sentry operational
- Load test passed (1M ops/day)
- Security audit passed
- Full documentation suite

### Phase 8 (Planned — AI Builder)
- Project #09 delivered as flow
- Multi-agent orchestration working
- Cost tracking accurate
- End-to-end integration tested

## Dependencies on Other Projects

### businesslogic-excel (formula-core extraction)

**Dependency:** Phase 1 blocked until formula-core crate exists.

**Action:**
- Coordinate with CTO to plan Phase 0 extraction
- Target: formula-core published on crates.io by end of Phase 0
- Flow engine adds dependency: `formula-core = { version = "0.x", path = "../businesslogic-excel/crates/formula-core" }` or crates.io

### excel-formula-api (Formula API)

**Dependency:** Phase 2 (Calculator node) requires formula-api running.

**Action:**
- No breaking changes to formula-api
- Calculator node calls existing `/execute` endpoint
- Uses per-calculator tokens (already implemented)
- Integration test: flow with Calculator node → verify results match direct API call

### businesslogic-cms (Directus extensions)

**Dependency:** Phase 4 (UI) requires Directus extensions built.

**Action:**
- New extensions: `project-extension-flows` and `project-extension-flow-api`
- Follow existing extension patterns: TypeScript, Directus SDK, `directus-extension build`
- Deploy with Directus (Docker image)

## Metrics & KPIs

Track throughout development:

1. **Execution Performance:**
   - Per-node overhead: <5ms (excluding I/O)
   - End-to-end latency: <500ms (typical 5-node flow)

2. **Cost Control:**
   - Budget accuracy: ±0.1% actual vs. estimated
   - Cost per execution: <$0.01 for non-LLM flows

3. **Reliability:**
   - Zero unplanned downtime post-Phase 5
   - Error rate: <1% for user flows
   - Worker health: 99.9% uptime

4. **User Experience:**
   - Flow creation time: <5 minutes (simple flow)
   - Visual editor UX score: >4/5 (user feedback)
   - Documentation completeness: 100%

5. **Security:**
   - Vulnerabilities found by audit: 0 critical, <3 high
   - Incident response time: <15 minutes to mitigation
   - Account isolation tests: 100% pass rate

## Contingencies

### If formula-core extraction takes longer than 2 weeks

**Impact:** Phase 1 delayed by 1–2 weeks.

**Mitigation:**
- Parallelize: start engine design in Phase 0.5 (low-priority)
- Use temporary formula-napi wrapper until formula-core ready
- Accelerate Phase 1 with dedicated eng resources

### If Vue Flow doesn't meet UI needs

**Impact:** Phase 4 delayed by 2–4 weeks.

**Mitigation:**
- Fallback: custom SVG renderer for canvas (lower fidelity, but functional)
- Alternative: use another Vue 3 library (harder to find, but possible)
- Worst case: web-based editor in separate service (REST API only, no visual)

### If LLM costs exceed projections

**Impact:** Pricing model needs adjustment, customer communication.

**Mitigation:**
- Prompt caching reduces cost 90% (implement early in Phase 3)
- Open-source LLM option (Llama, Mistral) for cost-sensitive customers
- Monthly cost alerts and circuit breaker prevent surprises

### If Hetzner migration encounters issues

**Impact:** Rollback to DO, delay Phase 0.5 by 1 week.

**Mitigation:**
- Keep DO running for 2–3 weeks (not 1)
- Test DNS failover extensively before cutover
- Document rollback procedure in runbook
