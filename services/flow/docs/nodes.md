# Node System Documentation

BusinessLogic Flow Engine uses a three-tier node architecture to enable executable workflow logic with varying performance/complexity tradeoffs.

## Three-Tier Node Architecture

| Tier | Nodes | Runtime | Overhead |
|------|-------|---------|----------|
| Tier 1 — Core | HTTP, DB, Transform, Condition, Loop, Redis, Delay, Aggregate, Formula, Calculator, LLM, Embedding, Vector Search, Script | Compiled Rust | ~0μs (native fn call) |
| Tier 2 — WASM | Custom plugins in any WASM-compilable language | Wasmtime sandbox | ~3ms cold / ~50μs warm |
| Tier 3 — External | Microservices via HTTP/gRPC | Separate containers | ~1-10ms network |

**Selection criteria:**
- **Tier 1 (Rust)** — Built-in nodes for 80% of workflows. Minimal overhead, maximum performance, full access to engine internals.
- **Tier 2 (WASM)** — Custom logic that must stay in-process but isn't performance-critical. Sandboxed for security. Supports Go, Rust, C/C++, AssemblyScript.
- **Tier 3 (External)** — Integration with external services, third-party APIs, or heavy computation better handled separately.

## Node Registry

All nodes register with a central `NodeRegistry` at engine initialization. The registry stores two parallel `HashMap`s — one for metadata, one for handler functions — keyed by node type ID (e.g., `"core:http_request"`).

```rust
pub struct NodeRegistry {
    handlers: HashMap<String, NodeHandler>,
    metadata: HashMap<String, NodeTypeMeta>,
}
```

**Key methods:**
- `register(id, meta, handler)` — add a node type
- `execute(node_type, input)` — look up handler and call it
- `all_metadata()` — return metadata for all registered node types (used by `/node-types` API)
- `get_metadata(id)` — return metadata for a single node type (used by permission validation)

Core nodes are registered at startup via `register_core_nodes()`. Nodes requiring connection pools (database, redis, AI nodes) are registered via `with_pools(redis, pg)`. WASM plugins are loaded dynamically via `register_wasm_node()`.

At runtime, the executor looks up a node by ID, executes the handler, and stores outputs in the execution context.

## RequiredRole System

Each node type declares a `required_role` field in its metadata, controlling who can use it:

| Role | Meaning |
|------|---------|
| `Any` (default) | Any authenticated user can use the node |
| `Admin` | Only platform admins can use the node |

**Enforcement points:**
- **`validation.rs`** — `validate_flow_permissions()` checks all nodes in a flow graph against the caller's role before execution. Returns errors listing each unauthorized node.
- **Editor palette** — `/node-types` API returns metadata including `required_role`; the visual editor can filter nodes by role.
- **Database** — `bl_node_types.required_role` column stores the role constraint; `bl_node_permissions` table allows per-Directus-role overrides.

**Current role assignments:**
- `Admin`: `core:database`, `core:redis` (direct infrastructure access)
- `Any`: all other core nodes

## Core Nodes (All Implemented)

### noop
**Category:** utility
**Purpose:** Pass-through for testing and placeholder logic.

**Config:**
```json
{
  "delay_ms": 0
}
```

**Inputs:**
- `data` (any)

**Outputs:**
- `data` (passthrough)

**Behavior:** Waits `delay_ms` milliseconds, then outputs input unchanged.

### http_request
**Category:** network
**Purpose:** Make HTTP requests to external APIs.

**Config:**
```json
{
  "url": "https://api.example.com/endpoint",
  "method": "GET|POST|PUT|PATCH|DELETE",
  "headers": { "Authorization": "Bearer token", "Content-Type": "application/json" },
  "body": null,
  "timeout_ms": 30000,
  "follow_redirects": true,
  "max_redirects": 5
}
```

**Inputs:**
- `trigger_data` (object) — Used for interpolation in url, headers, body

**Outputs:**
- `status` (number)
- `headers` (object)
- `body` (string)
- `elapsed_ms` (number)

**Behavior:** Uses `reqwest` async HTTP client. Supports URL/header/body interpolation via `$trigger.field` syntax. Returns status, response headers, and raw response body. Errors on network failure or timeout.

### transform
**Category:** data
**Purpose:** Map/reshape data using expressions.

**Config:**
```json
{
  "mapping": {
    "user_id": "$trigger.id",
    "email": "$trigger.contact.email",
    "last_result": "$nodes.fetch_user.body.email",
    "timestamp": "$now",
    "computed": "=1 + 2"
  }
}
```

**Inputs:**
- `trigger_data` (object)
- `node_results` (map of previous node outputs)

**Outputs:**
- `result` (object) — Shape defined by mapping

**Behavior:** Evaluates mapping expressions in order. Supports:
- `$trigger.path` — Access trigger data fields
- `$nodes.node_id.path` — Access previous node output fields
- `$now` — Current ISO timestamp
- `=expression` — Inline arithmetic/string expressions (via `rhai`)

Errors if a referenced path doesn't exist (strict mode).

### condition
**Category:** control-flow
**Purpose:** Route execution based on boolean conditions.

**Config:**
```json
{
  "condition_expr": "$trigger.status == 'active'",
  "then_value": true,
  "else_value": false
}
```

**Inputs:**
- `trigger_data` (object)
- `node_results` (map)

**Outputs:**
- `result` (boolean)
- `matched` (boolean) — Whether condition evaluated to true

**Behavior:** Evaluates `condition_expr` using the same expression engine as transform. Returns `then_value` if true, `else_value` if false. Downstream nodes can branch on `matched` port to implement if/else logic.

### formula_eval
**Category:** calculation
**Purpose:** Evaluate inline Excel formulas.

**Config:**
```json
{
  "formula": "=SUM($nodes.data.values)"
}
```

**Inputs:**
- `context` (object) — Available as named ranges in formula evaluation

**Outputs:**
- `result` (scalar) — Result of formula
- `error` (string, optional) — Error message if formula failed

**Behavior:** Parses formula and evaluates using bl-excel formula engine. Formula can reference input ports. Returns numeric/string/boolean result. Errors propagate as error output.

### calculator
**Category:** calculation
**Purpose:** Execute a saved Directus Calculator model.

**Config:**
```json
{
  "calculator_id": "uuid",
  "input_mapping": {
    "revenue": "$trigger.sales_amount",
    "cost": "$nodes.fetch_costs.result"
  },
  "output_mapping": {
    "gross_profit": "profit"
  }
}
```

**Inputs:**
- `trigger_data` (object)
- `node_results` (map)

**Outputs:**
- `outputs` (object) — Mapped calculator outputs
- `stats` (object) — Execution time, iteration count

**Behavior:** Looks up Calculator by ID, builds input object from input_mapping, calls Calculator::execute(), maps outputs to output_mapping. Reuses existing Calculator struct and validation logic.

### loop
**Category:** control-flow
**Purpose:** Repeat node execution over arrays or conditions.

**Config:**
```json
{
  "loop_type": "for_each|while|pagination",
  "items": "$nodes.fetch_data.items",
  "condition": "$context.offset < $context.total",
  "max_iterations": 1000,
  "break_on_error": false
}
```

**Inputs:**
- `context` (object) — Loop state

**Outputs:**
- `results` (array) — Collected results from each iteration
- `iteration_count` (number)
- `final_context` (object) — Loop state after completion

**Behavior:**
- **for_each**: Iterates over `items` array, executing child nodes with current item as context.
- **while**: Executes until `condition` evaluates false.
- **pagination**: Increments offset, executes until end of data.

Collects outputs from each iteration. Stops if max_iterations exceeded or break_on_error triggered.

### database
**Category:** data  **RequiredRole:** Admin
**Purpose:** Execute PostgreSQL queries.

**Config:**
```json
{
  "query": "SELECT * FROM users WHERE id = $1",
  "params": ["$trigger.user_id"],
  "timeout_ms": 5000,
  "mode": "execute|query_one|query_all"
}
```

**Inputs:**
- `trigger_data` (object)

**Outputs:**
- `result` (object|array) — Query result rows
- `rows_affected` (number)

**Behavior:** Uses `sqlx` async PostgreSQL client. Supports parameterized queries. Requires a PG pool (registered via `with_pools()`). Modes:
- **execute**: Run INSERT/UPDATE/DELETE, return rows_affected
- **query_one**: SELECT expecting single row
- **query_all**: SELECT expecting 0+ rows

Account-scoped: queries operate on account's dedicated schema/views.

### redis
**Category:** data  **RequiredRole:** Admin
**Purpose:** Get/set/subscribe to Redis keys.

**Config:**
```json
{
  "operation": "get|set|del|incr|lpush|lpop|hget|hset|publish|subscribe",
  "key": "cache:user:$trigger.user_id",
  "value": "$nodes.transform.result",
  "ttl_seconds": 3600,
  "field": "email"
}
```

**Inputs:**
- `trigger_data` (object)
- `node_results` (map)

**Outputs:**
- `result` (any) — Operation result
- `exists` (boolean) — For get operations

**Behavior:** Uses `redis` async client. Requires a Redis pool (registered via `with_pools()`). Supports:
- **get/set/del**: Standard cache operations
- **incr**: Atomic increment
- **list ops**: lpush, lpop, llen
- **hash ops**: hget, hset, hgetall
- **pub/sub**: publish to channel, subscribe to channel (blocks)

Keys and values support interpolation.

### delay
**Category:** utility
**Purpose:** Wait for specified duration or debounce.

**Config:**
```json
{
  "duration_ms": 5000,
  "type": "static|exponential_backoff|jitter"
}
```

**Inputs:**
- `attempt` (number, optional) — For exponential backoff

**Outputs:**
- `waited_ms` (number) — Actual wait time

**Behavior:**
- **static**: Wait exactly `duration_ms`
- **exponential_backoff**: Wait `duration_ms * 2^attempt` (capped at MAX_BACKOFF)
- **jitter**: Wait `duration_ms ± random(0, jitter_percent)`

Used for rate limiting, retry delays, and timed operations.

### aggregate
**Category:** data
**Purpose:** Collect, merge, or reduce arrays/objects.

**Config:**
```json
{
  "operation": "collect|merge|reduce|flatten|group_by",
  "input_path": "$nodes.loop.results",
  "reduce_expr": "$acc + $current.value",
  "group_by_field": "category"
}
```

**Inputs:**
- `data` (array|object)
- `accumulator` (any, for reduce)

**Outputs:**
- `result` (array|object) — Aggregated result

**Behavior:**
- **collect**: Gather all values into array
- **merge**: Shallow merge all objects
- **reduce**: Apply expression across items with accumulator
- **flatten**: Flatten nested arrays
- **group_by**: Group items by field value

## WASM Plugin Interface (WIT)

Custom plugins are written in any WASM-compilable language (Rust, Go, C/C++, AssemblyScript) and implement the following WIT contract:

```wit
package businesslogic:node@1.0.0;

interface node {
    record node-info {
        id: string,
        name: string,
        category: string,
        description: string,
        config-schema: string,
        inputs: list<port>,
        outputs: list<port>,
    }

    record port {
        name: string,
        data-type: string,
        required: bool,
        description: option<string>,
    }

    record exec-input {
        config: string,
        data: string,
        context-ref: string,
    }

    record exec-output {
        data: string,
        logs: list<string>,
        error: option<string>,
    }

    describe: func() -> node-info;
    execute: func(input: exec-input) -> result<exec-output, string>;
}
```

**Implementation notes:**
- **describe()**: Return static metadata about your plugin. Called once at registration.
- **execute()**: Receive config as JSON string, data as JSON string, context reference (opaque). Return output data as JSON string, logs, and optional error.
- **Sandboxing**: Plugin runs in Wasmtime sandbox with no filesystem or network access unless explicitly granted.
- **Memory**: Each plugin instance gets isolated memory. Allocations are bounded by `max_memory_mb` in registration.

### Example: Rust WASM Plugin

```rust
use bindings::exports::businesslogic::node::node::{Guest, NodeInfo, Port, ExecInput, ExecOutput};

struct MyPlugin;

impl Guest for MyPlugin {
    fn describe() -> NodeInfo {
        NodeInfo {
            id: "custom:my-plugin".to_string(),
            name: "My Plugin".to_string(),
            category: "custom".to_string(),
            description: "Does custom things".to_string(),
            config_schema: r#"{"type": "object"}"#.to_string(),
            inputs: vec![
                Port {
                    name: "input".to_string(),
                    data_type: "string".to_string(),
                    required: true,
                    description: None,
                }
            ],
            outputs: vec![
                Port {
                    name: "output".to_string(),
                    data_type: "string".to_string(),
                    required: true,
                    description: None,
                }
            ],
        }
    }

    fn execute(input: ExecInput) -> Result<ExecOutput, String> {
        let data: serde_json::Value = serde_json::from_str(&input.data)
            .map_err(|e| e.to_string())?;

        let result = serde_json::json!({
            "output": format!("processed: {}", data["input"])
        });

        Ok(ExecOutput {
            data: result.to_string(),
            logs: vec!["Execution completed".to_string()],
            error: None,
        })
    }
}

export!(MyPlugin);
```

### script
**Category:** scripting  **Feature flag:** `scripting`
**Purpose:** Execute JavaScript code in a sandboxed QuickJS runtime.

Enabled via the `scripting` feature flag. See `docs/security.md` for sandboxing details.

### llm
**Category:** ai  **Feature flag:** `ai-nodes`
**Purpose:** Call LLM providers (OpenAI, Anthropic, etc.) with prompt templates.

Budget-controlled with per-node cost limits. Requires Redis + PG pools (registered via `with_pools()`).

### embedding
**Category:** ai  **Feature flag:** `ai-nodes`
**Purpose:** Generate vector embeddings from text.

### vector_search
**Category:** ai  **Feature flag:** `ai-nodes`
**Purpose:** Query pgvector for semantic similarity search.

Requires PG pool with pgvector extension (registered via `with_pools()`).

## Node Handler Interface (Rust)

All core nodes implement the following async handler interface:

```rust
pub type NodeHandler = Arc<
    dyn Fn(NodeInput) -> Pin<Box<dyn Future<Output = Result<NodeResult, anyhow::Error>> + Send>>
        + Send + Sync,
>;

pub struct NodeInput {
    pub config: serde_json::Value,
    pub data: serde_json::Value,
    pub context_snapshot: serde_json::Value,
    pub cancel: CancellationToken,
}

pub struct NodeResult {
    pub data: serde_json::Value,
    pub logs: Vec<String>,
    pub cost_usd: f64,
}
```

**NodeTypeMeta** describes each node type for the registry, editor, and budget system:

```rust
pub struct NodeTypeMeta {
    pub id: String,               // e.g., "core:http_request"
    pub name: String,
    pub description: String,
    pub category: String,
    pub tier: NodeTier,           // Core, Wasm, External
    pub inputs: Vec<PortDef>,
    pub outputs: Vec<PortDef>,
    pub config_schema: serde_json::Value,
    pub estimated_cost_usd: f64,  // Budget pre-checks
    pub required_role: RequiredRole, // Any or Admin
}
```

Each node module exports two functions:

```rust
pub fn metadata() -> NodeTypeMeta { ... }
pub fn handler() -> NodeHandler { ... }
```

At engine startup, all core node modules are registered by calling their metadata() and handler() functions, building the central registry.

## Node Execution Model

1. **Instantiation**: When a flow starts executing, the engine instantiates all nodes in the DAG.
2. **Dependency Resolution**: Executor builds execution order based on data dependencies between nodes.
3. **Execution**: For each node in order:
   - Validate inputs against input port schemas
   - Call node handler with NodeInput
   - Validate outputs against output port schemas
   - Store outputs in execution state
   - Retry on transient errors if retry policy configured
4. **Error Propagation**: Errors either stop execution or route to error handler node, depending on flow configuration.
5. **Cleanup**: After flow completes, all node resources are released.

## Best Practices

- **Idempotency**: Design nodes to be idempotent where possible. Retries may execute the same node multiple times.
- **Logging**: Use node logs for debugging and observability. Logs are captured per execution.
- **Timeouts**: Always set reasonable timeouts on external calls (HTTP, DB, etc.).
- **Memory**: Be mindful of memory usage in loops. Aggregate results as you go rather than collecting all items.
- **Error Messages**: Return clear, actionable error messages. Include context that helps debugging.
