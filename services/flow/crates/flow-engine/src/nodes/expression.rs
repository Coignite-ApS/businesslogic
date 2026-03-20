//! Shared expression resolver for variable interpolation.
//!
//! Resolves `$trigger.x`, `$last.x`, `$nodes.id.x` path expressions
//! and `{{$trigger.x}}` template interpolation in strings.

use flow_common::context::{ExecutionContext, NodeOutput};
use std::collections::HashMap;

/// Resolve a single value expression or literal against execution context.
pub fn resolve_value(
    expr: &serde_json::Value,
    trigger: &serde_json::Value,
    last: &Option<serde_json::Value>,
    nodes: &HashMap<String, NodeOutput>,
) -> serde_json::Value {
    match expr {
        serde_json::Value::String(s) => {
            if let Some(path) = s.strip_prefix("$trigger.") {
                resolve_path(trigger, path)
            } else if let Some(path) = s.strip_prefix("$last.") {
                last.as_ref()
                    .map(|v| resolve_path(v, path))
                    .unwrap_or(serde_json::Value::Null)
            } else if let Some(rest) = s.strip_prefix("$nodes.") {
                resolve_nodes_path(rest, nodes)
            } else if s.contains("{{") {
                serde_json::Value::String(interpolate_string(s, trigger, last, nodes))
            } else {
                serde_json::Value::String(s.clone())
            }
        }
        other => other.clone(),
    }
}

/// Resolve `$nodes.node_id.path` expressions.
fn resolve_nodes_path(rest: &str, nodes: &HashMap<String, NodeOutput>) -> serde_json::Value {
    if let Some(dot_pos) = rest.find('.') {
        let node_id = &rest[..dot_pos];
        let path = &rest[dot_pos + 1..];
        nodes
            .get(node_id)
            .map(|no| resolve_path(&no.data, path))
            .unwrap_or(serde_json::Value::Null)
    } else {
        nodes
            .get(rest)
            .map(|no| no.data.clone())
            .unwrap_or(serde_json::Value::Null)
    }
}

/// Resolve a dot-notation path in a JSON value.
pub fn resolve_path(value: &serde_json::Value, path: &str) -> serde_json::Value {
    let mut current = value.clone();
    for part in path.split('.') {
        current = match current.get(part) {
            Some(v) => v.clone(),
            None => return serde_json::Value::Null,
        };
    }
    current
}

/// Resolve a condition-style value (path expression or literal).
pub fn resolve_condition_value(
    expr: &str,
    trigger: &serde_json::Value,
    last: &Option<serde_json::Value>,
    nodes: &HashMap<String, NodeOutput>,
) -> serde_json::Value {
    let expr = expr.trim();

    if let Some(path) = expr.strip_prefix("$trigger.") {
        resolve_path(trigger, path)
    } else if let Some(path) = expr.strip_prefix("$last.") {
        last.as_ref()
            .map(|v| resolve_path(v, path))
            .unwrap_or(serde_json::Value::Null)
    } else if let Some(rest) = expr.strip_prefix("$nodes.") {
        resolve_nodes_path(rest, nodes)
    } else if let Ok(num) = expr.parse::<f64>() {
        serde_json::json!(num)
    } else if expr == "true" {
        serde_json::json!(true)
    } else if expr == "false" {
        serde_json::json!(false)
    } else if expr == "null" {
        serde_json::Value::Null
    } else {
        serde_json::Value::String(expr.to_string())
    }
}

/// Interpolate `{{$trigger.x}}`, `{{$last.x}}`, `{{$nodes.id.x}}` in a string.
/// Missing paths resolve to empty string.
pub fn interpolate_string(
    template: &str,
    trigger: &serde_json::Value,
    last: &Option<serde_json::Value>,
    nodes: &HashMap<String, NodeOutput>,
) -> String {
    let mut result = String::with_capacity(template.len());
    let mut rest = template;

    while let Some(start) = rest.find("{{") {
        result.push_str(&rest[..start]);
        let after_open = &rest[start + 2..];

        if let Some(end) = after_open.find("}}") {
            let expr = after_open[..end].trim();
            let resolved = resolve_condition_value(expr, trigger, last, nodes);
            match resolved {
                serde_json::Value::String(s) => result.push_str(&s),
                serde_json::Value::Null => {}
                other => result.push_str(&other.to_string()),
            }
            rest = &after_open[end + 2..];
        } else {
            result.push_str("{{");
            rest = after_open;
        }
    }
    result.push_str(rest);
    result
}

/// Extract context from a snapshot for expression resolution.
pub fn context_from_snapshot(snapshot: &serde_json::Value) -> ExecutionContext {
    serde_json::from_value(snapshot.clone()).unwrap_or_else(|_| {
        ExecutionContext::new(
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            serde_json::Value::Null,
            HashMap::new(),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use flow_common::context::NodeStatus;

    fn make_nodes() -> HashMap<String, NodeOutput> {
        let mut nodes = HashMap::new();
        nodes.insert(
            "http_1".to_string(),
            NodeOutput {
                data: serde_json::json!({"status": 200, "body": "ok"}),
                duration_ms: 100,
                status: NodeStatus::Completed,
                error: None,
            },
        );
        nodes
    }

    #[test]
    fn test_resolve_trigger_path() {
        let trigger = serde_json::json!({"body": {"user": {"name": "Alice"}}});
        let result = resolve_value(
            &serde_json::json!("$trigger.body.user.name"),
            &trigger,
            &None,
            &HashMap::new(),
        );
        assert_eq!(result, serde_json::json!("Alice"));
    }

    #[test]
    fn test_resolve_last_path() {
        let last = Some(serde_json::json!({"status": 200}));
        let result = resolve_value(
            &serde_json::json!("$last.status"),
            &serde_json::json!({}),
            &last,
            &HashMap::new(),
        );
        assert_eq!(result, serde_json::json!(200));
    }

    #[test]
    fn test_resolve_nodes_path() {
        let nodes = make_nodes();
        let result = resolve_value(
            &serde_json::json!("$nodes.http_1.body"),
            &serde_json::json!({}),
            &None,
            &nodes,
        );
        assert_eq!(result, serde_json::json!("ok"));
    }

    #[test]
    fn test_resolve_literal() {
        let result = resolve_value(
            &serde_json::json!("hello"),
            &serde_json::json!({}),
            &None,
            &HashMap::new(),
        );
        assert_eq!(result, serde_json::json!("hello"));
    }

    #[test]
    fn test_resolve_number() {
        let result = resolve_value(
            &serde_json::json!(42),
            &serde_json::json!({}),
            &None,
            &HashMap::new(),
        );
        assert_eq!(result, serde_json::json!(42));
    }

    #[test]
    fn test_missing_path_returns_null() {
        let result = resolve_value(
            &serde_json::json!("$trigger.missing.deep"),
            &serde_json::json!({"a": 1}),
            &None,
            &HashMap::new(),
        );
        assert_eq!(result, serde_json::Value::Null);
    }

    #[test]
    fn test_interpolate_trigger() {
        let trigger = serde_json::json!({"url": "https://api.example.com"});
        let result = interpolate_string(
            "Calling {{$trigger.url}}/data",
            &trigger,
            &None,
            &HashMap::new(),
        );
        assert_eq!(result, "Calling https://api.example.com/data");
    }

    #[test]
    fn test_interpolate_last() {
        let last = Some(serde_json::json!({"id": 42}));
        let result = interpolate_string(
            "/items/{{$last.id}}",
            &serde_json::json!({}),
            &last,
            &HashMap::new(),
        );
        assert_eq!(result, "/items/42");
    }

    #[test]
    fn test_interpolate_nodes() {
        let nodes = make_nodes();
        let result = interpolate_string(
            "Status: {{$nodes.http_1.status}}",
            &serde_json::json!({}),
            &None,
            &nodes,
        );
        assert_eq!(result, "Status: 200");
    }

    #[test]
    fn test_interpolate_missing_path() {
        let result = interpolate_string(
            "Hello {{$trigger.name}}!",
            &serde_json::json!({}),
            &None,
            &HashMap::new(),
        );
        assert_eq!(result, "Hello !");
    }

    #[test]
    fn test_interpolate_no_templates() {
        let result = interpolate_string(
            "plain string",
            &serde_json::json!({}),
            &None,
            &HashMap::new(),
        );
        assert_eq!(result, "plain string");
    }

    #[test]
    fn test_interpolate_multiple() {
        let trigger = serde_json::json!({"host": "example.com", "path": "/api"});
        let result = interpolate_string(
            "https://{{$trigger.host}}{{$trigger.path}}",
            &trigger,
            &None,
            &HashMap::new(),
        );
        assert_eq!(result, "https://example.com/api");
    }

    #[test]
    fn test_nested_path() {
        let trigger = serde_json::json!({"a": {"b": {"c": "deep"}}});
        let result = resolve_value(
            &serde_json::json!("$trigger.a.b.c"),
            &trigger,
            &None,
            &HashMap::new(),
        );
        assert_eq!(result, serde_json::json!("deep"));
    }
}
