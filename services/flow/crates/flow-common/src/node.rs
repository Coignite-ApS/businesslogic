//! Node type definitions — the registry of available nodes.

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

/// Role required to use a node type.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RequiredRole {
    /// Any authenticated user.
    #[default]
    Any,
    /// Platform admin only.
    Admin,
}

impl<'de> Deserialize<'de> for RequiredRole {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        match s.to_lowercase().as_str() {
            "any" => Ok(RequiredRole::Any),
            "admin" => Ok(RequiredRole::Admin),
            _ => Err(serde::de::Error::unknown_variant(&s, &["any", "admin"])),
        }
    }
}

impl RequiredRole {
    /// Returns true if `caller` has sufficient privileges for `self`.
    pub fn satisfied_by(&self, caller: &RequiredRole) -> bool {
        match self {
            RequiredRole::Any => true,
            RequiredRole::Admin => *caller == RequiredRole::Admin,
        }
    }
}

/// Node tier determines how the node is executed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NodeTier {
    /// Compiled into the binary. Zero overhead.
    Core,
    /// WebAssembly plugin executed via Wasmtime.
    Wasm,
    /// External microservice called via HTTP/gRPC.
    External,
}

/// Port definition for node inputs/outputs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortDef {
    pub name: String,
    /// Type hint: "any", "string", "number", "object", "array", "boolean".
    pub data_type: String,
    pub required: bool,
}

/// Node type metadata — stored in bl_node_types table and used by the
/// visual editor to render the node palette.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeTypeMeta {
    /// Unique ID (e.g., "core:http_request", "wasm:slack_notify").
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub tier: NodeTier,
    pub inputs: Vec<PortDef>,
    pub outputs: Vec<PortDef>,
    /// JSON Schema for the node's configuration panel in the editor.
    pub config_schema: serde_json::Value,
    /// Estimated cost per execution in USD (for budget pre-checks).
    #[serde(default)]
    pub estimated_cost_usd: f64,
    /// Minimum role required to use this node type.
    #[serde(default)]
    pub required_role: RequiredRole,
}

/// Input provided to a node during execution.
#[derive(Debug, Clone)]
pub struct NodeInput {
    /// Node-specific configuration from the flow definition.
    pub config: serde_json::Value,
    /// Data from upstream nodes (resolved from execution context).
    pub data: serde_json::Value,
    /// Read-only reference to the full execution context.
    pub context_snapshot: serde_json::Value,
    /// Cancellation token for cooperative cancellation.
    pub cancel: CancellationToken,
}

impl NodeInput {
    /// Create a NodeInput without cancellation (convenience for tests).
    pub fn new(
        config: serde_json::Value,
        data: serde_json::Value,
        context_snapshot: serde_json::Value,
    ) -> Self {
        Self {
            config,
            data,
            context_snapshot,
            cancel: CancellationToken::new(),
        }
    }
}

/// Output produced by a node after execution.
#[derive(Debug, Clone)]
pub struct NodeResult {
    /// Output data to store in the execution context.
    pub data: serde_json::Value,
    /// Log entries for debugging.
    pub logs: Vec<String>,
    /// Cost incurred (for LLM nodes).
    pub cost_usd: f64,
}

impl NodeResult {
    pub fn ok(data: serde_json::Value) -> Self {
        Self {
            data,
            logs: Vec::new(),
            cost_usd: 0.0,
        }
    }

    pub fn with_logs(data: serde_json::Value, logs: Vec<String>) -> Self {
        Self {
            data,
            logs,
            cost_usd: 0.0,
        }
    }

    pub fn with_cost(data: serde_json::Value, cost_usd: f64) -> Self {
        Self {
            data,
            logs: Vec::new(),
            cost_usd,
        }
    }
}
