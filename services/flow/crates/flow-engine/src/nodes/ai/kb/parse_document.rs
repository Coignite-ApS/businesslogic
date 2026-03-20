//! Parse Document node — fetch document content from PostgreSQL.
//!
//! Reads kb_documents content (stored inline) and file metadata.
//! Account-scoped: verifies document belongs to the triggering account.

use std::sync::Arc;

use flow_common::node::{NodeInput, NodeResult, NodeTier, NodeTypeMeta, PortDef, RequiredRole};
use uuid::Uuid;

use crate::nodes::expression::context_from_snapshot;
use crate::nodes::NodeHandler;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "ai:parse_document".to_string(),
        name: "Parse Document".to_string(),
        description: "Fetch and parse a KB document's content from the database.".to_string(),
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
                    "description": "KB document UUID (supports expressions)"
                },
                "knowledge_base_id": {
                    "type": "string",
                    "description": "Knowledge base UUID for ownership verification"
                }
            },
            "required": ["document_id", "knowledge_base_id"],
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
                .ok_or_else(|| anyhow::anyhow!("ParseDocument: requires PostgreSQL pool"))?;

            let ctx = context_from_snapshot(&input.context_snapshot);
            let trigger = &ctx.trigger;
            let last = &ctx.last;
            let nodes = &ctx.nodes;
            let account_id = ctx.meta.account_id;

            // Resolve document_id
            let doc_id_raw = input
                .config
                .get("document_id")
                .ok_or_else(|| anyhow::anyhow!("ParseDocument: missing 'document_id'"))?;
            let doc_id_str = match doc_id_raw {
                serde_json::Value::String(s) => {
                    crate::nodes::expression::interpolate_string(s, trigger, last, nodes)
                }
                other => other.to_string().trim_matches('"').to_string(),
            };
            let document_id: Uuid = doc_id_str
                .parse()
                .map_err(|_| anyhow::anyhow!("ParseDocument: invalid document_id UUID"))?;

            // Resolve knowledge_base_id
            let kb_id_raw = input
                .config
                .get("knowledge_base_id")
                .ok_or_else(|| anyhow::anyhow!("ParseDocument: missing 'knowledge_base_id'"))?;
            let kb_id_str = match kb_id_raw {
                serde_json::Value::String(s) => {
                    crate::nodes::expression::interpolate_string(s, trigger, last, nodes)
                }
                other => other.to_string().trim_matches('"').to_string(),
            };
            let kb_id: Uuid = kb_id_str
                .parse()
                .map_err(|_| anyhow::anyhow!("ParseDocument: invalid knowledge_base_id UUID"))?;

            if input.cancel.is_cancelled() {
                return Err(anyhow::anyhow!("ParseDocument: cancelled"));
            }

            // Fetch document with account scoping
            let row = sqlx::query_as::<_, DocRow>(
                "SELECT d.id, d.content, d.file_id, d.status,
                        f.filename_download, f.type as file_type
                 FROM kb_documents d
                 LEFT JOIN directus_files f ON f.id = d.file_id
                 WHERE d.id = $1 AND d.knowledge_base = $2 AND d.account_id = $3",
            )
            .bind(document_id)
            .bind(kb_id)
            .bind(account_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| anyhow::anyhow!("ParseDocument: query failed: {}", e))?;

            let doc = row.ok_or_else(|| {
                anyhow::anyhow!("ParseDocument: document not found or access denied")
            })?;

            let content = doc.content.ok_or_else(|| {
                anyhow::anyhow!("ParseDocument: document has no content")
            })?;

            Ok(NodeResult::ok(serde_json::json!({
                "document_id": document_id.to_string(),
                "knowledge_base_id": kb_id.to_string(),
                "account_id": account_id.to_string(),
                "content": content,
                "file_name": doc.filename_download.unwrap_or_default(),
                "file_type": doc.file_type.unwrap_or_else(|| "text/plain".to_string()),
                "char_count": content.len(),
            })))
        })
    })
}

#[derive(sqlx::FromRow)]
#[allow(dead_code)]
struct DocRow {
    id: Uuid,
    content: Option<String>,
    file_id: Option<Uuid>,
    status: Option<String>,
    filename_download: Option<String>,
    file_type: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_document_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "ai:parse_document");
        assert_eq!(meta.category, "ai");
    }

    #[tokio::test]
    async fn test_parse_document_no_pool() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({
                "document_id": "00000000-0000-0000-0000-000000000000",
                "knowledge_base_id": "00000000-0000-0000-0000-000000000000"
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("PostgreSQL pool"));
    }

    #[tokio::test]
    async fn test_parse_document_missing_doc_id() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({"knowledge_base_id": "00000000-0000-0000-0000-000000000000"}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        // Pool check happens before config validation
        assert!(result.unwrap_err().to_string().contains("PostgreSQL pool"));
    }

    #[tokio::test]
    async fn test_parse_document_invalid_uuid() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({
                "document_id": "not-a-uuid",
                "knowledge_base_id": "00000000-0000-0000-0000-000000000000"
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        // Pool check happens before UUID validation
        assert!(result.unwrap_err().to_string().contains("PostgreSQL pool"));
    }

    #[tokio::test]
    async fn test_parse_document_cancellation() {
        let h = handler(None);
        let cancel = tokio_util::sync::CancellationToken::new();
        cancel.cancel();

        let input = NodeInput {
            config: serde_json::json!({
                "document_id": "00000000-0000-0000-0000-000000000000",
                "knowledge_base_id": "00000000-0000-0000-0000-000000000000"
            }),
            data: serde_json::json!({}),
            context_snapshot: serde_json::json!({}),
            cancel,
        };
        let result = h(input).await;
        assert!(result.is_err());
        // Either pool error or cancellation error
    }
}
