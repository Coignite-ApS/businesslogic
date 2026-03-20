//! Condition node — routes flow based on a condition expression.
//!
//! Configuration:
//! - `condition`: Expression to evaluate (e.g., "$last.status == 200")
//! - `then_value`: Value to output on true branch
//! - `else_value`: Value to output on false branch
//!
//! Supports: ==, !=, >, <, >=, <= operators

use super::expression::{context_from_snapshot, resolve_condition_value};
use super::NodeHandler;
use flow_common::context::NodeOutput;
use flow_common::node::{RequiredRole, NodeInput, NodeResult, NodeTypeMeta, PortDef};
use std::collections::HashMap;
use std::sync::Arc;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "core:condition".to_string(),
        name: "Condition".to_string(),
        description: "Routes flow based on a condition expression. Returns branch decision."
            .to_string(),
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
                "condition": {
                    "type": "string",
                    "description": "Condition expression (e.g., '$last.status == 200')"
                },
                "then_value": {
                    "description": "Value to return on true branch"
                },
                "else_value": {
                    "description": "Value to return on false branch"
                }
            },
            "required": ["condition", "then_value", "else_value"],
            "additionalProperties": false
        }),
        estimated_cost_usd: 0.0,
        required_role: RequiredRole::default(),
    }
}

/// Parse and evaluate a simple comparison expression.
/// Public for reuse in back-edge guard evaluation.
pub fn evaluate_condition(
    condition: &str,
    trigger: &serde_json::Value,
    last: &Option<serde_json::Value>,
    nodes: &HashMap<String, NodeOutput>,
) -> Result<bool, anyhow::Error> {
    let condition = condition.trim();

    let operators = ["!=", ">=", "<=", "==", ">", "<", "contains"];
    let mut found_op = None;
    let mut op_pos = 0;

    for op in &operators {
        if let Some(pos) = condition.find(op) {
            found_op = Some(*op);
            op_pos = pos;
            break;
        }
    }

    let op = found_op
        .ok_or_else(|| anyhow::anyhow!("Condition: no operator found in '{}'", condition))?;

    let left_str = condition[..op_pos].trim();
    let right_str = condition[op_pos + op.len()..].trim();

    let left = resolve_condition_value(left_str, trigger, last, nodes);
    let right = resolve_condition_value(right_str, trigger, last, nodes);

    let l_num = left.as_f64();
    let r_num = right.as_f64();

    Ok(match op {
        "==" => {
            if let (Some(l), Some(r)) = (l_num, r_num) {
                l == r
            } else {
                left == right
            }
        }
        "!=" => {
            if let (Some(l), Some(r)) = (l_num, r_num) {
                l != r
            } else {
                left != right
            }
        }
        ">" => l_num.unwrap_or(0.0) > r_num.unwrap_or(0.0),
        "<" => l_num.unwrap_or(0.0) < r_num.unwrap_or(0.0),
        ">=" => l_num.unwrap_or(0.0) >= r_num.unwrap_or(0.0),
        "<=" => l_num.unwrap_or(0.0) <= r_num.unwrap_or(0.0),
        "contains" => {
            let l_str = left.as_str().unwrap_or_default();
            let r_str = right.as_str().unwrap_or_default();
            l_str.contains(r_str)
        }
        _ => false,
    })
}

pub fn handler() -> NodeHandler {
    Arc::new(|input: NodeInput| {
        Box::pin(async move {
            let condition = input
                .config
                .get("condition")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Condition: missing or invalid 'condition' config"))?;

            let then_value = input
                .config
                .get("then_value")
                .ok_or_else(|| anyhow::anyhow!("Condition: missing 'then_value' config"))?;

            let else_value = input
                .config
                .get("else_value")
                .ok_or_else(|| anyhow::anyhow!("Condition: missing 'else_value' config"))?;

            let context = context_from_snapshot(&input.context_snapshot);

            let evaluated = evaluate_condition(
                condition,
                &context.trigger,
                &context.last,
                &context.nodes,
            )?;

            let value = if evaluated {
                then_value.clone()
            } else {
                else_value.clone()
            };

            let branch = if evaluated { "then" } else { "else" };

            Ok(NodeResult::ok(serde_json::json!({
                "branch": branch,
                "value": value,
                "evaluated": evaluated
            })))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_evaluate_equality() {
        let trigger = serde_json::json!({"status": 200});
        assert!(evaluate_condition("$trigger.status == 200", &trigger, &None, &Default::default()).unwrap());
        assert!(!evaluate_condition("$trigger.status == 404", &trigger, &None, &Default::default()).unwrap());
    }

    #[test]
    fn test_evaluate_inequality() {
        let trigger = serde_json::json!({"status": 200});
        assert!(evaluate_condition("$trigger.status != 404", &trigger, &None, &Default::default()).unwrap());
    }

    #[test]
    fn test_evaluate_greater_than() {
        let trigger = serde_json::json!({"count": 100});
        assert!(evaluate_condition("$trigger.count > 50", &trigger, &None, &Default::default()).unwrap());
        assert!(!evaluate_condition("$trigger.count > 150", &trigger, &None, &Default::default()).unwrap());
    }

    #[test]
    fn test_evaluate_less_than() {
        let trigger = serde_json::json!({"count": 50});
        assert!(evaluate_condition("$trigger.count < 100", &trigger, &None, &Default::default()).unwrap());
    }

    #[test]
    fn test_resolve_literal_number() {
        let value = resolve_condition_value("42", &serde_json::json!({}), &None, &Default::default());
        assert_eq!(value, serde_json::json!(42.0));
    }

    #[test]
    fn test_resolve_literal_boolean() {
        assert_eq!(resolve_condition_value("true", &serde_json::json!({}), &None, &Default::default()), serde_json::json!(true));
        assert_eq!(resolve_condition_value("false", &serde_json::json!({}), &None, &Default::default()), serde_json::json!(false));
    }

    #[test]
    fn test_evaluate_contains() {
        let trigger = serde_json::json!({"msg": "hello world"});
        assert!(evaluate_condition("$trigger.msg contains world", &trigger, &None, &Default::default()).unwrap());
        assert!(!evaluate_condition("$trigger.msg contains xyz", &trigger, &None, &Default::default()).unwrap());
    }

    #[test]
    fn test_operator_precedence_not_equals() {
        let trigger = serde_json::json!({"a": 1, "b": 2});
        assert!(evaluate_condition("$trigger.a != $trigger.b", &trigger, &None, &Default::default()).unwrap());
    }

    #[tokio::test]
    async fn test_condition_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "core:condition");
        assert_eq!(meta.tier, flow_common::node::NodeTier::Core);
    }

    #[tokio::test]
    async fn test_condition_missing_config() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        assert!(handler(input).await.is_err());
    }

    #[tokio::test]
    async fn test_condition_true_branch() {
        let handler = handler();
        let mut ctx = flow_common::context::ExecutionContext::new(
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            serde_json::json!({}),
            std::collections::HashMap::new(),
        );
        ctx.last = Some(serde_json::json!({"status": 200}));
        let input = NodeInput::new(
            serde_json::json!({
                "condition": "$last.status == 200",
                "then_value": {"ok": true},
                "else_value": {"ok": false}
            }),
            serde_json::json!({}),
            serde_json::to_value(&ctx).unwrap(),
        );
        let result = handler(input).await.unwrap();
        assert_eq!(result.data["branch"], "then");
        assert_eq!(result.data["evaluated"], true);
    }

    #[tokio::test]
    async fn test_condition_false_branch() {
        let handler = handler();
        let mut ctx = flow_common::context::ExecutionContext::new(
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            serde_json::json!({}),
            std::collections::HashMap::new(),
        );
        ctx.last = Some(serde_json::json!({"status": 500}));
        let input = NodeInput::new(
            serde_json::json!({
                "condition": "$last.status == 200",
                "then_value": {"ok": true},
                "else_value": {"ok": false}
            }),
            serde_json::json!({}),
            serde_json::to_value(&ctx).unwrap(),
        );
        let result = handler(input).await.unwrap();
        assert_eq!(result.data["branch"], "else");
        assert_eq!(result.data["evaluated"], false);
    }
}
