# Data Model

The BusinessLogic Flow Engine uses a multi-tier data model optimized for in-flight execution context, persistent storage, and reference tracking. This document specifies the execution context structure, tiered storage, serialization formats, database schema, and Redis key layout.

## Execution Context

The execution context is the central JSON structure threaded through all nodes during execution. It provides immutable input data, accumulated outputs, and metadata about the flow's progress.

### Structure

```json
{
  "$trigger": {
    "type": "webhook",
    "body": {
      "user_id": "usr_123",
      "email": "alice@example.com",
      "amount": 1500.00
    },
    "headers": {
      "X-Webhook-ID": "wh_abc123",
      "Content-Type": "application/json"
    },
    "timestamp": "2026-03-11T14:30:00Z"
  },
  "$env": {
    "STRIPE_API_KEY": "sk_live_...",
    "DATABASE_URL": "postgresql://...",
    "FEATURE_FLAGS": "{...}"
  },
  "$meta": {
    "execution_id": "exec-f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "flow_id": "flow-payment-processing",
    "account_id": "acme-corp",
    "worker_id": "worker-5",
    "started_at": "2026-03-11T14:30:00Z",
    "current_node": "validate_amount",
    "cumulative_cost_usd": 0.0342,
    "duration_ms": 450
  },
  "$nodes": {
    "fetch_customer": {
      "data": {
        "id": "cust_123",
        "name": "Alice Smith",
        "email": "alice@example.com",
        "tier": "premium"
      },
      "duration_ms": 145,
      "status": "completed",
      "cost_usd": 0.0
    },
    "validate_amount": {
      "data": {
        "valid": true,
        "amount": 1500.00,
        "currency": "USD"
      },
      "duration_ms": 5,
      "status": "completed",
      "cost_usd": 0.0
    },
    "calculate_fee": {
      "data": {
        "base_fee": 0.029,
        "percentage_fee": 43.50,
        "total_fee": 43.53
      },
      "duration_ms": 12,
      "status": "completed",
      "cost_usd": 0.0042
    }
  },
  "$last": {
    "base_fee": 0.029,
    "percentage_fee": 43.50,
    "total_fee": 43.53
  }
}
```

### Fields

**$trigger** (immutable)
- Original trigger data from webhook, timer, API call, or MCP
- Read-only throughout execution
- Accessible as: `$trigger.body.user_id`, `$trigger.headers['X-Webhook-ID']`

**$env** (filtered)
- Subset of environment variables allowed by flow configuration
- Read-only
- Whitelist-based: only variables listed in `flow.settings.allowed_env_vars` included
- Accessible as: `$env.STRIPE_API_KEY`, `$env.DATABASE_URL`

**$meta** (tracked)
- Execution metadata updated as flow progresses
- `execution_id`: Unique identifier for this execution run
- `flow_id`: Identifier of the flow definition
- `account_id`: Tenant account
- `worker_id`: ID of worker thread executing this flow
- `started_at`: Timestamp when execution began
- `current_node`: ID of node currently executing (updated in real-time)
- `cumulative_cost_usd`: Running total of costs (LLM tokens, API calls)
- `duration_ms`: Total elapsed time (updated on each node completion)
- Accessible as: `$meta.execution_id`, `$meta.cumulative_cost_usd`

**$nodes** (accumulated)
- Dictionary mapping node IDs to their execution results
- Each entry contains:
  - `data`: The output of that node (may be inline or reference)
  - `duration_ms`: Wall-clock execution time
  - `status`: "completed", "failed", "skipped", "timeout"
  - `cost_usd`: Cost incurred by that node (LLM, API calls)
- Nodes are added as execution progresses
- Accessible as: `$nodes.fetch_customer.data.name`, `$nodes.calculate_fee.cost_usd`

**$last** (current)
- The most recent node's output data
- Updated after each node completes
- Convenient shorthand: instead of `$nodes.latest_node.data`, use `$last`
- In sequential mode, always refers to the previous node
- In parallel mode, refers to whichever node completed most recently
- Accessible as: `$last.total_fee`, `$last.status`

### Expression Access

All nodes can reference context values via expressions:

```json
{
  "id": "apply_discount",
  "type": "formula",
  "config": {
    "formula": "=($trigger.body.amount - $last.total_fee) * $nodes.fetch_customer.data.discount_rate"
  }
}
```

Expressions are evaluated by a safe interpreter (QuickJS, no file I/O, no `require`).

## Tiered Storage Model

The context's `$nodes` dictionary can contain outputs of any size. A three-tier storage system handles this efficiently:

### Tier 1: Inline (< 64 KB)

Small payloads stored directly in the ExecutionContext JSON.

**Benefits:**
- Sub-microsecond access (memory resident)
- No network round-trips
- Entire context serializable as one blob

**Drawback:**
- Context JSON grows with node count

**Example**:

```json
{
  "$nodes": {
    "validate_amount": {
      "data": {
        "valid": true,
        "amount": 1500.00
      }
    }
  }
}
```

### Tier 2: Reference (64 KB – 100 MB)

Payloads too large for inline storage. Data stored in Redis (hot) and S3 (persistent backup). Context stores a reference pointer.

**Benefits:**
- Context remains small (~1-2 KB per node)
- Redis: ~1ms access, 30-day TTL
- S3: 50-100ms access, indefinite retention

**Drawback:**
- Network latency: 1ms (Redis) or 50ms (S3)
- Must dereference before using in expressions

**Storage format**:

```
Redis Key: flow:state:{execution_id}:{node_id}
Redis Value: MessagePack-encoded node result
S3 Path: s3://businesslogic-flow/{account_id}/{flow_id}/{execution_id}/{node_id}.msgpack.lz4
```

**Reference in context**:

```json
{
  "$nodes": {
    "fetch_large_dataset": {
      "data": {
        "$ref": "redis:flow:state:exec-12345:fetch_large_dataset"
      },
      "duration_ms": 450,
      "status": "completed"
    }
  }
}
```

**Dereferencing**:

When a node needs to read from a reference, the executor automatically dereferences:

```rust
fn resolve_input(context: &ExecutionContext, path: &str) -> Result<Value> {
  let value = json_path::select(context, path)?;

  if let Some(ref_str) = value.get("$ref") {
    // Extract storage location
    let (storage, key) = parse_ref(ref_str)?;  // "redis:..." or "s3:..."

    match storage {
      Storage::Redis => redis.get(key),
      Storage::S3 => s3.get_object(key),
    }
  } else {
    Ok(value)
  }
}
```

### Tier 3: Streaming (> 100 MB)

For very large data (video files, multi-gigabyte logs), data is streamed directly between nodes without intermediate storage.

**Benefits:**
- Constant memory: only current chunk in memory
- No intermediate materialization
- Suitable for ETL pipelines

**Drawback:**
- Data not stored in context
- Only accessible to immediate downstream node
- Must use `streaming_input: true` on next node

**Example**:

```json
{
  "nodes": [
    {
      "id": "download_video",
      "type": "http",
      "config": {
        "url": "https://cdn.example.com/video.mp4",
        "streaming_output": true
      }
    },
    {
      "id": "transcode",
      "type": "wasm",
      "config": {
        "module": "wasm/ffmpeg.wasm",
        "streaming_input": true,
        "streaming_output": true
      }
    },
    {
      "id": "upload_output",
      "type": "http",
      "config": {
        "method": "PUT",
        "url": "https://cdn.example.com/video-converted.mp4",
        "streaming_input": true
      }
    }
  ]
}
```

Streaming pipeline:

```
download_video (source)
  → chunk[0] → transcode → chunk[0]' → upload_output
  → chunk[1] → transcode → chunk[1]' → upload_output
  → chunk[2] → transcode → chunk[2]' → upload_output
  → EOF
```

No `$nodes.download_video` entry created; streaming is transparent to context.

### Tier Selection Algorithm

```rust
fn store_node_result(
  context: &mut ExecutionContext,
  node_id: &str,
  result: NodeResult,
) -> Result<()> {
  let serialized = bincode::serialize(&result.data)?;

  match serialized.len() {
    0..=65536 => {
      // Inline: store directly
      context.$nodes.insert(node_id.to_string(), result);
    }
    65537..=104857600 => {
      // Reference: Redis + S3
      let ref_key = format!("flow:state:{}:{}", context.$meta.execution_id, node_id);

      // Write to Redis (30-day TTL)
      redis.set(
        &ref_key,
        &msgpack::to_bytes(&result.data)?,
        ex: 2592000
      )?;

      // Write to S3 (permanent backup)
      let s3_key = format!(
        "{}/{}/{}/{}.msgpack.lz4",
        context.$meta.account_id,
        context.$meta.flow_id,
        context.$meta.execution_id,
        node_id
      );
      s3.put_object(
        "businesslogic-flow",
        &s3_key,
        &lz4::compress(&msgpack::to_bytes(&result.data)?)
      )?;

      // Store reference in context
      context.$nodes.insert(node_id.to_string(), NodeResult {
        data: serde_json::json!({"$ref": ref_key}),
        ..result
      });
    }
    104857601.. => {
      // Streaming: don't store in context
      // Data piped directly from producer to consumer
    }
  }

  Ok(())
}
```

## Serialization

Different parts of the system use different serialization formats optimized for their use case:

### MessagePack (rmp-serde)

Used for node results and context storage (Redis, database, S3).

**Advantages:**
- 2x faster than JSON encoding/decoding
- ~30% smaller than JSON
- Binary-safe
- Deterministic

**Example**:

```rust
let result = NodeResult {
  data: serde_json::json!({"count": 42, "items": [...]}),
  duration_ms: 145,
  status: "completed",
  cost_usd: 0.0042,
};

let bytes = rmp_serde::to_vec(&result)?;
// Store/transmit bytes
let restored: NodeResult = rmp_serde::from_slice(&bytes)?;
```

### JSON (serde_json)

Used for external API communication and human-readable logs.

**Example**:

```json
{
  "data": {"count": 42},
  "duration_ms": 145,
  "status": "completed",
  "cost_usd": 0.0042
}
```

### MessagePack + LZ4 Compression

For S3 storage of reference-tier data. LZ4 provides fast compression (~500MB/s on typical hardware).

**Example**:

```rust
let result_bytes = rmp_serde::to_vec(&node_result)?;
let compressed = lz4::compress(&result_bytes)?;
// Store compressed bytes to S3
```

Compression ratio: typically 40-60% for JSON-like structured data.

### Redis Streams (flat fields)

Redis Streams store execution jobs as flat key-value pairs (no nesting).

**Example**:

```bash
XADD flow:execute:normal "*" \
  execution_id "exec-12345" \
  flow_id "flow-payment" \
  account_id "acme-corp" \
  priority "normal" \
  trigger_data '{"user_id": "usr_123", "amount": 1500}' \
  created_at "2026-03-11T14:30:00Z"
```

Large trigger data is serialized as a single JSON string field.

## Database Schema

PostgreSQL tables store flow definitions and execution records.

### bl_flows

Stores flow definitions (the DAG structure and configuration).

```sql
CREATE TABLE bl_flows (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,

  -- Graph structure
  nodes JSONB NOT NULL,        -- Array of node definitions
  edges JSONB NOT NULL,        -- Array of edges (dependencies)
  back_edges JSONB,            -- Array of annotated back-edges (loops)

  -- Trigger configuration
  trigger_config JSONB NOT NULL,  -- Webhook, timer, API, MCP config

  -- Flow settings
  settings JSONB NOT NULL,     -- Execution modes, budgets, retry policies

  -- Versioning and status
  version INT DEFAULT 1,
  status TEXT NOT NULL,        -- 'draft', 'active', 'disabled'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Audit
  created_by UUID,             -- FK to directus_users
  updated_by UUID,             -- FK to directus_users

  FOREIGN KEY (account_id) REFERENCES accounts(id),
  INDEX idx_account_flow (account_id, status)
);
```

**Example entry**:

```json
{
  "id": "flow-payment-processing",
  "account_id": "acme-corp",
  "name": "Payment Processing",
  "description": "Fetch customer, validate amount, calculate fee, process payment",
  "nodes": [
    {
      "id": "fetch_customer",
      "type": "http",
      "config": {
        "method": "GET",
        "url": "https://api.example.com/customers/{$trigger.body.user_id}"
      }
    },
    {
      "id": "validate_amount",
      "type": "formula",
      "config": {
        "formula": "=IF($trigger.body.amount > 0, TRUE, FALSE)"
      }
    },
    {
      "id": "calculate_fee",
      "type": "formula",
      "config": {
        "formula": "=($trigger.body.amount * 0.029) + 0.30"
      }
    }
  ],
  "edges": [
    {"from": "fetch_customer", "to": "validate_amount"},
    {"from": "validate_amount", "to": "calculate_fee"}
  ],
  "back_edges": [],
  "trigger_config": {
    "type": "webhook",
    "path": "/webhooks/payment"
  },
  "settings": {
    "execution_mode": "sequential",
    "budget_limit_usd": 1.00,
    "max_retries": 3,
    "allowed_env_vars": ["STRIPE_API_KEY", "DATABASE_URL"]
  },
  "version": 1,
  "status": "active",
  "created_at": "2026-03-01T10:00:00Z",
  "updated_at": "2026-03-11T14:00:00Z"
}
```

### bl_flow_executions

Stores records of each flow execution (audit trail + cost tracking).

```sql
CREATE TABLE bl_flow_executions (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  account_id TEXT NOT NULL,

  -- Execution state
  status TEXT NOT NULL,        -- 'running', 'completed', 'failed', 'timeout'

  -- Input and output
  trigger_data TEXT NOT NULL,  -- JSON string of trigger payload
  context BYTEA,               -- MessagePack-encoded ExecutionContext
  result BYTEA,                -- MessagePack-encoded final result
  error TEXT,                  -- Error message/stack if failed

  -- Metrics
  duration_ms INT,
  nodes_executed INT,
  cost_usd DECIMAL(10, 6),

  -- Metadata
  worker_id TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,

  FOREIGN KEY (flow_id) REFERENCES bl_flows(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  INDEX idx_flow_execution (flow_id, status),
  INDEX idx_account_execution (account_id, started_at),
  INDEX idx_cost_tracking (account_id, started_at)
);
```

**Example entry**:

```json
{
  "id": "exec-f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "flow_id": "flow-payment-processing",
  "account_id": "acme-corp",
  "status": "completed",
  "trigger_data": "{\"user_id\": \"usr_123\", \"email\": \"alice@example.com\", \"amount\": 1500.00}",
  "context": "[MessagePack bytes]",
  "result": "[MessagePack bytes of $last]",
  "error": null,
  "duration_ms": 450,
  "nodes_executed": 3,
  "cost_usd": 0.034200,
  "worker_id": "worker-5",
  "started_at": "2026-03-11T14:30:00Z",
  "completed_at": "2026-03-11T14:30:00.450Z"
}
```

### bl_node_types

Catalog of available node types (HTTP, formula, WASM, QuickJS, etc.).

```sql
CREATE TABLE bl_node_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,               -- 'integration', 'computation', 'control'
  tier TEXT,                   -- 'core', 'premium', 'experimental'

  -- Input/output schema
  inputs JSONB,                -- JSON Schema for inputs
  outputs JSONB,               -- JSON Schema for outputs
  config_schema JSONB,         -- JSON Schema for node config

  -- Access control
  required_role TEXT NOT NULL DEFAULT 'any'
    CHECK (required_role IN ('any', 'admin')),

  -- WASM module reference (if applicable)
  wasm_module_id TEXT,
  external_url TEXT,           -- For HTTP nodes to external services

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  FOREIGN KEY (wasm_module_id) REFERENCES bl_wasm_modules(id),
  INDEX idx_category_tier (category, tier)
);
```

**Examples**:

```sql
-- HTTP node type
INSERT INTO bl_node_types VALUES (
  'type-http',
  'HTTP Request',
  'Execute HTTP request and capture response',
  'integration',
  'core',
  '{"method": {"type": "string"}, "url": {"type": "string"}, ...}',
  '{"status": {"type": "integer"}, "body": {"type": "object"}, ...}',
  '{"method": {...}, "url": {...}, "headers": {...}}',
  NULL,
  NULL
);

-- WASM node type
INSERT INTO bl_node_types VALUES (
  'type-wasm-csv',
  'CSV Parser (WASM)',
  'Parse CSV data using WASM module',
  'computation',
  'core',
  '{"data": {"type": "string"}}',
  '{"rows": {"type": "array"}, "columns": {"type": "array"}}',
  '{"delimiter": {"type": "string", "default": ","}}',
  'wasm-csv-parser-v2',
  NULL
);
```

### bl_wasm_modules

Stores WASM modules used by flow nodes.

```sql
CREATE TABLE bl_wasm_modules (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,

  -- Module binary (small modules) or S3 reference (large)
  wasm_bytes BYTEA,            -- NULL if stored in S3
  s3_key TEXT,                 -- S3 path if size > 1MB
  hash TEXT NOT NULL,          -- SHA-256 of WASM binary
  size_bytes INT NOT NULL,

  -- Metadata
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  FOREIGN KEY (account_id) REFERENCES accounts(id),
  UNIQUE (account_id, name, version),
  INDEX idx_account_module (account_id)
);
```

## Redis Keys

Redis stores execution state, job queues, and worker health.

### Job Queues

```
flow:execute:critical    — Stream, SLA < 500ms, retries: 3
flow:execute:normal      — Stream, SLA < 5s, retries: 5
flow:execute:batch       — Stream, SLA < 60s, retries: 10
```

Consumer group: `workers`
Consumer naming: `consumer-{worker_id}`

**Example message**:

```
XADD flow:execute:normal "*" \
  execution_id "exec-12345" \
  flow_id "flow-payment" \
  account_id "acme-corp" \
  priority "normal" \
  trigger_data '{"user_id": "usr_123", "amount": 1500}' \
  created_at "2026-03-11T14:30:00Z" \
  delivery_count "0"
```

### State Storage

```
flow:state:{execution_id}:{node_id}

Type: STRING (MessagePack-encoded node result)
TTL: 2592000 (30 days)

Example:
  Key: flow:state:exec-12345:fetch_large_dataset
  Value: [MessagePack bytes]
```

Multiple state keys per execution (one per node with reference-tier data).

### Events Channel

```
flow:events:{flow_id}

Type: PubSub channel
Content: JSON event messages

Example publish:
  {
    "type": "flow_completed",
    "execution_id": "exec-12345",
    "result": {...},
    "duration_ms": 450
  }
```

Used by:
- UI dashboards (real-time execution updates)
- Webhooks (notifying external systems)
- Analytics aggregators

### Worker Health

```
flow:workers:{worker_id}

Type: HASH with fields:
  - worker_id
  - started_at
  - last_heartbeat
  - status (running, idle, unhealthy)
  - executions_completed
  - total_cost_usd

TTL: 30 seconds (auto-cleanup on expiration)

Example:
  HSET flow:workers:worker-5 \
    worker_id "worker-5" \
    last_heartbeat "2026-03-11T14:30:15Z" \
    status "idle" \
    executions_completed "1234" \
    total_cost_usd "567.89"

  EXPIRE flow:workers:worker-5 30
```

### Configuration Cache

```
flow:cache:{flow_id}

Type: STRING (JSON flow definition)
TTL: 3600 (1 hour)

Used to avoid repeated database lookups during execution.
```

### Rate Limiting

```
rl:flow:rps:{account_id}:{epoch_seconds}

Type: STRING (counter via INCR)
TTL: 2 seconds
Purpose: Per-second request counter per account.
```

```
rl:flow:mo:{account_id}:{YYYY-MM}

Type: STRING (counter via INCR)
TTL: 35 days
Purpose: Monthly execution counter per account.
```

### Cron Dedup Lock

```
flow:cron_lock:{flow_id}:{minute_timestamp}

Type: STRING (via SETNX)
TTL: 120 seconds
Purpose: Prevents duplicate cron firings within the same minute.
```

### bl_node_permissions

Per-role node access overrides (consumed by editor to show/hide nodes in palette).

```sql
CREATE TABLE bl_node_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID NOT NULL,          -- FK to directus_roles (cross-system)
    node_type_id TEXT NOT NULL,     -- FK to bl_node_types(id)
    allowed BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_bl_node_perms_role_node
    ON bl_node_permissions (role_id, node_type_id);
```

## Data Flow Example: Payment Processing

Complete walkthrough of data movement through all tiers:

1. **Webhook received**: Fastify handler serializes request → `flow:execute:normal` stream
2. **Worker picks up**: Reads `execution_id`, `flow_id`, `trigger_data` from Redis
3. **Load flow**: Cache miss → PostgreSQL query → cache for 1 hour
4. **Initialize context**: Create ExecutionContext with $trigger = trigger_data
5. **Execute fetch_customer**: HTTP request → 2KB response → store inline in $nodes.fetch_customer.data
6. **Execute validate_amount**: Formula result → 50 bytes → store inline
7. **Execute calculate_fee**: Formula result → 100 bytes → store inline
8. **Complete**: Total context ~ 3KB, all inline
   - Serialize $last with serde_json
   - Insert execution record into PostgreSQL
   - Publish event to `flow:events:flow-payment`
   - XACK message from Redis

Large-data scenario:

1. **fetch_large_dataset** node: HTTP response = 50MB
   - Size > 64KB threshold
   - Serialize to MessagePack: ~35MB
   - Compress LZ4: ~15MB
   - Write to S3: `businesslogic-flow/acme-corp/flow-payment/exec-12345/fetch_large_dataset.msgpack.lz4`
   - Write to Redis: same 15MB (30-day TTL)
   - Store reference in context: `{"$ref": "redis:flow:state:exec-12345:fetch_large_dataset"}`
2. **Next node** (e.g., aggregate): Dereference → Redis GET (1ms) → decompress → process
3. **On completion**: Redis TTL expires after 30 days; S3 retained indefinitely for audit

Streaming scenario:

1. **download_video** node: Initiates HTTP GET, `streaming_output: true`
2. **Transcode** node: `streaming_input: true`, processes chunks as they arrive
3. **Upload_output** node: `streaming_input: true`, pipes transcoded chunks directly to S3
4. No entry in `$nodes.download_video` (data never materialized)
5. Memory usage constant regardless of file size
