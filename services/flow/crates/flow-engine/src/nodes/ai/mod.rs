//! AI node implementations — LLM, Embedding, Vector Search.
//!
//! Feature-gated behind `ai-nodes`. Requires pgvector + fastembed.

pub mod budget;
pub mod embedding;
pub mod llm;
pub mod provider;
pub mod vector_search;
