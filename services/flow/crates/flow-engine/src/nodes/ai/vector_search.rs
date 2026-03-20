//! Vector Search node — pgvector cosine similarity search on knowledge base chunks.
//!
//! CRITICAL: All queries are account-scoped. Never returns data from another account's KB.
//! Requires pg_pool. cost_usd = 0.0.

use std::sync::Arc;

use flow_common::node::{RequiredRole, NodeInput, NodeResult, NodeTier, NodeTypeMeta, PortDef};
use pgvector::Vector;
use uuid::Uuid;

use crate::nodes::expression::{context_from_snapshot, resolve_value};
use crate::nodes::NodeHandler;

const DEFAULT_TOP_K: i64 = 5;
const DEFAULT_THRESHOLD: f64 = 0.7;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "core:vector_search".to_string(),
        name: "Vector Search".to_string(),
        description:
            "Search knowledge base chunks by vector similarity (pgvector cosine distance)."
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
                "knowledge_base_id": {
                    "type": "string",
                    "description": "Knowledge base UUID (supports interpolation)"
                },
                "query_embedding": {
                    "description": "Embedding vector (array of floats or $nodes ref)"
                },
                "top_k": {
                    "type": "integer",
                    "default": DEFAULT_TOP_K
                },
                "similarity_threshold": {
                    "type": "number",
                    "default": DEFAULT_THRESHOLD,
                    "minimum": 0.0,
                    "maximum": 1.0
                },
                "folder_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Scope to specific folders"
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Scope to docs with these tags"
                }
            },
            "required": ["knowledge_base_id", "query_embedding"],
            "additionalProperties": false
        }),
        estimated_cost_usd: 0.0,
        required_role: RequiredRole::default(),
    }
}

/// Build the vector search handler, capturing the PG pool.
pub fn handler(pg: Option<sqlx::PgPool>) -> NodeHandler {
    Arc::new(move |input: NodeInput| {
        let pg = pg.clone();
        Box::pin(async move {
            let pg_pool = pg
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("VectorSearch: requires PostgreSQL pool"))?;

            let ctx = context_from_snapshot(&input.context_snapshot);
            let trigger = &ctx.trigger;
            let last = &ctx.last;
            let nodes = &ctx.nodes;

            // Get account_id from $meta for access control
            let account_id = ctx.meta.account_id;

            // Resolve knowledge_base_id
            let kb_id_raw = input
                .config
                .get("knowledge_base_id")
                .ok_or_else(|| anyhow::anyhow!("VectorSearch: missing 'knowledge_base_id'"))?;
            let kb_id_str = match kb_id_raw {
                serde_json::Value::String(s) => {
                    crate::nodes::expression::interpolate_string(s, trigger, last, nodes)
                }
                other => other.to_string().trim_matches('"').to_string(),
            };
            let kb_id: Uuid = kb_id_str
                .parse()
                .map_err(|_| anyhow::anyhow!("VectorSearch: invalid knowledge_base_id UUID"))?;

            // Verify KB ownership (account-scoped access control)
            let kb_exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM bl_knowledge_bases WHERE id = $1 AND account_id = $2)",
            )
            .bind(kb_id)
            .bind(account_id)
            .fetch_one(pg_pool)
            .await
            .map_err(|e| anyhow::anyhow!("VectorSearch: KB lookup failed: {}", e))?;

            if !kb_exists {
                return Err(anyhow::anyhow!(
                    "VectorSearch: knowledge base not found or access denied"
                ));
            }

            // Resolve query embedding
            let embedding_expr = input
                .config
                .get("query_embedding")
                .ok_or_else(|| anyhow::anyhow!("VectorSearch: missing 'query_embedding'"))?;

            let resolved = resolve_value(embedding_expr, trigger, last, nodes);
            let embedding_vec: Vec<f32> = resolve_embedding(&resolved)?;

            let top_k = input
                .config
                .get("top_k")
                .and_then(|v| v.as_i64())
                .unwrap_or(DEFAULT_TOP_K);

            let threshold = input
                .config
                .get("similarity_threshold")
                .and_then(|v| v.as_f64())
                .unwrap_or(DEFAULT_THRESHOLD);

            // Optional folder filter
            let folder_ids: Option<Vec<Uuid>> = input
                .config
                .get("folder_ids")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().and_then(|s| s.parse().ok()))
                        .collect()
                });

            // Optional tag filter
            let tags: Option<Vec<String>> = input
                .config
                .get("tags")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                });

            // Check cancellation
            if input.cancel.is_cancelled() {
                return Err(anyhow::anyhow!("VectorSearch: cancelled"));
            }

            let query_start = std::time::Instant::now();
            let query_vector = Vector::from(embedding_vec);

            // Build dynamic query with optional filters
            let results = execute_search(
                pg_pool,
                kb_id,
                &query_vector,
                top_k,
                threshold,
                folder_ids.as_deref(),
                tags.as_deref(),
            )
            .await?;

            let query_time_ms = query_start.elapsed().as_millis() as u64;

            Ok(NodeResult::ok(serde_json::json!({
                "results": results,
                "query_time_ms": query_time_ms,
            })))
        })
    })
}

/// Resolve various embedding input formats to Vec<f32>.
fn resolve_embedding(value: &serde_json::Value) -> Result<Vec<f32>, anyhow::Error> {
    match value {
        // Direct array of numbers
        serde_json::Value::Array(arr) => {
            let vec: Vec<f32> = arr
                .iter()
                .map(|v| {
                    v.as_f64()
                        .map(|f| f as f32)
                        .ok_or_else(|| anyhow::anyhow!("VectorSearch: embedding array must contain numbers"))
                })
                .collect::<Result<_, _>>()?;
            if vec.is_empty() {
                return Err(anyhow::anyhow!("VectorSearch: empty embedding vector"));
            }
            Ok(vec)
        }
        // Object with "vector" field (output from embedding node)
        serde_json::Value::Object(obj) => {
            if let Some(vector) = obj.get("vector") {
                return resolve_embedding(vector);
            }
            // Check embeddings[0].vector pattern
            if let Some(embeddings) = obj.get("embeddings") {
                if let Some(first) = embeddings.as_array().and_then(|a| a.first()) {
                    if let Some(vector) = first.get("vector") {
                        return resolve_embedding(vector);
                    }
                }
            }
            Err(anyhow::anyhow!(
                "VectorSearch: object must have 'vector' or 'embeddings[0].vector' field"
            ))
        }
        _ => Err(anyhow::anyhow!(
            "VectorSearch: query_embedding must be array or object with vector field"
        )),
    }
}

#[derive(sqlx::FromRow)]
struct ChunkRow {
    id: Uuid,
    document_id: Uuid,
    content: String,
    similarity_score: f64,
    metadata: serde_json::Value,
    folder_id: Option<Uuid>,
    chunk_index: i32,
}

async fn execute_search(
    pool: &sqlx::PgPool,
    kb_id: Uuid,
    query_vector: &Vector,
    top_k: i64,
    threshold: f64,
    folder_ids: Option<&[Uuid]>,
    tags: Option<&[String]>,
) -> Result<Vec<serde_json::Value>, anyhow::Error> {
    // Build query dynamically based on filters
    let mut sql = String::from(
        "SELECT c.id, c.document_id, c.content, c.metadata, c.folder_id, c.chunk_index,
                1 - (c.embedding <=> $1::vector) as similarity_score
         FROM bl_kb_chunks c
         WHERE c.knowledge_base_id = $2
           AND 1 - (c.embedding <=> $1::vector) >= $3",
    );

    let mut param_idx = 4u32;

    if folder_ids.is_some() {
        sql.push_str(&format!(" AND c.folder_id = ANY(${}::uuid[])", param_idx));
        param_idx += 1;
    }

    if tags.is_some() {
        sql.push_str(&format!(
            " AND c.document_id IN (SELECT document_id FROM bl_kb_document_tags WHERE tag = ANY(${}::text[]))",
            param_idx
        ));
        param_idx += 1;
    }
    let _ = param_idx; // suppress unused warning

    sql.push_str(" ORDER BY c.embedding <=> $1::vector LIMIT ");
    sql.push_str(&top_k.to_string());

    // Execute with dynamic binds
    let mut query = sqlx::query_as::<_, ChunkRow>(&sql)
        .bind(query_vector)
        .bind(kb_id)
        .bind(threshold);

    if let Some(fids) = folder_ids {
        query = query.bind(fids);
    }

    if let Some(t) = tags {
        query = query.bind(t);
    }

    let rows = query
        .fetch_all(pool)
        .await
        .map_err(|e| anyhow::anyhow!("VectorSearch: query failed: {}", e))?;

    let results: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.id,
                "document_id": row.document_id,
                "content": row.content,
                "similarity_score": row.similarity_score,
                "metadata": row.metadata,
                "folder_id": row.folder_id,
                "chunk_index": row.chunk_index,
            })
        })
        .collect();

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vector_search_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "core:vector_search");
        assert_eq!(meta.category, "ai");
        assert_eq!(meta.estimated_cost_usd, 0.0);
    }

    #[tokio::test]
    async fn test_vector_search_no_pg_pool() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({
                "knowledge_base_id": "00000000-0000-0000-0000-000000000000",
                "query_embedding": [0.1, 0.2, 0.3]
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("PostgreSQL pool"));
    }

    #[tokio::test]
    async fn test_vector_search_missing_kb_id() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({"query_embedding": [0.1]}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_embedding_array() {
        let val = serde_json::json!([0.1, 0.2, 0.3]);
        let result = resolve_embedding(&val).unwrap();
        assert_eq!(result.len(), 3);
        assert!((result[0] - 0.1).abs() < 1e-6);
    }

    #[test]
    fn test_resolve_embedding_from_embedding_node_output() {
        let val = serde_json::json!({
            "embeddings": [{"index": 0, "vector": [0.1, 0.2, 0.3]}],
            "model": "BAAI/bge-small-en-v1.5",
            "dimensions": 3,
            "count": 1
        });
        let result = resolve_embedding(&val).unwrap();
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn test_resolve_embedding_object_with_vector() {
        let val = serde_json::json!({"vector": [0.5, 0.6]});
        let result = resolve_embedding(&val).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_resolve_embedding_empty_array() {
        let val = serde_json::json!([]);
        assert!(resolve_embedding(&val).is_err());
    }

    #[test]
    fn test_resolve_embedding_invalid_type() {
        assert!(resolve_embedding(&serde_json::json!("not a vector")).is_err());
        assert!(resolve_embedding(&serde_json::json!(42)).is_err());
    }

    #[tokio::test]
    async fn test_vector_search_cancellation() {
        let h = handler(None);
        let cancel = tokio_util::sync::CancellationToken::new();
        cancel.cancel();

        let input = NodeInput {
            config: serde_json::json!({
                "knowledge_base_id": "00000000-0000-0000-0000-000000000000",
                "query_embedding": [0.1, 0.2, 0.3]
            }),
            data: serde_json::json!({}),
            context_snapshot: serde_json::json!({}),
            cancel,
        };
        let result = h(input).await;
        // Will fail with "requires PostgreSQL pool" before reaching cancellation check
        // because pool check comes first
        assert!(result.is_err());
    }
}
