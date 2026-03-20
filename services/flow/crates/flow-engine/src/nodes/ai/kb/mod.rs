//! KB-specific AI nodes for ingestion and search flows.
//!
//! These nodes implement the KB ingestion pipeline as flow nodes,
//! replacing the BullMQ-based pipeline in bl-ai-api.

pub mod chunk_text;
pub mod filter_unchanged;
pub mod parse_document;
pub mod store_vectors;
pub mod update_status;
