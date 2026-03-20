//! BusinessLogic Flow Engine — core execution library.
//!
//! This crate provides the DAG-based workflow execution engine. It is used
//! by the `flow-worker` binary to execute flows pulled from Redis Streams.
//!
//! # Architecture
//!
//! ```text
//! FlowDef (JSON) → DAG (petgraph) → Executor (Tokio tasks) → Results
//! ```
//!
//! The executor walks the DAG in topological order, spawning Tokio tasks
//! for independent branches. Each node is executed by looking up its type
//! in the node registry and calling the appropriate handler.
//!
//! # Node Tiers
//!
//! - **Core** (Tier 1): Compiled Rust functions. Zero overhead.
//! - **WASM** (Tier 2): Wasmtime-sandboxed plugins. ~3ms cold start.
//! - **External** (Tier 3): HTTP/gRPC microservices. Network latency.

pub mod dag;
pub mod executor;
pub mod nodes;
pub mod state;
pub mod validation;

#[cfg(feature = "wasm-plugins")]
pub mod plugins;
