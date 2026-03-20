//! Text Search node — PostgreSQL full-text search on KB chunks.
//!
//! Uses tsvector/plainto_tsquery for FTS ranking. Account-scoped.
//! Runs in parallel with vector_search for hybrid search flows.

use std::sync::Arc;

use flow_common::node::{NodeInput, NodeResult, NodeTier, NodeTypeMeta, PortDef, RequiredRole};
use uuid::Uuid;

use crate::nodes::expression::{context_from_snapshot, resolve_value};
use crate::nodes::NodeHandler;

const DEFAULT_LIMIT: i64 = 15;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "ai:text_search".to_string(),
        name: "Text Search".to_string(),
        description: "PostgreSQL full-text search on KB chunks using tsvector.".to_string(),
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
                "query": {
                    "type": "string",
                    "description": "Search query text (supports expressions)"
                },
                "knowledge_base_id": {
                    "type": "string",
                    "description": "Optional KB UUID to scope search"
                },
                "limit": {
                    "type": "integer",
                    "default": DEFAULT_LIMIT
                },
                "ts_config": {
                    "type": "string",
                    "default": "simple",
                    "description": "PostgreSQL text search config (simple, english, etc.)"
                }
            },
            "required": ["query"],
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
                .ok_or_else(|| anyhow::anyhow!("TextSearch: requires PostgreSQL pool"))?;

            let ctx = context_from_snapshot(&input.context_snapshot);
            let trigger = &ctx.trigger;
            let last = &ctx.last;
            let nodes = &ctx.nodes;
            let account_id = ctx.meta.account_id;

            let query_expr = input
                .config
                .get("query")
                .ok_or_else(|| anyhow::anyhow!("TextSearch: missing 'query'"))?;
            let resolved = resolve_value(query_expr, trigger, last, nodes);
            let search_query = resolved
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("TextSearch: 'query' must resolve to string"))?;

            if search_query.trim().is_empty() {
                return Err(anyhow::anyhow!("TextSearch: empty query"));
            }

            let kb_id: Option<Uuid> = input
                .config
                .get("knowledge_base_id")
                .and_then(|v| {
                    let s = match v {
                        serde_json::Value::String(s) => {
                            crate::nodes::expression::interpolate_string(s, trigger, last, nodes)
                        }
                        other => other.to_string().trim_matches('"').to_string(),
                    };
                    s.parse().ok()
                });

            let limit = input
                .config
                .get("limit")
                .and_then(|v| v.as_i64())
                .unwrap_or(DEFAULT_LIMIT);

            let ts_config = input
                .config
                .get("ts_config")
                .and_then(|v| v.as_str())
                .unwrap_or("simple");

            if input.cancel.is_cancelled() {
                return Err(anyhow::anyhow!("TextSearch: cancelled"));
            }

            let query_start = std::time::Instant::now();

            let rows: Vec<FtsRow> = if let Some(kb) = kb_id {
                sqlx::query_as::<_, FtsRow>(
                    &format!(
                        "SELECT c.id, c.document_id, c.content, c.metadata, c.chunk_index,
                                ts_rank(c.search_vector, plainto_tsquery('{}', $1)) as fts_rank
                         FROM kb_chunks c
                         WHERE c.account_id = $2 AND c.knowledge_base = $3
                               AND c.search_vector IS NOT NULL
                               AND c.search_vector @@ plainto_tsquery('{}', $1)
                         ORDER BY fts_rank DESC
                         LIMIT {}",
                        ts_config, ts_config, limit
                    ),
                )
                .bind(search_query)
                .bind(account_id)
                .bind(kb)
                .fetch_all(pool)
                .await
                .map_err(|e| anyhow::anyhow!("TextSearch: query failed: {}", e))?
            } else {
                sqlx::query_as::<_, FtsRow>(
                    &format!(
                        "SELECT c.id, c.document_id, c.content, c.metadata, c.chunk_index,
                                ts_rank(c.search_vector, plainto_tsquery('{}', $1)) as fts_rank
                         FROM kb_chunks c
                         WHERE c.account_id = $2
                               AND c.search_vector IS NOT NULL
                               AND c.search_vector @@ plainto_tsquery('{}', $1)
                         ORDER BY fts_rank DESC
                         LIMIT {}",
                        ts_config, ts_config, limit
                    ),
                )
                .bind(search_query)
                .bind(account_id)
                .fetch_all(pool)
                .await
                .map_err(|e| anyhow::anyhow!("TextSearch: query failed: {}", e))?
            };

            let query_time_ms = query_start.elapsed().as_millis() as u64;

            let results: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|row| {
                    serde_json::json!({
                        "id": row.id.to_string(),
                        "document_id": row.document_id.to_string(),
                        "content": row.content,
                        "metadata": row.metadata,
                        "chunk_index": row.chunk_index,
                        "fts_rank": row.fts_rank,
                    })
                })
                .collect();

            Ok(NodeResult::ok(serde_json::json!({
                "results": results,
                "count": results.len(),
                "query_time_ms": query_time_ms,
            })))
        })
    })
}

#[derive(sqlx::FromRow)]
struct FtsRow {
    id: Uuid,
    document_id: Uuid,
    content: String,
    metadata: serde_json::Value,
    chunk_index: i32,
    fts_rank: f32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_text_search_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "ai:text_search");
        assert_eq!(meta.category, "ai");
    }

    #[tokio::test]
    async fn test_text_search_no_pool() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({"query": "test"}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("PostgreSQL pool"));
    }

    #[tokio::test]
    async fn test_text_search_missing_query() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
    }
}
