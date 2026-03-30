//! LLM node — unified Anthropic Messages API integration.
//!
//! Config: model, prompt (required, interpolated), system_prompt, temperature,
//! max_tokens, timeout_seconds, fallback_model, api_base_url.
//!
//! Handler captures Redis + PG pools for budget enforcement.

use std::sync::Arc;
use std::time::Duration;

use flow_common::node::{RequiredRole, NodeInput, NodeResult, NodeTier, NodeTypeMeta, PortDef};

use super::budget;
use super::provider;
use crate::nodes::expression::{context_from_snapshot, interpolate_string};
use crate::nodes::NodeHandler;

const DEFAULT_MODEL: &str = "claude-sonnet-4-6";
const DEFAULT_TEMPERATURE: f64 = 0.7;
const DEFAULT_MAX_TOKENS: u64 = 1000;
const DEFAULT_TIMEOUT_SECS: u64 = 30;
const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "core:llm".to_string(),
        name: "LLM".to_string(),
        description: "Call an LLM (Anthropic Claude) with a prompt and return the response text."
            .to_string(),
        category: "ai".to_string(),
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
                "model": {
                    "type": "string",
                    "default": DEFAULT_MODEL,
                    "description": "Anthropic model ID"
                },
                "prompt": {
                    "type": "string",
                    "description": "User prompt (supports {{$trigger.x}} interpolation)"
                },
                "system_prompt": {
                    "type": "string",
                    "description": "Optional system prompt"
                },
                "temperature": {
                    "type": "number",
                    "default": DEFAULT_TEMPERATURE,
                    "minimum": 0.0,
                    "maximum": 1.0
                },
                "max_tokens": {
                    "type": "integer",
                    "default": DEFAULT_MAX_TOKENS
                },
                "timeout_seconds": {
                    "type": "integer",
                    "default": DEFAULT_TIMEOUT_SECS
                },
                "fallback_model": {
                    "type": "string",
                    "description": "Fallback model if primary fails"
                },
                "api_base_url": {
                    "type": "string",
                    "description": "Override API base URL (for testing)"
                }
            },
            "required": ["prompt"],
            "additionalProperties": false
        }),
        estimated_cost_usd: 0.003, // ~1000 tokens sonnet
        required_role: RequiredRole::default(),
    }
}

/// Build the LLM node handler, capturing optional pools for budget enforcement.
pub fn handler(
    redis: Option<deadpool_redis::Pool>,
    pg: Option<sqlx::PgPool>,
) -> NodeHandler {
    Arc::new(move |input: NodeInput| {
        let redis = redis.clone();
        let pg = pg.clone();
        Box::pin(async move {
            let ctx = context_from_snapshot(&input.context_snapshot);
            let trigger = &ctx.trigger;
            let last = &ctx.last;
            let nodes = &ctx.nodes;

            // Extract config
            let prompt_raw = input
                .config
                .get("prompt")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("LLM: missing 'prompt' config"))?;

            let model = input
                .config
                .get("model")
                .and_then(|v| v.as_str())
                .unwrap_or(DEFAULT_MODEL);

            let system_prompt = input.config.get("system_prompt").and_then(|v| v.as_str());

            let temperature = input
                .config
                .get("temperature")
                .and_then(|v| v.as_f64())
                .unwrap_or(DEFAULT_TEMPERATURE);

            let max_tokens = input
                .config
                .get("max_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(DEFAULT_MAX_TOKENS);

            let timeout_secs = input
                .config
                .get("timeout_seconds")
                .and_then(|v| v.as_u64())
                .unwrap_or(DEFAULT_TIMEOUT_SECS);

            let fallback_model = input
                .config
                .get("fallback_model")
                .and_then(|v| v.as_str());

            let api_base_url = input
                .config
                .get("api_base_url")
                .and_then(|v| v.as_str())
                .unwrap_or(ANTHROPIC_API_URL);

            // Interpolate prompt + system prompt
            let prompt = interpolate_string(prompt_raw, trigger, last, nodes);
            let system = system_prompt
                .map(|s| interpolate_string(s, trigger, last, nodes));

            // Get API key
            let api_key = provider::get_api_key(&input.context_snapshot, "ANTHROPIC_API_KEY")?;

            // Budget pre-check (layers 2-5)
            let estimated = metadata().estimated_cost_usd;
            budget::check_budget(
                pg.as_ref(),
                redis.as_ref(),
                ctx.meta.account_id,
                estimated,
            )
            .await?;

            // Try primary model
            let result = call_anthropic(
                api_base_url,
                &api_key,
                model,
                &prompt,
                system.as_deref(),
                temperature,
                max_tokens,
                timeout_secs,
                &input.cancel,
            )
            .await;

            // Fallback on failure
            let (response, used_model) = match result {
                Ok(resp) => (resp, model.to_string()),
                Err(primary_err) => {
                    if let Some(fallback) = fallback_model {
                        tracing::warn!(
                            primary_model = model,
                            fallback_model = fallback,
                            error = %primary_err,
                            "LLM primary failed, trying fallback"
                        );
                        let fallback_result = call_anthropic(
                            api_base_url,
                            &api_key,
                            fallback,
                            &prompt,
                            system.as_deref(),
                            temperature,
                            max_tokens,
                            timeout_secs,
                            &input.cancel,
                        )
                        .await?;
                        (fallback_result, fallback.to_string())
                    } else {
                        return Err(primary_err);
                    }
                }
            };

            // Calculate cost (including prompt cache pricing)
            let cost_usd = provider::calculate_cost(
                &used_model,
                response.input_tokens,
                response.output_tokens,
                response.cache_creation_input_tokens,
                response.cache_read_input_tokens,
            );

            // Record cost
            budget::record_cost(
                pg.as_ref(),
                redis.as_ref(),
                ctx.meta.account_id,
                cost_usd,
            )
            .await?;

            Ok(NodeResult::with_cost(
                serde_json::json!({
                    "text": response.text,
                    "model": used_model,
                    "input_tokens": response.input_tokens,
                    "output_tokens": response.output_tokens,
                    "cache_creation_input_tokens": response.cache_creation_input_tokens,
                    "cache_read_input_tokens": response.cache_read_input_tokens,
                    "cost_usd": cost_usd,
                    "stop_reason": response.stop_reason,
                }),
                cost_usd,
            ))
        })
    })
}

struct AnthropicResponse {
    text: String,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_input_tokens: u64,
    cache_read_input_tokens: u64,
    stop_reason: String,
}

#[allow(clippy::too_many_arguments)]
async fn call_anthropic(
    api_url: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
    system: Option<&str>,
    temperature: f64,
    max_tokens: u64,
    timeout_secs: u64,
    cancel: &tokio_util::sync::CancellationToken,
) -> Result<AnthropicResponse, anyhow::Error> {
    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [
            {"role": "user", "content": prompt}
        ]
    });

    if let Some(sys) = system {
        body["system"] = serde_json::json!([{
            "type": "text",
            "text": sys,
            "cache_control": { "type": "ephemeral" }
        }]);
    }

    let req = provider::HTTP_CLIENT
        .post(api_url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("anthropic-beta", "prompt-caching-2024-07-31")
        .header("content-type", "application/json")
        .timeout(Duration::from_secs(timeout_secs))
        .json(&body);

    // Race request vs cancellation
    let response = tokio::select! {
        result = req.send() => result.map_err(|e| {
            if e.is_timeout() {
                anyhow::anyhow!("LLM: timeout after {}s", timeout_secs)
            } else {
                anyhow::anyhow!("LLM: request failed: {}", e)
            }
        })?,
        _ = cancel.cancelled() => {
            return Err(anyhow::anyhow!("LLM: cancelled"));
        }
    };

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(anyhow::anyhow!(
            "LLM: API error {} — {}",
            status.as_u16(),
            truncate(&response_text, 500),
        ));
    }

    let json: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|e| anyhow::anyhow!("LLM: invalid JSON response: {}", e))?;

    // Extract text from content blocks
    let text = json["content"]
        .as_array()
        .and_then(|blocks| {
            blocks
                .iter()
                .filter(|b| b["type"] == "text")
                .map(|b| b["text"].as_str().unwrap_or(""))
                .collect::<Vec<_>>()
                .into_iter()
                .next()
        })
        .unwrap_or("")
        .to_string();

    let usage = &json["usage"];
    let input_tokens = usage["input_tokens"].as_u64().unwrap_or(0);
    let output_tokens = usage["output_tokens"].as_u64().unwrap_or(0);
    let cache_creation = usage.get("cache_creation_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
    let cache_read = usage.get("cache_read_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);

    if cache_read > 0 {
        tracing::info!(cache_read_tokens = cache_read, "Prompt cache hit");
    } else if cache_creation > 0 {
        tracing::info!(cache_creation_tokens = cache_creation, "Prompt cache miss — created new cache entry");
    }

    let stop_reason = json["stop_reason"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();

    Ok(AnthropicResponse {
        text,
        input_tokens,
        output_tokens,
        cache_creation_input_tokens: cache_creation,
        cache_read_input_tokens: cache_read,
        stop_reason,
    })
}

fn truncate(s: &str, max_len: usize) -> &str {
    if s.len() <= max_len {
        s
    } else {
        // Find last valid UTF-8 char boundary at or before max_len
        let mut end = max_len;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        &s[..end]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;
    use tokio_util::sync::CancellationToken;

    #[test]
    fn test_llm_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "core:llm");
        assert_eq!(meta.category, "ai");
        assert!(meta.estimated_cost_usd > 0.0);
    }

    #[tokio::test]
    async fn test_llm_missing_prompt() {
        let h = handler(None, None);
        let input = NodeInput::new(
            serde_json::json!({}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("missing 'prompt'"));
    }

    #[tokio::test]
    async fn test_llm_missing_api_key() {
        let h = handler(None, None);
        let input = NodeInput::new(
            serde_json::json!({"prompt": "Hello"}),
            serde_json::json!({}),
            serde_json::json!({
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
            }),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("ANTHROPIC_API_KEY"));
    }

    #[tokio::test]
    async fn test_llm_cancellation() {
        let h = handler(None, None);
        let cancel = CancellationToken::new();
        cancel.cancel();

        let input = NodeInput {
            config: serde_json::json!({"prompt": "Hello"}),
            data: serde_json::json!({}),
            context_snapshot: serde_json::json!({
                "$trigger": {},
                "$env": {"ANTHROPIC_API_KEY": "sk-test"},
                "$meta": {
                    "execution_id": "00000000-0000-0000-0000-000000000000",
                    "flow_id": "00000000-0000-0000-0000-000000000000",
                    "account_id": "00000000-0000-0000-0000-000000000000",
                    "started_at": "2026-01-01T00:00:00Z",
                    "cumulative_cost_usd": 0.0
                },
                "$nodes": {},
                "$last": null
            }),
            cancel,
        };
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("cancelled"));
    }

    #[tokio::test]
    async fn test_llm_mock_server() {
        // Start a mock Axum server that returns a valid Anthropic response
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let api_url = format!("http://127.0.0.1:{}/v1/messages", addr.port());

        tokio::spawn(async move {
            let app = axum::Router::new().route(
                "/v1/messages",
                axum::routing::post(|| async {
                    axum::Json(serde_json::json!({
                        "id": "msg_test",
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "text", "text": "Hello from mock!"}],
                        "model": "claude-sonnet-4-6",
                        "stop_reason": "end_turn",
                        "usage": {
                            "input_tokens": 10,
                            "output_tokens": 5
                        }
                    }))
                }),
            );
            axum::serve(listener, app).await.unwrap();
        });

        // Give server a moment to start
        tokio::time::sleep(Duration::from_millis(50)).await;

        let h = handler(None, None);
        let input = NodeInput::new(
            serde_json::json!({
                "prompt": "Say hello",
                "api_base_url": api_url,
                "model": "claude-sonnet-4-6"
            }),
            serde_json::json!({}),
            serde_json::json!({
                "$trigger": {},
                "$env": {"ANTHROPIC_API_KEY": "sk-test-key"},
                "$meta": {
                    "execution_id": "00000000-0000-0000-0000-000000000000",
                    "flow_id": "00000000-0000-0000-0000-000000000000",
                    "account_id": "00000000-0000-0000-0000-000000000000",
                    "started_at": "2026-01-01T00:00:00Z",
                    "cumulative_cost_usd": 0.0
                },
                "$nodes": {},
                "$last": null
            }),
        );

        let result = h(input).await.unwrap();
        assert_eq!(result.data["text"], "Hello from mock!");
        assert_eq!(result.data["input_tokens"], 10);
        assert_eq!(result.data["output_tokens"], 5);
        assert!(result.cost_usd > 0.0);
        assert_eq!(result.data["stop_reason"], "end_turn");
    }

    #[tokio::test]
    async fn test_llm_fallback_model() {
        // Mock: primary returns 500, fallback returns 200
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let api_url = format!("http://127.0.0.1:{}/v1/messages", addr.port());

        let call_count = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let call_count_clone = call_count.clone();

        tokio::spawn(async move {
            let app = axum::Router::new().route(
                "/v1/messages",
                axum::routing::post(move || {
                    let count = call_count_clone.clone();
                    async move {
                        let n = count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        if n == 0 {
                            // First call (primary) — fail
                            (
                                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                                "server error",
                            )
                                .into_response()
                        } else {
                            // Second call (fallback) — success
                            axum::Json(serde_json::json!({
                                "id": "msg_fallback",
                                "type": "message",
                                "role": "assistant",
                                "content": [{"type": "text", "text": "Fallback response"}],
                                "model": "claude-haiku-4-5",
                                "stop_reason": "end_turn",
                                "usage": {"input_tokens": 10, "output_tokens": 3}
                            }))
                            .into_response()
                        }
                    }
                }),
            );
            axum::serve(listener, app).await.unwrap();
        });

        tokio::time::sleep(Duration::from_millis(50)).await;

        let h = handler(None, None);
        let input = NodeInput::new(
            serde_json::json!({
                "prompt": "Test fallback",
                "api_base_url": api_url,
                "model": "claude-sonnet-4-6",
                "fallback_model": "claude-haiku-4-5"
            }),
            serde_json::json!({}),
            serde_json::json!({
                "$trigger": {},
                "$env": {"ANTHROPIC_API_KEY": "sk-test-key"},
                "$meta": {
                    "execution_id": "00000000-0000-0000-0000-000000000000",
                    "flow_id": "00000000-0000-0000-0000-000000000000",
                    "account_id": "00000000-0000-0000-0000-000000000000",
                    "started_at": "2026-01-01T00:00:00Z",
                    "cumulative_cost_usd": 0.0
                },
                "$nodes": {},
                "$last": null
            }),
        );

        let result = h(input).await.unwrap();
        assert_eq!(result.data["text"], "Fallback response");
        assert_eq!(result.data["model"], "claude-haiku-4-5");
        assert_eq!(call_count.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn test_llm_system_prompt_cache_control_format() {
        use axum::extract::Request;
        use axum::body::to_bytes;
        use std::sync::Mutex;

        // Capture the request body to verify system prompt format
        let captured_body: Arc<Mutex<Option<serde_json::Value>>> = Arc::new(Mutex::new(None));
        let captured_clone = captured_body.clone();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let api_url = format!("http://127.0.0.1:{}/v1/messages", addr.port());

        tokio::spawn(async move {
            let captured = captured_clone.clone();
            let app = axum::Router::new().route(
                "/v1/messages",
                axum::routing::post(move |req: Request| {
                    let captured = captured.clone();
                    async move {
                        let body_bytes = to_bytes(req.into_body(), usize::MAX).await.unwrap();
                        let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
                        *captured.lock().unwrap() = Some(body);
                        axum::Json(serde_json::json!({
                            "id": "msg_test",
                            "type": "message",
                            "role": "assistant",
                            "content": [{"type": "text", "text": "ok"}],
                            "model": "claude-sonnet-4-6",
                            "stop_reason": "end_turn",
                            "usage": {"input_tokens": 5, "output_tokens": 2}
                        }))
                    }
                }),
            );
            axum::serve(listener, app).await.unwrap();
        });

        tokio::time::sleep(Duration::from_millis(50)).await;

        let h = handler(None, None);
        let input = NodeInput::new(
            serde_json::json!({
                "prompt": "Hello",
                "system_prompt": "You are a helpful assistant.",
                "api_base_url": api_url,
                "model": "claude-sonnet-4-6"
            }),
            serde_json::json!({}),
            serde_json::json!({
                "$trigger": {},
                "$env": {"ANTHROPIC_API_KEY": "sk-test-key"},
                "$meta": {
                    "execution_id": "00000000-0000-0000-0000-000000000000",
                    "flow_id": "00000000-0000-0000-0000-000000000000",
                    "account_id": "00000000-0000-0000-0000-000000000000",
                    "started_at": "2026-01-01T00:00:00Z",
                    "cumulative_cost_usd": 0.0
                },
                "$nodes": {},
                "$last": null
            }),
        );

        h(input).await.unwrap();

        let body = captured_body.lock().unwrap().clone().unwrap();
        // System prompt must be array with cache_control
        let system = body["system"].as_array().expect("system must be an array");
        assert_eq!(system.len(), 1);
        assert_eq!(system[0]["type"], "text");
        assert_eq!(system[0]["text"], "You are a helpful assistant.");
        assert_eq!(system[0]["cache_control"]["type"], "ephemeral");
    }

    #[tokio::test]
    async fn test_llm_prompt_caching_beta_header() {
        use axum::extract::Request;
        use std::sync::Mutex;

        let captured_header: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let captured_clone = captured_header.clone();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let api_url = format!("http://127.0.0.1:{}/v1/messages", addr.port());

        tokio::spawn(async move {
            let captured = captured_clone.clone();
            let app = axum::Router::new().route(
                "/v1/messages",
                axum::routing::post(move |req: Request| {
                    let captured = captured.clone();
                    async move {
                        let beta = req
                            .headers()
                            .get("anthropic-beta")
                            .and_then(|v| v.to_str().ok())
                            .map(|s| s.to_string());
                        *captured.lock().unwrap() = beta;
                        axum::Json(serde_json::json!({
                            "id": "msg_test",
                            "type": "message",
                            "role": "assistant",
                            "content": [{"type": "text", "text": "ok"}],
                            "model": "claude-sonnet-4-6",
                            "stop_reason": "end_turn",
                            "usage": {"input_tokens": 5, "output_tokens": 2}
                        }))
                    }
                }),
            );
            axum::serve(listener, app).await.unwrap();
        });

        tokio::time::sleep(Duration::from_millis(50)).await;

        let h = handler(None, None);
        let input = NodeInput::new(
            serde_json::json!({
                "prompt": "Hello",
                "api_base_url": api_url,
                "model": "claude-sonnet-4-6"
            }),
            serde_json::json!({}),
            serde_json::json!({
                "$trigger": {},
                "$env": {"ANTHROPIC_API_KEY": "sk-test-key"},
                "$meta": {
                    "execution_id": "00000000-0000-0000-0000-000000000000",
                    "flow_id": "00000000-0000-0000-0000-000000000000",
                    "account_id": "00000000-0000-0000-0000-000000000000",
                    "started_at": "2026-01-01T00:00:00Z",
                    "cumulative_cost_usd": 0.0
                },
                "$nodes": {},
                "$last": null
            }),
        );

        h(input).await.unwrap();

        let header_val = captured_header.lock().unwrap().clone().unwrap();
        assert_eq!(header_val, "prompt-caching-2024-07-31");
    }
}
