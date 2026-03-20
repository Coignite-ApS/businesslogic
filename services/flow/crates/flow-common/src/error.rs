use thiserror::Error;

/// Top-level error type for the flow engine.
#[derive(Debug, Error)]
pub enum FlowError {
    #[error("flow not found: {0}")]
    FlowNotFound(uuid::Uuid),

    #[error("node not found: {0}")]
    NodeNotFound(String),

    #[error("invalid flow graph: {0}")]
    InvalidGraph(String),

    #[error("execution failed at node '{node_id}': {reason}")]
    ExecutionFailed { node_id: String, reason: String },

    #[error("node timeout after {timeout_ms}ms: {node_id}")]
    NodeTimeout { node_id: String, timeout_ms: u64 },

    #[error("max iterations ({max}) reached for back-edge: {edge}")]
    MaxIterations { edge: String, max: u32 },

    #[error("budget exceeded: {0}")]
    BudgetExceeded(String),

    #[error("data reference not found: {0}")]
    ReferenceNotFound(String),

    #[error("serialization error: {0}")]
    Serialization(String),

    #[error("redis error: {0}")]
    Redis(String),

    #[error("database error: {0}")]
    Database(String),

    #[error("plugin error: {0}")]
    Plugin(String),
}

/// Per-node error with retry context.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NodeError {
    pub node_id: String,
    pub error: String,
    pub retries_attempted: u32,
    pub is_retryable: bool,
}

impl std::fmt::Display for NodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "node '{}' failed (attempt {}): {}",
            self.node_id, self.retries_attempted, self.error
        )
    }
}
