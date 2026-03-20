//! Flow definition types — the blueprint for a flow execution.
//!
//! A FlowDef is the JSON-serializable definition stored in PostgreSQL
//! (bl_flows table). It contains the DAG structure, node configurations,
//! trigger setup, and execution settings.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Complete flow definition as stored in PostgreSQL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowDef {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub account_id: Uuid,
    pub status: FlowStatus,
    pub graph: FlowGraph,
    pub trigger_config: crate::trigger::TriggerConfig,
    pub settings: FlowSettings,
    pub version: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FlowStatus {
    Draft,
    Active,
    Disabled,
}

/// The DAG: nodes + edges + back-edges.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowGraph {
    pub nodes: Vec<FlowNode>,
    pub edges: Vec<FlowEdge>,
}

/// A single node in the flow graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowNode {
    /// Unique within this flow (e.g., "http_fetch_1", "formula_calc_1").
    pub id: String,

    /// Node type ID from the registry (e.g., "core:http_request", "core:formula_eval").
    pub node_type: String,

    /// Node-specific configuration (validated against the node type's config_schema).
    pub config: serde_json::Value,

    /// Error handling strategy for this node.
    #[serde(default)]
    pub on_error: ErrorStrategy,

    /// Position in the visual editor (x, y).
    #[serde(default)]
    pub position: Option<NodePosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodePosition {
    pub x: f64,
    pub y: f64,
}

/// An edge connecting two nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowEdge {
    pub from: String,
    pub to: String,

    /// Output port name on the source node (default: "output").
    #[serde(default = "default_port")]
    pub from_port: String,

    /// Input port name on the target node (default: "input").
    #[serde(default = "default_port")]
    pub to_port: String,

    /// If set, this is a back-edge (loop). Requires guard + max_iterations.
    #[serde(default)]
    pub back_edge: Option<BackEdge>,
}

fn default_port() -> String {
    "default".to_string()
}

/// Back-edge configuration for controlled loops.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackEdge {
    /// Expression evaluated against the execution context.
    /// Loop continues while this is truthy.
    pub guard: String,

    /// Safety limit to prevent infinite loops.
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,
}

fn default_max_iterations() -> u32 {
    100
}

/// Per-node error handling strategy.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorStrategy {
    /// Retry with exponential backoff.
    Retry {
        max_retries: u32,
        initial_delay_ms: u64,
        backoff_multiplier: f64,
    },
    /// Route to a fallback branch (edge to error-handling nodes).
    Fallback,
    /// Skip this node, continue with null output.
    Skip,
    /// Abort the entire flow execution.
    #[default]
    Abort,
}

/// Flow-level settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowSettings {
    /// Execution mode.
    #[serde(default)]
    pub mode: ExecutionMode,

    /// Overall timeout for the entire flow (ms).
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,

    /// Priority queue: critical, normal, batch.
    #[serde(default)]
    pub priority: Priority,

    /// Worker group tag for specialized routing.
    #[serde(default)]
    pub worker_group: Option<String>,

    /// Budget limit for LLM/AI nodes (USD).
    #[serde(default)]
    pub budget_limit_usd: Option<f64>,
}

impl Default for FlowSettings {
    fn default() -> Self {
        Self {
            mode: ExecutionMode::Parallel,
            timeout_ms: default_timeout(),
            priority: Priority::Normal,
            worker_group: None,
            budget_limit_usd: None,
        }
    }
}

fn default_timeout() -> u64 {
    300_000 // 5 minutes
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionMode {
    #[default]
    Parallel,
    Sequential,
    Streaming,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    Critical,
    #[default]
    Normal,
    Batch,
}

impl Priority {
    /// Redis Stream key for this priority level.
    pub fn stream_key(&self) -> &'static str {
        match self {
            Self::Critical => "flow:execute:critical",
            Self::Normal => "flow:execute:normal",
            Self::Batch => "flow:execute:batch",
        }
    }
}
