//! Flow executor — parallel DAG execution with JoinSet, loops, and checkpointing.
//!
//! Phase 2: Parallel branch execution via Tokio JoinSet, back-edge loops,
//! CancellationToken propagation, reference tier promotion, and checkpointing.

use crate::dag::ExecutionDag;
use crate::nodes::NodeRegistry;
use crate::state;
use flow_common::context::ExecutionContext;
use flow_common::error::FlowError;
use flow_common::flow::{ExecutionMode, FlowDef};
use flow_common::node::NodeInput;
use petgraph::graph::NodeIndex;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

/// Result of a complete flow execution.
#[derive(Debug)]
pub struct ExecutionResult {
    pub execution_id: Uuid,
    pub context: ExecutionContext,
    pub duration_ms: u64,
    pub nodes_executed: usize,
    pub status: ExecutionStatus,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ExecutionStatus {
    Completed,
    Failed,
    TimedOut,
    Cancelled,
}

/// Outcome from a single node execution task.
struct NodeOutcome {
    node_idx: NodeIndex,
    node_id: String,
    result: Result<flow_common::node::NodeResult, anyhow::Error>,
    duration_ms: u64,
    on_error: flow_common::flow::ErrorStrategy,
    node_type: String,
    config: serde_json::Value,
}

/// Execute a flow to completion.
/// `redis_pool`: optional Redis pool for reference tier + checkpointing.
pub async fn execute_flow(
    flow: &FlowDef,
    trigger_data: serde_json::Value,
    registry: &NodeRegistry,
    env_vars: HashMap<String, String>,
    execution_id: Option<Uuid>,
    redis_pool: Option<deadpool_redis::Pool>,
) -> Result<ExecutionResult, FlowError> {
    let start = Instant::now();
    let execution_id = execution_id.unwrap_or_else(Uuid::new_v4);
    let cancel = CancellationToken::new();

    tracing::info!(
        flow_id = %flow.id,
        execution_id = %execution_id,
        mode = ?flow.settings.mode,
        "starting flow execution"
    );

    // Build DAG
    let dag = ExecutionDag::build(&flow.graph)?;

    // Initialize context
    let context = Arc::new(RwLock::new(ExecutionContext::new(
        execution_id,
        flow.id,
        flow.account_id,
        trigger_data,
        env_vars,
    )));

    // Track completed nodes
    let completed: Arc<RwLock<HashSet<NodeIndex>>> = Arc::new(RwLock::new(HashSet::new()));

    // Execute with flow-level timeout + cancellation
    let timeout = std::time::Duration::from_millis(flow.settings.timeout_ms);
    let cancel_clone = cancel.clone();
    let dag_result = tokio::select! {
        result = execute_dag(
            &dag,
            flow,
            registry,
            &context,
            &completed,
            cancel_clone,
            redis_pool.as_ref(),
            execution_id,
        ) => result,
        _ = tokio::time::sleep(timeout) => {
            cancel.cancel();
            Err(FlowError::NodeTimeout {
                node_id: "flow".into(),
                timeout_ms: flow.settings.timeout_ms,
            })
        }
    };

    let ctx = context.read().await;
    let duration_ms = start.elapsed().as_millis() as u64;
    let nodes_executed = completed.read().await.len();

    // Clean up checkpoint on success
    if dag_result.is_ok() {
        if let Some(ref pool) = redis_pool {
            let _ = state::delete_checkpoint(pool, execution_id).await;
        }
    }

    match dag_result {
        Ok(()) => {
            tracing::info!(
                flow_id = %flow.id,
                execution_id = %execution_id,
                duration_ms,
                nodes_executed,
                "flow execution completed"
            );
            Ok(ExecutionResult {
                execution_id,
                context: ctx.clone(),
                duration_ms,
                nodes_executed,
                status: ExecutionStatus::Completed,
                error: None,
            })
        }
        Err(FlowError::NodeTimeout { timeout_ms, .. }) => {
            tracing::error!(
                flow_id = %flow.id,
                execution_id = %execution_id,
                timeout_ms,
                "flow execution timed out"
            );
            Ok(ExecutionResult {
                execution_id,
                context: ctx.clone(),
                duration_ms,
                nodes_executed,
                status: ExecutionStatus::TimedOut,
                error: Some(format!("flow timed out after {}ms", timeout_ms)),
            })
        }
        Err(e) => {
            tracing::error!(
                flow_id = %flow.id,
                execution_id = %execution_id,
                error = %e,
                "flow execution failed"
            );
            Ok(ExecutionResult {
                execution_id,
                context: ctx.clone(),
                duration_ms,
                nodes_executed,
                status: ExecutionStatus::Failed,
                error: Some(e.to_string()),
            })
        }
    }
}

/// Execute all nodes in the DAG with parallel dispatch (D1: JoinSet).
///
/// Algorithm:
/// 1. Find entry nodes (no forward deps) → ready queue
/// 2. Spawn ready nodes into JoinSet (respect Sequential mode)
/// 3. Await any completion via join_next()
/// 4. On success: update context, check back-edges (loops), find newly-ready dependents
/// 5. On error: apply error strategy (retry/skip/fallback/abort)
/// 6. Repeat until JoinSet empty and ready queue empty
#[allow(clippy::too_many_arguments)]
async fn execute_dag(
    dag: &ExecutionDag,
    flow: &FlowDef,
    registry: &NodeRegistry,
    context: &Arc<RwLock<ExecutionContext>>,
    completed: &Arc<RwLock<HashSet<NodeIndex>>>,
    cancel: CancellationToken,
    redis_pool: Option<&deadpool_redis::Pool>,
    execution_id: Uuid,
) -> Result<(), FlowError> {
    let is_sequential = matches!(flow.settings.mode, ExecutionMode::Sequential);
    let timeout_secs = (flow.settings.timeout_ms / 1000) as i64;

    let mut ready: Vec<NodeIndex> = dag.entry_nodes();
    let mut join_set: JoinSet<NodeOutcome> = JoinSet::new();
    let mut loop_iterations: HashMap<(NodeIndex, NodeIndex), u32> = HashMap::new();
    let mut in_flight: HashSet<NodeIndex> = HashSet::new();

    while !ready.is_empty() || !join_set.is_empty() {
        // Check cancellation
        if cancel.is_cancelled() {
            join_set.shutdown().await;
            return Err(FlowError::ExecutionFailed {
                node_id: "flow".into(),
                reason: "cancelled".into(),
            });
        }

        // Spawn ready nodes into JoinSet
        while let Some(node_idx) = ready.pop() {
            // Sequential mode: only one task at a time
            if is_sequential && !join_set.is_empty() {
                ready.push(node_idx);
                break;
            }

            // Skip if already in flight (can happen with loop re-enqueue)
            if in_flight.contains(&node_idx) {
                continue;
            }

            let node_def = dag
                .node_defs
                .get(&node_idx)
                .ok_or_else(|| FlowError::NodeNotFound(format!("index {:?}", node_idx)))?
                .clone();

            // Budget pre-check
            {
                let ctx = context.read().await;
                if ctx.is_over_budget(flow.settings.budget_limit_usd) {
                    return Err(FlowError::BudgetExceeded(format!(
                        "cumulative cost ${:.4} exceeds limit",
                        ctx.meta.cumulative_cost_usd
                    )));
                }

                // Budget pre-estimation (D9): check estimated cost
                if let Some(limit) = flow.settings.budget_limit_usd {
                    let estimated = registry
                        .get_metadata(&node_def.node_type)
                        .map(|m| m.estimated_cost_usd)
                        .unwrap_or(0.0);
                    if estimated > 0.0 && ctx.meta.cumulative_cost_usd + estimated > limit {
                        tracing::warn!(
                            node_id = %node_def.id,
                            estimated_cost = estimated,
                            cumulative = ctx.meta.cumulative_cost_usd,
                            limit,
                            "budget pre-check: estimated cost would exceed limit"
                        );
                        return Err(FlowError::BudgetExceeded(format!(
                            "estimated cost ${:.4} for {} would exceed budget limit",
                            estimated, node_def.id
                        )));
                    }
                }
            }

            // Build node input from execution context
            let input = {
                let ctx = context.read().await;
                NodeInput {
                    config: node_def.config.clone(),
                    data: ctx.last.clone().unwrap_or(serde_json::Value::Null),
                    context_snapshot: serde_json::to_value(&*ctx).unwrap_or_default(),
                    cancel: cancel.child_token(),
                }
            };

            // Get handler
            let handler = registry
                .get_handler(&node_def.node_type)
                .ok_or_else(|| {
                    FlowError::NodeNotFound(format!("unknown node type: {}", node_def.node_type))
                })?
                .clone();

            let on_error = node_def.on_error.clone();
            let node_id = node_def.id.clone();
            let node_type = node_def.node_type.clone();
            let config = node_def.config.clone();

            in_flight.insert(node_idx);

            tracing::debug!(
                node_id = %node_id,
                node_type = %node_type,
                "spawning node execution"
            );

            // Spawn node execution
            join_set.spawn(async move {
                let node_start = Instant::now();
                let result = handler(input).await;
                let duration_ms = node_start.elapsed().as_millis() as u64;

                tracing::debug!(
                    node_id = %node_id,
                    duration_ms,
                    ok = result.is_ok(),
                    "node execution finished"
                );

                NodeOutcome {
                    node_idx,
                    node_id,
                    result,
                    duration_ms,
                    on_error,
                    node_type,
                    config,
                }
            });
        }

        // Wait for any result
        let Some(join_result) = join_set.join_next().await else {
            break;
        };

        let outcome = match join_result {
            Ok(outcome) => outcome,
            Err(join_err) => {
                // Task panicked — treat as Abort
                return Err(FlowError::ExecutionFailed {
                    node_id: "unknown".into(),
                    reason: format!("node task panicked: {}", join_err),
                });
            }
        };

        in_flight.remove(&outcome.node_idx);

        match outcome.result {
            Ok(node_result) => {
                // Success: write result to context
                let mut ctx = context.write().await;

                // D6: Reference tier promotion if payload > 64KB
                let data = if let Some(pool) = redis_pool {
                    if state::exceeds_inline_threshold(&node_result.data) {
                        match state::store_reference(
                            pool,
                            execution_id,
                            &outcome.node_id,
                            &node_result.data,
                        )
                        .await
                        {
                            Ok(ref_pointer) => serde_json::Value::String(ref_pointer),
                            Err(e) => {
                                tracing::warn!(
                                    node_id = %outcome.node_id,
                                    error = %e,
                                    "reference tier store failed, keeping inline"
                                );
                                node_result.data
                            }
                        }
                    } else {
                        node_result.data
                    }
                } else {
                    node_result.data
                };

                ctx.set_node_output(&outcome.node_id, data, outcome.duration_ms);

                if node_result.cost_usd > 0.0 {
                    ctx.add_cost(node_result.cost_usd);
                }

                for log in &node_result.logs {
                    tracing::debug!(node_id = %outcome.node_id, "{}", log);
                }

                completed.write().await.insert(outcome.node_idx);
                drop(ctx);

                // D7: Checkpoint after each node
                if let Some(pool) = redis_pool {
                    let ctx = context.read().await;
                    let comp = completed.read().await;
                    if let Err(e) = state::checkpoint_execution(
                        pool,
                        execution_id,
                        &ctx,
                        &comp,
                        &loop_iterations,
                        timeout_secs,
                    )
                    .await
                    {
                        tracing::warn!(
                            execution_id = %execution_id,
                            error = %e,
                            "checkpoint failed (non-fatal)"
                        );
                    }
                }

                // D4: Check back-edges from this node (loop handling)
                let back_edges = dag.back_edges_from(outcome.node_idx);
                for be in back_edges {
                    let iter_key = (be.from, be.to);
                    let iterations = loop_iterations.entry(iter_key).or_insert(0);

                    // Evaluate guard condition
                    let ctx = context.read().await;
                    let guard_result = crate::nodes::condition::evaluate_condition(
                        &be.guard,
                        &ctx.trigger,
                        &ctx.last,
                        &ctx.nodes,
                    );
                    drop(ctx);

                    match guard_result {
                        Ok(true) if *iterations < be.max_iterations => {
                            *iterations += 1;
                            tracing::debug!(
                                from = ?be.from,
                                to = ?be.to,
                                iteration = *iterations,
                                max = be.max_iterations,
                                "back-edge guard true, re-entering loop"
                            );

                            // Remove loop body nodes from completed set
                            if let Some(body) = dag.loop_bodies.get(&(be.from, be.to)) {
                                let mut comp = completed.write().await;
                                for &body_node in body {
                                    comp.remove(&body_node);
                                    in_flight.remove(&body_node);
                                }
                            }

                            // Re-enqueue loop entry node
                            ready.push(be.to);
                        }
                        Ok(true) => {
                            tracing::warn!(
                                from = ?be.from,
                                to = ?be.to,
                                max = be.max_iterations,
                                "max iterations reached for back-edge"
                            );
                            return Err(FlowError::MaxIterations {
                                edge: format!(
                                    "{} -> {}",
                                    dag.graph[be.from], dag.graph[be.to]
                                ),
                                max: be.max_iterations,
                            });
                        }
                        Ok(false) => {
                            tracing::debug!(
                                from = ?be.from,
                                to = ?be.to,
                                "back-edge guard false, exiting loop"
                            );
                        }
                        Err(e) => {
                            tracing::warn!(
                                from = ?be.from,
                                to = ?be.to,
                                error = %e,
                                "back-edge guard evaluation failed, treating as false"
                            );
                        }
                    }
                }

                // Find newly ready dependents (forward edges only)
                let comp = completed.read().await;
                for dep in dag.forward_dependents(outcome.node_idx) {
                    if !comp.contains(&dep)
                        && !in_flight.contains(&dep)
                        && dag.all_forward_deps_completed(dep, &comp)
                    {
                        ready.push(dep);
                    }
                }
            }
            Err(error) => {
                // Node failed — apply error strategy
                match &outcome.on_error {
                    flow_common::flow::ErrorStrategy::Skip => {
                        tracing::warn!(
                            node_id = %outcome.node_id,
                            error = %error,
                            duration_ms = outcome.duration_ms,
                            "node failed, skipping"
                        );
                        let mut ctx = context.write().await;
                        ctx.set_node_skipped(&outcome.node_id);
                        completed.write().await.insert(outcome.node_idx);
                        drop(ctx);

                        // Find newly ready dependents
                        let comp = completed.read().await;
                        for dep in dag.forward_dependents(outcome.node_idx) {
                            if !comp.contains(&dep)
                                && !in_flight.contains(&dep)
                                && dag.all_forward_deps_completed(dep, &comp)
                            {
                                ready.push(dep);
                            }
                        }
                    }
                    flow_common::flow::ErrorStrategy::Abort => {
                        let mut ctx = context.write().await;
                        ctx.set_node_error(
                            &outcome.node_id,
                            error.to_string(),
                            outcome.duration_ms,
                        );
                        drop(ctx);

                        // Cancel all in-flight tasks
                        cancel.cancel();
                        join_set.shutdown().await;

                        return Err(FlowError::ExecutionFailed {
                            node_id: outcome.node_id,
                            reason: error.to_string(),
                        });
                    }
                    flow_common::flow::ErrorStrategy::Fallback => {
                        tracing::warn!(
                            node_id = %outcome.node_id,
                            error = %error,
                            "node failed, fallback"
                        );
                        let mut ctx = context.write().await;
                        ctx.set_node_error(
                            &outcome.node_id,
                            error.to_string(),
                            outcome.duration_ms,
                        );
                        completed.write().await.insert(outcome.node_idx);
                        drop(ctx);

                        let comp = completed.read().await;
                        for dep in dag.forward_dependents(outcome.node_idx) {
                            if !comp.contains(&dep)
                                && !in_flight.contains(&dep)
                                && dag.all_forward_deps_completed(dep, &comp)
                            {
                                ready.push(dep);
                            }
                        }
                    }
                    flow_common::flow::ErrorStrategy::Retry {
                        max_retries,
                        initial_delay_ms,
                        backoff_multiplier,
                    } => {
                        tracing::warn!(
                            node_id = %outcome.node_id,
                            error = %error,
                            max_retries,
                            "node failed, starting retry sequence"
                        );

                        let handler = registry
                            .get_handler(&outcome.node_type)
                            .ok_or_else(|| {
                                FlowError::NodeNotFound(format!(
                                    "unknown node type: {}",
                                    outcome.node_type
                                ))
                            })?
                            .clone();

                        let retry_result = execute_retry(
                            &handler,
                            context,
                            &outcome.node_id,
                            &outcome.config,
                            *max_retries,
                            *initial_delay_ms,
                            *backoff_multiplier,
                            cancel.clone(),
                        )
                        .await;

                        match retry_result {
                            Ok(node_result) => {
                                let mut ctx = context.write().await;
                                ctx.set_node_output(
                                    &outcome.node_id,
                                    node_result.data,
                                    outcome.duration_ms,
                                );
                                if node_result.cost_usd > 0.0 {
                                    ctx.add_cost(node_result.cost_usd);
                                }
                                completed.write().await.insert(outcome.node_idx);
                                drop(ctx);

                                let comp = completed.read().await;
                                for dep in dag.forward_dependents(outcome.node_idx) {
                                    if !comp.contains(&dep)
                                        && !in_flight.contains(&dep)
                                        && dag.all_forward_deps_completed(dep, &comp)
                                    {
                                        ready.push(dep);
                                    }
                                }
                            }
                            Err(final_err) => {
                                let mut ctx = context.write().await;
                                ctx.set_node_error(
                                    &outcome.node_id,
                                    final_err.to_string(),
                                    outcome.duration_ms,
                                );
                                drop(ctx);
                                cancel.cancel();
                                join_set.shutdown().await;
                                return Err(FlowError::ExecutionFailed {
                                    node_id: outcome.node_id,
                                    reason: format!(
                                        "failed after {} retries: {}",
                                        max_retries, final_err
                                    ),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

/// Execute retry sequence for a failed node.
#[allow(clippy::too_many_arguments)]
async fn execute_retry(
    handler: &crate::nodes::NodeHandler,
    context: &Arc<RwLock<ExecutionContext>>,
    node_id: &str,
    config: &serde_json::Value,
    max_retries: u32,
    initial_delay_ms: u64,
    backoff_multiplier: f64,
    cancel: CancellationToken,
) -> Result<flow_common::node::NodeResult, anyhow::Error> {
    let mut last_err = anyhow::anyhow!("retry exhausted");

    for attempt in 1..=max_retries {
        let base_delay = initial_delay_ms as f64 * backoff_multiplier.powi(attempt as i32 - 1);
        let jitter = base_delay * 0.1 * (2.0 * rand_jitter() - 1.0);
        let delay_ms = (base_delay + jitter).max(1.0) as u64;

        tracing::warn!(
            node_id = %node_id,
            attempt,
            max_retries,
            delay_ms,
            "retrying node"
        );

        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;

        if cancel.is_cancelled() {
            return Err(anyhow::anyhow!("retry cancelled"));
        }

        let input = {
            let ctx = context.read().await;
            NodeInput {
                config: config.clone(),
                data: ctx.last.clone().unwrap_or(serde_json::Value::Null),
                context_snapshot: serde_json::to_value(&*ctx).unwrap_or_default(),
                cancel: cancel.child_token(),
            }
        };

        match handler(input).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                last_err = e;
                if attempt == max_retries {
                    return Err(last_err);
                }
            }
        }
    }

    Err(last_err)
}

/// Simple jitter using timestamp nanos.
fn rand_jitter() -> f64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    (nanos % 1000) as f64 / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nodes::NodeRegistry;
    use flow_common::context::NodeStatus;
    use flow_common::flow::*;

    fn test_flow() -> FlowDef {
        FlowDef {
            id: Uuid::new_v4(),
            name: "test".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![FlowNode {
                    id: "noop_1".to_string(),
                    node_type: "core:noop".to_string(),
                    config: serde_json::json!({}),
                    on_error: ErrorStrategy::default(),
                    position: None,
                }],
                edges: vec![],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings::default(),
            version: 1,
        }
    }

    fn make_node(id: &str, node_type: &str) -> FlowNode {
        FlowNode {
            id: id.to_string(),
            node_type: node_type.to_string(),
            config: serde_json::json!({}),
            on_error: ErrorStrategy::default(),
            position: None,
        }
    }

    fn make_node_with_config(id: &str, node_type: &str, config: serde_json::Value) -> FlowNode {
        FlowNode {
            id: id.to_string(),
            node_type: node_type.to_string(),
            config,
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

    #[tokio::test]
    async fn test_simple_execution() {
        let flow = test_flow();
        let registry = NodeRegistry::new();

        let result = execute_flow(
            &flow,
            serde_json::json!({"test": true}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.status, ExecutionStatus::Completed);
        assert_eq!(result.nodes_executed, 1);
    }

    #[tokio::test]
    async fn test_external_execution_id() {
        let flow = test_flow();
        let registry = NodeRegistry::new();
        let ext_id = Uuid::new_v4();

        let result = execute_flow(
            &flow,
            serde_json::json!({}),
            &registry,
            HashMap::new(),
            Some(ext_id),
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.execution_id, ext_id);
    }

    #[tokio::test]
    async fn test_multi_node_chain() {
        let flow = FlowDef {
            id: Uuid::new_v4(),
            name: "chain".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![
                    make_node("a", "core:noop"),
                    make_node("b", "core:noop"),
                    make_node("c", "core:noop"),
                ],
                edges: vec![make_edge("a", "b"), make_edge("b", "c")],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings::default(),
            version: 1,
        };
        let registry = NodeRegistry::new();

        let result = execute_flow(
            &flow,
            serde_json::json!({"x": 1}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.status, ExecutionStatus::Completed);
        assert_eq!(result.nodes_executed, 3);
    }

    #[tokio::test]
    async fn test_diamond_dag_parallel() {
        let flow = FlowDef {
            id: Uuid::new_v4(),
            name: "diamond".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![
                    make_node("a", "core:noop"),
                    make_node("b", "core:noop"),
                    make_node("c", "core:noop"),
                    make_node("d", "core:noop"),
                ],
                edges: vec![
                    make_edge("a", "b"),
                    make_edge("a", "c"),
                    make_edge("b", "d"),
                    make_edge("c", "d"),
                ],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings {
                mode: ExecutionMode::Parallel,
                ..Default::default()
            },
            version: 1,
        };
        let registry = NodeRegistry::new();

        let result = execute_flow(
            &flow,
            serde_json::json!({"diamond": true}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.status, ExecutionStatus::Completed);
        assert_eq!(result.nodes_executed, 4);
    }

    #[tokio::test]
    async fn test_diamond_dag_sequential() {
        let flow = FlowDef {
            id: Uuid::new_v4(),
            name: "diamond_seq".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![
                    make_node("a", "core:noop"),
                    make_node("b", "core:noop"),
                    make_node("c", "core:noop"),
                    make_node("d", "core:noop"),
                ],
                edges: vec![
                    make_edge("a", "b"),
                    make_edge("a", "c"),
                    make_edge("b", "d"),
                    make_edge("c", "d"),
                ],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings {
                mode: ExecutionMode::Sequential,
                ..Default::default()
            },
            version: 1,
        };
        let registry = NodeRegistry::new();

        let result = execute_flow(
            &flow,
            serde_json::json!({}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.status, ExecutionStatus::Completed);
        assert_eq!(result.nodes_executed, 4);
    }

    #[tokio::test]
    async fn test_parallel_timing() {
        let mut registry = NodeRegistry::new();
        registry.register(
            "test:slow_100ms",
            flow_common::node::NodeTypeMeta {
                id: "test:slow_100ms".into(),
                name: "Slow100".into(),
                description: "Sleeps 100ms".into(),
                category: "test".into(),
                tier: flow_common::node::NodeTier::Core,
                inputs: vec![],
                outputs: vec![],
                config_schema: serde_json::json!({}),
                estimated_cost_usd: 0.0,
                required_role: flow_common::node::RequiredRole::default(),
            },
            Arc::new(|_input: NodeInput| {
                Box::pin(async {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    Ok(flow_common::node::NodeResult::ok(serde_json::json!({"done": true})))
                })
            }),
        );

        let flow = FlowDef {
            id: Uuid::new_v4(),
            name: "parallel_timing".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![
                    make_node("start", "core:noop"),
                    make_node("slow_a", "test:slow_100ms"),
                    make_node("slow_b", "test:slow_100ms"),
                    make_node("end", "core:noop"),
                ],
                edges: vec![
                    make_edge("start", "slow_a"),
                    make_edge("start", "slow_b"),
                    make_edge("slow_a", "end"),
                    make_edge("slow_b", "end"),
                ],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings {
                mode: ExecutionMode::Parallel,
                ..Default::default()
            },
            version: 1,
        };

        let result = execute_flow(
            &flow,
            serde_json::json!({}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.status, ExecutionStatus::Completed);
        assert!(
            result.duration_ms < 180,
            "parallel execution took {}ms, expected < 180ms",
            result.duration_ms
        );
    }

    #[tokio::test]
    async fn test_cancellation() {
        let mut registry = NodeRegistry::new();
        registry.register(
            "test:slow",
            flow_common::node::NodeTypeMeta {
                id: "test:slow".into(),
                name: "Slow".into(),
                description: "Sleeps 5s".into(),
                category: "test".into(),
                tier: flow_common::node::NodeTier::Core,
                inputs: vec![],
                outputs: vec![],
                config_schema: serde_json::json!({}),
                estimated_cost_usd: 0.0,
                required_role: flow_common::node::RequiredRole::default(),
            },
            Arc::new(|input: NodeInput| {
                Box::pin(async move {
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {
                            Ok(flow_common::node::NodeResult::ok(serde_json::json!({"done": true})))
                        }
                        _ = input.cancel.cancelled() => {
                            Err(anyhow::anyhow!("cancelled"))
                        }
                    }
                })
            }),
        );

        let flow = FlowDef {
            id: Uuid::new_v4(),
            name: "cancel_test".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![make_node("slow_1", "test:slow")],
                edges: vec![],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings {
                timeout_ms: 50,
                ..Default::default()
            },
            version: 1,
        };

        let result = execute_flow(
            &flow,
            serde_json::json!({}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.status, ExecutionStatus::TimedOut);
    }

    #[tokio::test]
    async fn test_condition_branching() {
        let flow = FlowDef {
            id: Uuid::new_v4(),
            name: "cond".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![
                    make_node("start", "core:noop"),
                    make_node_with_config(
                        "check",
                        "core:condition",
                        serde_json::json!({
                            "condition": "$trigger.val == 42",
                            "then_value": {"branch": "yes"},
                            "else_value": {"branch": "no"}
                        }),
                    ),
                ],
                edges: vec![make_edge("start", "check")],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings::default(),
            version: 1,
        };
        let registry = NodeRegistry::new();

        let result = execute_flow(
            &flow,
            serde_json::json!({"val": 42}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(result.status, ExecutionStatus::Completed);
        assert_eq!(result.context.last.as_ref().unwrap()["branch"], "then");

        let result = execute_flow(
            &flow,
            serde_json::json!({"val": 99}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(result.context.last.as_ref().unwrap()["branch"], "else");
    }

    #[tokio::test]
    async fn test_skip_error_strategy() {
        let flow = FlowDef {
            id: Uuid::new_v4(),
            name: "skip".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![
                    FlowNode {
                        id: "bad".to_string(),
                        node_type: "core:http_request".to_string(),
                        config: serde_json::json!({}),
                        on_error: ErrorStrategy::Skip,
                        position: None,
                    },
                    make_node("after", "core:noop"),
                ],
                edges: vec![make_edge("bad", "after")],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings::default(),
            version: 1,
        };
        let registry = NodeRegistry::new();

        let result = execute_flow(
            &flow,
            serde_json::json!({}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.status, ExecutionStatus::Completed);
        assert_eq!(result.nodes_executed, 2);
        assert_eq!(result.context.nodes["bad"].status, NodeStatus::Skipped);
    }

    #[tokio::test]
    async fn test_abort_error_strategy() {
        let flow = FlowDef {
            id: Uuid::new_v4(),
            name: "abort".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![
                    FlowNode {
                        id: "bad".to_string(),
                        node_type: "core:http_request".to_string(),
                        config: serde_json::json!({}),
                        on_error: ErrorStrategy::Abort,
                        position: None,
                    },
                    make_node("after", "core:noop"),
                ],
                edges: vec![make_edge("bad", "after")],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings::default(),
            version: 1,
        };
        let registry = NodeRegistry::new();

        let result = execute_flow(
            &flow,
            serde_json::json!({}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.status, ExecutionStatus::Failed);
        assert!(result.error.is_some());
        assert!(!result.context.nodes.contains_key("after"));
    }

    #[tokio::test]
    async fn test_abort_cancels_parallel_branches() {
        let mut registry = NodeRegistry::new();
        registry.register(
            "test:slow",
            flow_common::node::NodeTypeMeta {
                id: "test:slow".into(),
                name: "Slow".into(),
                description: "".into(),
                category: "test".into(),
                tier: flow_common::node::NodeTier::Core,
                inputs: vec![],
                outputs: vec![],
                config_schema: serde_json::json!({}),
                estimated_cost_usd: 0.0,
                required_role: flow_common::node::RequiredRole::default(),
            },
            Arc::new(|input: NodeInput| {
                Box::pin(async move {
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {
                            Ok(flow_common::node::NodeResult::ok(serde_json::json!({})))
                        }
                        _ = input.cancel.cancelled() => {
                            Err(anyhow::anyhow!("cancelled"))
                        }
                    }
                })
            }),
        );

        let flow = FlowDef {
            id: Uuid::new_v4(),
            name: "abort_parallel".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![
                    make_node("start", "core:noop"),
                    FlowNode {
                        id: "fail_fast".to_string(),
                        node_type: "core:http_request".to_string(),
                        config: serde_json::json!({}),
                        on_error: ErrorStrategy::Abort,
                        position: None,
                    },
                    make_node("slow_branch", "test:slow"),
                ],
                edges: vec![
                    make_edge("start", "fail_fast"),
                    make_edge("start", "slow_branch"),
                ],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings::default(),
            version: 1,
        };

        let result = execute_flow(
            &flow,
            serde_json::json!({}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.status, ExecutionStatus::Failed);
        assert!(result.duration_ms < 1000);
    }

    #[tokio::test]
    async fn test_skip_in_parallel_branch() {
        let flow = FlowDef {
            id: Uuid::new_v4(),
            name: "skip_parallel".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![
                    make_node("start", "core:noop"),
                    FlowNode {
                        id: "branch_fail".to_string(),
                        node_type: "core:http_request".to_string(),
                        config: serde_json::json!({}),
                        on_error: ErrorStrategy::Skip,
                        position: None,
                    },
                    make_node("branch_ok", "core:noop"),
                    make_node("merge", "core:noop"),
                ],
                edges: vec![
                    make_edge("start", "branch_fail"),
                    make_edge("start", "branch_ok"),
                    make_edge("branch_fail", "merge"),
                    make_edge("branch_ok", "merge"),
                ],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings::default(),
            version: 1,
        };
        let registry = NodeRegistry::new();

        let result = execute_flow(
            &flow,
            serde_json::json!({}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.status, ExecutionStatus::Completed);
        assert_eq!(result.nodes_executed, 4);
        assert_eq!(result.context.nodes["branch_fail"].status, NodeStatus::Skipped);
    }

    #[tokio::test]
    async fn test_budget_exceeded() {
        let flow = FlowDef {
            id: Uuid::new_v4(),
            name: "budget".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![
                    make_node("a", "core:noop"),
                    make_node("b", "core:noop"),
                ],
                edges: vec![make_edge("a", "b")],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings {
                budget_limit_usd: Some(0.0),
                ..Default::default()
            },
            version: 1,
        };
        let registry = NodeRegistry::new();

        let result = execute_flow(
            &flow,
            serde_json::json!({}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(result.status, ExecutionStatus::Completed);
    }

    #[tokio::test]
    async fn test_timeout_enforcement() {
        let mut registry = NodeRegistry::new();
        registry.register(
            "test:slow",
            flow_common::node::NodeTypeMeta {
                id: "test:slow".into(),
                name: "Slow".into(),
                description: "Sleeps for testing timeout".into(),
                category: "test".into(),
                tier: flow_common::node::NodeTier::Core,
                inputs: vec![],
                outputs: vec![],
                config_schema: serde_json::json!({}),
                estimated_cost_usd: 0.0,
                required_role: flow_common::node::RequiredRole::default(),
            },
            Arc::new(|_input: flow_common::node::NodeInput| {
                Box::pin(async {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    Ok(flow_common::node::NodeResult::ok(serde_json::json!({"done": true})))
                })
            }),
        );

        let flow = FlowDef {
            id: Uuid::new_v4(),
            name: "timeout".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![make_node("slow_1", "test:slow")],
                edges: vec![],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings {
                timeout_ms: 50,
                ..Default::default()
            },
            version: 1,
        };

        let result = execute_flow(
            &flow,
            serde_json::json!({}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.status, ExecutionStatus::TimedOut);
        assert!(result.error.as_ref().unwrap().contains("timed out"));
    }

    #[tokio::test]
    async fn test_fast_flow_does_not_timeout() {
        let flow = FlowDef {
            id: Uuid::new_v4(),
            name: "fast".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![make_node("a", "core:noop")],
                edges: vec![],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings {
                timeout_ms: 5000,
                ..Default::default()
            },
            version: 1,
        };
        let registry = NodeRegistry::new();

        let result = execute_flow(
            &flow,
            serde_json::json!({}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.status, ExecutionStatus::Completed);
    }

    #[tokio::test]
    async fn test_empty_flow() {
        let flow = FlowDef {
            id: Uuid::new_v4(),
            name: "empty".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![],
                edges: vec![],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings::default(),
            version: 1,
        };
        let registry = NodeRegistry::new();

        let result = execute_flow(
            &flow,
            serde_json::json!({}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.status, ExecutionStatus::Completed);
        assert_eq!(result.nodes_executed, 0);
    }

    #[tokio::test]
    async fn test_back_edge_loop() {
        let mut registry = NodeRegistry::new();
        registry.register(
            "test:counter",
            flow_common::node::NodeTypeMeta {
                id: "test:counter".into(),
                name: "Counter".into(),
                description: "Increments counter".into(),
                category: "test".into(),
                tier: flow_common::node::NodeTier::Core,
                inputs: vec![],
                outputs: vec![],
                config_schema: serde_json::json!({}),
                estimated_cost_usd: 0.0,
                required_role: flow_common::node::RequiredRole::default(),
            },
            Arc::new(|input: NodeInput| {
                Box::pin(async move {
                    let current = input
                        .data
                        .get("counter")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0) as i64;
                    Ok(flow_common::node::NodeResult::ok(
                        serde_json::json!({"counter": current + 1}),
                    ))
                })
            }),
        );

        let flow = FlowDef {
            id: Uuid::new_v4(),
            name: "loop_test".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![
                    make_node("init", "core:noop"),
                    make_node("count", "test:counter"),
                    make_node("check", "core:noop"),
                ],
                edges: vec![
                    make_edge("init", "count"),
                    make_edge("count", "check"),
                    FlowEdge {
                        from: "check".to_string(),
                        to: "count".to_string(),
                        from_port: "default".to_string(),
                        to_port: "default".to_string(),
                        back_edge: Some(BackEdge {
                            guard: "$last.counter < 3".to_string(),
                            max_iterations: 10,
                        }),
                    },
                ],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings::default(),
            version: 1,
        };

        let result = execute_flow(
            &flow,
            serde_json::json!({"counter": 0}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.status, ExecutionStatus::Completed);
        let counter = result.context.last.as_ref().unwrap()["counter"]
            .as_f64()
            .unwrap() as i64;
        assert_eq!(counter, 3);
    }

    #[tokio::test]
    async fn test_back_edge_guard_false_immediately() {
        let mut registry = NodeRegistry::new();
        registry.register(
            "test:counter",
            flow_common::node::NodeTypeMeta {
                id: "test:counter".into(),
                name: "Counter".into(),
                description: "".into(),
                category: "test".into(),
                tier: flow_common::node::NodeTier::Core,
                inputs: vec![],
                outputs: vec![],
                config_schema: serde_json::json!({}),
                estimated_cost_usd: 0.0,
                required_role: flow_common::node::RequiredRole::default(),
            },
            Arc::new(|input: NodeInput| {
                Box::pin(async move {
                    let current = input
                        .data
                        .get("counter")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0) as i64;
                    Ok(flow_common::node::NodeResult::ok(
                        serde_json::json!({"counter": current + 1, "should_loop": false}),
                    ))
                })
            }),
        );

        let flow = FlowDef {
            id: Uuid::new_v4(),
            name: "no_loop".to_string(),
            description: None,
            account_id: Uuid::new_v4(),
            status: FlowStatus::Active,
            graph: FlowGraph {
                nodes: vec![
                    make_node("count", "test:counter"),
                    make_node("end", "core:noop"),
                ],
                edges: vec![
                    make_edge("count", "end"),
                    FlowEdge {
                        from: "end".to_string(),
                        to: "count".to_string(),
                        from_port: "default".to_string(),
                        to_port: "default".to_string(),
                        back_edge: Some(BackEdge {
                            guard: "$last.should_loop == true".to_string(),
                            max_iterations: 10,
                        }),
                    },
                ],
            },
            trigger_config: flow_common::trigger::TriggerConfig::Manual,
            settings: FlowSettings::default(),
            version: 1,
        };

        let result = execute_flow(
            &flow,
            serde_json::json!({}),
            &registry,
            HashMap::new(),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.status, ExecutionStatus::Completed);
        let counter = result.context.nodes["count"].data["counter"]
            .as_f64()
            .unwrap() as i64;
        assert_eq!(counter, 1);
    }
}
