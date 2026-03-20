//! Flow permission validation — checks node-level access control.

use crate::nodes::NodeRegistry;
use flow_common::flow::FlowGraph;
use flow_common::node::RequiredRole;

/// Validate that `caller_role` has permission to use all nodes in the graph.
///
/// Returns `Ok(())` if all nodes are accessible, or `Err(Vec<String>)` with
/// one error message per unauthorized node.
pub fn validate_flow_permissions(
    graph: &FlowGraph,
    registry: &NodeRegistry,
    caller_role: &RequiredRole,
) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();

    for node in &graph.nodes {
        match registry.get_metadata(&node.node_type) {
            Some(meta) => {
                if !meta.required_role.satisfied_by(caller_role) {
                    errors.push(format!(
                        "node '{}' uses type '{}' which requires role '{}'",
                        node.id,
                        node.node_type,
                        serde_json::to_string(&meta.required_role).unwrap_or_default().trim_matches('"'),
                    ));
                }
            }
            None => {
                errors.push(format!(
                    "node '{}' uses unknown type '{}'",
                    node.id, node.node_type,
                ));
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flow_common::flow::{ErrorStrategy, FlowNode};

    fn make_node(id: &str, node_type: &str) -> FlowNode {
        FlowNode {
            id: id.to_string(),
            node_type: node_type.to_string(),
            config: serde_json::json!({}),
            on_error: ErrorStrategy::default(),
            position: None,
        }
    }

    #[test]
    fn admin_can_use_all_nodes() {
        let registry = NodeRegistry::with_pools(None, None);
        let graph = FlowGraph {
            nodes: vec![
                make_node("n1", "core:noop"),
                make_node("n2", "core:database"),
                make_node("n3", "core:redis"),
            ],
            edges: vec![],
        };
        let result = validate_flow_permissions(&graph, &registry, &RequiredRole::Admin);
        assert!(result.is_ok());
    }

    #[test]
    fn non_admin_rejected_for_admin_nodes() {
        let registry = NodeRegistry::with_pools(None, None);
        let graph = FlowGraph {
            nodes: vec![
                make_node("n1", "core:noop"),
                make_node("n2", "core:database"),
                make_node("n3", "core:redis"),
            ],
            edges: vec![],
        };
        let result = validate_flow_permissions(&graph, &registry, &RequiredRole::Any);
        let errors = result.unwrap_err();
        assert_eq!(errors.len(), 2);
        assert!(errors[0].contains("core:database"));
        assert!(errors[1].contains("core:redis"));
    }

    #[test]
    fn non_admin_allowed_for_any_nodes() {
        let registry = NodeRegistry::new();
        let graph = FlowGraph {
            nodes: vec![
                make_node("n1", "core:noop"),
                make_node("n2", "core:transform"),
                make_node("n3", "core:condition"),
            ],
            edges: vec![],
        };
        let result = validate_flow_permissions(&graph, &registry, &RequiredRole::Any);
        assert!(result.is_ok());
    }

    #[test]
    fn unknown_node_type_error() {
        let registry = NodeRegistry::new();
        let graph = FlowGraph {
            nodes: vec![make_node("n1", "core:nonexistent")],
            edges: vec![],
        };
        let result = validate_flow_permissions(&graph, &registry, &RequiredRole::Admin);
        let errors = result.unwrap_err();
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("unknown type"));
    }

    #[test]
    fn required_role_serde_roundtrip() {
        let admin: RequiredRole = serde_json::from_str("\"admin\"").unwrap();
        assert_eq!(admin, RequiredRole::Admin);
        let any: RequiredRole = serde_json::from_str("\"any\"").unwrap();
        assert_eq!(any, RequiredRole::Any);
        assert_eq!(serde_json::to_string(&RequiredRole::Admin).unwrap(), "\"admin\"");
        assert_eq!(serde_json::to_string(&RequiredRole::Any).unwrap(), "\"any\"");
    }

    #[test]
    fn satisfied_by_logic() {
        assert!(RequiredRole::Any.satisfied_by(&RequiredRole::Any));
        assert!(RequiredRole::Any.satisfied_by(&RequiredRole::Admin));
        assert!(RequiredRole::Admin.satisfied_by(&RequiredRole::Admin));
        assert!(!RequiredRole::Admin.satisfied_by(&RequiredRole::Any));
    }
}
