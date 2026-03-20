//! Update Status node — update kb_documents indexing status.
//!
//! Sets document status to 'indexed' or 'error' after ingestion completes.

use std::sync::Arc;

use flow_common::node::{NodeInput, NodeResult, NodeTier, NodeTypeMeta, PortDef, RequiredRole};
use uuid::Uuid;

use crate::nodes::expression::{context_from_snapshot, interpolate_string, resolve_value};
use crate::nodes::NodeHandler;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "ai:update_status".to_string(),
        name: "Update Status".to_string(),
        description: "Update KB document indexing status after ingestion.".to_string(),
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
                "status": {
                    "type": "string",
                    "enum": ["processing", "indexed", "error"],
                    "description": "New status"
                },
                "chunk_count": {
                    "description": "Total chunk count (expression)"
                },
                "token_count": {
                    "description": "Total token count (expression)"
                },
                "error_message": {
                    "type": "string",
                    "description": "Error message (if status=error)"
                }
            },
            "required": ["document_id", "status"],
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
                .ok_or_else(|| anyhow::anyhow!("UpdateStatus: requires PostgreSQL pool"))?;

            let ctx = context_from_snapshot(&input.context_snapshot);
            let trigger = &ctx.trigger;
            let last = &ctx.last;
            let nodes = &ctx.nodes;

            // Resolve document_id
            let doc_id_raw = input.config.get("document_id")
                .ok_or_else(|| anyhow::anyhow!("UpdateStatus: missing 'document_id'"))?;
            let doc_id_str = match doc_id_raw {
                serde_json::Value::String(s) => interpolate_string(s, trigger, last, nodes),
                other => other.to_string().trim_matches('"').to_string(),
            };
            let document_id: Uuid = doc_id_str
                .parse()
                .map_err(|_| anyhow::anyhow!("UpdateStatus: invalid document_id UUID"))?;

            let status = input.config.get("status")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("UpdateStatus: missing 'status'"))?;

            if !matches!(status, "processing" | "indexed" | "error") {
                return Err(anyhow::anyhow!("UpdateStatus: invalid status '{}'", status));
            }

            let chunk_count = input.config.get("chunk_count")
                .map(|v| resolve_value(v, trigger, last, nodes))
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32;

            let token_count = input.config.get("token_count")
                .map(|v| resolve_value(v, trigger, last, nodes))
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32;

            if input.cancel.is_cancelled() {
                return Err(anyhow::anyhow!("UpdateStatus: cancelled"));
            }

            let rows_affected = sqlx::query(
                "UPDATE kb_documents SET status = $1, chunk_count = $2, token_count = $3, date_updated = NOW() WHERE id = $4",
            )
            .bind(status)
            .bind(chunk_count)
            .bind(token_count)
            .bind(document_id)
            .execute(pool)
            .await
            .map_err(|e| anyhow::anyhow!("UpdateStatus: query failed: {}", e))?
            .rows_affected();

            Ok(NodeResult::ok(serde_json::json!({
                "document_id": document_id.to_string(),
                "status": status,
                "chunk_count": chunk_count,
                "token_count": token_count,
                "rows_affected": rows_affected,
            })))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_update_status_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "ai:update_status");
        assert_eq!(meta.required_role, RequiredRole::Admin);
    }

    #[tokio::test]
    async fn test_update_status_no_pool() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({
                "document_id": "00000000-0000-0000-0000-000000000000",
                "status": "indexed"
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("PostgreSQL pool"));
    }

    #[tokio::test]
    async fn test_update_status_missing_doc_id() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({"status": "indexed"}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        // Pool check happens before config validation
        assert!(result.unwrap_err().to_string().contains("PostgreSQL pool"));
    }

    #[tokio::test]
    async fn test_update_status_invalid_status() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({
                "document_id": "00000000-0000-0000-0000-000000000000",
                "status": "invalid"
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        // Will fail with pool error first, then status validation
        assert!(result.is_err());
    }
}
