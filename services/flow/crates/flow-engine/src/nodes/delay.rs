//! Delay node — pauses execution for a configurable duration.
//!
//! Configuration:
//! - `delay_type`: "static" | "exponential_backoff" | "jitter" (default: "static")
//! - `delay_ms`: base delay in milliseconds (default: 1000)
//! - `multiplier`: for exponential_backoff (default: 2.0)
//! - `attempt`: current attempt number for backoff (default: 1)

use super::NodeHandler;
use flow_common::node::{RequiredRole, NodeInput, NodeResult, NodeTypeMeta, PortDef};
use std::sync::Arc;
use std::time::Duration;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "core:delay".to_string(),
        name: "Delay".to_string(),
        description: "Pauses execution for a configurable duration. Supports static, exponential backoff, and jitter modes.".to_string(),
        category: "utility".to_string(),
        tier: flow_common::node::NodeTier::Core,
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
                "delay_type": {
                    "type": "string",
                    "enum": ["static", "exponential_backoff", "jitter"],
                    "default": "static"
                },
                "delay_ms": {
                    "type": "number",
                    "default": 1000,
                    "description": "Base delay in milliseconds"
                },
                "multiplier": {
                    "type": "number",
                    "default": 2.0,
                    "description": "Multiplier for exponential backoff"
                },
                "attempt": {
                    "type": "integer",
                    "default": 1,
                    "description": "Current attempt number (for backoff calculation)"
                }
            },
            "additionalProperties": false
        }),
        estimated_cost_usd: 0.0,
        required_role: RequiredRole::default(),
    }
}

/// Simple deterministic-enough jitter: returns 0.0..1.0 using timestamp nanos.
fn rand_jitter() -> f64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    (nanos % 1000) as f64 / 1000.0
}

/// Calculate the delay duration based on config.
fn calculate_delay_ms(config: &serde_json::Value) -> u64 {
    let delay_type = config
        .get("delay_type")
        .and_then(|v| v.as_str())
        .unwrap_or("static");
    let delay_ms = config
        .get("delay_ms")
        .and_then(|v| v.as_f64())
        .unwrap_or(1000.0);

    match delay_type {
        "exponential_backoff" => {
            let multiplier = config
                .get("multiplier")
                .and_then(|v| v.as_f64())
                .unwrap_or(2.0);
            let attempt = config
                .get("attempt")
                .and_then(|v| v.as_u64())
                .unwrap_or(1)
                .max(1);
            (delay_ms * multiplier.powi((attempt - 1) as i32)) as u64
        }
        "jitter" => {
            // ±20% jitter around base delay
            let jitter_factor = 0.2 * (2.0 * rand_jitter() - 1.0); // -0.2..+0.2
            (delay_ms * (1.0 + jitter_factor)).max(1.0) as u64
        }
        _ => delay_ms as u64, // "static"
    }
}

pub fn handler() -> NodeHandler {
    Arc::new(|input: NodeInput| {
        Box::pin(async move {
            let actual_delay = calculate_delay_ms(&input.config);

            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(actual_delay)) => {
                    Ok(NodeResult::ok(serde_json::json!({
                        "delayed_ms": actual_delay,
                        "cancelled": false
                    })))
                }
                _ = input.cancel.cancelled() => {
                    Ok(NodeResult::ok(serde_json::json!({
                        "delayed_ms": 0,
                        "cancelled": true
                    })))
                }
            }
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_util::sync::CancellationToken;

    #[tokio::test]
    async fn test_static_delay() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({"delay_type": "static", "delay_ms": 10}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let start = std::time::Instant::now();
        let result = handler(input).await.unwrap();
        let elapsed = start.elapsed();
        assert!(elapsed.as_millis() >= 9);
        assert_eq!(result.data["delayed_ms"], 10);
        assert_eq!(result.data["cancelled"], false);
    }

    #[tokio::test]
    async fn test_cancellation() {
        let handler = handler();
        let cancel = CancellationToken::new();
        let input = NodeInput {
            config: serde_json::json!({"delay_type": "static", "delay_ms": 60000}),
            data: serde_json::json!({}),
            context_snapshot: serde_json::json!({}),
            cancel: cancel.clone(),
        };

        let handle = tokio::spawn(async move { handler(input).await });

        // Cancel after a short delay
        tokio::time::sleep(Duration::from_millis(10)).await;
        cancel.cancel();

        let result = handle.await.unwrap().unwrap();
        assert_eq!(result.data["cancelled"], true);
        assert_eq!(result.data["delayed_ms"], 0);
    }

    #[test]
    fn test_backoff_calculation() {
        // attempt=1: 100 * 2^0 = 100
        let ms = calculate_delay_ms(&serde_json::json!({
            "delay_type": "exponential_backoff",
            "delay_ms": 100,
            "multiplier": 2.0,
            "attempt": 1
        }));
        assert_eq!(ms, 100);

        // attempt=2: 100 * 2^1 = 200
        let ms = calculate_delay_ms(&serde_json::json!({
            "delay_type": "exponential_backoff",
            "delay_ms": 100,
            "multiplier": 2.0,
            "attempt": 2
        }));
        assert_eq!(ms, 200);

        // attempt=4: 100 * 2^3 = 800
        let ms = calculate_delay_ms(&serde_json::json!({
            "delay_type": "exponential_backoff",
            "delay_ms": 100,
            "multiplier": 2.0,
            "attempt": 4
        }));
        assert_eq!(ms, 800);
    }

    #[test]
    fn test_jitter_within_range() {
        for _ in 0..20 {
            let ms = calculate_delay_ms(&serde_json::json!({
                "delay_type": "jitter",
                "delay_ms": 1000
            }));
            // ±20% of 1000 = 800..1200
            assert!(ms >= 800, "jitter too low: {ms}");
            assert!(ms <= 1200, "jitter too high: {ms}");
        }
    }

    #[test]
    fn test_default_static() {
        let ms = calculate_delay_ms(&serde_json::json!({}));
        assert_eq!(ms, 1000);
    }

    #[tokio::test]
    async fn test_delay_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "core:delay");
        assert_eq!(meta.tier, flow_common::node::NodeTier::Core);
    }
}
