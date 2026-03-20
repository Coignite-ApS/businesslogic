//! KB-specific AI nodes for ingestion and search flows.
//!
//! These nodes implement the KB ingestion and search pipelines as flow nodes,
//! replacing the BullMQ-based pipeline and OpenAI-based search in bl-ai-api.

pub mod chunk_text;
pub mod filter_unchanged;
pub mod merge_rrf;
pub mod parse_document;
pub mod store_vectors;
pub mod text_search;
pub mod update_status;
