//! Node registry and core node implementations.
//!
//! The registry maps node type IDs to handler functions. Core nodes are
//! registered at startup. WASM plugins are loaded dynamically.

pub mod aggregate;
pub mod condition;
pub mod database;
pub mod delay;
pub mod expression;
pub mod formula;
pub mod http_request;
pub mod loop_node;
pub mod noop;
pub mod redis_node;
#[cfg(feature = "scripting")]
pub mod script;
pub mod transform;
#[cfg(feature = "ai-nodes")]
pub mod ai;

use flow_common::node::{NodeInput, NodeResult, NodeTypeMeta};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

/// Async node handler function type.
pub type NodeHandler = Arc<
    dyn Fn(NodeInput) -> Pin<Box<dyn Future<Output = Result<NodeResult, anyhow::Error>> + Send>>
        + Send
        + Sync,
>;

/// Registry of all available node types and their handlers.
pub struct NodeRegistry {
    handlers: HashMap<String, NodeHandler>,
    metadata: HashMap<String, NodeTypeMeta>,
}

impl NodeRegistry {
    /// Create a new registry with all core nodes registered.
    pub fn new() -> Self {
        let mut registry = Self {
            handlers: HashMap::new(),
            metadata: HashMap::new(),
        };

        // Register core nodes
        registry.register_core_nodes();

        registry
    }

    /// Register all built-in core nodes.
    fn register_core_nodes(&mut self) {
        self.register("core:noop", noop::metadata(), noop::handler());
        self.register("core:http_request", http_request::metadata(), http_request::handler());
        self.register("core:transform", transform::metadata(), transform::handler());
        self.register("core:condition", condition::metadata(), condition::handler());
        self.register("core:formula_eval", formula::formula_eval_metadata(), formula::formula_eval_handler());
        self.register("core:calculator", formula::calculator_metadata(), formula::calculator_handler());
        self.register("core:loop", loop_node::metadata(), loop_node::handler());
        // database + redis registered via with_pools() since they need connection pools
        self.register("core:delay", delay::metadata(), delay::handler());
        self.register("core:aggregate", aggregate::metadata(), aggregate::handler());
        // AI nodes (core:llm, core:embedding, core:vector_search) registered via with_pools()
        #[cfg(feature = "scripting")]
        self.register("core:script", script::metadata(), script::handler());
    }

    /// Register a node type with its handler.
    pub fn register(&mut self, id: &str, meta: NodeTypeMeta, handler: NodeHandler) {
        self.handlers.insert(id.to_string(), handler);
        self.metadata.insert(id.to_string(), meta);
    }

    /// Get a handler by node type ID (for cloning into spawned tasks).
    pub fn get_handler(&self, node_type: &str) -> Option<&NodeHandler> {
        self.handlers.get(node_type)
    }

    /// Execute a node by type ID.
    pub async fn execute(
        &self,
        node_type: &str,
        input: NodeInput,
    ) -> Result<NodeResult, anyhow::Error> {
        let handler = self
            .handlers
            .get(node_type)
            .ok_or_else(|| anyhow::anyhow!("unknown node type: {node_type}"))?;

        handler(input).await
    }

    /// Get metadata for all registered node types.
    pub fn all_metadata(&self) -> Vec<&NodeTypeMeta> {
        self.metadata.values().collect()
    }

    /// Get metadata for a specific node type.
    pub fn get_metadata(&self, id: &str) -> Option<&NodeTypeMeta> {
        self.metadata.get(id)
    }
}

impl NodeRegistry {
    /// Create a registry with pools for nodes that need database/cache access.
    pub fn with_pools(
        redis: Option<deadpool_redis::Pool>,
        pg: Option<sqlx::PgPool>,
    ) -> Self {
        let mut registry = Self::new();

        // Infrastructure nodes (database + redis)
        registry.register_infra_nodes(redis.clone(), pg.clone());

        #[cfg(feature = "ai-nodes")]
        registry.register_ai_nodes(redis, pg);

        #[cfg(not(feature = "ai-nodes"))]
        {
            let _ = (redis, pg);
        }

        registry
    }

    /// Register infrastructure nodes that need connection pools.
    fn register_infra_nodes(
        &mut self,
        redis: Option<deadpool_redis::Pool>,
        pg: Option<sqlx::PgPool>,
    ) {
        self.register("core:database", database::metadata(), database::handler(pg));
        self.register("core:redis", redis_node::metadata(), redis_node::handler(redis));
    }

    #[cfg(feature = "ai-nodes")]
    fn register_ai_nodes(
        &mut self,
        redis: Option<deadpool_redis::Pool>,
        pg: Option<sqlx::PgPool>,
    ) {
        self.register(
            "core:llm",
            ai::llm::metadata(),
            ai::llm::handler(redis, pg.clone()),
        );
        self.register(
            "core:embedding",
            ai::embedding::metadata(),
            ai::embedding::handler(),
        );
        self.register(
            "core:vector_search",
            ai::vector_search::metadata(),
            ai::vector_search::handler(pg.clone()),
        );
        // KB ingestion pipeline nodes
        self.register(
            "ai:parse_document",
            ai::kb::parse_document::metadata(),
            ai::kb::parse_document::handler(pg.clone()),
        );
        self.register(
            "ai:chunk_text",
            ai::kb::chunk_text::metadata(),
            ai::kb::chunk_text::handler(),
        );
        self.register(
            "ai:filter_unchanged",
            ai::kb::filter_unchanged::metadata(),
            ai::kb::filter_unchanged::handler(pg.clone()),
        );
        self.register(
            "ai:store_vectors",
            ai::kb::store_vectors::metadata(),
            ai::kb::store_vectors::handler(pg.clone()),
        );
        self.register(
            "ai:update_status",
            ai::kb::update_status::metadata(),
            ai::kb::update_status::handler(pg),
        );
    }
}

impl NodeRegistry {
    /// Register a WASM plugin as a node type.
    /// The module is instantiated per-call via spawn_blocking.
    #[cfg(feature = "wasm-plugins")]
    pub fn register_wasm_node(
        &mut self,
        id: &str,
        module: crate::plugins::WasmModule,
        meta: flow_common::node::NodeTypeMeta,
    ) {
        let module = Arc::new(module);
        let handler: NodeHandler = Arc::new(move |input| {
            let module = module.clone();
            Box::pin(async move {
                tokio::task::spawn_blocking(move || module.call_execute_sync(&input))
                    .await
                    .map_err(|e| anyhow::anyhow!("wasm spawn error: {}", e))?
            })
        });
        self.register(id, meta, handler);
    }
}

impl Default for NodeRegistry {
    fn default() -> Self {
        Self::new()
    }
}
