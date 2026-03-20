//! AI node implementations — LLM, Embedding, Vector Search, KB pipeline.
//!
//! Feature-gated behind `ai-nodes`. Requires pgvector + fastembed.

pub mod budget;
pub mod embedding;
pub mod kb;
pub mod llm;
pub mod provider;
pub mod vector_search;
