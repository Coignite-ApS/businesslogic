//! Filter Unchanged node — content hash diffing for skip-if-unchanged logic.
//!
//! Compares new chunks against existing chunks in the database by SHA-256 hash.
//! Unchanged chunks are reused (no re-embedding needed). Changed chunks are
//! flagged for embedding.

use std::sync::Arc;

use flow_common::node::{NodeInput, NodeResult, NodeTier, NodeTypeMeta, PortDef, RequiredRole};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::nodes::expression::{context_from_snapshot, resolve_value};
use crate::nodes::NodeHandler;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "ai:filter_unchanged".to_string(),
        name: "Filter Unchanged".to_string(),
        description:
            "Content-hash diff: skip chunks that haven't changed since last indexing."
                .to_string(),
        category: "ai".to_string(),
        tier: NodeTier::Core,
        inputs: vec![PortDef {
            name: "input".to_string(),
            data_type: "any".to_string(),
            required: true,
        }],
        outputs: vec![PortDef {
            name: "output".to_string(),
            data_type: "object".to_string(),
            required: true,
        }],
        config_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "document_id": {
                    "type": "string",
                    "description": "Document UUID to compare against"
                },
                "chunks": {
                    "description": "Array of chunk objects with 'content' and 'chunk_index'"
                }
            },
            "required": ["document_id", "chunks"],
            "additionalProperties": false
        }),
        estimated_cost_usd: 0.0,
        required_role: RequiredRole::default(),
    }
}

pub fn handler(pg: Option<sqlx::PgPool>) -> NodeHandler {
    Arc::new(move |input: NodeInput| {
        let pg = pg.clone();
        Box::pin(async move {
            let pool = pg
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("FilterUnchanged: requires PostgreSQL pool"))?;

            let ctx = context_from_snapshot(&input.context_snapshot);
            let trigger = &ctx.trigger;
            let last = &ctx.last;
            let nodes = &ctx.nodes;

            // Resolve document_id
            let doc_id_raw = input
                .config
                .get("document_id")
                .ok_or_else(|| anyhow::anyhow!("FilterUnchanged: missing 'document_id'"))?;
            let doc_id_str = match doc_id_raw {
                serde_json::Value::String(s) => {
                    crate::nodes::expression::interpolate_string(s, trigger, last, nodes)
                }
                other => other.to_string().trim_matches('"').to_string(),
            };
            let document_id: Uuid = doc_id_str
                .parse()
                .map_err(|_| anyhow::anyhow!("FilterUnchanged: invalid document_id UUID"))?;

            // Resolve chunks
            let chunks_expr = input
                .config
                .get("chunks")
                .ok_or_else(|| anyhow::anyhow!("FilterUnchanged: missing 'chunks'"))?;
            let resolved = resolve_value(chunks_expr, trigger, last, nodes);
            let chunks_arr = resolved
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("FilterUnchanged: 'chunks' must be an array"))?;

            if input.cancel.is_cancelled() {
                return Err(anyhow::anyhow!("FilterUnchanged: cancelled"));
            }

            // Fetch existing chunks' content hashes
            let existing: Vec<ExistingChunkRow> = sqlx::query_as(
                "SELECT id, content_hash, chunk_index FROM kb_chunks WHERE document = $1",
            )
            .bind(document_id)
            .fetch_all(pool)
            .await
            .map_err(|e| anyhow::anyhow!("FilterUnchanged: query failed: {}", e))?;

            // Build hash → existing chunk map
            let mut existing_by_hash: std::collections::HashMap<String, ExistingChunkRow> =
                std::collections::HashMap::new();
            for ec in existing {
                if let Some(ref hash) = ec.content_hash {
                    existing_by_hash.insert(hash.clone(), ec);
                }
            }

            let mut to_embed = Vec::new();
            let mut to_reuse = Vec::new();
            let mut to_delete_ids = Vec::new();

            for chunk in chunks_arr {
                let content = chunk
                    .get("content")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        anyhow::anyhow!("FilterUnchanged: chunk missing 'content' field")
                    })?;
                let chunk_index = chunk
                    .get("chunk_index")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as i32;

                let hash = compute_hash(content);

                if let Some(ec) = existing_by_hash.remove(&hash) {
                    to_reuse.push(serde_json::json!({
                        "existing_id": ec.id.to_string(),
                        "chunk_index": chunk_index,
                        "content_hash": hash,
                    }));
                } else {
                    to_embed.push(serde_json::json!({
                        "content": content,
                        "chunk_index": chunk_index,
                        "content_hash": hash,
                    }));
                }
            }

            // Remaining existing chunks (not reused) should be deleted
            for (_, ec) in &existing_by_hash {
                to_delete_ids.push(ec.id.to_string());
            }

            // Collect texts that need embedding (for feeding to embedding node)
            let texts_to_embed: Vec<&str> = to_embed
                .iter()
                .filter_map(|c| c.get("content").and_then(|v| v.as_str()))
                .collect();

            Ok(NodeResult::ok(serde_json::json!({
                "to_embed": to_embed,
                "to_reuse": to_reuse,
                "to_delete_ids": to_delete_ids,
                "texts_to_embed": texts_to_embed,
                "embed_count": to_embed.len(),
                "reuse_count": to_reuse.len(),
                "delete_count": to_delete_ids.len(),
            })))
        })
    })
}

fn compute_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hex::encode(hasher.finalize())
}

#[derive(sqlx::FromRow, Clone)]
struct ExistingChunkRow {
    id: Uuid,
    content_hash: Option<String>,
    chunk_index: i32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filter_unchanged_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "ai:filter_unchanged");
        assert_eq!(meta.category, "ai");
    }

    #[test]
    fn test_compute_hash_deterministic() {
        let h1 = compute_hash("hello world");
        let h2 = compute_hash("hello world");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64); // SHA-256 hex
    }

    #[test]
    fn test_compute_hash_different() {
        let h1 = compute_hash("hello");
        let h2 = compute_hash("world");
        assert_ne!(h1, h2);
    }

    #[tokio::test]
    async fn test_filter_no_pool() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({
                "document_id": "00000000-0000-0000-0000-000000000000",
                "chunks": [{"content": "test", "chunk_index": 0}]
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("PostgreSQL pool"));
    }

    #[tokio::test]
    async fn test_filter_missing_document_id() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({"chunks": []}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        // Pool check happens before config validation
        assert!(result.unwrap_err().to_string().contains("PostgreSQL pool"));
    }

    #[tokio::test]
    async fn test_filter_missing_chunks() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({"document_id": "00000000-0000-0000-0000-000000000000"}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("PostgreSQL pool"));
    }
}
