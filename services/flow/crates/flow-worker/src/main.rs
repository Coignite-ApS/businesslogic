//! Execution worker for BusinessLogic flows.
//!
//! Consumes ExecuteMessages from Redis Streams and executes flows.
//! Multiple workers can run in parallel, each processing one message at a time.

use chrono::Utc;
use flow_common::flow::{FlowDef, FlowStatus, Priority};
use flow_common::message::{ExecuteMessage, ExecutionEvent, ExecutionEventType};
use flow_engine::executor::{ExecutionResult, ExecutionStatus};
use flow_engine::nodes::NodeRegistry;
#[allow(unused_imports)]
use redis::AsyncCommands;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tracing::{error, info, warn};
use uuid::Uuid;

/// Max XACK retry attempts before logging error and moving on.
const XACK_MAX_RETRIES: u32 = 3;

/// Default graceful shutdown timeout (configurable via SHUTDOWN_TIMEOUT_SECS).
const DEFAULT_SHUTDOWN_TIMEOUT_SECS: u64 = 30;

/// Worker state shared across message processing.
#[derive(Clone)]
struct WorkerState {
    redis_pool: deadpool_redis::Pool,
    postgres_pool: sqlx::postgres::PgPool,
    worker_id: Uuid,
    registry: Arc<NodeRegistry>,
    messages_processed: Arc<AtomicU64>,
    active_executions: Arc<AtomicU64>,
    started_at: chrono::DateTime<Utc>,
    shutting_down: Arc<AtomicBool>,
}

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .with_writer(std::io::stdout)
        .init();

    info!("Starting BusinessLogic Flow Worker");

    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost".to_string());
    let postgres_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://localhost/flow".to_string());
    let db_pool_size: u32 = std::env::var("DATABASE_POOL_SIZE")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10);
    let shutdown_timeout_secs: u64 = std::env::var("SHUTDOWN_TIMEOUT_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_SHUTDOWN_TIMEOUT_SECS);

    // Initialize Redis connection pool
    let cfg = deadpool_redis::Config::from_url(&redis_url);
    let redis_pool = cfg.create_pool(Some(deadpool_redis::Runtime::Tokio1))?;

    // Test Redis connection
    match redis_pool.get().await {
        Ok(mut conn) => match redis::cmd("PING")
            .query_async::<String>(&mut *conn)
            .await
        {
            Ok(pong) => info!("Redis connected: {}", pong),
            Err(e) => error!("Redis PING failed: {}", e),
        },
        Err(e) => error!("Failed to get Redis connection: {}", e),
    }

    // Initialize PostgreSQL connection pool (M2: configurable pool size)
    let postgres_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(db_pool_size)
        .connect(&postgres_url)
        .await?;

    info!("PostgreSQL connected (pool_size={})", db_pool_size);

    let worker_id = Uuid::new_v4();

    // Pre-warm embedding model if ai-nodes feature is enabled
    #[cfg(feature = "ai-nodes")]
    {
        info!("Pre-warming AI models...");
        flow_engine::nodes::ai::embedding::prewarm_model();
    }

    let registry = Arc::new(NodeRegistry::with_pools(
        Some(redis_pool.clone()),
        Some(postgres_pool.clone()),
    ));

    let state = WorkerState {
        redis_pool,
        postgres_pool,
        worker_id,
        registry,
        messages_processed: Arc::new(AtomicU64::new(0)),
        active_executions: Arc::new(AtomicU64::new(0)),
        started_at: Utc::now(),
        shutting_down: Arc::new(AtomicBool::new(false)),
    };

    // Create consumer groups — H5: fail hard on non-BUSYGROUP errors
    ensure_consumer_groups(&state).await?;

    // Start background tasks
    let state_clone = state.clone();
    tokio::spawn(health_push_task(state_clone));

    let state_clone = state.clone();
    tokio::spawn(xclaim_recovery_task(state_clone));

    // Setup SIGTERM handler
    let mut shutdown =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;

    info!("Worker {} ready, consuming messages", worker_id);

    // Main loop
    loop {
        tokio::select! {
            _ = shutdown.recv() => {
                info!("Received SIGTERM, shutting down gracefully");
                state.shutting_down.store(true, Ordering::SeqCst);
                break;
            }
            _ = process_one_batch(&state) => {}
        }
    }

    // M4: Graceful shutdown — wait for in-flight executions with configurable timeout
    let active = state.active_executions.load(Ordering::SeqCst);
    if active > 0 {
        info!(
            "Waiting for {} in-flight executions (timeout={}s)",
            active, shutdown_timeout_secs
        );
        let deadline =
            tokio::time::Instant::now() + tokio::time::Duration::from_secs(shutdown_timeout_secs);
        loop {
            let remaining = state.active_executions.load(Ordering::SeqCst);
            if remaining == 0 {
                info!("All in-flight executions completed");
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                warn!(
                    "Shutdown timeout reached with {} executions still in flight",
                    remaining
                );
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    }

    info!("Worker {} shut down gracefully", worker_id);
    Ok(())
}

/// Ensure Redis consumer groups exist.
/// H5: Only ignores BUSYGROUP (already exists). Other errors are fatal at startup.
async fn ensure_consumer_groups(state: &WorkerState) -> Result<(), anyhow::Error> {
    let streams = [
        "flow:execute:critical",
        "flow:execute:normal",
        "flow:execute:batch",
    ];

    let mut conn = state.redis_pool.get().await?;
    for stream in &streams {
        let result: Result<String, _> = redis::cmd("XGROUP")
            .arg("CREATE")
            .arg(*stream)
            .arg("workers")
            .arg("0")
            .arg("MKSTREAM")
            .query_async(&mut *conn)
            .await;

        match result {
            Ok(_) => info!("Created consumer group for {}", stream),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("BUSYGROUP") {
                    // Already exists — expected
                } else {
                    return Err(anyhow::anyhow!(
                        "Failed to create consumer group for {}: {}",
                        stream,
                        e
                    ));
                }
            }
        }
    }
    Ok(())
}

/// Process one batch of messages from the priority queues.
/// C3: Weighted read — critical gets COUNT 10, normal 5, batch 1.
async fn process_one_batch(state: &WorkerState) {
    let queues: [(Priority, usize); 3] = [
        (Priority::Critical, 10),
        (Priority::Normal, 5),
        (Priority::Batch, 1),
    ];

    for (priority, count) in &queues {
        let stream_key = priority.stream_key();

        match read_and_process_stream(state, stream_key, *count).await {
            Ok(processed) => {
                if processed > 0 {
                    info!("Processed {} messages from {}", processed, stream_key);
                }
            }
            Err(e) => {
                error!("Error processing stream {}: {}", stream_key, e);
            }
        }
    }

    // BLOCK in XREADGROUP handles wait; small sleep only if all streams empty
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
}

/// Read and process messages from a single Redis Stream.
/// C3: COUNT parameter controls how many messages to read per priority level.
async fn read_and_process_stream(
    state: &WorkerState,
    stream_key: &str,
    count: usize,
) -> Result<usize, anyhow::Error> {
    let mut redis_conn = state.redis_pool.get().await?;

    // Use redis StreamReadReply for proper typed parsing
    let response: redis::streams::StreamReadReply = match redis::cmd("XREADGROUP")
        .arg("GROUP")
        .arg("workers")
        .arg(state.worker_id.to_string())
        .arg("COUNT")
        .arg(count)
        .arg("BLOCK")
        .arg(1000) // 1s block to avoid busy-loop
        .arg("STREAMS")
        .arg(stream_key)
        .arg(">")
        .query_async(&mut *redis_conn)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            // Nil reply = no messages, not an error
            let msg = e.to_string();
            if msg.contains("nil") || msg.contains("response was nil") {
                return Ok(0);
            }
            return Err(e.into());
        }
    };

    let mut messages: Vec<(String, Vec<(String, String)>)> = Vec::new();
    for stream_key_result in &response.keys {
        for msg in &stream_key_result.ids {
            let fields: Vec<(String, String)> = msg
                .map
                .iter()
                .filter_map(|(k, v)| {
                    if let redis::Value::BulkString(bytes) = v {
                        String::from_utf8(bytes.clone())
                            .ok()
                            .map(|s| (k.clone(), s))
                    } else {
                        None
                    }
                })
                .collect();
            messages.push((msg.id.clone(), fields));
        }
    }

    let mut processed = 0;

    for (msg_id, fields) in messages {
        match ExecuteMessage::from_redis_fields(&fields) {
            Ok(message) => {
                // Track active executions for graceful shutdown (M4)
                state.active_executions.fetch_add(1, Ordering::SeqCst);

                let exec_result = execute_flow(state, &message).await;

                state.active_executions.fetch_sub(1, Ordering::SeqCst);

                match exec_result {
                    Ok(persist_ok) => {
                        if persist_ok {
                            // C2+C4: Only XACK if execution AND persistence succeeded
                            xack_with_retry(&mut redis_conn, stream_key, &msg_id).await;
                            state.messages_processed.fetch_add(1, Ordering::Relaxed);
                            processed += 1;
                        } else {
                            // C4: Persist failed — don't XACK, message will redeliver
                            warn!(
                                "Skipping XACK for execution_id={} — persist failed, will redeliver",
                                message.execution_id
                            );
                        }
                    }
                    Err(e) => {
                        error!(
                            "Flow execution failed for execution_id={}: {}",
                            message.execution_id, e
                        );
                        // ACK on execution failure to prevent infinite retry
                        // (the error is recorded in the execution result)
                        xack_with_retry(&mut redis_conn, stream_key, &msg_id).await;
                        state.messages_processed.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
            Err(e) => {
                warn!("Failed to parse ExecuteMessage: {}", e);
                xack_with_retry(&mut redis_conn, stream_key, &msg_id).await;
            }
        }
    }

    Ok(processed)
}

/// C2: XACK with retry. Logs error if all retries fail.
async fn xack_with_retry(
    conn: &mut deadpool_redis::Connection,
    stream_key: &str,
    msg_id: &str,
) {
    for attempt in 0..XACK_MAX_RETRIES {
        match redis::cmd("XACK")
            .arg(stream_key)
            .arg("workers")
            .arg(msg_id)
            .query_async::<i32>(&mut **conn)
            .await
        {
            Ok(_) => return,
            Err(e) => {
                if attempt + 1 < XACK_MAX_RETRIES {
                    warn!(
                        "XACK failed (attempt {}/{}): {} — retrying",
                        attempt + 1,
                        XACK_MAX_RETRIES,
                        e
                    );
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                } else {
                    error!(
                        "XACK failed after {} retries for msg_id={} on {}: {}",
                        XACK_MAX_RETRIES, msg_id, stream_key, e
                    );
                }
            }
        }
    }
}

/// Execute a single flow from an ExecuteMessage.
/// Returns Ok(true) if execution + persistence succeeded,
/// Ok(false) if execution succeeded but persistence failed,
/// Err if execution itself failed.
async fn execute_flow(state: &WorkerState, message: &ExecuteMessage) -> Result<bool, anyhow::Error> {
    info!(
        "Executing flow: execution_id={}, flow_id={}",
        message.execution_id, message.flow_id
    );

    // Load flow definition from PostgreSQL
    let flow_def = load_flow_definition(state, &message.flow_id).await?;

    // Publish execution started event
    let _ = publish_execution_event(
        state,
        message.execution_id,
        message.flow_id,
        ExecutionEventType::Started,
    )
    .await;

    // Build env vars (filtered for this flow)
    let env_vars: HashMap<String, String> = std::env::vars()
        .filter(|(k, _)| k.starts_with("FLOW_ENV_"))
        .map(|(k, v)| (k.trim_start_matches("FLOW_ENV_").to_string(), v))
        .collect();

    // Execute via the engine (pass Redis pool for reference tier + checkpointing)
    let result = flow_engine::executor::execute_flow(
        &flow_def,
        message.trigger_data.clone(),
        &state.registry,
        env_vars,
        Some(message.execution_id),
        Some(state.redis_pool.clone()),
    )
    .await;

    match result {
        Ok(exec_result) => {
            // C4: Persist to PostgreSQL — track success for XACK decision
            let persist_ok = match persist_execution_result(state, message, &exec_result).await {
                Ok(()) => true,
                Err(e) => {
                    error!(
                        "Failed to persist execution result for execution_id={}: {}",
                        message.execution_id, e
                    );
                    false
                }
            };

            let event = match exec_result.status {
                ExecutionStatus::Completed => ExecutionEventType::Completed {
                    duration_ms: exec_result.duration_ms,
                },
                ExecutionStatus::Failed => ExecutionEventType::Failed {
                    error: exec_result
                        .error
                        .clone()
                        .unwrap_or_else(|| "unknown".to_string()),
                },
                ExecutionStatus::TimedOut | ExecutionStatus::Cancelled => ExecutionEventType::Failed {
                    error: format!("timed out after {}ms", exec_result.duration_ms),
                },
            };

            let _ = publish_execution_event(
                state,
                message.execution_id,
                message.flow_id,
                event,
            )
            .await;

            if exec_result.status == ExecutionStatus::Failed {
                return Err(anyhow::anyhow!(
                    exec_result.error.unwrap_or_else(|| "execution failed".to_string())
                ));
            }

            info!(
                "Flow execution completed: execution_id={}, duration={}ms, nodes={}",
                message.execution_id, exec_result.duration_ms, exec_result.nodes_executed
            );
            Ok(persist_ok)
        }
        Err(e) => {
            let _ = publish_execution_event(
                state,
                message.execution_id,
                message.flow_id,
                ExecutionEventType::Failed {
                    error: e.to_string(),
                },
            )
            .await;
            Err(e.into())
        }
    }
}

/// Load flow definition from PostgreSQL.
async fn load_flow_definition(
    state: &WorkerState,
    flow_id: &Uuid,
) -> Result<FlowDef, anyhow::Error> {
    info!("Loading flow definition for {}", flow_id);

    let row = sqlx::query_as::<_, FlowRow>(
        "SELECT id, name, description, account_id, status, graph, trigger_config, settings, version
         FROM bl_flows WHERE id = $1 AND status = 'active'",
    )
    .bind(flow_id)
    .fetch_optional(&state.postgres_pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("flow not found or not active: {}", flow_id))?;

    Ok(FlowDef {
        id: row.id,
        name: row.name,
        description: row.description,
        account_id: row.account_id,
        status: FlowStatus::Active,
        graph: serde_json::from_value(row.graph)?,
        trigger_config: serde_json::from_value(row.trigger_config)?,
        settings: serde_json::from_value(row.settings).unwrap_or_default(),
        version: row.version,
    })
}

#[derive(sqlx::FromRow)]
#[allow(dead_code)]
struct FlowRow {
    id: Uuid,
    name: String,
    description: Option<String>,
    account_id: Uuid,
    status: String,
    graph: serde_json::Value,
    trigger_config: serde_json::Value,
    settings: serde_json::Value,
    version: i32,
}

/// Persist execution result to bl_flow_executions.
async fn persist_execution_result(
    state: &WorkerState,
    message: &ExecuteMessage,
    result: &ExecutionResult,
) -> Result<(), anyhow::Error> {
    let status = match result.status {
        ExecutionStatus::Completed => "completed",
        ExecutionStatus::Failed => "failed",
        ExecutionStatus::TimedOut | ExecutionStatus::Cancelled => "timed_out",
    };

    let context_json = serde_json::to_value(&result.context)?;
    let trigger_json = &message.trigger_data;
    let result_json = result
        .context
        .last
        .as_ref()
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    sqlx::query(
        "INSERT INTO bl_flow_executions
         (id, flow_id, account_id, status, trigger_data, context, result, error, duration_ms, nodes_executed, cost_usd, worker_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)"
    )
    .bind(result.execution_id)
    .bind(message.flow_id)
    .bind(message.account_id)
    .bind(status)
    .bind(trigger_json)
    .bind(context_json)
    .bind(result_json)
    .bind(result.error.as_deref())
    .bind(result.duration_ms as i64)
    .bind(result.nodes_executed as i32)
    .bind(result.context.meta.cumulative_cost_usd)
    .bind(state.worker_id)
    .execute(&state.postgres_pool)
    .await?;

    Ok(())
}

/// Publish an execution event via Redis PubSub.
async fn publish_execution_event(
    state: &WorkerState,
    execution_id: Uuid,
    flow_id: Uuid,
    event_type: ExecutionEventType,
) -> Result<(), anyhow::Error> {
    let event = ExecutionEvent {
        execution_id,
        flow_id,
        event_type,
        timestamp: Utc::now(),
        data: None,
    };

    let mut redis_conn = state.redis_pool.get().await?;
    let channel = format!("flow:events:{}", flow_id);
    let payload = serde_json::to_string(&event)?;

    redis::cmd("PUBLISH")
        .arg(&channel)
        .arg(&payload)
        .query_async::<i32>(&mut *redis_conn)
        .await?;

    Ok(())
}

/// Background task: XCLAIM recovery every 60s for messages idle >5min.
/// Claims abandoned messages from other consumers and re-processes them.
async fn xclaim_recovery_task(state: WorkerState) {
    info!("XCLAIM recovery task started");

    let streams = [
        "flow:execute:critical",
        "flow:execute:normal",
        "flow:execute:batch",
    ];
    let idle_threshold_ms: u64 = 300_000; // 5 minutes

    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;

        if state.shutting_down.load(Ordering::SeqCst) {
            break;
        }

        for stream in &streams {
            if let Err(e) = xclaim_idle_messages(&state, stream, idle_threshold_ms).await {
                warn!("XCLAIM scan failed for {}: {}", stream, e);
            }
        }
    }
}

/// Scan for idle messages in a stream and claim them via XAUTOCLAIM.
async fn xclaim_idle_messages(
    state: &WorkerState,
    stream_key: &str,
    idle_threshold_ms: u64,
) -> Result<(), anyhow::Error> {
    let mut conn = state.redis_pool.get().await?;

    // Use XAUTOCLAIM (Redis 6.2+) to claim idle messages in one call.
    // Returns: [next_start_id, [[id, [field, value, ...]], ...], [deleted_ids]]
    let result: redis::Value = redis::cmd("XAUTOCLAIM")
        .arg(stream_key)
        .arg("workers")
        .arg(state.worker_id.to_string())
        .arg(idle_threshold_ms)
        .arg("0-0")
        .arg("COUNT")
        .arg(10)
        .query_async(&mut *conn)
        .await?;

    // Parse XAUTOCLAIM response manually
    let entries = match &result {
        redis::Value::Array(arr) if arr.len() >= 2 => {
            match &arr[1] {
                redis::Value::Array(messages) => messages.clone(),
                _ => return Ok(()),
            }
        }
        _ => return Ok(()),
    };

    for entry in &entries {
        let redis::Value::Array(msg_parts) = entry else {
            continue;
        };
        if msg_parts.len() < 2 {
            continue;
        }

        // Extract message ID
        let msg_id = match &msg_parts[0] {
            redis::Value::BulkString(bytes) => String::from_utf8_lossy(bytes).to_string(),
            _ => continue,
        };

        // Extract fields
        let fields: Vec<(String, String)> = match &msg_parts[1] {
            redis::Value::Array(field_vals) => {
                field_vals
                    .chunks(2)
                    .filter_map(|chunk| {
                        if chunk.len() == 2 {
                            let k = match &chunk[0] {
                                redis::Value::BulkString(b) => String::from_utf8(b.clone()).ok()?,
                                _ => return None,
                            };
                            let v = match &chunk[1] {
                                redis::Value::BulkString(b) => String::from_utf8(b.clone()).ok()?,
                                _ => return None,
                            };
                            Some((k, v))
                        } else {
                            None
                        }
                    })
                    .collect()
            }
            _ => continue,
        };

        match flow_common::message::ExecuteMessage::from_redis_fields(&fields) {
            Ok(message) => {
                info!(
                    execution_id = %message.execution_id,
                    msg_id = %msg_id,
                    "re-processing auto-claimed message"
                );
                state.active_executions.fetch_add(1, Ordering::SeqCst);
                let _ = execute_flow(state, &message).await;
                state.active_executions.fetch_sub(1, Ordering::SeqCst);

                xack_with_retry(&mut conn, stream_key, &msg_id).await;
                state.messages_processed.fetch_add(1, Ordering::Relaxed);
            }
            Err(e) => {
                warn!("Failed to parse claimed message: {}", e);
                xack_with_retry(&mut conn, stream_key, &msg_id).await;
            }
        }
    }

    Ok(())
}

/// Background task: Health push every 15s with 30s TTL.
async fn health_push_task(state: WorkerState) {
    info!("Health push task started");

    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;

        let key = format!("flow:workers:{}", state.worker_id);
        let uptime_secs = (Utc::now() - state.started_at).num_seconds();
        let processed = state.messages_processed.load(Ordering::Relaxed);

        let health = serde_json::json!({
            "worker_id": state.worker_id.to_string(),
            "timestamp": Utc::now().to_rfc3339(),
            "uptime_secs": uptime_secs,
            "messages_processed": processed,
            "active_executions": state.active_executions.load(Ordering::Relaxed),
        });

        if let Ok(mut conn) = state.redis_pool.get().await {
            let payload = serde_json::to_string(&health).unwrap_or_default();
            let _: Result<(), _> = redis::cmd("SETEX")
                .arg(&key)
                .arg(30)
                .arg(&payload)
                .query_async(&mut *conn)
                .await;
        }
    }
}
