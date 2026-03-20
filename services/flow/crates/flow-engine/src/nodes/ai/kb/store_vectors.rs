//! Store Vectors node — insert embedded chunks into pgvector.
//!
//! Accepts chunks with embeddings from the pipeline, inserts into kb_chunks
//! table, handles reuse updates and deletes stale chunks. Account-scoped.

use std::sync::Arc;

use flow_common::node::{NodeInput, NodeResult, NodeTier, NodeTypeMeta, PortDef, RequiredRole};
use pgvector::Vector;
use uuid::Uuid;

use crate::nodes::expression::{context_from_snapshot, resolve_value};
use crate::nodes::NodeHandler;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "ai:store_vectors".to_string(),
        name: "Store Vectors".to_string(),
        description:
            "Insert embedded chunks into PostgreSQL with pgvector HNSW index.".to_string(),
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
                    "description": "Document UUID"
                },
                "knowledge_base_id": {
                    "type": "string",
                    "description": "KB UUID"
                },
                "to_embed": {
                    "description": "Chunks that need new embeddings (from filter_unchanged)"
                },
                "embeddings": {
                    "description": "Embedding results (from embed node)"
                },
                "to_reuse": {
                    "description": "Chunks to reuse (from filter_unchanged)"
                },
                "to_delete_ids": {
                    "description": "Chunk IDs to delete (from filter_unchanged)"
                }
            },
            "required": ["document_id", "knowledge_base_id", "to_embed", "embeddings"],
            "additionalProperties": false
        }),
        estimated_cost_usd: 0.0,
        required_role: RequiredRole::Admin,
    }
}

pub fn handler(pg: Option<sqlx::PgPool>) -> NodeHandler {
    Arc::new(move |input: NodeInput| {
        let pg = pg.clone();
        Box::pin(async move {
            let pool = pg
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("StoreVectors: requires PostgreSQL pool"))?;

            let ctx = context_from_snapshot(&input.context_snapshot);
            let trigger = &ctx.trigger;
            let last = &ctx.last;
            let nodes = &ctx.nodes;
            let account_id = ctx.meta.account_id;

            // Resolve IDs
            let doc_id = resolve_uuid(&input.config, "document_id", trigger, last, nodes)?;
            let kb_id = resolve_uuid(&input.config, "knowledge_base_id", trigger, last, nodes)?;

            // Resolve arrays
            let to_embed_raw = input.config.get("to_embed")
                .ok_or_else(|| anyhow::anyhow!("StoreVectors: missing 'to_embed'"))?;
            let to_embed = resolve_value(to_embed_raw, trigger, last, nodes);
            let to_embed_arr = to_embed.as_array()
                .ok_or_else(|| anyhow::anyhow!("StoreVectors: 'to_embed' must be array"))?;

            let embeddings_raw = input.config.get("embeddings")
                .ok_or_else(|| anyhow::anyhow!("StoreVectors: missing 'embeddings'"))?;
            let embeddings = resolve_value(embeddings_raw, trigger, last, nodes);

            // Extract embedding vectors
            let embedding_vecs = extract_embeddings(&embeddings)?;

            if to_embed_arr.len() != embedding_vecs.len() {
                return Err(anyhow::anyhow!(
                    "StoreVectors: chunk count ({}) != embedding count ({})",
                    to_embed_arr.len(),
                    embedding_vecs.len()
                ));
            }

            let to_reuse = input.config.get("to_reuse")
                .and_then(|v| resolve_value(v, trigger, last, nodes).as_array().cloned())
                .unwrap_or_default();

            let to_delete_ids = input.config.get("to_delete_ids")
                .and_then(|v| resolve_value(v, trigger, last, nodes).as_array().cloned())
                .unwrap_or_default();

            if input.cancel.is_cancelled() {
                return Err(anyhow::anyhow!("StoreVectors: cancelled"));
            }

            let mut inserted = 0u64;
            let mut updated = 0u64;
            let mut deleted = 0u64;

            // Delete stale chunks
            for id_val in &to_delete_ids {
                if let Some(id_str) = id_val.as_str() {
                    if let Ok(chunk_id) = id_str.parse::<Uuid>() {
                        sqlx::query("DELETE FROM kb_chunks WHERE id = $1")
                            .bind(chunk_id)
                            .execute(pool)
                            .await
                            .map_err(|e| anyhow::anyhow!("StoreVectors: delete failed: {}", e))?;
                        deleted += 1;
                    }
                }
            }

            // Update reused chunk indices
            for reused in &to_reuse {
                if let (Some(id_str), Some(idx)) = (
                    reused.get("existing_id").and_then(|v| v.as_str()),
                    reused.get("chunk_index").and_then(|v| v.as_i64()),
                ) {
                    if let Ok(chunk_id) = id_str.parse::<Uuid>() {
                        sqlx::query("UPDATE kb_chunks SET chunk_index = $1 WHERE id = $2")
                            .bind(idx as i32)
                            .bind(chunk_id)
                            .execute(pool)
                            .await
                            .map_err(|e| anyhow::anyhow!("StoreVectors: reuse update failed: {}", e))?;
                        updated += 1;
                    }
                }
            }

            // Insert new chunks with embeddings
            for (i, chunk) in to_embed_arr.iter().enumerate() {
                let content = chunk.get("content").and_then(|v| v.as_str()).unwrap_or("");
                let chunk_index = chunk.get("chunk_index").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                let content_hash = chunk.get("content_hash").and_then(|v| v.as_str()).unwrap_or("");

                let embedding_vec = &embedding_vecs[i];
                let vector = Vector::from(embedding_vec.clone());
                let chunk_id = Uuid::new_v4();

                let metadata = serde_json::json!({
                    "chunk_index": chunk_index,
                });

                let token_count = estimate_tokens(content) as i32;

                sqlx::query(
                    "INSERT INTO kb_chunks (id, document, knowledge_base, account_id, chunk_index, content, content_hash, embedding, metadata, token_count, search_vector)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, to_tsvector('simple', $11))",
                )
                .bind(chunk_id)
                .bind(doc_id)
                .bind(kb_id)
                .bind(account_id)
                .bind(chunk_index)
                .bind(content)
                .bind(content_hash)
                .bind(&vector)
                .bind(&metadata)
                .bind(token_count)
                .bind(content)
                .execute(pool)
                .await
                .map_err(|e| anyhow::anyhow!("StoreVectors: insert failed: {}", e))?;

                inserted += 1;
            }

            Ok(NodeResult::ok(serde_json::json!({
                "inserted": inserted,
                "updated": updated,
                "deleted": deleted,
                "total_chunks": inserted + updated,
            })))
        })
    })
}

fn resolve_uuid(
    config: &serde_json::Value,
    field: &str,
    trigger: &serde_json::Value,
    last: &Option<serde_json::Value>,
    nodes: &std::collections::HashMap<String, flow_common::context::NodeOutput>,
) -> Result<Uuid, anyhow::Error> {
    let raw = config
        .get(field)
        .ok_or_else(|| anyhow::anyhow!("StoreVectors: missing '{}'", field))?;
    let s = match raw {
        serde_json::Value::String(s) => {
            crate::nodes::expression::interpolate_string(s, trigger, last, nodes)
        }
        other => other.to_string().trim_matches('"').to_string(),
    };
    s.parse()
        .map_err(|_| anyhow::anyhow!("StoreVectors: invalid {} UUID", field))
}

fn extract_embeddings(value: &serde_json::Value) -> Result<Vec<Vec<f32>>, anyhow::Error> {
    // Handle embedding node output: { embeddings: [{index, vector}, ...] }
    if let Some(embs) = value.get("embeddings").and_then(|v| v.as_array()) {
        let mut result = Vec::with_capacity(embs.len());
        for emb in embs {
            let vec: Vec<f32> = emb
                .get("vector")
                .and_then(|v| v.as_array())
                .ok_or_else(|| anyhow::anyhow!("StoreVectors: embedding missing 'vector'"))?
                .iter()
                .map(|n| n.as_f64().unwrap_or(0.0) as f32)
                .collect();
            result.push(vec);
        }
        return Ok(result);
    }

    // Handle direct array of vectors: [[0.1, 0.2, ...], ...]
    if let Some(arr) = value.as_array() {
        if arr.first().and_then(|v| v.as_array()).is_some() {
            let mut result = Vec::with_capacity(arr.len());
            for item in arr {
                let vec: Vec<f32> = item
                    .as_array()
                    .ok_or_else(|| anyhow::anyhow!("StoreVectors: expected vector array"))?
                    .iter()
                    .map(|n| n.as_f64().unwrap_or(0.0) as f32)
                    .collect();
                result.push(vec);
            }
            return Ok(result);
        }
    }

    Err(anyhow::anyhow!("StoreVectors: unrecognized embeddings format"))
}

fn estimate_tokens(text: &str) -> usize {
    let words = text.split_whitespace().count();
    ((words as f64) / 0.75).ceil() as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_vectors_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "ai:store_vectors");
        assert_eq!(meta.required_role, RequiredRole::Admin);
    }

    #[test]
    fn test_extract_embeddings_node_format() {
        let val = serde_json::json!({
            "embeddings": [
                {"index": 0, "vector": [0.1, 0.2, 0.3]},
                {"index": 1, "vector": [0.4, 0.5, 0.6]}
            ]
        });
        let result = extract_embeddings(&val).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].len(), 3);
    }

    #[test]
    fn test_extract_embeddings_direct_format() {
        let val = serde_json::json!([[0.1, 0.2], [0.3, 0.4]]);
        let result = extract_embeddings(&val).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_extract_embeddings_invalid() {
        assert!(extract_embeddings(&serde_json::json!("invalid")).is_err());
        assert!(extract_embeddings(&serde_json::json!(42)).is_err());
    }

    #[tokio::test]
    async fn test_store_vectors_no_pool() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({
                "document_id": "00000000-0000-0000-0000-000000000000",
                "knowledge_base_id": "00000000-0000-0000-0000-000000000000",
                "to_embed": [],
                "embeddings": {"embeddings": []}
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("PostgreSQL pool"));
    }
}
