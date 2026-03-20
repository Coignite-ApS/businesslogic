//! DAG construction and validation from flow definitions.
//!
//! Converts a FlowGraph (JSON) into a petgraph DiGraph, validates structure,
//! performs topological sort, and identifies back-edges for controlled loops.

use flow_common::error::FlowError;
use flow_common::flow::{FlowGraph, FlowNode};
use petgraph::graph::{DiGraph, EdgeIndex, NodeIndex};
use petgraph::algo::toposort;
use petgraph::visit::EdgeRef;
use std::collections::{HashMap, HashSet, VecDeque};

/// Compiled DAG ready for execution.
#[derive(Debug)]
pub struct ExecutionDag {
    /// The petgraph directed graph. Weights are node IDs.
    pub graph: DiGraph<String, EdgeType>,

    /// Map from node ID string to petgraph NodeIndex.
    pub node_indices: HashMap<String, NodeIndex>,

    /// Map from petgraph NodeIndex to flow node definition.
    pub node_defs: HashMap<NodeIndex, FlowNode>,

    /// Topological order (excludes back-edge targets from initial sort).
    pub topo_order: Vec<NodeIndex>,

    /// Back-edges (loops) stored separately from forward edges.
    pub back_edges: Vec<BackEdgeInfo>,

    /// Forward-only edge indices (excludes back-edges).
    forward_edges: HashSet<EdgeIndex>,

    /// Loop bodies: for each back-edge (from, to), the set of nodes in the loop body.
    /// Computed via BFS from `to` to `from` on forward edges.
    pub loop_bodies: HashMap<(NodeIndex, NodeIndex), Vec<NodeIndex>>,
}

/// Edge classification.
#[derive(Debug, Clone)]
pub enum EdgeType {
    /// Normal forward edge.
    Forward { from_port: String, to_port: String },
    /// Back-edge (loop) with guard condition.
    Back {
        guard: String,
        max_iterations: u32,
        from_port: String,
        to_port: String,
    },
}

/// Compiled back-edge info for the executor.
#[derive(Debug, Clone)]
pub struct BackEdgeInfo {
    pub from: NodeIndex,
    pub to: NodeIndex,
    pub guard: String,
    pub max_iterations: u32,
}

impl ExecutionDag {
    /// Build an ExecutionDag from a FlowGraph definition.
    pub fn build(graph: &FlowGraph) -> Result<Self, FlowError> {
        let mut dag = DiGraph::new();
        let mut node_indices = HashMap::new();
        let mut node_defs = HashMap::new();
        let mut back_edges = Vec::new();
        let mut forward_edges = HashSet::new();

        // Add all nodes
        for node in &graph.nodes {
            let idx = dag.add_node(node.id.clone());
            node_indices.insert(node.id.clone(), idx);
            node_defs.insert(idx, node.clone());
        }

        // Add edges
        for edge in &graph.edges {
            let from = *node_indices.get(&edge.from).ok_or_else(|| {
                FlowError::InvalidGraph(format!("edge references unknown node: {}", edge.from))
            })?;
            let to = *node_indices.get(&edge.to).ok_or_else(|| {
                FlowError::InvalidGraph(format!("edge references unknown node: {}", edge.to))
            })?;

            if let Some(ref be) = edge.back_edge {
                back_edges.push(BackEdgeInfo {
                    from,
                    to,
                    guard: be.guard.clone(),
                    max_iterations: be.max_iterations,
                });
                dag.add_edge(
                    from,
                    to,
                    EdgeType::Back {
                        guard: be.guard.clone(),
                        max_iterations: be.max_iterations,
                        from_port: edge.from_port.clone(),
                        to_port: edge.to_port.clone(),
                    },
                );
            } else {
                let ei = dag.add_edge(
                    from,
                    to,
                    EdgeType::Forward {
                        from_port: edge.from_port.clone(),
                        to_port: edge.to_port.clone(),
                    },
                );
                forward_edges.insert(ei);
            }
        }

        // Topological sort on forward-only graph
        let mut forward_dag = DiGraph::new();
        let mut forward_indices: HashMap<String, NodeIndex> = HashMap::new();
        for node in &graph.nodes {
            let idx = forward_dag.add_node(node.id.clone());
            forward_indices.insert(node.id.clone(), idx);
        }
        for edge in &graph.edges {
            if edge.back_edge.is_none() {
                let from = forward_indices[&edge.from];
                let to = forward_indices[&edge.to];
                forward_dag.add_edge(from, to, ());
            }
        }

        let topo_order = toposort(&forward_dag, None).map_err(|cycle| {
            let node_id = forward_dag[cycle.node_id()].clone();
            FlowError::InvalidGraph(format!(
                "cycle detected (not a back-edge) involving node: {node_id}"
            ))
        })?;

        // Map forward_dag indices back to main dag indices
        let topo_order: Vec<NodeIndex> = topo_order
            .into_iter()
            .map(|fi| {
                let node_id = &forward_dag[fi];
                node_indices[node_id]
            })
            .collect();

        // D4: Pre-compute loop bodies for each back-edge via BFS
        let mut loop_bodies = HashMap::new();
        for be in &back_edges {
            let body = Self::compute_loop_body(&dag, &forward_edges, be.to, be.from);
            loop_bodies.insert((be.from, be.to), body);
        }

        // Reject nested back-edges sharing nodes
        let body_sets: Vec<(&(NodeIndex, NodeIndex), HashSet<NodeIndex>)> = loop_bodies
            .iter()
            .map(|(k, v)| (k, v.iter().copied().collect::<HashSet<_>>()))
            .collect();
        for i in 0..body_sets.len() {
            for j in (i + 1)..body_sets.len() {
                let overlap: HashSet<_> = body_sets[i].1.intersection(&body_sets[j].1).collect();
                if !overlap.is_empty() {
                    return Err(FlowError::InvalidGraph(
                        "nested back-edge loops sharing nodes are not supported".to_string(),
                    ));
                }
            }
        }

        if !back_edges.is_empty() {
            tracing::info!(
                count = back_edges.len(),
                "flow contains back-edge(s) for controlled loops"
            );
        }

        Ok(Self {
            graph: dag,
            node_indices,
            node_defs,
            topo_order,
            back_edges,
            forward_edges,
            loop_bodies,
        })
    }

    /// BFS from `start` to `end` on forward edges only. Returns nodes in the loop body.
    fn compute_loop_body(
        graph: &DiGraph<String, EdgeType>,
        forward_edges: &HashSet<EdgeIndex>,
        start: NodeIndex,
        end: NodeIndex,
    ) -> Vec<NodeIndex> {
        let mut visited = HashSet::new();
        let mut queue = VecDeque::new();
        queue.push_back(start);
        visited.insert(start);

        while let Some(node) = queue.pop_front() {
            if node == end {
                continue; // don't traverse past the end
            }
            for edge in graph.edges(node) {
                if forward_edges.contains(&edge.id()) && !visited.contains(&edge.target()) {
                    visited.insert(edge.target());
                    queue.push_back(edge.target());
                }
            }
        }

        visited.into_iter().collect()
    }

    /// Get node IDs that have no incoming forward edges (entry points).
    pub fn entry_nodes(&self) -> Vec<NodeIndex> {
        self.topo_order
            .iter()
            .filter(|&&idx| {
                !self.graph
                    .edges_directed(idx, petgraph::Direction::Incoming)
                    .any(|e| self.forward_edges.contains(&e.id()))
            })
            .copied()
            .collect()
    }

    /// Get downstream nodes that depend on the given node (forward edges only).
    pub fn forward_dependents(&self, node: NodeIndex) -> Vec<NodeIndex> {
        self.graph
            .edges_directed(node, petgraph::Direction::Outgoing)
            .filter(|e| self.forward_edges.contains(&e.id()))
            .map(|e| e.target())
            .collect()
    }

    /// Check if all forward dependencies of a node are completed.
    pub fn all_forward_deps_completed(
        &self,
        node: NodeIndex,
        completed: &HashSet<NodeIndex>,
    ) -> bool {
        self.graph
            .edges_directed(node, petgraph::Direction::Incoming)
            .filter(|e| self.forward_edges.contains(&e.id()))
            .all(|e| completed.contains(&e.source()))
    }

    /// Find back-edges where `node` is the `from` (tail) node.
    pub fn back_edges_from(&self, node: NodeIndex) -> Vec<&BackEdgeInfo> {
        self.back_edges.iter().filter(|be| be.from == node).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flow_common::flow::*;

    fn make_node(id: &str) -> FlowNode {
        FlowNode {
            id: id.to_string(),
            node_type: "core:noop".to_string(),
            config: serde_json::json!({}),
            on_error: ErrorStrategy::default(),
            position: None,
        }
    }

    fn make_edge(from: &str, to: &str) -> FlowEdge {
        FlowEdge {
            from: from.to_string(),
            to: to.to_string(),
            from_port: "default".to_string(),
            to_port: "default".to_string(),
            back_edge: None,
        }
    }

    #[test]
    fn test_simple_dag() {
        let graph = FlowGraph {
            nodes: vec![make_node("a"), make_node("b"), make_node("c")],
            edges: vec![make_edge("a", "b"), make_edge("b", "c")],
        };

        let dag = ExecutionDag::build(&graph).unwrap();
        assert_eq!(dag.topo_order.len(), 3);
        assert_eq!(dag.back_edges.len(), 0);
    }

    #[test]
    fn test_parallel_branches() {
        let graph = FlowGraph {
            nodes: vec![
                make_node("start"),
                make_node("branch_a"),
                make_node("branch_b"),
                make_node("merge"),
            ],
            edges: vec![
                make_edge("start", "branch_a"),
                make_edge("start", "branch_b"),
                make_edge("branch_a", "merge"),
                make_edge("branch_b", "merge"),
            ],
        };

        let dag = ExecutionDag::build(&graph).unwrap();
        assert_eq!(dag.topo_order.len(), 4);
        assert_eq!(dag.entry_nodes().len(), 1);
    }

    #[test]
    fn test_back_edge() {
        let graph = FlowGraph {
            nodes: vec![make_node("fetch"), make_node("process"), make_node("check")],
            edges: vec![
                make_edge("fetch", "process"),
                make_edge("process", "check"),
                FlowEdge {
                    from: "check".to_string(),
                    to: "fetch".to_string(),
                    from_port: "default".to_string(),
                    to_port: "default".to_string(),
                    back_edge: Some(BackEdge {
                        guard: "$last.has_next == true".to_string(),
                        max_iterations: 50,
                    }),
                },
            ],
        };

        let dag = ExecutionDag::build(&graph).unwrap();
        assert_eq!(dag.back_edges.len(), 1);
        assert_eq!(dag.back_edges[0].max_iterations, 50);
        // Loop body should contain fetch, process, check
        let body = &dag.loop_bodies[&(dag.back_edges[0].from, dag.back_edges[0].to)];
        assert_eq!(body.len(), 3);
    }

    #[test]
    fn test_cycle_detection() {
        let graph = FlowGraph {
            nodes: vec![make_node("a"), make_node("b")],
            edges: vec![make_edge("a", "b"), make_edge("b", "a")],
        };

        let result = ExecutionDag::build(&graph);
        assert!(result.is_err());
    }

    #[test]
    fn test_entry_nodes_forward_only() {
        // Node with only back-edge incoming should still be an entry node
        let graph = FlowGraph {
            nodes: vec![make_node("a"), make_node("b")],
            edges: vec![
                make_edge("a", "b"),
                FlowEdge {
                    from: "b".to_string(),
                    to: "a".to_string(),
                    from_port: "default".to_string(),
                    to_port: "default".to_string(),
                    back_edge: Some(BackEdge {
                        guard: "$last.continue == true".to_string(),
                        max_iterations: 10,
                    }),
                },
            ],
        };

        let dag = ExecutionDag::build(&graph).unwrap();
        let entries = dag.entry_nodes();
        assert_eq!(entries.len(), 1);
        // "a" should be the entry (back-edge incoming doesn't count)
        let entry_id = &dag.graph[entries[0]];
        assert_eq!(entry_id, "a");
    }

    #[test]
    fn test_forward_dependents() {
        let graph = FlowGraph {
            nodes: vec![make_node("a"), make_node("b"), make_node("c")],
            edges: vec![
                make_edge("a", "b"),
                make_edge("a", "c"),
            ],
        };
        let dag = ExecutionDag::build(&graph).unwrap();
        let a_idx = dag.node_indices["a"];
        let deps = dag.forward_dependents(a_idx);
        assert_eq!(deps.len(), 2);
    }
}
