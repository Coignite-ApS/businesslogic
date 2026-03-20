//! Redis Stream message types for communication between trigger and workers.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Message enqueued into Redis Streams by the trigger service.
/// Workers consume this to start flow execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecuteMessage {
    /// Unique execution ID.
    pub execution_id: Uuid,

    /// Flow definition ID.
    pub flow_id: Uuid,

    /// Account that owns this flow.
    pub account_id: Uuid,

    /// Trigger data (webhook body, cron metadata, etc.).
    pub trigger_data: serde_json::Value,

    /// Priority (determines which stream).
    pub priority: crate::flow::Priority,

    /// Timestamp when the trigger fired.
    pub created_at: DateTime<Utc>,
}

impl ExecuteMessage {
    /// Serialize to a flat HashMap for Redis XADD.
    /// C3: Includes priority field for round-trip through Redis.
    pub fn to_redis_fields(&self) -> Vec<(String, String)> {
        vec![
            ("execution_id".into(), self.execution_id.to_string()),
            ("flow_id".into(), self.flow_id.to_string()),
            ("account_id".into(), self.account_id.to_string()),
            (
                "trigger_data".into(),
                serde_json::to_string(&self.trigger_data).unwrap_or_default(),
            ),
            (
                "priority".into(),
                serde_json::to_string(&self.priority).unwrap_or_else(|_| "\"normal\"".into()),
            ),
            ("created_at".into(), self.created_at.to_rfc3339()),
        ]
    }

    /// Deserialize from Redis XREADGROUP fields.
    /// C3: Reads priority field back from Redis (falls back to Normal).
    pub fn from_redis_fields(
        fields: &[(String, String)],
    ) -> Result<Self, crate::error::FlowError> {
        let get = |key: &str| -> Result<&str, crate::error::FlowError> {
            fields
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v.as_str())
                .ok_or_else(|| {
                    crate::error::FlowError::Serialization(format!("missing field: {key}"))
                })
        };

        let priority = fields
            .iter()
            .find(|(k, _)| k == "priority")
            .and_then(|(_, v)| serde_json::from_str(v).ok())
            .unwrap_or(crate::flow::Priority::Normal);

        Ok(Self {
            execution_id: get("execution_id")?
                .parse()
                .map_err(|e| crate::error::FlowError::Serialization(format!("{e}")))?,
            flow_id: get("flow_id")?
                .parse()
                .map_err(|e| crate::error::FlowError::Serialization(format!("{e}")))?,
            account_id: get("account_id")?
                .parse()
                .map_err(|e| crate::error::FlowError::Serialization(format!("{e}")))?,
            trigger_data: serde_json::from_str(get("trigger_data")?)
                .unwrap_or(serde_json::Value::Null),
            priority,
            created_at: get("created_at")?
                .parse()
                .unwrap_or_else(|_| Utc::now()),
        })
    }
}

/// Event published via Redis PubSub when execution state changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionEvent {
    pub execution_id: Uuid,
    pub flow_id: Uuid,
    pub event_type: ExecutionEventType,
    pub timestamp: DateTime<Utc>,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionEventType {
    Started,
    NodeStarted { node_id: String },
    NodeCompleted { node_id: String, duration_ms: u64 },
    NodeFailed { node_id: String, error: String },
    Completed { duration_ms: u64 },
    Failed { error: String },
}
