//! Loop node — iterates over data within a single node execution.
//!
//! Configuration:
//! - `loop_type`: "for_each" | "while" (default: "for_each")
//! - `items`: expression for array to iterate (for for_each)
//! - `condition`: expression for while loop guard
//! - `max_iterations`: safety limit (default: 1000)
//! - `body_expression`: optional per-item mapping (object of expressions)

use super::condition::evaluate_condition;
use super::expression::{context_from_snapshot, resolve_value};
use super::NodeHandler;
use flow_common::node::{RequiredRole, NodeInput, NodeResult, NodeTypeMeta, PortDef};
use std::sync::Arc;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "core:loop".to_string(),
        name: "Loop".to_string(),
        description: "Iterates over arrays (for_each) or repeats while a condition holds (while). Inline single-node execution.".to_string(),
        category: "logic".to_string(),
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
                "loop_type": {
                    "type": "string",
                    "enum": ["for_each", "while"],
                    "default": "for_each"
                },
                "items": {
                    "type": "string",
                    "description": "Expression resolving to array (for for_each)"
                },
                "condition": {
                    "type": "string",
                    "description": "Condition expression for while loop guard"
                },
                "max_iterations": {
                    "type": "integer",
                    "default": 1000
                },
                "body_expression": {
                    "type": "object",
                    "description": "Optional per-item mapping (keys are output fields, values are expressions)"
                }
            },
            "additionalProperties": false
        }),
        estimated_cost_usd: 0.0,
        required_role: RequiredRole::default(),
    }
}

pub fn handler() -> NodeHandler {
    Arc::new(|input: NodeInput| {
        Box::pin(async move {
            let loop_type = input
                .config
                .get("loop_type")
                .and_then(|v| v.as_str())
                .unwrap_or("for_each");
            let max_iterations = input
                .config
                .get("max_iterations")
                .and_then(|v| v.as_u64())
                .unwrap_or(1000) as usize;

            let context = context_from_snapshot(&input.context_snapshot);

            match loop_type {
                "for_each" => {
                    let items_expr = input
                        .config
                        .get("items")
                        .ok_or_else(|| anyhow::anyhow!("Loop: missing 'items' config for for_each"))?;

                    let resolved = resolve_value(items_expr, &context.trigger, &context.last, &context.nodes);

                    let items = match &resolved {
                        serde_json::Value::Array(arr) => arr.clone(),
                        other => vec![other.clone()],
                    };

                    let body_expr = input
                        .config
                        .get("body_expression")
                        .and_then(|v| v.as_object());

                    let limit = items.len().min(max_iterations);
                    let mut results = Vec::with_capacity(limit);

                    for item in items.into_iter().take(max_iterations) {
                        if let Some(mapping) = body_expr {
                            let item_last = Some(item);
                            let mut mapped = serde_json::Map::new();
                            for (key, expr) in mapping {
                                let val = resolve_value(expr, &context.trigger, &item_last, &context.nodes);
                                mapped.insert(key.clone(), val);
                            }
                            results.push(serde_json::Value::Object(mapped));
                        } else {
                            results.push(item);
                        }
                    }

                    let count = results.len();
                    Ok(NodeResult::ok(serde_json::json!({
                        "items": results,
                        "count": count,
                        "loop_type": "for_each"
                    })))
                }
                "while" => {
                    let condition = input
                        .config
                        .get("condition")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| anyhow::anyhow!("Loop: missing 'condition' config for while"))?;

                    let mut iterations = 0u64;
                    let mut last_value = context.last.clone().unwrap_or(serde_json::Value::Null);

                    while iterations < max_iterations as u64 {
                        let current_last = Some(last_value.clone());
                        let result = evaluate_condition(
                            condition,
                            &context.trigger,
                            &current_last,
                            &context.nodes,
                        )?;

                        if !result {
                            break;
                        }

                        iterations += 1;
                        // Each iteration produces current $last
                        last_value = serde_json::json!({"iteration": iterations});
                    }

                    Ok(NodeResult::ok(serde_json::json!({
                        "iterations": iterations,
                        "last_value": last_value,
                        "loop_type": "while"
                    })))
                }
                other => Err(anyhow::anyhow!("Loop: unknown loop_type '{other}'")),
            }
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ctx_with_source(data: serde_json::Value) -> serde_json::Value {
        let mut ctx = flow_common::context::ExecutionContext::new(
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            serde_json::json!({}),
            std::collections::HashMap::new(),
        );
        ctx.set_node_output("source", data, 10);
        serde_json::to_value(&ctx).unwrap()
    }

    #[tokio::test]
    async fn test_for_each_basic() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "loop_type": "for_each",
                "items": "$nodes.source"
            }),
            serde_json::json!({}),
            make_ctx_with_source(serde_json::json!([1, 2, 3])),
        );

        let result = handler(input).await.unwrap();
        assert_eq!(result.data["count"], 3);
        assert_eq!(result.data["loop_type"], "for_each");
        assert_eq!(result.data["items"], serde_json::json!([1, 2, 3]));
    }

    #[tokio::test]
    async fn test_for_each_with_body_expression() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "loop_type": "for_each",
                "items": "$nodes.source",
                "body_expression": {
                    "user_name": "$last.name"
                }
            }),
            serde_json::json!({}),
            make_ctx_with_source(serde_json::json!([
                {"name": "Alice", "age": 30},
                {"name": "Bob", "age": 25}
            ])),
        );

        let result = handler(input).await.unwrap();
        assert_eq!(result.data["count"], 2);
        let items = result.data["items"].as_array().unwrap();
        assert_eq!(items[0]["user_name"], "Alice");
        assert_eq!(items[1]["user_name"], "Bob");
    }

    #[tokio::test]
    async fn test_max_iterations_enforcement() {
        let handler = handler();
        let big_array: Vec<i32> = (0..50).collect();

        let input = NodeInput::new(
            serde_json::json!({
                "loop_type": "for_each",
                "items": "$nodes.source",
                "max_iterations": 10
            }),
            serde_json::json!({}),
            make_ctx_with_source(serde_json::json!(big_array)),
        );

        let result = handler(input).await.unwrap();
        assert_eq!(result.data["count"], 10);
    }

    #[tokio::test]
    async fn test_empty_array() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "loop_type": "for_each",
                "items": "$nodes.source"
            }),
            serde_json::json!({}),
            make_ctx_with_source(serde_json::json!([])),
        );

        let result = handler(input).await.unwrap();
        assert_eq!(result.data["count"], 0);
        assert_eq!(result.data["items"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn test_non_array_wrapped() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "loop_type": "for_each",
                "items": "$nodes.source"
            }),
            serde_json::json!({}),
            make_ctx_with_source(serde_json::json!({"single": "item"})),
        );

        let result = handler(input).await.unwrap();
        assert_eq!(result.data["count"], 1);
    }

    #[tokio::test]
    async fn test_while_loop() {
        let handler = handler();
        let mut ctx = flow_common::context::ExecutionContext::new(
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            serde_json::json!({}),
            std::collections::HashMap::new(),
        );
        ctx.last = Some(serde_json::json!({"count": 5}));

        // Condition: $last.iteration < 3 — will run 3 times then stop
        // iteration 1: $last = {"count":5}, check iteration (null < 3 => 0 < 3 => true)
        // After iter 1: $last = {"iteration":1}, check 1 < 3 => true
        // After iter 2: $last = {"iteration":2}, check 2 < 3 => true
        // After iter 3: $last = {"iteration":3}, check 3 < 3 => false => stop
        let input = NodeInput::new(
            serde_json::json!({
                "loop_type": "while",
                "condition": "$last.iteration < 3",
                "max_iterations": 100
            }),
            serde_json::json!({}),
            serde_json::to_value(&ctx).unwrap(),
        );

        let result = handler(input).await.unwrap();
        assert_eq!(result.data["iterations"], 3);
        assert_eq!(result.data["loop_type"], "while");
    }

    #[tokio::test]
    async fn test_loop_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "core:loop");
        assert_eq!(meta.tier, flow_common::node::NodeTier::Core);
    }
}
