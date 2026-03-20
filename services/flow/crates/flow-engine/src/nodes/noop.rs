//! No-op node — passes input through unchanged.

use super::NodeHandler;
use flow_common::node::{RequiredRole, NodeInput, NodeResult, NodeTypeMeta, PortDef};
use std::sync::Arc;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "core:noop".to_string(),
        name: "No-op".to_string(),
        description: "Passes input data through unchanged. Useful for testing and debugging."
            .to_string(),
        category: "utility".to_string(),
        tier: flow_common::node::NodeTier::Core,
        inputs: vec![PortDef {
            name: "input".to_string(),
            data_type: "any".to_string(),
            required: false,
        }],
        outputs: vec![PortDef {
            name: "output".to_string(),
            data_type: "any".to_string(),
            required: true,
        }],
        config_schema: serde_json::json!({
            "type": "object",
            "properties": {},
            "required": []
        }),
        estimated_cost_usd: 0.0,
        required_role: RequiredRole::default(),
    }
}

pub fn handler() -> NodeHandler {
    Arc::new(|input: NodeInput| {
        Box::pin(async move {
            Ok(NodeResult::ok(input.data))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_noop_passes_through_json() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({}),
            serde_json::json!({"message": "hello", "count": 42}),
            serde_json::json!({}),
        );
        let result = handler(input).await.unwrap();
        assert_eq!(result.data, serde_json::json!({"message": "hello", "count": 42}));
        assert_eq!(result.logs.len(), 0);
        assert_eq!(result.cost_usd, 0.0);
    }

    #[tokio::test]
    async fn test_noop_passes_null() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({}),
            serde_json::Value::Null,
            serde_json::json!({}),
        );
        let result = handler(input).await.unwrap();
        assert_eq!(result.data, serde_json::Value::Null);
    }

    #[tokio::test]
    async fn test_noop_passes_array() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({}),
            serde_json::json!([1, 2, 3]),
            serde_json::json!({}),
        );
        let result = handler(input).await.unwrap();
        assert_eq!(result.data, serde_json::json!([1, 2, 3]));
    }

    #[tokio::test]
    async fn test_noop_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "core:noop");
        assert_eq!(meta.inputs.len(), 1);
        assert_eq!(meta.outputs.len(), 1);
    }
}
