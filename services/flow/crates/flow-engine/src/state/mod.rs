//! Execution state management — tiered storage for payloads and checkpointing.
//!
//! # Tiers
//! - **Inline**: Payloads < 64KB stored directly in ExecutionContext
//! - **Reference**: Payloads 64KB-100MB stored in Redis with "$ref:redis:..." pointer
//! - **Streaming**: Payloads > 100MB piped directly between nodes (Phase 3)
//!
//! # Checkpointing
//! After each node completes, executor can checkpoint state to Redis.
//! Crashed workers recover via XCLAIM + checkpoint load.

use flow_common::context::INLINE_THRESHOLD;
use petgraph::graph::NodeIndex;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

/// Reference tier key prefix.
const REF_PREFIX: &str = "$ref:redis:";

/// Default TTL for reference tier entries (1 hour).
const REFERENCE_TTL_SECS: i64 = 3600;

/// Default TTL for checkpoints (flow timeout + 5min buffer).
const CHECKPOINT_BUFFER_SECS: i64 = 300;

/// Check if a payload exceeds the inline threshold.
pub fn exceeds_inline_threshold(data: &serde_json::Value) -> bool {
    // Quick estimate: serialize to vec and check length
    serde_json::to_vec(data)
        .map(|v| v.len() > INLINE_THRESHOLD)
        .unwrap_or(false)
}

/// Build a reference key for a node's output.
pub fn reference_key(execution_id: Uuid, node_id: &str) -> String {
    format!("flow:state:{}:{}", execution_id, node_id)
}

/// Build a reference pointer string.
pub fn reference_pointer(execution_id: Uuid, node_id: &str) -> String {
    format!("{}{}", REF_PREFIX, reference_key(execution_id, node_id))
}

/// Check if a value is a reference pointer.
pub fn is_reference(value: &serde_json::Value) -> bool {
    value.as_str().is_some_and(|s| s.starts_with(REF_PREFIX))
}

/// Extract the Redis key from a reference pointer.
pub fn extract_reference_key(pointer: &str) -> Option<&str> {
    pointer.strip_prefix(REF_PREFIX)
}

// ── Reference Tier (Redis) ──────────────────────────────────────────────────

/// Store a large payload in Redis, returning the reference pointer.
pub async fn store_reference(
    pool: &deadpool_redis::Pool,
    execution_id: Uuid,
    node_id: &str,
    payload: &serde_json::Value,
) -> Result<String, anyhow::Error> {
    let key = reference_key(execution_id, node_id);
    let encoded = rmp_serde::to_vec(payload)
        .map_err(|e| anyhow::anyhow!("reference tier: msgpack encode failed: {}", e))?;

    let mut conn = pool.get().await
        .map_err(|e| anyhow::anyhow!("reference tier: redis pool error: {}", e))?;

    redis::cmd("SETEX")
        .arg(&key)
        .arg(REFERENCE_TTL_SECS)
        .arg(&encoded)
        .query_async::<String>(&mut *conn)
        .await
        .map_err(|e| anyhow::anyhow!("reference tier: redis SET failed: {}", e))?;

    tracing::debug!(
        key = %key,
        size_bytes = encoded.len(),
        "stored reference tier payload"
    );

    Ok(reference_pointer(execution_id, node_id))
}

/// Resolve a reference pointer back to its payload.
pub async fn resolve_reference(
    pool: &deadpool_redis::Pool,
    ref_pointer: &str,
) -> Result<serde_json::Value, anyhow::Error> {
    let key = extract_reference_key(ref_pointer)
        .ok_or_else(|| anyhow::anyhow!("invalid reference pointer: {}", ref_pointer))?;

    let mut conn = pool.get().await
        .map_err(|e| anyhow::anyhow!("reference tier: redis pool error: {}", e))?;

    let data: Option<Vec<u8>> = redis::cmd("GET")
        .arg(key)
        .query_async(&mut *conn)
        .await
        .map_err(|e| anyhow::anyhow!("reference tier: redis GET failed: {}", e))?;

    match data {
        Some(bytes) => {
            let value: serde_json::Value = rmp_serde::from_slice(&bytes)
                .map_err(|e| anyhow::anyhow!("reference tier: msgpack decode failed: {}", e))?;
            Ok(value)
        }
        None => Err(anyhow::anyhow!("reference not found: {}", key)),
    }
}

// ── Checkpointing ───────────────────────────────────────────────────────────

/// Checkpoint key for an execution.
fn checkpoint_key(execution_id: Uuid) -> String {
    format!("flow:checkpoint:{}", execution_id)
}

/// Serializable checkpoint state.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct Checkpoint {
    /// Serialized ExecutionContext.
    pub context: serde_json::Value,
    /// Completed node indices (as usize for serialization).
    pub completed: Vec<u32>,
    /// Loop iteration counters: (from_idx, to_idx) -> count.
    pub loop_iterations: HashMap<String, u32>,
}

/// Save execution checkpoint to Redis after a node completes.
pub async fn checkpoint_execution(
    pool: &deadpool_redis::Pool,
    execution_id: Uuid,
    context: &flow_common::context::ExecutionContext,
    completed: &HashSet<NodeIndex>,
    loop_iterations: &HashMap<(NodeIndex, NodeIndex), u32>,
    ttl_secs: i64,
) -> Result<(), anyhow::Error> {
    let key = checkpoint_key(execution_id);

    let checkpoint = Checkpoint {
        context: serde_json::to_value(context)
            .map_err(|e| anyhow::anyhow!("checkpoint: serialize context failed: {}", e))?,
        completed: completed.iter().map(|idx| idx.index() as u32).collect(),
        loop_iterations: loop_iterations
            .iter()
            .map(|((from, to), count)| {
                (format!("{}:{}", from.index(), to.index()), *count)
            })
            .collect(),
    };

    let encoded = rmp_serde::to_vec(&checkpoint)
        .map_err(|e| anyhow::anyhow!("checkpoint: msgpack encode failed: {}", e))?;

    let ttl = ttl_secs + CHECKPOINT_BUFFER_SECS;

    let mut conn = pool.get().await
        .map_err(|e| anyhow::anyhow!("checkpoint: redis pool error: {}", e))?;

    redis::cmd("SETEX")
        .arg(&key)
        .arg(ttl)
        .arg(&encoded)
        .query_async::<String>(&mut *conn)
        .await
        .map_err(|e| anyhow::anyhow!("checkpoint: redis SET failed: {}", e))?;

    tracing::trace!(
        execution_id = %execution_id,
        completed_nodes = completed.len(),
        "checkpointed execution"
    );

    Ok(())
}

/// Load a checkpoint from Redis for resuming execution.
pub async fn load_checkpoint(
    pool: &deadpool_redis::Pool,
    execution_id: Uuid,
) -> Result<Option<Checkpoint>, anyhow::Error> {
    let key = checkpoint_key(execution_id);

    let mut conn = pool.get().await
        .map_err(|e| anyhow::anyhow!("checkpoint: redis pool error: {}", e))?;

    let data: Option<Vec<u8>> = redis::cmd("GET")
        .arg(&key)
        .query_async(&mut *conn)
        .await
        .map_err(|e| anyhow::anyhow!("checkpoint: redis GET failed: {}", e))?;

    match data {
        Some(bytes) => {
            let checkpoint: Checkpoint = rmp_serde::from_slice(&bytes)
                .map_err(|e| anyhow::anyhow!("checkpoint: msgpack decode failed: {}", e))?;
            tracing::info!(
                execution_id = %execution_id,
                completed_nodes = checkpoint.completed.len(),
                "loaded checkpoint for resumption"
            );
            Ok(Some(checkpoint))
        }
        None => Ok(None),
    }
}

/// Delete a checkpoint after successful execution.
pub async fn delete_checkpoint(
    pool: &deadpool_redis::Pool,
    execution_id: Uuid,
) -> Result<(), anyhow::Error> {
    let key = checkpoint_key(execution_id);

    let mut conn = pool.get().await
        .map_err(|e| anyhow::anyhow!("checkpoint: redis pool error: {}", e))?;

    redis::cmd("DEL")
        .arg(&key)
        .query_async::<i32>(&mut *conn)
        .await
        .map_err(|e| anyhow::anyhow!("checkpoint: redis DEL failed: {}", e))?;

    Ok(())
}
