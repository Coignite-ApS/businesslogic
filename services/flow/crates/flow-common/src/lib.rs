//! Shared types and message definitions for the BusinessLogic flow engine.
//!
//! This crate contains types used by both the trigger service and worker
//! processes, including flow definitions, execution context, and Redis
//! message formats.

pub mod flow;
pub mod context;
pub mod node;
pub mod trigger;
pub mod message;
pub mod error;
