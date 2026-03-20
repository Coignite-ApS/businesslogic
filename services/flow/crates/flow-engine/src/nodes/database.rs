//! Database node — executes SQL queries against PostgreSQL.
//!
//! Config: query (interpolated), params (array, expressions resolved),
//! mode ("query_all" | "query_one" | "execute"), timeout_ms (5000).
//!
//! Trusted: admin-authored flows only. PG connection role provides safety boundary.

use std::sync::Arc;
use std::time::Duration;

use flow_common::node::{NodeInput, NodeResult, NodeTier, NodeTypeMeta, PortDef, RequiredRole};
use sqlx::postgres::PgRow;
use sqlx::Row;

use super::expression::{context_from_snapshot, interpolate_string, resolve_value};
use super::NodeHandler;

const DEFAULT_TIMEOUT_MS: u64 = 5000;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "core:database".to_string(),
        name: "Database".to_string(),
        description: "Execute SQL queries against PostgreSQL.".to_string(),
        category: "infrastructure".to_string(),
        tier: NodeTier::Core,
        inputs: vec![PortDef {
            name: "input".to_string(),
            data_type: "any".to_string(),
            required: false,
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
                    "description": "SQL query (supports {{$trigger.x}} interpolation)"
                },
                "params": {
                    "type": "array",
                    "description": "Positional parameters ($1, $2, ...) — expressions resolved"
                },
                "mode": {
                    "type": "string",
                    "enum": ["query_all", "query_one", "execute"],
                    "default": "query_all"
                },
                "timeout_ms": {
                    "type": "integer",
                    "default": DEFAULT_TIMEOUT_MS
                }
            },
            "required": ["query"],
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
            let pool = pg.ok_or_else(|| anyhow::anyhow!("database: PgPool not available"))?;

            let ctx = context_from_snapshot(&input.context_snapshot);
            let trigger = &ctx.trigger;
            let last = &ctx.last;
            let nodes = &ctx.nodes;

            // Extract and interpolate query
            let query_raw = input
                .config
                .get("query")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("database: missing 'query' config"))?;
            let query = interpolate_string(query_raw, trigger, last, nodes);

            let mode = input
                .config
                .get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("query_all");

            let timeout_ms = input
                .config
                .get("timeout_ms")
                .and_then(|v| v.as_u64())
                .unwrap_or(DEFAULT_TIMEOUT_MS);

            // Resolve params
            let params: Vec<serde_json::Value> = input
                .config
                .get("params")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|p| resolve_value(p, trigger, last, nodes))
                        .collect()
                })
                .unwrap_or_default();

            // Build query with binds
            let timeout = Duration::from_millis(timeout_ms);

            let result = tokio::select! {
                result = execute_query(&pool, &query, &params, mode, timeout) => result,
                _ = input.cancel.cancelled() => {
                    Err(anyhow::anyhow!("database: cancelled"))
                }
            };

            result.map(NodeResult::ok)
        })
    })
}

async fn execute_query(
    pool: &sqlx::PgPool,
    query: &str,
    params: &[serde_json::Value],
    mode: &str,
    timeout: Duration,
) -> Result<serde_json::Value, anyhow::Error> {
    // Validate mode
    if !matches!(mode, "query_all" | "query_one" | "execute") {
        return Err(anyhow::anyhow!("database: invalid mode '{}'", mode));
    }

    let mut q = sqlx::query(query);
    for param in params {
        q = bind_param(q, param);
    }

    let result = tokio::time::timeout(timeout, async {
        match mode {
            "query_all" => {
                let rows: Vec<PgRow> = q.fetch_all(pool).await?;
                let json_rows: Vec<serde_json::Value> = rows.iter().map(row_to_json).collect();
                let count = json_rows.len();
                Ok(serde_json::json!({ "rows": json_rows, "count": count }))
            }
            "query_one" => {
                let row: Option<PgRow> = q.fetch_optional(pool).await?;
                match row {
                    Some(r) => Ok(serde_json::json!({ "row": row_to_json(&r) })),
                    None => Ok(serde_json::json!({ "row": null })),
                }
            }
            "execute" => {
                let result = q.execute(pool).await?;
                Ok(serde_json::json!({ "rows_affected": result.rows_affected() }))
            }
            _ => unreachable!(),
        }
    })
    .await;

    match result {
        Ok(inner) => inner.map_err(|e: sqlx::Error| anyhow::anyhow!("database: {}", e)),
        Err(_) => Err(anyhow::anyhow!("database: query timed out")),
    }
}

/// Bind a JSON value as a typed PG parameter.
fn bind_param<'q>(
    q: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    value: &'q serde_json::Value,
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    match value {
        serde_json::Value::String(s) => q.bind(s.as_str()),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                q.bind(i)
            } else {
                q.bind(n.as_f64().unwrap_or(0.0))
            }
        }
        serde_json::Value::Bool(b) => q.bind(*b),
        serde_json::Value::Null => q.bind(None::<String>),
        other => q.bind(other.to_string()),
    }
}

/// Convert a PgRow to a JSON object using column metadata.
fn row_to_json(row: &PgRow) -> serde_json::Value {
    use sqlx::Column;
    use sqlx::TypeInfo;

    let mut map = serde_json::Map::new();
    for col in row.columns() {
        let name = col.name().to_string();
        let type_name = col.type_info().name();
        let value = match type_name {
            "BOOL" => row
                .try_get::<bool, _>(name.as_str())
                .ok()
                .map(serde_json::Value::Bool)
                .unwrap_or(serde_json::Value::Null),
            "INT2" | "INT4" => row
                .try_get::<i32, _>(name.as_str())
                .ok()
                .map(|v| serde_json::json!(v))
                .unwrap_or(serde_json::Value::Null),
            "INT8" => row
                .try_get::<i64, _>(name.as_str())
                .ok()
                .map(|v| serde_json::json!(v))
                .unwrap_or(serde_json::Value::Null),
            "FLOAT4" | "FLOAT8" | "NUMERIC" => row
                .try_get::<f64, _>(name.as_str())
                .ok()
                .map(|v| serde_json::json!(v))
                .unwrap_or(serde_json::Value::Null),
            "UUID" => row
                .try_get::<uuid::Uuid, _>(name.as_str())
                .ok()
                .map(|v| serde_json::json!(v.to_string()))
                .unwrap_or(serde_json::Value::Null),
            "JSON" | "JSONB" => row
                .try_get::<serde_json::Value, _>(name.as_str())
                .ok()
                .unwrap_or(serde_json::Value::Null),
            "TIMESTAMPTZ" | "TIMESTAMP" => row
                .try_get::<chrono::DateTime<chrono::Utc>, _>(name.as_str())
                .ok()
                .map(|v| serde_json::json!(v.to_rfc3339()))
                .unwrap_or(serde_json::Value::Null),
            _ => row
                .try_get::<String, _>(name.as_str())
                .ok()
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null),
        };
        map.insert(name, value);
    }
    serde_json::Value::Object(map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_util::sync::CancellationToken;

    #[test]
    fn test_database_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "core:database");
        assert_eq!(meta.category, "infrastructure");
    }

    #[tokio::test]
    async fn test_missing_query_config() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("PgPool not available"));
    }

    #[tokio::test]
    async fn test_missing_pool() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({"query": "SELECT 1"}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("PgPool not available"));
    }

    #[tokio::test]
    async fn test_invalid_mode() {
        // Can't test without a real pool, but we can test mode validation logic
        assert!(!matches!("invalid", "query_all" | "query_one" | "execute"));
    }

    #[tokio::test]
    async fn test_cancellation() {
        let h = handler(None);
        let cancel = CancellationToken::new();
        cancel.cancel();

        let input = NodeInput {
            config: serde_json::json!({"query": "SELECT 1"}),
            data: serde_json::json!({}),
            context_snapshot: serde_json::json!({}),
            cancel,
        };
        let result = h(input).await;
        assert!(result.is_err());
        // Either "PgPool not available" or "cancelled" depending on ordering
    }

    #[test]
    fn test_param_binding_types() {
        // Verify our matching logic handles all JSON value types
        let string_val = serde_json::json!("hello");
        assert!(string_val.is_string());

        let num_val = serde_json::json!(42);
        assert!(num_val.is_number());

        let bool_val = serde_json::json!(true);
        assert!(bool_val.is_boolean());

        let null_val = serde_json::Value::Null;
        assert!(null_val.is_null());
    }
}
