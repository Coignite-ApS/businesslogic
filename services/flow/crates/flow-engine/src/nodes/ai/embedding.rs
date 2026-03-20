//! Embedding node — local ONNX inference via fastembed.
//!
//! Zero API cost, ~5-10ms per doc on CPX31. Uses bge-small-en-v1.5 (384-dim) by default.
//! Model is cached via LazyLock + Mutex for thread-safe reuse.

use std::sync::{Arc, LazyLock, Mutex};

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use flow_common::node::{RequiredRole, NodeInput, NodeResult, NodeTier, NodeTypeMeta, PortDef};

use crate::nodes::expression::{context_from_snapshot, resolve_value};
use crate::nodes::NodeHandler;

const DEFAULT_MODEL: &str = "BAAI/bge-small-en-v1.5";
const DEFAULT_BATCH_SIZE: usize = 256;
const DEFAULT_DIMENSIONS: usize = 384;

/// Cached embedding model instance. Initialized once, reused across calls.
static EMBEDDING_MODEL: LazyLock<Mutex<Option<TextEmbedding>>> =
    LazyLock::new(|| Mutex::new(None));

/// Initialize the embedding model (call at worker startup for pre-warming).
pub fn prewarm_model() {
    let mut guard = EMBEDDING_MODEL.lock().unwrap();
    if guard.is_none() {
        tracing::info!("Pre-warming embedding model: {}", DEFAULT_MODEL);
        match TextEmbedding::try_new(
            InitOptions::new(EmbeddingModel::BGESmallENV15).with_show_download_progress(true),
        ) {
            Ok(model) => {
                tracing::info!("Embedding model loaded successfully");
                *guard = Some(model);
            }
            Err(e) => {
                tracing::error!("Failed to load embedding model: {}", e);
            }
        }
    }
}

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "core:embedding".to_string(),
        name: "Embedding".to_string(),
        description:
            "Generate vector embeddings from text using a local ONNX model (bge-small-en-v1.5)."
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
                "model": {
                    "type": "string",
                    "default": DEFAULT_MODEL
                },
                "input": {
                    "description": "String or array of strings to embed (supports expressions)"
                },
                "batch_size": {
                    "type": "integer",
                    "default": DEFAULT_BATCH_SIZE
                }
            },
            "required": ["input"],
            "additionalProperties": false
        }),
        estimated_cost_usd: 0.0,
        required_role: RequiredRole::default(),
    }
}

pub fn handler() -> NodeHandler {
    Arc::new(|input: NodeInput| {
        Box::pin(async move {
            let ctx = context_from_snapshot(&input.context_snapshot);
            let trigger = &ctx.trigger;
            let last = &ctx.last;
            let nodes = &ctx.nodes;

            // Resolve input to array of strings
            let input_expr = input
                .config
                .get("input")
                .ok_or_else(|| anyhow::anyhow!("Embedding: missing 'input' config"))?;

            let resolved = resolve_value(input_expr, trigger, last, nodes);

            let texts: Vec<String> = match &resolved {
                serde_json::Value::String(s) => vec![s.clone()],
                serde_json::Value::Array(arr) => arr
                    .iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect(),
                _ => {
                    return Err(anyhow::anyhow!(
                        "Embedding: 'input' must resolve to string or array of strings"
                    ))
                }
            };

            if texts.is_empty() {
                return Err(anyhow::anyhow!("Embedding: no texts to embed"));
            }

            let batch_size = input
                .config
                .get("batch_size")
                .and_then(|v| v.as_u64())
                .unwrap_or(DEFAULT_BATCH_SIZE as u64) as usize;

            // Check cancellation before expensive operation
            if input.cancel.is_cancelled() {
                return Err(anyhow::anyhow!("Embedding: cancelled"));
            }

            // Embed using the cached model
            // Run in spawn_blocking since fastembed is CPU-bound
            let texts_clone = texts.clone();
            let embeddings = tokio::task::spawn_blocking(move || {
                let mut guard = EMBEDDING_MODEL.lock().map_err(|e| {
                    anyhow::anyhow!("Embedding: model lock poisoned: {}", e)
                })?;
                let model = guard
                    .as_mut()
                    .ok_or_else(|| anyhow::anyhow!("Embedding: model not initialized — call prewarm_model() at startup"))?;

                // Process in batches
                let mut all_embeddings: Vec<Vec<f32>> = Vec::with_capacity(texts_clone.len());
                for chunk in texts_clone.chunks(batch_size) {
                    let batch: Vec<&str> = chunk.iter().map(|s| s.as_str()).collect();
                    let batch_result = model.embed(batch, None)
                        .map_err(|e| anyhow::anyhow!("Embedding: inference failed: {}", e))?;
                    all_embeddings.extend(batch_result);
                }

                Ok::<Vec<Vec<f32>>, anyhow::Error>(all_embeddings)
            })
            .await
            .map_err(|e| anyhow::anyhow!("Embedding: task join error: {}", e))??;

            // Build output
            let embedding_results: Vec<serde_json::Value> = embeddings
                .iter()
                .enumerate()
                .map(|(i, vec)| {
                    serde_json::json!({
                        "index": i,
                        "vector": vec,
                    })
                })
                .collect();

            let dimensions = embeddings.first().map(|v| v.len()).unwrap_or(DEFAULT_DIMENSIONS);

            Ok(NodeResult::ok(serde_json::json!({
                "embeddings": embedding_results,
                "model": DEFAULT_MODEL,
                "dimensions": dimensions,
                "count": embeddings.len(),
            })))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_embedding_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "core:embedding");
        assert_eq!(meta.category, "ai");
        assert_eq!(meta.estimated_cost_usd, 0.0);
    }

    #[tokio::test]
    async fn test_embedding_missing_input() {
        let h = handler();
        let input = NodeInput::new(
            serde_json::json!({}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("missing 'input'"));
    }

    #[tokio::test]
    async fn test_embedding_invalid_input_type() {
        let h = handler();
        let input = NodeInput::new(
            serde_json::json!({"input": 42}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("string or array"));
    }

    #[tokio::test]
    async fn test_embedding_empty_array() {
        let h = handler();
        let input = NodeInput::new(
            serde_json::json!({"input": []}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("no texts"));
    }

    #[tokio::test]
    async fn test_embedding_cancellation() {
        let h = handler();
        let cancel = tokio_util::sync::CancellationToken::new();
        cancel.cancel();

        let input = NodeInput {
            config: serde_json::json!({"input": "test"}),
            data: serde_json::json!({}),
            context_snapshot: serde_json::json!({}),
            cancel,
        };
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("cancelled"));
    }

    // Integration test: actually runs fastembed inference (requires model download)
    #[tokio::test]
    #[ignore] // Run with: cargo test --features ai-nodes -- --ignored test_embedding_real
    async fn test_embedding_real() {
        prewarm_model();

        let h = handler();
        let input = NodeInput::new(
            serde_json::json!({"input": "Hello, world!"}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await.unwrap();

        assert_eq!(result.data["count"], 1);
        assert_eq!(result.data["dimensions"], 384);
        assert_eq!(result.data["model"], "BAAI/bge-small-en-v1.5");
        let embeddings = result.data["embeddings"].as_array().unwrap();
        assert_eq!(embeddings.len(), 1);
        let vector = embeddings[0]["vector"].as_array().unwrap();
        assert_eq!(vector.len(), 384);
        assert_eq!(result.cost_usd, 0.0);
    }

    #[tokio::test]
    #[ignore]
    async fn test_embedding_batch() {
        prewarm_model();

        let h = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "input": ["Hello", "World", "Test"],
                "batch_size": 2
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await.unwrap();

        assert_eq!(result.data["count"], 3);
        let embeddings = result.data["embeddings"].as_array().unwrap();
        assert_eq!(embeddings.len(), 3);
        for (i, emb) in embeddings.iter().enumerate() {
            assert_eq!(emb["index"], i);
            assert_eq!(emb["vector"].as_array().unwrap().len(), 384);
        }
    }
}
