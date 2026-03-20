//! Aggregate node — combines data from multiple sources.
//!
//! Configuration:
//! - `operation`: "collect" | "merge" | "flatten" | "group_by" | "count"
//! - `sources`: array of expression strings to resolve
//! - `group_key`: key name for group_by operation

use super::expression::{context_from_snapshot, resolve_value};
use super::NodeHandler;
use flow_common::node::{RequiredRole, NodeInput, NodeResult, NodeTypeMeta, PortDef};
use std::sync::Arc;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "core:aggregate".to_string(),
        name: "Aggregate".to_string(),
        description: "Combines data from multiple sources using collect, merge, flatten, group_by, or count operations.".to_string(),
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
                "operation": {
                    "type": "string",
                    "enum": ["collect", "merge", "flatten", "group_by", "count"]
                },
                "sources": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Array of expression strings to resolve"
                },
                "group_key": {
                    "type": "string",
                    "description": "Key name for group_by operation"
                }
            },
            "required": ["operation", "sources"],
            "additionalProperties": false
        }),
        estimated_cost_usd: 0.0,
        required_role: RequiredRole::default(),
    }
}

/// Deep merge two JSON objects. Later values override earlier ones.
fn deep_merge(base: &mut serde_json::Value, other: &serde_json::Value) {
    match (base, other) {
        (serde_json::Value::Object(base_map), serde_json::Value::Object(other_map)) => {
            for (key, value) in other_map {
                let entry = base_map
                    .entry(key.clone())
                    .or_insert(serde_json::Value::Null);
                deep_merge(entry, value);
            }
        }
        (base, other) => {
            *base = other.clone();
        }
    }
}

pub fn handler() -> NodeHandler {
    Arc::new(|input: NodeInput| {
        Box::pin(async move {
            let operation = input
                .config
                .get("operation")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Aggregate: missing 'operation' config"))?;

            let sources = input
                .config
                .get("sources")
                .and_then(|v| v.as_array())
                .ok_or_else(|| anyhow::anyhow!("Aggregate: missing or invalid 'sources' config"))?;

            let context = context_from_snapshot(&input.context_snapshot);

            // Resolve all source expressions
            let resolved: Vec<serde_json::Value> = sources
                .iter()
                .map(|expr| resolve_value(expr, &context.trigger, &context.last, &context.nodes))
                .collect();

            match operation {
                "collect" => {
                    let count = resolved.len();
                    Ok(NodeResult::ok(serde_json::json!({
                        "result": resolved,
                        "count": count
                    })))
                }
                "merge" => {
                    let mut merged = serde_json::Value::Object(serde_json::Map::new());
                    for item in &resolved {
                        deep_merge(&mut merged, item);
                    }
                    Ok(NodeResult::ok(serde_json::json!({
                        "result": merged
                    })))
                }
                "flatten" => {
                    let mut flat = Vec::new();
                    for item in &resolved {
                        match item {
                            serde_json::Value::Array(arr) => flat.extend(arr.iter().cloned()),
                            other => flat.push(other.clone()),
                        }
                    }
                    let count = flat.len();
                    Ok(NodeResult::ok(serde_json::json!({
                        "result": flat,
                        "count": count
                    })))
                }
                "group_by" => {
                    let group_key = input
                        .config
                        .get("group_key")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| anyhow::anyhow!("Aggregate: missing 'group_key' for group_by"))?;

                    // Collect all items into a flat list
                    let mut all_items = Vec::new();
                    for item in &resolved {
                        match item {
                            serde_json::Value::Array(arr) => all_items.extend(arr.iter().cloned()),
                            other => all_items.push(other.clone()),
                        }
                    }

                    let mut groups: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
                    for item in &all_items {
                        let key = item
                            .get(group_key)
                            .map(|v| match v {
                                serde_json::Value::String(s) => s.clone(),
                                other => other.to_string(),
                            })
                            .unwrap_or_else(|| "_unknown".to_string());

                        let group = groups
                            .entry(key)
                            .or_insert_with(|| serde_json::Value::Array(Vec::new()));
                        if let serde_json::Value::Array(arr) = group {
                            arr.push(item.clone());
                        }
                    }

                    let num_groups = groups.len();
                    Ok(NodeResult::ok(serde_json::json!({
                        "result": groups,
                        "groups": num_groups
                    })))
                }
                "count" => {
                    let mut total = 0usize;
                    for item in &resolved {
                        match item {
                            serde_json::Value::Array(arr) => total += arr.len(),
                            _ => total += 1,
                        }
                    }
                    Ok(NodeResult::ok(serde_json::json!({
                        "count": total
                    })))
                }
                other => Err(anyhow::anyhow!("Aggregate: unknown operation '{other}'")),
            }
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use flow_common::context::ExecutionContext;
    use std::collections::HashMap;

    fn make_ctx_with_nodes() -> serde_json::Value {
        let mut ctx = ExecutionContext::new(
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            serde_json::json!({}),
            HashMap::new(),
        );
        ctx.set_node_output("a", serde_json::json!({"x": 1, "y": 2}), 10);
        ctx.set_node_output("b", serde_json::json!({"y": 3, "z": 4}), 10);
        serde_json::to_value(&ctx).unwrap()
    }

    fn make_ctx_with_arrays() -> serde_json::Value {
        let mut ctx = ExecutionContext::new(
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            serde_json::json!({}),
            HashMap::new(),
        );
        ctx.set_node_output("a", serde_json::json!([1, 2, 3]), 10);
        ctx.set_node_output("b", serde_json::json!([4, 5]), 10);
        serde_json::to_value(&ctx).unwrap()
    }

    #[tokio::test]
    async fn test_collect() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "operation": "collect",
                "sources": ["$nodes.a", "$nodes.b"]
            }),
            serde_json::json!({}),
            make_ctx_with_nodes(),
        );
        let result = handler(input).await.unwrap();
        assert_eq!(result.data["count"], 2);
        let items = result.data["result"].as_array().unwrap();
        assert_eq!(items.len(), 2);
    }

    #[tokio::test]
    async fn test_merge() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "operation": "merge",
                "sources": ["$nodes.a", "$nodes.b"]
            }),
            serde_json::json!({}),
            make_ctx_with_nodes(),
        );
        let result = handler(input).await.unwrap();
        let merged = &result.data["result"];
        assert_eq!(merged["x"], 1);
        assert_eq!(merged["y"], 3); // b overrides a
        assert_eq!(merged["z"], 4);
    }

    #[tokio::test]
    async fn test_flatten() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "operation": "flatten",
                "sources": ["$nodes.a", "$nodes.b"]
            }),
            serde_json::json!({}),
            make_ctx_with_arrays(),
        );
        let result = handler(input).await.unwrap();
        assert_eq!(result.data["count"], 5);
        assert_eq!(result.data["result"], serde_json::json!([1, 2, 3, 4, 5]));
    }

    #[tokio::test]
    async fn test_group_by() {
        let handler = handler();
        let ctx = {
            let mut ctx = ExecutionContext::new(
                uuid::Uuid::nil(),
                uuid::Uuid::nil(),
                uuid::Uuid::nil(),
                serde_json::json!({}),
                HashMap::new(),
            );
            ctx.set_node_output("items", serde_json::json!([
                {"category": "fruit", "name": "apple"},
                {"category": "vegetable", "name": "carrot"},
                {"category": "fruit", "name": "banana"}
            ]), 10);
            serde_json::to_value(&ctx).unwrap()
        };

        let input = NodeInput::new(
            serde_json::json!({
                "operation": "group_by",
                "sources": ["$nodes.items"],
                "group_key": "category"
            }),
            serde_json::json!({}),
            ctx,
        );
        let result = handler(input).await.unwrap();
        assert_eq!(result.data["groups"], 2);
        let groups = result.data["result"].as_object().unwrap();
        assert_eq!(groups["fruit"].as_array().unwrap().len(), 2);
        assert_eq!(groups["vegetable"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn test_count() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "operation": "count",
                "sources": ["$nodes.a", "$nodes.b"]
            }),
            serde_json::json!({}),
            make_ctx_with_arrays(),
        );
        let result = handler(input).await.unwrap();
        assert_eq!(result.data["count"], 5);
    }

    #[tokio::test]
    async fn test_unknown_operation() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "operation": "invalid",
                "sources": []
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        assert!(handler(input).await.is_err());
    }

    #[tokio::test]
    async fn test_aggregate_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "core:aggregate");
        assert_eq!(meta.tier, flow_common::node::NodeTier::Core);
    }
}
