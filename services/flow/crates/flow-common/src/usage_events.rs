//! Usage event emitter for the flow engine.
//!
//! Pushes events to the Redis stream `bl:usage_events:in` matching the
//! `UsageEventEnvelope` JSON schema defined in `@coignite/bl-events`.
//! Fire-and-forget: all errors are logged as WARN, never propagated.

use chrono::Utc;
use serde::Serialize;
use serde_json::json;
use tracing::warn;
use uuid::Uuid;

pub const USAGE_STREAM_KEY: &str = "bl:usage_events:in";
const STREAM_MAXLEN: usize = 100_000;

/// Mirrors UsageEventEnvelope from @coignite/bl-events.
#[derive(Debug, Serialize)]
pub struct UsageEventEnvelope {
    pub account_id: Uuid,
    pub api_key_id: Option<Uuid>,
    pub module: &'static str,
    pub event_kind: &'static str,
    pub quantity: f64,
    pub cost_eur: Option<f64>,
    pub metadata: serde_json::Value,
    pub occurred_at: String,
}

impl UsageEventEnvelope {
    fn new(
        account_id: Uuid,
        api_key_id: Option<Uuid>,
        event_kind: &'static str,
        quantity: f64,
        metadata: serde_json::Value,
    ) -> Self {
        UsageEventEnvelope {
            account_id,
            api_key_id,
            module: "flows",
            event_kind,
            quantity,
            cost_eur: None,
            metadata,
            occurred_at: Utc::now().to_rfc3339(),
        }
    }
}

/// Emit a flow.execution event (fire-and-forget).
pub async fn emit_flow_execution(
    redis_pool: &deadpool_redis::Pool,
    account_id: Uuid,
    flow_id: Uuid,
    duration_ms: u64,
    status: &str,
) {
    let envelope = UsageEventEnvelope::new(
        account_id,
        None,
        "flow.execution",
        1.0,
        json!({
            "flow_id": flow_id.to_string(),
            "duration_ms": duration_ms,
            "status": status,
        }),
    );
    emit(redis_pool, &envelope).await;
}

/// Emit a flow.step event (fire-and-forget).
pub async fn emit_flow_step(
    redis_pool: &deadpool_redis::Pool,
    account_id: Uuid,
    flow_id: Uuid,
    step_id: &str,
    step_kind: &str,
    duration_ms: u64,
) {
    let envelope = UsageEventEnvelope::new(
        account_id,
        None,
        "flow.step",
        1.0,
        json!({
            "flow_id": flow_id.to_string(),
            "step_id": step_id,
            "step_kind": step_kind,
            "duration_ms": duration_ms,
        }),
    );
    emit(redis_pool, &envelope).await;
}

/// Emit a flow.failed event (fire-and-forget).
pub async fn emit_flow_failed(
    redis_pool: &deadpool_redis::Pool,
    account_id: Uuid,
    flow_id: Uuid,
    step_id: Option<&str>,
    error: &str,
) {
    let envelope = UsageEventEnvelope::new(
        account_id,
        None,
        "flow.failed",
        1.0,
        json!({
            "flow_id": flow_id.to_string(),
            "step_id": step_id,
            "error": &error[..error.len().min(500)],
        }),
    );
    emit(redis_pool, &envelope).await;
}

/// Push one event envelope to the Redis stream. Catches all errors.
async fn emit(redis_pool: &deadpool_redis::Pool, envelope: &UsageEventEnvelope) {
    let payload = match serde_json::to_string(envelope) {
        Ok(p) => p,
        Err(e) => {
            warn!("[usage-events] serialize failed: {}", e);
            return;
        }
    };

    let conn = match redis_pool.get().await {
        Ok(c) => c,
        Err(e) => {
            warn!("[usage-events] Redis pool unavailable: {}", e);
            return;
        }
    };

    let mut conn = conn;
    let result: Result<(), _> = redis::cmd("XADD")
        .arg(USAGE_STREAM_KEY)
        .arg("MAXLEN")
        .arg("~")
        .arg(STREAM_MAXLEN)
        .arg("*")
        .arg("event")
        .arg(&payload)
        .query_async(&mut *conn)
        .await;

    if let Err(e) = result {
        warn!("[usage-events] XADD failed: {}", e);
    }
}
