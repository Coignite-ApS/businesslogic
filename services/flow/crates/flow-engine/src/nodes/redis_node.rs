//! Redis node — execute Redis commands with automatic key namespacing.
//!
//! Config: operation (get|set|del|incr|expire|hget|hset|publish|lpush|rpush|lrange),
//! key (interpolated), value (optional), field (optional), ttl (optional), timeout_ms (5000).
//!
//! All keys auto-prefixed with `flow:user:` to prevent collision with engine internals.

use std::sync::Arc;
use std::time::Duration;

use flow_common::node::{NodeInput, NodeResult, NodeTier, NodeTypeMeta, PortDef, RequiredRole};
#[allow(unused_imports)]
use redis::AsyncCommands;

use super::expression::{context_from_snapshot, interpolate_string, resolve_value};
use super::NodeHandler;

const DEFAULT_TIMEOUT_MS: u64 = 5000;
const KEY_PREFIX: &str = "flow:user:";

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "core:redis".to_string(),
        name: "Redis".to_string(),
        description: "Execute Redis commands with automatic key namespacing.".to_string(),
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
                "operation": {
                    "type": "string",
                    "enum": ["get", "set", "del", "incr", "expire", "hget", "hset", "publish", "lpush", "rpush", "lrange"]
                },
                "key": {
                    "type": "string",
                    "description": "Redis key (supports interpolation, auto-prefixed with flow:user:)"
                },
                "value": {
                    "type": "string",
                    "description": "Value for set/hset/publish/lpush/rpush operations"
                },
                "field": {
                    "type": "string",
                    "description": "Hash field for hget/hset operations"
                },
                "ttl": {
                    "type": "integer",
                    "description": "TTL in seconds for set operations"
                },
                "start": {
                    "type": "integer",
                    "description": "Start index for lrange (default 0)"
                },
                "stop": {
                    "type": "integer",
                    "description": "Stop index for lrange (default -1)"
                },
                "timeout_ms": {
                    "type": "integer",
                    "default": DEFAULT_TIMEOUT_MS
                }
            },
            "required": ["operation", "key"],
            "additionalProperties": false
        }),
        estimated_cost_usd: 0.0,
        required_role: RequiredRole::Admin,
    }
}

/// Auto-prefix key with `flow:user:` unless already prefixed.
fn prefix_key(key: &str) -> String {
    if key.starts_with(KEY_PREFIX) {
        key.to_string()
    } else {
        format!("{}{}", KEY_PREFIX, key)
    }
}

pub fn handler(redis_pool: Option<deadpool_redis::Pool>) -> NodeHandler {
    Arc::new(move |input: NodeInput| {
        let pool = redis_pool.clone();
        Box::pin(async move {
            let pool = pool.ok_or_else(|| anyhow::anyhow!("redis: pool not available"))?;

            let ctx = context_from_snapshot(&input.context_snapshot);
            let trigger = &ctx.trigger;
            let last = &ctx.last;
            let nodes = &ctx.nodes;

            let operation = input
                .config
                .get("operation")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("redis: missing 'operation' config"))?;

            let key_raw = input
                .config
                .get("key")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("redis: missing 'key' config"))?;
            let key = prefix_key(&interpolate_string(key_raw, trigger, last, nodes));

            let value = input.config.get("value").map(|v| {
                let resolved = resolve_value(v, trigger, last, nodes);
                match resolved {
                    serde_json::Value::String(s) => s,
                    other => other.to_string(),
                }
            });

            let field = input.config.get("field").and_then(|v| v.as_str()).map(|s| {
                interpolate_string(s, trigger, last, nodes)
            });

            let ttl = input.config.get("ttl").and_then(|v| v.as_u64());

            let timeout_ms = input
                .config
                .get("timeout_ms")
                .and_then(|v| v.as_u64())
                .unwrap_or(DEFAULT_TIMEOUT_MS);

            let timeout = Duration::from_millis(timeout_ms);

            let result = tokio::select! {
                result = execute_redis_op(&pool, operation, &key, value.as_deref(), field.as_deref(), ttl, &input.config, timeout) => result,
                _ = input.cancel.cancelled() => {
                    Err(anyhow::anyhow!("redis: cancelled"))
                }
            };

            result.map(|data| {
                NodeResult::ok(serde_json::json!({
                    "result": data,
                    "operation": operation,
                    "key": key,
                }))
            })
        })
    })
}

#[allow(clippy::too_many_arguments)]
async fn execute_redis_op(
    pool: &deadpool_redis::Pool,
    operation: &str,
    key: &str,
    value: Option<&str>,
    field: Option<&str>,
    ttl: Option<u64>,
    config: &serde_json::Value,
    timeout: Duration,
) -> Result<serde_json::Value, anyhow::Error> {
    let mut conn = pool.get().await?;

    let result = tokio::time::timeout(timeout, async {
        match operation {
            "get" => {
                let val: Option<String> = redis::cmd("GET")
                    .arg(key)
                    .query_async(&mut *conn)
                    .await?;
                Ok(val.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null))
            }
            "set" => {
                let val = value.ok_or_else(|| anyhow::anyhow!("redis set: missing 'value'"))?;
                if let Some(ttl_secs) = ttl {
                    redis::cmd("SETEX")
                        .arg(key)
                        .arg(ttl_secs)
                        .arg(val)
                        .query_async::<String>(&mut *conn)
                        .await?;
                } else {
                    redis::cmd("SET")
                        .arg(key)
                        .arg(val)
                        .query_async::<String>(&mut *conn)
                        .await?;
                }
                Ok(serde_json::json!("OK"))
            }
            "del" => {
                let count: i64 = redis::cmd("DEL")
                    .arg(key)
                    .query_async(&mut *conn)
                    .await?;
                Ok(serde_json::json!(count))
            }
            "incr" => {
                let val: i64 = redis::cmd("INCR")
                    .arg(key)
                    .query_async(&mut *conn)
                    .await?;
                Ok(serde_json::json!(val))
            }
            "expire" => {
                let secs = ttl.ok_or_else(|| anyhow::anyhow!("redis expire: missing 'ttl'"))?;
                let ok: bool = redis::cmd("EXPIRE")
                    .arg(key)
                    .arg(secs)
                    .query_async(&mut *conn)
                    .await?;
                Ok(serde_json::json!(ok))
            }
            "hget" => {
                let f = field.ok_or_else(|| anyhow::anyhow!("redis hget: missing 'field'"))?;
                let val: Option<String> = redis::cmd("HGET")
                    .arg(key)
                    .arg(f)
                    .query_async(&mut *conn)
                    .await?;
                Ok(val.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null))
            }
            "hset" => {
                let f = field.ok_or_else(|| anyhow::anyhow!("redis hset: missing 'field'"))?;
                let val = value.ok_or_else(|| anyhow::anyhow!("redis hset: missing 'value'"))?;
                let _: i64 = redis::cmd("HSET")
                    .arg(key)
                    .arg(f)
                    .arg(val)
                    .query_async(&mut *conn)
                    .await?;
                Ok(serde_json::json!("OK"))
            }
            "publish" => {
                let val = value.ok_or_else(|| anyhow::anyhow!("redis publish: missing 'value'"))?;
                let receivers: i64 = redis::cmd("PUBLISH")
                    .arg(key)
                    .arg(val)
                    .query_async(&mut *conn)
                    .await?;
                Ok(serde_json::json!(receivers))
            }
            "lpush" => {
                let val = value.ok_or_else(|| anyhow::anyhow!("redis lpush: missing 'value'"))?;
                let len: i64 = redis::cmd("LPUSH")
                    .arg(key)
                    .arg(val)
                    .query_async(&mut *conn)
                    .await?;
                Ok(serde_json::json!(len))
            }
            "rpush" => {
                let val = value.ok_or_else(|| anyhow::anyhow!("redis rpush: missing 'value'"))?;
                let len: i64 = redis::cmd("RPUSH")
                    .arg(key)
                    .arg(val)
                    .query_async(&mut *conn)
                    .await?;
                Ok(serde_json::json!(len))
            }
            "lrange" => {
                let start = config.get("start").and_then(|v| v.as_i64()).unwrap_or(0);
                let stop = config.get("stop").and_then(|v| v.as_i64()).unwrap_or(-1);
                let vals: Vec<String> = redis::cmd("LRANGE")
                    .arg(key)
                    .arg(start)
                    .arg(stop)
                    .query_async(&mut *conn)
                    .await?;
                Ok(serde_json::json!(vals))
            }
            other => Err(anyhow::anyhow!("redis: unknown operation '{}'", other)),
        }
    })
    .await;

    match result {
        Ok(inner) => inner,
        Err(_) => Err(anyhow::anyhow!("redis: operation timed out")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_util::sync::CancellationToken;

    #[test]
    fn test_redis_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "core:redis");
        assert_eq!(meta.category, "infrastructure");
    }

    #[test]
    fn test_key_prefixing() {
        assert_eq!(prefix_key("mykey"), "flow:user:mykey");
        assert_eq!(prefix_key("foo:bar"), "flow:user:foo:bar");
        // Already prefixed — no double prefix
        assert_eq!(prefix_key("flow:user:mykey"), "flow:user:mykey");
    }

    #[tokio::test]
    async fn test_missing_pool() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({"operation": "get", "key": "test"}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("pool not available"));
    }

    #[tokio::test]
    async fn test_missing_operation() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({"key": "test"}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_missing_key() {
        let h = handler(None);
        let input = NodeInput::new(
            serde_json::json!({"operation": "get"}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_cancellation() {
        let h = handler(None);
        let cancel = CancellationToken::new();
        cancel.cancel();
        let input = NodeInput {
            config: serde_json::json!({"operation": "get", "key": "test"}),
            data: serde_json::json!({}),
            context_snapshot: serde_json::json!({}),
            cancel,
        };
        let result = h(input).await;
        assert!(result.is_err());
    }
}
