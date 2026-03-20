# Triggers Documentation

BusinessLogic Flow Engine supports multiple trigger types to initiate flow executions. All triggers follow a consistent enqueue path into Redis streams for reliable, ordered processing.

## Trigger Types

| Trigger | Implementation | Latency to Enqueue |
|---------|---------------|-------------------|
| Webhook | Axum HTTP handler → XADD | <1ms |
| Cron | Tokio timer wheel + cron crate | Sub-second accuracy |
| DB event | PostgreSQL LISTEN/NOTIFY | ~5ms from commit |
| Manual | REST API → XADD | <1ms |
| Flow-to-flow | Node emit → Redis PubSub → Trigger | ~2ms |
| Calculator event | Formula API publishes → Trigger | ~5ms |
| File upload | S3/Directus file event → Trigger | ~10ms |

**Selection criteria:**
- **Webhook** — External events, third-party integrations, API-driven workflows
- **Cron** — Scheduled tasks, periodic reports, cleanup jobs
- **DB event** — React to data changes in Directus collections
- **Manual** — Testing, API-driven execution, ad-hoc runs
- **Flow-to-flow** — Event-driven architecture, flow composition
- **Calculator event** — Trigger on calculator output changes or formula results
- **File upload** — Initiate workflows when files are uploaded to S3 or Directus

## Webhook Trigger

**Endpoint:** `POST /webhook/{flow_id}`

Receives HTTP requests and enqueues them as flow executions.

### Request Format

```http
POST /webhook/550e8400-e29b-41d4-a716-446655440000 HTTP/1.1
Host: flow-trigger.example.com
Content-Type: application/json
X-Signature: sha256=abc123...
X-Timestamp: 2026-03-11T14:30:00Z

{
  "event": "user_created",
  "user_id": 12345,
  "email": "user@example.com"
}
```

### Response Format

```json
{
  "execution_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "enqueued",
  "flow_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

HTTP Status: `202 Accepted`

### Configuration

Webhooks are configured in the Flow model:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Process User Signup",
  "triggers": [
    {
      "type": "webhook",
      "config": {
        "allowed_methods": ["POST"],
        "require_signature": true,
        "signature_secret": "sk_live_abc123",
        "signature_header": "X-Signature",
        "signature_algorithm": "sha256",
        "max_payload_bytes": 1048576,
        "timeout_seconds": 30
      }
    }
  ]
}
```

### Signature Verification (HMAC-SHA256)

If `require_signature` is true, the webhook handler:
1. Extracts `X-Signature` header (format: `algorithm=value`)
2. Reconstructs HMAC-SHA256(body, secret)
3. Compares using timing-safe comparison
4. Rejects request (401) if signatures don't match

Timestamp validation optional (via `X-Timestamp` header and `timestamp_tolerance_seconds`).

### Behavior

1. Receive HTTP POST to `/webhook/{flow_id}`
2. Parse Content-Type: application/json or application/x-www-form-urlencoded
3. If raw body (not JSON), wrap in `{"body": "raw_body_string"}`
4. Validate signature if required
5. Create ExecuteMessage with trigger_data = parsed body
6. Enqueue via XADD (see Enqueue Path below)
7. Return 202 with execution_id
8. Non-blocking: do not wait for flow completion

### Error Responses

- **400 Bad Request** — Invalid JSON, payload too large
- **401 Unauthorized** — Signature verification failed
- **404 Not Found** — Flow ID doesn't exist or is inactive
- **429 Too Many Requests** — Rate limit exceeded
- **500 Internal Server Error** — Enqueue failed (transient Redis error)

## Cron Trigger

**Background task** — Polls every 60 seconds to discover and enqueue scheduled flows.

### Configuration

Crons are configured in the Flow model:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Daily Report Generator",
  "triggers": [
    {
      "type": "cron",
      "config": {
        "expression": "0 9 * * *",
        "timezone": "America/New_York",
        "enabled": true,
        "max_parallel_executions": 1
      }
    }
  ]
}
```

### Cron Expression Format

5-field cron syntax (standard):

```
minute  hour  day-of-month  month  day-of-week
0       9     *             *      *            # Daily at 9:00 AM
30      14    *             *      1-5          # Weekdays at 2:30 PM
0       0     1             *      *            # First day of month at midnight
0       */6   *             *      *            # Every 6 hours
15,45   *     *             *      *            # Every hour at :15 and :45
```

Uses the `cron` crate for parsing and evaluation.

### Timezone Handling

- **Evaluation:** All cron times are evaluated in the specified timezone
- **Default:** UTC if not specified
- **Storage:** Timezone stored in flow config, evaluated on each poll
- **Daylight Saving:** Handled automatically by `chrono-tz` crate

### Polling Mechanism

**Background task (runs continuously):**

```rust
loop {
    // Every 60 seconds:
    let flows = db.query("SELECT * FROM flows WHERE enabled = true AND trigger_type = 'cron'")
        .await?;

    for flow in flows {
        let cron = Cron::new(&flow.trigger_config.expression)?;
        let tz = Tz::try_from(flow.trigger_config.timezone)?;
        let now = Utc::now().with_timezone(&tz);

        if cron.is_active(&now) && !has_executed_in_current_minute(&flow.id) {
            enqueue_execution(flow.id).await?;
            mark_executed(&flow.id, now).await?;
        }
    }

    sleep(Duration::from_secs(60)).await;
}
```

### Deduplication

Redis `SETNX` lock prevents duplicate cron firings:

```
Key: flow:cron_lock:{flow_id}:{minute_timestamp}
TTL: 120 seconds
```

Each poll cycle, the scheduler attempts `SET key 1 NX EX 120`. If the key already exists (another instance or earlier poll already fired), the flow is skipped for that minute.

### Behavior

1. Poll every 60 seconds (configurable via `CRON_POLL_INTERVAL_SECONDS`)
2. Load all enabled flows with cron triggers from PostgreSQL
3. For each flow, evaluate cron expression at current time in configured timezone
4. If expression matches and not yet executed in current minute:
   - Create ExecuteMessage with trigger_data = { "scheduled_at": now }
   - Enqueue via XADD
   - Update `last_cron_execution_at`
5. Continue polling

### Edge Cases

- **Missed execution** — If engine is down when cron fires, next poll within 60 seconds will catch it (runs once)
- **Slow startup** — If engine restarts, cron polls from current time forward (no backlog)
- **Timezone changes** — New timezone takes effect on next poll cycle
- **DST transitions** — Handled by chrono-tz; ambiguous times default to first occurrence

## Database Event Trigger

**Event source:** PostgreSQL LISTEN/NOTIFY on Directus collection changes.

Reacts to INSERT/UPDATE/DELETE events on specified collections.

### Configuration

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Sync User to CRM",
  "triggers": [
    {
      "type": "db_event",
      "config": {
        "collection": "users",
        "events": ["create", "update"],
        "filter": "$event.status == 'active'",
        "exclude_fields": ["password", "api_key"],
        "debounce_ms": 0
      }
    }
  ]
}
```

### Configuration Fields

- **collection** — Directus collection name (e.g., "users", "orders")
- **events** — List of ["create", "update", "delete"]
- **filter** — Optional expression to filter events (evaluated on event data)
- **exclude_fields** — Fields to redact from trigger data (for sensitive data)
- **debounce_ms** — Wait this long before enqueuing (coalesces rapid events)

### Directus Hook Integration

Directus hooks emit to PostgreSQL NOTIFY on data changes:

```javascript
// In Directus extensions/hooks/flow-events.js
export default defineHook({
    handler: ({ collection }, { database, logger }) => {
        database.on(`items.${collection}.create`, async (event) => {
            const channel = `flow:trigger:${collection}:create`;
            const payload = JSON.stringify({
                event: 'create',
                collection,
                item: event.item,
                user_id: event.user,
            });
            // NOTIFY to PostgreSQL
            await database.raw(`SELECT pg_notify(?, ?)`, [channel, payload]);
        });
    }
});
```

### Listener Architecture

**Background task (runs continuously):**

```rust
// Dedicated persistent PostgreSQL connection
let listener = db.listen("flow:trigger:*").await?;

loop {
    if let Ok(notification) = listener.recv().await {
        let (collection, event_type) = parse_channel(&notification.channel)?;
        let event_data = serde_json::from_str(&notification.payload)?;

        // Find flows subscribed to this collection + event
        let flows = db.query(
            "SELECT * FROM flows WHERE trigger_type = 'db_event'
             AND trigger_config->>'collection' = ?
             AND trigger_config->'events' ? ?"
            [&collection, &event_type]
        ).await?;

        for flow in flows {
            if should_trigger(&flow.trigger_config.filter, &event_data) {
                let trigger_data = filter_excluded_fields(&event_data, &flow.trigger_config.exclude_fields);
                enqueue_execution(flow.id, trigger_data).await?;
            }
        }
    }
}
```

### Behavior

1. Maintain persistent PG connection with LISTEN on pattern `flow:trigger:*`
2. When notification received:
   - Parse channel name to extract collection and event type
   - Decode JSON payload
   - Query flows subscribed to this collection + event type
   - Evaluate filter expression on event data
   - Redact excluded fields
   - Enqueue executions
3. Continue listening

### Latency Characteristics

- **Database commit** → **Directus hook fires** — ~1ms
- **Hook calls NOTIFY** → **Listener receives** — ~4ms
- **Listener enqueues** → **Executor picks up** — <1ms
- **Total:** ~5ms

### Edge Cases

- **Lost event** — Connection drops before dequeue: listener reconnects, next event processes normally (no backlog for missed events)
- **Listener down** — If engine crashes, events fire into void. Resume listening on restart.
- **Debounce** — Multiple updates to same item within debounce window → single execution
- **Filter fail** — If filter expression errors, event is skipped (logged)

## Manual Trigger

**Endpoint:** `POST /trigger/{flow_id}`

API endpoint for testing and ad-hoc execution.

### Request Format

```http
POST /trigger/550e8400-e29b-41d4-a716-446655440000 HTTP/1.1
Host: flow-trigger.example.com
Content-Type: application/json
Authorization: Bearer <account_token>

{
  "custom_field": "value",
  "user_id": 12345
}
```

### Response Format

```json
{
  "execution_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "enqueued",
  "flow_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

HTTP Status: `202 Accepted`

### Behavior

Identical to webhook trigger, but:
- No signature verification
- No rate limiting (authenticated)
- No allowed methods restriction
- Used for testing and manual invocations

### Authentication

Requires valid account token (via `Authorization: Bearer` header or query param `token=`).

## Flow-to-Flow Trigger

**Communication:** One flow emits named events, other flows subscribe and execute.

Enables event-driven architecture and flow composition.

### Configuration

**Emitting flow:**

```json
{
  "nodes": [
    {
      "id": "emit_event",
      "type": "core:emit",
      "config": {
        "event_name": "user_processed",
        "data": "$nodes.transform.result"
      }
    }
  ]
}
```

**Receiving flow:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Handle User Processed Event",
  "triggers": [
    {
      "type": "flow_event",
      "config": {
        "source_flow_id": "aabbccdd-eeff-0011-2233-445566778899",
        "event_name": "user_processed"
      }
    }
  ]
}
```

### Flow Emit Node

A built-in node publishes events via Redis PubSub:

```rust
// In emit node handler
async fn emit_handler(input: NodeInput) -> Result<NodeResult> {
    let event_name = input.config["event_name"].as_str().ok_or("missing event_name")?;
    let event_data = &input.config["data"];

    let channel = format!("flow:event:{}:{}", input.execution_context.flow_id, event_name);
    redis.publish(&channel, serde_json::to_string(event_data)?).await?;

    Ok(NodeResult {
        outputs: HashMap::from([("emitted".to_string(), json!(true))]),
        logs: vec![format!("Emitted {} to {}", event_name, channel)],
        elapsed_ms: 5,
    })
}
```

### Event Listener

When a flow with flow_event trigger is active, a background task subscribes to Redis channel:

```rust
let channel = format!("flow:event:{}:*", flow.trigger_config.source_flow_id);
let mut pubsub = redis.subscribe(&channel).await?;

loop {
    if let Ok(message) = pubsub.on_message().recv().await {
        let (_, event_name) = parse_channel(&message.get_channel())?;
        let event_data = serde_json::from_str(message.get_payload())?;

        // Enqueue execution with event data as trigger_data
        enqueue_execution(flow.id, event_data).await?;
    }
}
```

### Behavior

1. Source flow executes emit node
2. Emit node publishes event to Redis channel: `flow:event:{source_flow_id}:{event_name}`
3. Receiving flow's PubSub listener receives message
4. Listener enqueues execution with event data as trigger_data
5. Receiving flow starts executing with `$trigger.field` available

### Latency Characteristics

- **Emit call** → **PubSub publish** — <1ms
- **Publish** → **Subscriber receives** — ~1ms
- **Listener enqueues** → **Executor picks up** — <1ms
- **Total:** ~2ms

## Calculator Event Trigger

**Event source:** Formula API publishes calculator execution events.

Reacts to calculator result changes or threshold breaches.

### Configuration

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Alert on Profit Below Threshold",
  "triggers": [
    {
      "type": "calculator_event",
      "config": {
        "calculator_id": "ddccbbaa-ff00-1122-3344-556677889900",
        "event_type": "output_changed|threshold_breach",
        "watch_fields": ["gross_profit", "net_revenue"],
        "threshold_field": "gross_profit",
        "threshold_value": 10000,
        "threshold_operator": "<",
        "debounce_ms": 5000
      }
    }
  ]
}
```

### Event Types

- **output_changed** — Any output value changes
- **threshold_breach** — Specified field crosses threshold (>= or <= depending on operator)

### Behavior

1. Formula API executes calculator
2. Compares outputs to previous execution
3. If output_changed and watched fields differ:
   - Publishes to Redis channel: `flow:event:calculator:{calculator_id}`
4. If threshold_breach and value crosses threshold:
   - Publishes to same channel
5. Flow's PubSub listener receives and enqueues execution

### Latency Characteristics

- **Calculator execution** → **Event publish** — <1ms
- **Publish** → **Listener receives** — ~1ms
- **Total:** ~2-5ms

## File Upload Trigger

**Event source:** S3 or Directus file upload events.

Reacts to new or updated files in specific folders.

### Configuration

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Process Uploaded CSV",
  "triggers": [
    {
      "type": "file_upload",
      "config": {
        "source": "directus|s3",
        "folder": "imports/",
        "file_types": [".csv", ".xlsx"],
        "max_file_size_bytes": 10485760,
        "require_signature": true
      }
    }
  ]
}
```

### Behavior

1. S3 or Directus file upload event fires
2. Validates file type and size
3. If signature required, validates integrity
4. Enqueues execution with trigger_data:
   ```json
   {
     "file_id": "abc123",
     "file_name": "data.csv",
     "file_size": 1024,
     "mime_type": "text/csv",
     "s3_url": "s3://bucket/path/file.csv",
     "upload_time": "2026-03-11T14:30:00Z"
   }
   ```

### Latency Characteristics

- **File upload complete** → **Event published** — ~5-10ms

## Trigger Service Architecture

The `flow-trigger` binary runs as an Axum HTTP server with three background tasks for multi-trigger coordination.

### Main Server

**Listens on:** `0.0.0.0:PORT` (default: 3100)

**Routes:**
- `GET /health` — Health check (uptime, Redis/PG connectivity)
- `GET /ping` — Simple pong response
- `POST /webhook/{flow_id}` — Webhook trigger (HMAC verified, rate limited)
- `POST /trigger/{flow_id}` — Manual trigger (rate limited)
- `GET /executions/{execution_id}` — Get execution status (account-scoped)
- `GET /executions/{execution_id}/stream` — SSE execution progress stream
- `GET /flows/{flow_id}/executions` — List executions for a flow (account-scoped)
- `POST /flows/validate` — Validate flow graph + permissions (admin auth required)
- `GET /node-types` — List all registered node type metadata (admin auth required)

**Admin auth:** `POST /flows/validate` and `GET /node-types` require `X-Admin-Token` header matching the `ADMIN_TOKEN` env var.

**Rate limiting:** Webhook and manual trigger endpoints enforce per-account RPS (default 50/s) and monthly quota (default 100K) via Redis counters. See `docs/security.md` for details.

**Account scoping:** Execution query endpoints (`GET /executions/*`, `GET /flows/*/executions`) require `account_id` query parameter and filter results by account.

### Background Task 1: Cron Scheduler

Runs every 60 seconds (configurable via `CRON_POLL_INTERVAL_SECONDS`):

```rust
tokio::spawn(async {
    loop {
        poll_cron_triggers().await.log_error();
        sleep(Duration::from_secs(CRON_POLL_INTERVAL_SECONDS)).await;
    }
});
```

Discovers and enqueues scheduled executions.

### Background Task 2: Database Listener

Maintains persistent PostgreSQL connection listening for Directus change notifications:

```rust
tokio::spawn(async {
    loop {
        if let Err(e) = listen_db_events().await {
            error!("DB listener error: {}", e);
            sleep(Duration::from_secs(5)).await; // Reconnect with backoff
        }
    }
});
```

Enqueues executions on INSERT/UPDATE/DELETE events.

### Background Task 3: Health Push

Publishes instance health snapshot to Redis every 15 seconds:

```rust
// Key: flow:triggers:{instance_id}
// TTL: 30 seconds (SETEX)
// Interval: every 15 seconds
// Payload: { instance_id, timestamp, uptime_secs, requests_total }
```

TTL: 30 seconds. If a heartbeat is missed, the key expires automatically. Used by load balancer for instance discovery.

### Graceful Shutdown

On `SIGTERM`:

```rust
async fn shutdown_signal() {
    tokio::signal::ctrl_c().await.expect("Failed to install CTRL+C signal handler");
    info!("Shutdown signal received");

    // Stop accepting new requests
    // Wait for in-flight handlers to complete (timeout: 30 seconds)
    // Close Redis/DB connections
    // Exit
}
```

## Enqueue Path

All triggers follow the same path to Redis for reliable, ordered processing:

### ExecuteMessage Structure

```rust
pub struct ExecuteMessage {
    pub execution_id: Uuid,
    pub flow_id: Uuid,
    pub account_id: Uuid,
    pub trigger_data: serde_json::Value,
    pub priority: ExecutionPriority,  // Normal, High, Low
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,    // TTL: 24 hours
}

pub enum ExecutionPriority {
    High = 0,
    Normal = 1,
    Low = 2,
}
```

### Enqueue Steps

1. **Create ExecuteMessage**
   ```rust
   let msg = ExecuteMessage {
       execution_id: Uuid::new_v4(),
       flow_id: flow.id,
       account_id: account.id,
       trigger_data: request_body,
       priority: ExecutionPriority::Normal,
       created_at: Utc::now(),
       expires_at: Utc::now() + Duration::hours(24),
   };
   ```

2. **Serialize fields for Redis**
   ```rust
   let stream_entry = redis::StreamEntry {
       id: msg.execution_id.to_string(),
       fields: [
           ("flow_id", msg.flow_id.to_string()),
           ("account_id", msg.account_id.to_string()),
           ("trigger_data", serde_json::to_string(&msg.trigger_data)?),
           ("priority", msg.priority as u8),
           ("created_at", msg.created_at.to_rfc3339()),
       ],
   };
   ```

3. **XADD to priority stream**
   ```rust
   let stream_key = format!("flow:execute:{}", msg.priority as u8);
   let entry_id = redis.xadd(&stream_key, "*", &fields).await?;
   ```

   Streams:
   - `flow:execute:0` — High priority
   - `flow:execute:1` — Normal priority
   - `flow:execute:2` — Low priority

4. **Return execution_id to caller**
   ```rust
   Ok((StatusCode::ACCEPTED, Json(json!({
       "execution_id": msg.execution_id,
       "status": "enqueued",
       "flow_id": msg.flow_id,
   }))))
   ```

### Stream Consumption

The `flow-executor` binary consumes from priority streams in order:

```rust
loop {
    // Poll high priority first, then normal, then low
    for priority in [0, 1, 2] {
        let stream_key = format!("flow:execute:{}", priority);
        let entries = redis.xread(&stream_key, "$", count=BATCH_SIZE).await?;

        for entry in entries {
            let msg = ExecuteMessage::from_redis_entry(&entry)?;
            execute_flow(&msg).await?;
            redis.xack(&stream_key, &msg.execution_id).await?;
        }
    }

    sleep(Duration::from_millis(100)).await; // Poll interval
}
```

### Guarantees

- **At-least-once:** Entries remain in stream until acknowledged (XACK)
- **Ordered:** Within same priority level, FIFO order maintained
- **Expiration:** Entries auto-expire after 24 hours (handled by separate cleanup task)
- **No loss:** If executor crashes mid-execution, message remains and is retried on recovery
