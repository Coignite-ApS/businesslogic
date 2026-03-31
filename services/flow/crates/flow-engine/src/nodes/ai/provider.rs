//! LLM provider abstraction — pricing, API key extraction, shared HTTP client.
//!
//! Phase 3: Anthropic-only. Model string routes internally.

use std::collections::HashMap;
use std::sync::LazyLock;

use flow_common::context::NodeOutput;

use crate::nodes::expression;

/// Shared reqwest client for all AI HTTP calls.
pub static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .expect("failed to build HTTP client")
});

/// Pricing per million tokens (input, output) in USD.
struct ModelPricing {
    input_per_m: f64,
    output_per_m: f64,
}

fn get_pricing(model: &str) -> ModelPricing {
    match model {
        m if m.contains("opus") => ModelPricing {
            input_per_m: 15.0,
            output_per_m: 75.0,
        },
        m if m.contains("sonnet") => ModelPricing {
            input_per_m: 3.0,
            output_per_m: 15.0,
        },
        m if m.contains("haiku") => ModelPricing {
            input_per_m: 0.8,
            output_per_m: 4.0,
        },
        // Unknown model — use opus pricing as safe (conservative) default
        _ => {
            tracing::warn!(model = model, "Unknown model for cost calculation — using Opus pricing as safe default");
            ModelPricing {
                input_per_m: 15.0,
                output_per_m: 75.0,
            }
        }
    }
}

/// Calculate cost in USD for a given model and token counts.
/// `cache_creation_tokens`: tokens written to cache (1.25x input rate).
/// `cache_read_tokens`: tokens read from cache (0.1x input rate).
pub fn calculate_cost(
    model: &str,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_tokens: u64,
    cache_read_tokens: u64,
) -> f64 {
    let pricing = get_pricing(model);
    let input_cost = (input_tokens as f64 / 1_000_000.0) * pricing.input_per_m;
    let output_cost = (output_tokens as f64 / 1_000_000.0) * pricing.output_per_m;
    let cache_read_cost = (cache_read_tokens as f64 / 1_000_000.0) * pricing.input_per_m * 0.1;
    let cache_write_cost = (cache_creation_tokens as f64 / 1_000_000.0) * pricing.input_per_m * 1.25;
    input_cost + output_cost + cache_read_cost + cache_write_cost
}

/// Extract API key from execution context `$env`. Never log the key value.
pub fn get_api_key(
    context_snapshot: &serde_json::Value,
    key_name: &str,
) -> Result<String, anyhow::Error> {
    let ctx = expression::context_from_snapshot(context_snapshot);
    ctx.env
        .get(key_name)
        .filter(|v| !v.is_empty())
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("missing API key '{}' in $env (set FLOW_ENV_{})", key_name, key_name))
}

/// Resolve a config value using expression interpolation.
pub fn resolve_config_string(
    raw: &str,
    trigger: &serde_json::Value,
    last: &Option<serde_json::Value>,
    nodes: &HashMap<String, NodeOutput>,
) -> String {
    expression::interpolate_string(raw, trigger, last, nodes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_cost_sonnet() {
        let cost = calculate_cost("claude-sonnet-4-6", 1_000, 500, 0, 0);
        // input: 1000/1M * 3.0 = 0.003, output: 500/1M * 15.0 = 0.0075
        let expected = 0.003 + 0.0075;
        assert!((cost - expected).abs() < 1e-10);
    }

    #[test]
    fn test_calculate_cost_opus() {
        let cost = calculate_cost("claude-opus-4-6", 1_000_000, 1_000_000, 0, 0);
        // input: 15.0, output: 75.0
        assert!((cost - 90.0).abs() < 1e-10);
    }

    #[test]
    fn test_calculate_cost_haiku() {
        let cost = calculate_cost("claude-haiku-4-5", 10_000, 5_000, 0, 0);
        // input: 10000/1M * 0.8 = 0.008, output: 5000/1M * 4.0 = 0.02
        let expected = 0.008 + 0.02;
        assert!((cost - expected).abs() < 1e-10);
    }

    #[test]
    fn test_calculate_cost_zero_tokens() {
        assert_eq!(calculate_cost("claude-sonnet-4-6", 0, 0, 0, 0), 0.0);
    }

    #[test]
    fn test_calculate_cost_unknown_model() {
        // Unknown model falls back to opus pricing (conservative safe default)
        let cost = calculate_cost("gpt-4", 1_000_000, 0, 0, 0);
        assert!((cost - 15.0).abs() < 1e-10);
    }

    #[test]
    fn test_calculate_cost_cache_pricing() {
        // Sonnet: input_per_m = 3.0
        // cache_creation: 1_000_000 tokens * 3.0 * 1.25 / 1M = 3.75
        // cache_read:     1_000_000 tokens * 3.0 * 0.1  / 1M = 0.30
        // input:          0, output: 0
        let cost = calculate_cost("claude-sonnet-4-6", 0, 0, 1_000_000, 1_000_000);
        let expected = 3.75 + 0.30;
        assert!((cost - expected).abs() < 1e-10);
    }

    #[test]
    fn test_get_api_key_present() {
        let ctx = serde_json::json!({
            "$trigger": {},
            "$env": {"ANTHROPIC_API_KEY": "sk-test-123"},
            "$meta": {
                "execution_id": "00000000-0000-0000-0000-000000000000",
                "flow_id": "00000000-0000-0000-0000-000000000000",
                "account_id": "00000000-0000-0000-0000-000000000000",
                "started_at": "2026-01-01T00:00:00Z",
                "cumulative_cost_usd": 0.0
            },
            "$nodes": {},
            "$last": null
        });
        let key = get_api_key(&ctx, "ANTHROPIC_API_KEY").unwrap();
        assert_eq!(key, "sk-test-123");
    }

    #[test]
    fn test_get_api_key_missing() {
        let ctx = serde_json::json!({
            "$trigger": {},
            "$env": {},
            "$meta": {
                "execution_id": "00000000-0000-0000-0000-000000000000",
                "flow_id": "00000000-0000-0000-0000-000000000000",
                "account_id": "00000000-0000-0000-0000-000000000000",
                "started_at": "2026-01-01T00:00:00Z",
                "cumulative_cost_usd": 0.0
            },
            "$nodes": {},
            "$last": null
        });
        assert!(get_api_key(&ctx, "ANTHROPIC_API_KEY").is_err());
    }

    #[test]
    fn test_get_api_key_empty() {
        let ctx = serde_json::json!({
            "$trigger": {},
            "$env": {"ANTHROPIC_API_KEY": ""},
            "$meta": {
                "execution_id": "00000000-0000-0000-0000-000000000000",
                "flow_id": "00000000-0000-0000-0000-000000000000",
                "account_id": "00000000-0000-0000-0000-000000000000",
                "started_at": "2026-01-01T00:00:00Z",
                "cumulative_cost_usd": 0.0
            },
            "$nodes": {},
            "$last": null
        });
        assert!(get_api_key(&ctx, "ANTHROPIC_API_KEY").is_err());
    }
}
