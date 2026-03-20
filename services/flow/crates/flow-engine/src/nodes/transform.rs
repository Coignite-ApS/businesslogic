//! Transform node — maps input data to output using JSONPath-like expressions.
//!
//! Configuration:
//! - `mapping`: Object where keys are output field names and values are expressions:
//!   - `$trigger.field` — access trigger data
//!   - `$last.field` — access most recent node output
//!   - `$nodes.node_id.field` — access specific node output by ID
//!   - `{{$trigger.x}}` — template interpolation in strings
//!   - Literal values are returned as-is

use super::expression::{context_from_snapshot, resolve_value};
use super::NodeHandler;
use flow_common::node::{RequiredRole, NodeInput, NodeResult, NodeTypeMeta, PortDef};
use std::sync::Arc;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "core:transform".to_string(),
        name: "Transform".to_string(),
        description: "Maps input data to output using JSONPath-like expressions ($trigger, $last, $nodes.*)."
            .to_string(),
        category: "data".to_string(),
        tier: flow_common::node::NodeTier::Core,
        inputs: vec![PortDef {
            name: "input".to_string(),
            data_type: "any".to_string(),
            required: false,
        }],
        outputs: vec![PortDef {
            name: "output".to_string(),
            data_type: "object".to_string(),
            required: true,
        }],
        config_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "mapping": {
                    "type": "object",
                    "description": "Output field mapping (keys are output fields, values are expressions or literals)",
                    "additionalProperties": true
                }
            },
            "required": ["mapping"],
            "additionalProperties": false
        }),
        estimated_cost_usd: 0.0,
        required_role: RequiredRole::default(),
    }
}

pub fn handler() -> NodeHandler {
    Arc::new(|input: NodeInput| {
        Box::pin(async move {
            let mapping = input
                .config
                .get("mapping")
                .and_then(|v| v.as_object())
                .ok_or_else(|| anyhow::anyhow!("Transform: missing or invalid 'mapping' config"))?;

            let context = context_from_snapshot(&input.context_snapshot);

            let mut output = serde_json::Map::new();
            for (output_key, expr) in mapping {
                let resolved =
                    resolve_value(expr, &context.trigger, &context.last, &context.nodes);
                output.insert(output_key.clone(), resolved);
            }

            Ok(NodeResult::ok(serde_json::Value::Object(output)))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use flow_common::context::NodeOutput;
    use flow_common::context::NodeStatus;
    use crate::nodes::expression::resolve_value as rv;

    #[test]
    fn test_resolve_literal_string() {
        let result = rv(
            &serde_json::json!("hello"),
            &serde_json::json!({}),
            &None,
            &std::collections::HashMap::new(),
        );
        assert_eq!(result, serde_json::json!("hello"));
    }

    #[test]
    fn test_resolve_literal_number() {
        let result = rv(
            &serde_json::json!(42),
            &serde_json::json!({}),
            &None,
            &std::collections::HashMap::new(),
        );
        assert_eq!(result, serde_json::json!(42));
    }

    #[test]
    fn test_resolve_trigger_path() {
        let trigger = serde_json::json!({"body": {"user": {"name": "Alice"}}});
        let result = rv(
            &serde_json::json!("$trigger.body.user.name"),
            &trigger,
            &None,
            &std::collections::HashMap::new(),
        );
        assert_eq!(result, serde_json::json!("Alice"));
    }

    #[test]
    fn test_resolve_trigger_missing_path() {
        let trigger = serde_json::json!({"a": 1});
        let result = rv(
            &serde_json::json!("$trigger.missing.path"),
            &trigger,
            &None,
            &std::collections::HashMap::new(),
        );
        assert_eq!(result, serde_json::Value::Null);
    }

    #[test]
    fn test_resolve_last() {
        let last = Some(serde_json::json!({"status": 200, "data": "success"}));
        let result = rv(
            &serde_json::json!("$last.status"),
            &serde_json::json!({}),
            &last,
            &std::collections::HashMap::new(),
        );
        assert_eq!(result, serde_json::json!(200));
    }

    #[test]
    fn test_resolve_nodes() {
        let mut nodes = std::collections::HashMap::new();
        nodes.insert(
            "http_1".to_string(),
            NodeOutput {
                data: serde_json::json!({"status": 200, "body": "ok"}),
                duration_ms: 100,
                status: NodeStatus::Completed,
                error: None,
            },
        );
        let result = rv(
            &serde_json::json!("$nodes.http_1.body"),
            &serde_json::json!({}),
            &None,
            &nodes,
        );
        assert_eq!(result, serde_json::json!("ok"));
    }

    #[tokio::test]
    async fn test_transform_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "core:transform");
        assert_eq!(meta.tier, flow_common::node::NodeTier::Core);
    }

    #[tokio::test]
    async fn test_transform_missing_mapping() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = handler(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("missing or invalid 'mapping'"));
    }

    #[tokio::test]
    async fn test_transform_simple_mapping() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "mapping": {
                    "message": "hello",
                    "count": 42,
                    "active": true
                }
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = handler(input).await.unwrap();
        assert_eq!(result.data, serde_json::json!({"message": "hello", "count": 42, "active": true}));
    }
}
