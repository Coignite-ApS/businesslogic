# Execution Engine

The BusinessLogic Flow Engine executor processes workflow graphs with deterministic, scalable execution. This document describes the execution algorithm, DAG validation, error handling, and priority-based job dispatch.

## DAG with Controlled Back-Edges

The flow graph is a directed acyclic graph (DAG) built with `petgraph`. Unlike traditional DAGs, we support controlled back-edges (loops) with explicit guards and iteration limits—analogous to the formula engine's Gauss-Seidel cycle resolution, but at the flow level.

### Graph Topology

- **Nodes**: workflow steps (HTTP, formula, LLM, WASM, QuickJS, external service)
- **Edges**: data dependencies (output of node A → input of node B)
- **Back-edges**: explicitly annotated loops with:
  - Guard condition (boolean expression, e.g., `$last.count < 10`)
  - Max iteration limit (e.g., `iterations: 100`)
  - Loop body identifier (nodes within the loop)

### Validation (Build Time)

1. **True cycles rejected** — Any cycle not annotated as a back-edge is a programming error
2. **Back-edges separated** — Extracted from the base DAG; the core graph is acyclic
3. **Guard condition syntax validation** — Parsed as expressions; must evaluate to boolean
4. **Iteration limits enforced** — Must be positive integers ≤ 10,000
5. **Isolated loops** — No nested loops sharing state (simplifies execution model)

Example configuration:

```json
{
  "nodes": [
    {"id": "fetch_data", "type": "http", "config": {...}},
    {"id": "transform_1", "type": "formula", "config": {...}},
    {"id": "check_done", "type": "condition", "config": {...}}
  ],
  "edges": [
    {"from": "fetch_data", "to": "transform_1"},
    {"from": "transform_1", "to": "check_done"}
  ],
  "back_edges": [
    {
      "from": "check_done",
      "to": "fetch_data",
      "guard": "$last.count < 10",
      "max_iterations": 100,
      "loop_id": "fetch_loop"
    }
  ]
}
```

## Execution Algorithm

The executor implements a task-driven, dependency-aware pipeline:

### 1. Job Intake

Worker thread polls Redis Streams in priority order:

```rust
// Pseudocode
loop {
  let response = redis.xreadgroup(
    group: "workers",
    consumer: format!("consumer-{}", worker_id),
    streams: vec![
      "flow:execute:critical",  // Check first (SLA-bound)
      "flow:execute:normal",    // Then standard
      "flow:execute:batch"      // Finally background
    ],
    count: 1,
    block_ms: 5000
  );

  if let Some((stream, entries)) = response {
    for (message_id, fields) in entries {
      process_execution(execution_id, fields);
      redis.xack(stream, "workers", message_id);
    }
  }
}
```

### 1.5. Flow Permission Validation

Before execution begins, the executor validates that the caller has permission to use all nodes in the flow:

```rust
// In flow-engine/src/validation.rs
validate_flow_permissions(&flow.graph, &registry, &caller_role)?;
```

This checks each node's `required_role` against the caller. Admin-only nodes (`core:database`, `core:redis`) are rejected for non-admin callers. See `docs/nodes.md` for the RequiredRole system.

### 2. Initialization

```rust
struct ExecutionContext {
  $trigger: serde_json::Value,        // Immutable trigger data
  $env: HashMap<String, String>,      // Filtered environment variables
  $meta: ExecutionMetadata {
    execution_id: String,
    flow_id: String,
    started_at: DateTime<Utc>,
    current_node: String,
    cumulative_cost_usd: f64,
    worker_id: String,
    duration_ms: u64,
  },
  $nodes: HashMap<String, NodeResult>, // All executed node outputs
  $last: serde_json::Value,            // Most recent node output
}

// Load flow definition
let flow = flow_cache.get(flow_id)
  .or_else(|| db.query_flow(flow_id));

// Initialize context
let mut context = ExecutionContext {
  $trigger: trigger_data,
  $env: env::vars().filter(|k| whitelist.contains(k)).collect(),
  $meta: ExecutionMetadata {
    execution_id: uuid::new_v4().to_string(),
    flow_id: flow.id.clone(),
    started_at: Utc::now(),
    cumulative_cost_usd: 0.0,
    worker_id: worker_id.clone(),
    ..Default::default()
  },
  $nodes: HashMap::new(),
  $last: serde_json::json!(null),
};
```

### 3. Build DAG and Topological Sort

```rust
// Construct petgraph DAG
let mut dag = DiGraph::new();
let mut node_idx_map: HashMap<String, NodeIndex> = HashMap::new();

// Add nodes
for node in &flow.nodes {
  let idx = dag.add_node(node.id.clone());
  node_idx_map.insert(node.id.clone(), idx);
}

// Add edges (excluding back-edges)
for edge in &flow.edges {
  if !flow.back_edges.iter().any(|be| be.from == edge.from && be.to == edge.to) {
    let from_idx = node_idx_map[&edge.from];
    let to_idx = node_idx_map[&edge.to];
    dag.add_edge(from_idx, to_idx, ());
  }
}

// Topological sort
let topo_order = petgraph::algo::toposort(&dag, None)?;
```

### 4. Ready Queue Initialization

Identify all nodes with zero unmet dependencies:

```rust
let mut in_degree: HashMap<String, usize> = flow.nodes
  .iter()
  .map(|n| (n.id.clone(), 0))
  .collect();

for edge in &flow.edges {
  if !flow.back_edges.iter().any(|be| be.from == edge.from && be.to == edge.to) {
    in_degree[&edge.to] += 1;
  }
}

let mut ready_queue: VecDeque<String> = flow.nodes
  .iter()
  .filter(|n| in_degree[&n.id] == 0)
  .map(|n| n.id.clone())
  .collect();
```

### 5. Main Execution Loop

```rust
let mut remaining: HashSet<String> = flow.nodes.iter().map(|n| n.id.clone()).collect();
let mut loop_iterations: HashMap<String, usize> = HashMap::new();
let mut spawn_handles = Vec::new();

while !ready_queue.is_empty() || !spawn_handles.is_empty() {
  // Spawn tasks for ready nodes
  while let Some(node_id) = ready_queue.pop_front() {
    let node = flow.nodes.iter().find(|n| n.id == node_id).unwrap().clone();
    let ctx_clone = context.clone();
    let node_clone = node.clone();

    let handle = tokio::spawn(async move {
      execute_node(&node_clone, &ctx_clone).await
    });

    spawn_handles.push((node_id, handle));
  }

  // Await at least one task
  if !spawn_handles.is_empty() {
    let (completed_idx, (node_id, result)) = futures::future::select_all(
      spawn_handles.iter_mut().map(|(id, h)| Box::pin(async { (id.clone(), h.await) }))
    ).await;

    // Process result
    match result {
      Ok(Ok(node_result)) => {
        // Store output
        let output_size = bincode::serialized_size(&node_result.data)?;
        if output_size < 64_000 {
          // Inline storage
          context.$nodes.insert(node_id.clone(), node_result.clone());
        } else {
          // Reference tier: Redis + S3
          let ref_key = format!("flow:state:{}:{}", context.$meta.execution_id, node_id);
          redis.set(&ref_key, msgpack::to_bytes(&node_result)?)?;
          context.$nodes.insert(node_id.clone(), NodeResult {
            data: serde_json::json!({"$ref": ref_key}),
            ..node_result
          });
        }

        context.$last = node_result.data.clone();
        context.$meta.cumulative_cost_usd += node_result.cost_usd;
        remaining.remove(&node_id);

        // Update dependencies
        for edge in &flow.edges {
          if edge.from == node_id {
            in_degree[&edge.to] -= 1;
            if in_degree[&edge.to] == 0 {
              ready_queue.push_back(edge.to.clone());
            }
          }
        }

        // Handle back-edges
        for back_edge in flow.back_edges.iter()
          .filter(|be| be.from == node_id) {

          let guard_result = evaluate_expression(&back_edge.guard, &context)?;
          let current_iterations = loop_iterations.entry(back_edge.loop_id.clone()).or_insert(0);

          if guard_result && *current_iterations < back_edge.max_iterations {
            *current_iterations += 1;
            // Re-queue loop body nodes
            for loop_node in &flow.nodes {
              if in_loop(&loop_node.id, &back_edge.loop_id, &flow) {
                in_degree[&loop_node.id] = count_incoming_edges(&loop_node.id, &flow);
                if in_degree[&loop_node.id] == 0 {
                  ready_queue.push_back(loop_node.id.clone());
                }
              }
            }
          }
        }
      }
      Ok(Err(node_error)) => {
        // Error handling (see section 4)
        handle_node_error(&node_id, node_error, &mut context, &flow)?;
      }
      Err(join_error) => {
        // Task panicked
        return Err(ExecutionError::TaskPanic(node_id, join_error.to_string()));
      }
    }

    spawn_handles.remove(completed_idx);
  }

  // Budget check
  if context.$meta.cumulative_cost_usd > flow.settings.budget_limit_usd {
    return Err(ExecutionError::BudgetExceeded(context.$meta.cumulative_cost_usd));
  }
}
```

### 6. Completion

On success:

```rust
// Acknowledge Redis message
redis.xack(&stream, "workers", message_id)?;

// Persist summary
db.insert_execution(ExecutionRecord {
  id: context.$meta.execution_id.clone(),
  flow_id: flow.id.clone(),
  account_id: account_id.clone(),
  status: "completed",
  trigger_data: serde_json::to_string(&context.$trigger)?,
  context: msgpack::to_bytes(&context)?,
  result: msgpack::to_bytes(&context.$last)?,
  error: None,
  duration_ms: context.$meta.started_at.elapsed().as_millis() as u64,
  nodes_executed: context.$nodes.len(),
  cost_usd: context.$meta.cumulative_cost_usd,
  worker_id: context.$meta.worker_id.clone(),
  started_at: context.$meta.started_at,
  completed_at: Some(Utc::now()),
})?;

// Publish completion event
pubsub.publish(
  &format!("flow:events:{}", flow.id),
  serde_json::json!({
    "type": "flow_completed",
    "execution_id": context.$meta.execution_id,
    "result": context.$last,
    "duration_ms": context.$meta.started_at.elapsed().as_millis(),
  })
)?;
```

On failure:

```rust
// Dead-letter unacked messages after max retries
if message_metadata.delivery_count >= flow.settings.max_retries {
  redis.xread_group_ack(&stream, "workers", message_id)?;
  db.insert_to_dead_letter(execution_id, context, error)?;
} else {
  // Requeue with backoff
  let backoff_ms = flow.settings.initial_delay_ms
    * (flow.settings.backoff_multiplier as f64).powi(message_metadata.delivery_count as i32);
  redis.xadd(&stream, {
    "execution_id": execution_id,
    "delay_until": Utc::now() + Duration::from_millis(backoff_ms as u64),
    ...
  })?;
}
```

## Execution Modes

### Parallel (Default)

Independent branches execute concurrently via Tokio tasks. Nodes with no dependency order constraints run simultaneously.

**Use when**: ETL pipelines, multi-source data aggregation, batch processing

**Guarantees**: All nodes executed; execution order respects DAG dependencies only

### Sequential

Strict one-at-a-time execution. Each node waits for its predecessor even if dependencies allow parallelism.

**Use when**: Order-dependent side effects, rate-limited APIs, single-threaded operations

**Configuration**:

```json
{
  "execution_mode": "sequential",
  "settings": {
    "parallel_degree": 1
  }
}
```

### Streaming

Zero-copy pipes between nodes for large data (payloads > 100MB). Data flows from producer → consumer without intermediate materialization.

**Use when**: Large file processing (e.g., video transcoding, log aggregation)

**Configuration**:

```json
{
  "execution_mode": "streaming",
  "nodes": [
    {
      "id": "read_s3",
      "type": "http",
      "config": {
        "streaming_output": true,
        "content_type": "application/octet-stream"
      }
    },
    {
      "id": "transform",
      "type": "wasm",
      "config": {
        "streaming_input": true,
        "streaming_output": true
      }
    }
  ]
}
```

## Error Handling Strategies

Each node specifies its own error handling strategy. Strategies are mutually exclusive.

### Retry

Exponential backoff with configurable parameters:

```json
{
  "id": "fetch_data",
  "type": "http",
  "error_handling": {
    "strategy": "retry",
    "max_retries": 5,
    "initial_delay_ms": 1000,
    "backoff_multiplier": 2.0,
    "max_delay_ms": 30000,
    "jitter": true
  }
}
```

Algorithm:

```
delay = initial_delay_ms
for attempt = 1 to max_retries:
  try execute_node()
  catch error:
    if attempt == max_retries:
      propagate error
    delay_with_jitter = delay * (1 + random(0, 0.1))
    sleep(min(delay_with_jitter, max_delay_ms))
    delay *= backoff_multiplier
```

### Fallback

Route execution to an alternative branch on node failure:

```json
{
  "id": "primary_api",
  "type": "http",
  "error_handling": {
    "strategy": "fallback",
    "fallback_node_id": "secondary_api"
  }
}
```

On failure, the executor:
1. Marks primary node as failed
2. Skips dependent nodes of primary
3. Enqueues fallback node as if primary succeeded
4. Continues with fallback's dependents

### Skip

Mark node as skipped, continue execution with null output:

```json
{
  "id": "optional_enrichment",
  "type": "formula",
  "error_handling": {
    "strategy": "skip",
    "fallback_output": {
      "count": 0,
      "data": []
    }
  }
}
```

Use for non-critical enrichment steps where absence of data is acceptable.

### Abort

Halt the entire flow immediately and return error:

```json
{
  "id": "validate_payment",
  "type": "http",
  "error_handling": {
    "strategy": "abort"
  }
}
```

Default for critical nodes. Flow terminates; all subsequent nodes unexecuted.

## Priority Queues

Three Redis Streams enforce SLA-based prioritization:

### flow:execute:critical

For time-sensitive, SLA-bound flows (e.g., customer-facing webhooks). Workers poll this first.

**SLA**: 99th percentile latency < 500ms
**Retry policy**: exponential backoff, max 3 retries

**Configuration**:

```json
{
  "trigger": {
    "type": "webhook",
    "priority": "critical",
    "sla_ms": 500
  }
}
```

### flow:execute:normal

Standard production flows with reasonable SLA.

**SLA**: 99th percentile latency < 5000ms
**Retry policy**: exponential backoff, max 5 retries

### flow:execute:batch

Background processing, no latency requirements.

**SLA**: 95th percentile latency < 60000ms
**Retry policy**: exponential backoff, max 10 retries, up to 24 hours

### Worker Poll Order

```rust
// Workers always check in this order
let priorities = vec![
  "flow:execute:critical",
  "flow:execute:normal",
  "flow:execute:batch"
];

for stream in priorities {
  if let Some((entry_id, fields)) = redis.xreadgroup(stream, count: 1, block: 100)? {
    return Some((stream, entry_id, fields));
  }
}
```

### Starvation Prevention

To prevent batch jobs from being starved by continuous critical traffic:

- Poll critical with 90% probability
- Poll normal with 8% probability
- Poll batch with 2% probability

## Budget Tracking

Per-execution cost accumulation. Each node reports `cost_usd` (especially LLM nodes). ExecutionContext tracks cumulative total. Flow settings define hard limit.

### Node Cost Reporting

```json
{
  "id": "gpt4_analysis",
  "type": "quickjs",
  "config": {
    "code": "...",
    "cost_callback": "cost_usd(input.tokens)"
  }
}
```

Node result:

```rust
pub struct NodeResult {
  pub data: serde_json::Value,
  pub duration_ms: u64,
  pub cost_usd: f64,  // LLM nodes report actual API cost
  pub status: NodeStatus,
}
```

### Budget Enforcement

```rust
// Before each node execution
if context.$meta.cumulative_cost_usd + estimated_node_cost > flow.settings.budget_limit_usd {
  return Err(ExecutionError::BudgetExceeded {
    spent: context.$meta.cumulative_cost_usd,
    limit: flow.settings.budget_limit_usd,
    node_id: node_id.clone(),
  });
}

// After execution
context.$meta.cumulative_cost_usd += node_result.cost_usd;
```

### Cost Tracking in Database

```json
{
  "id": "exec-12345",
  "flow_id": "flow-abc",
  "account_id": "acme-corp",
  "cost_usd": 0.0342,
  "nodes_executed": [
    {"id": "gpt4_1", "cost_usd": 0.0200},
    {"id": "http_1", "cost_usd": 0.0100},
    {"id": "formula_1", "cost_usd": 0.0042}
  ]
}
```

Use for per-account billing, cost trending, and budget alerts.
