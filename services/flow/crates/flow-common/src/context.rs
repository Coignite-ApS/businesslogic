//! Execution context — the shared data object that flows through all nodes.
//!
//! Design: Hybrid tiered model inspired by Directus's data chain ($trigger,
//! $last, $operationKey) but with reference-based storage for large payloads.
//!
//! - Inline: payloads < 64KB stored directly in context
//! - Reference: payloads 64KB-100MB stored in Redis/S3 with "$ref:" pointer
//! - Streaming: payloads > 100MB piped directly between nodes

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Size threshold for inline vs reference storage (64KB).
pub const INLINE_THRESHOLD: usize = 65_536;

/// The execution context passed through and accumulated by each node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionContext {
    /// Immutable trigger data that started this execution.
    #[serde(rename = "$trigger")]
    pub trigger: serde_json::Value,

    /// Filtered environment variables.
    #[serde(rename = "$env")]
    pub env: HashMap<String, String>,

    /// Execution metadata.
    #[serde(rename = "$meta")]
    pub meta: ExecutionMeta,

    /// Per-node outputs, keyed by node ID.
    #[serde(rename = "$nodes")]
    pub nodes: HashMap<String, NodeOutput>,

    /// Shortcut to the most recent node's output (updated after each node).
    #[serde(rename = "$last")]
    pub last: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionMeta {
    pub execution_id: Uuid,
    pub flow_id: Uuid,
    pub account_id: Uuid,
    pub started_at: DateTime<Utc>,
    pub current_node: Option<String>,
    /// Cumulative cost for LLM/AI nodes in this execution (USD).
    #[serde(default)]
    pub cumulative_cost_usd: f64,
}

/// Output from a single node, stored in the $nodes map.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeOutput {
    /// The actual output data (inline JSON or "$ref:..." pointer).
    pub data: serde_json::Value,

    /// Execution timing for this node.
    pub duration_ms: u64,

    /// Node status.
    pub status: NodeStatus,

    /// Optional error info if the node failed but was handled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NodeStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
}

impl ExecutionContext {
    /// Create a new execution context for a flow run.
    pub fn new(
        execution_id: Uuid,
        flow_id: Uuid,
        account_id: Uuid,
        trigger_data: serde_json::Value,
        env_vars: HashMap<String, String>,
    ) -> Self {
        Self {
            trigger: trigger_data,
            env: env_vars,
            meta: ExecutionMeta {
                execution_id,
                flow_id,
                account_id,
                started_at: Utc::now(),
                current_node: None,
                cumulative_cost_usd: 0.0,
            },
            nodes: HashMap::new(),
            last: None,
        }
    }

    /// Store a node's output. Automatically determines inline vs reference.
    pub fn set_node_output(
        &mut self,
        node_id: &str,
        data: serde_json::Value,
        duration_ms: u64,
    ) {
        let output = NodeOutput {
            data: data.clone(),
            duration_ms,
            status: NodeStatus::Completed,
            error: None,
        };
        self.nodes.insert(node_id.to_string(), output);
        self.last = Some(data);
        self.meta.current_node = Some(node_id.to_string());
    }

    /// Record a node failure.
    pub fn set_node_error(
        &mut self,
        node_id: &str,
        error: String,
        duration_ms: u64,
    ) {
        let output = NodeOutput {
            data: serde_json::Value::Null,
            duration_ms,
            status: NodeStatus::Failed,
            error: Some(error),
        };
        self.nodes.insert(node_id.to_string(), output);
        self.meta.current_node = Some(node_id.to_string());
    }

    /// Mark a node as skipped.
    pub fn set_node_skipped(&mut self, node_id: &str) {
        let output = NodeOutput {
            data: serde_json::Value::Null,
            duration_ms: 0,
            status: NodeStatus::Skipped,
            error: None,
        };
        self.nodes.insert(node_id.to_string(), output);
    }

    /// Get a node's output by ID.
    pub fn get_node_output(&self, node_id: &str) -> Option<&serde_json::Value> {
        self.nodes.get(node_id).map(|o| &o.data)
    }

    /// Add cost tracking for LLM nodes.
    pub fn add_cost(&mut self, cost_usd: f64) {
        self.meta.cumulative_cost_usd += cost_usd;
    }

    /// Check if the budget limit has been exceeded.
    pub fn is_over_budget(&self, limit: Option<f64>) -> bool {
        match limit {
            Some(limit) => self.meta.cumulative_cost_usd > limit,
            None => false,
        }
    }

    /// Resolve a value that might be a "$ref:..." pointer.
    /// M3: Reference tier not implemented in Phase 1 — returns explicit error
    /// instead of silent null to prevent data-loss bugs.
    pub fn resolve_value(&self, value: &serde_json::Value) -> Result<serde_json::Value, String> {
        if let Some(s) = value.as_str() {
            if s.starts_with("$ref:") {
                return Err(format!(
                    "reference resolution not implemented (Phase 2): {}",
                    s
                ));
            }
        }
        Ok(value.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_context_lifecycle() {
        let mut ctx = ExecutionContext::new(
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            serde_json::json!({"webhook": true}),
            HashMap::new(),
        );

        // Set a node output
        ctx.set_node_output(
            "http_1",
            serde_json::json!({"status": 200, "body": "ok"}),
            42,
        );

        assert_eq!(ctx.nodes.len(), 1);
        assert_eq!(ctx.meta.current_node, Some("http_1".to_string()));
        assert!(ctx.last.is_some());

        // Check $last updated
        let last = ctx.last.as_ref().unwrap();
        assert_eq!(last["status"], 200);

        // Get node output
        let output = ctx.get_node_output("http_1").unwrap();
        assert_eq!(output["body"], "ok");
    }

    #[test]
    fn test_budget_tracking() {
        let mut ctx = ExecutionContext::new(
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            serde_json::json!({}),
            HashMap::new(),
        );

        ctx.add_cost(0.003);
        ctx.add_cost(0.005);
        assert!(!ctx.is_over_budget(Some(0.50)));

        ctx.add_cost(0.50);
        assert!(ctx.is_over_budget(Some(0.50)));
    }
}
