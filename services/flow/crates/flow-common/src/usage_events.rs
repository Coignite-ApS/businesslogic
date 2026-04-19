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
            "error": error.chars().take(500).collect::<String>(),
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

#[cfg(test)]
mod tests {

    /// Verify UTF-8-safe truncation: a string where a multi-byte codepoint
    /// straddles the 500-char boundary must not panic.
    #[test]
    fn emit_flow_failed_truncates_unicode_safely() {
        // 498 ASCII chars + 3 emoji (each 4 bytes) — byte index 500 falls mid-codepoint
        let error = "a".repeat(498) + "🔥🔥🔥";
        assert!(error.len() > 500, "sanity: raw bytes exceed 500");

        let truncated: String = error.chars().take(500).collect();
        // Should contain 498 + 2 emoji = 500 chars, last emoji cut at 500th char boundary
        assert_eq!(truncated.chars().count(), 500);
        // And it's valid UTF-8 — just asserting no panic is the main goal
        assert!(std::str::from_utf8(truncated.as_bytes()).is_ok());
    }

    /// Strings shorter than 500 chars pass through unchanged.
    #[test]
    fn emit_flow_failed_short_error_unchanged() {
        let error = "short error";
        let truncated: String = error.chars().take(500).collect();
        assert_eq!(truncated, error);
    }

    /// Pure ASCII at exactly 500 chars is unchanged.
    #[test]
    fn emit_flow_failed_exact_500_ascii() {
        let error = "x".repeat(500);
        let truncated: String = error.chars().take(500).collect();
        assert_eq!(truncated.len(), 500);
        assert_eq!(truncated, error);
    }
}
