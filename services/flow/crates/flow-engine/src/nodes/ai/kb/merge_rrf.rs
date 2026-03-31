//! Merge RRF node — Reciprocal Rank Fusion for hybrid search.
//!
//! Combines vector search results and full-text search results using RRF
//! scoring. Deduplicates by chunk ID and returns top-k merged results.

use std::collections::HashMap;
use std::sync::Arc;

use flow_common::node::{NodeInput, NodeResult, NodeTier, NodeTypeMeta, PortDef, RequiredRole};

use crate::nodes::expression::{context_from_snapshot, resolve_value};
use crate::nodes::NodeHandler;

const DEFAULT_K: u64 = 60;
const DEFAULT_TOP_K: usize = 5;
const DEFAULT_MIN_SIMILARITY: f64 = 0.2;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "ai:merge_rrf".to_string(),
        name: "Merge RRF".to_string(),
        description:
            "Reciprocal Rank Fusion: merge vector + text search results into unified ranking."
                .to_string(),
        category: "ai".to_string(),
        tier: NodeTier::Core,
        inputs: vec![
            PortDef {
                name: "vector_results".to_string(),
                data_type: "array".to_string(),
                required: true,
            },
            PortDef {
                name: "text_results".to_string(),
                data_type: "array".to_string(),
                required: false,
            },
        ],
        outputs: vec![PortDef {
            name: "output".to_string(),
            data_type: "object".to_string(),
            required: true,
        }],
        config_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "vector_results": {
                    "description": "Vector search results (with similarity_score)"
                },
                "text_results": {
                    "description": "Full-text search results (with fts_rank)"
                },
                "k": {
                    "type": "integer",
                    "default": DEFAULT_K,
                    "description": "RRF constant k"
                },
                "top_k": {
                    "type": "integer",
                    "default": DEFAULT_TOP_K,
                    "description": "Number of results to return"
                },
                "min_similarity": {
                    "type": "number",
                    "default": DEFAULT_MIN_SIMILARITY,
                    "description": "Minimum vector similarity threshold"
                }
            },
            "required": ["vector_results"],
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

            let vector_raw = input
                .config
                .get("vector_results")
                .ok_or_else(|| anyhow::anyhow!("MergeRRF: missing 'vector_results'"))?;
            let vector_resolved = resolve_value(vector_raw, trigger, last, nodes);

            let vector_results = extract_results(&vector_resolved)?;

            let text_results = input
                .config
                .get("text_results")
                .map(|v| resolve_value(v, trigger, last, nodes))
                .and_then(|v| extract_results(&v).ok())
                .unwrap_or_default();

            let k = input
                .config
                .get("k")
                .and_then(|v| v.as_u64())
                .unwrap_or(DEFAULT_K);
            let top_k = input
                .config
                .get("top_k")
                .and_then(|v| v.as_u64())
                .unwrap_or(DEFAULT_TOP_K as u64) as usize;
            let min_similarity = input
                .config
                .get("min_similarity")
                .and_then(|v| v.as_f64())
                .unwrap_or(DEFAULT_MIN_SIMILARITY);

            // Build score map
            let mut score_map: HashMap<String, MergedResult> = HashMap::new();

            // Process vector results
            for (rank, result) in vector_results.iter().enumerate() {
                let id = result
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if id.is_empty() {
                    continue;
                }

                let similarity = result
                    .get("similarity_score")
                    .or_else(|| result.get("similarity"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);

                if similarity < min_similarity {
                    continue;
                }

                let rrf_score = 1.0 / (k as f64 + rank as f64 + 1.0);

                score_map.insert(
                    id.clone(),
                    MergedResult {
                        data: result.clone(),
                        similarity,
                        rrf_score,
                    },
                );
            }

            // Process text results
            for (rank, result) in text_results.iter().enumerate() {
                let id = result
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if id.is_empty() {
                    continue;
                }

                let rrf_score = 1.0 / (k as f64 + rank as f64 + 1.0);

                if let Some(existing) = score_map.get_mut(&id) {
                    existing.rrf_score += rrf_score;
                } else {
                    score_map.insert(
                        id,
                        MergedResult {
                            data: result.clone(),
                            similarity: 0.0,
                            rrf_score,
                        },
                    );
                }
            }

            // Sort by RRF score and take top_k
            let mut ranked: Vec<MergedResult> = score_map.into_values().collect();
            ranked.sort_by(|a, b| b.rrf_score.partial_cmp(&a.rrf_score).unwrap_or(std::cmp::Ordering::Equal));
            ranked.truncate(top_k);

            let results: Vec<serde_json::Value> = ranked
                .iter()
                .map(|r| {
                    let mut obj = r.data.clone();
                    if let Some(map) = obj.as_object_mut() {
                        map.insert(
                            "rrf_score".to_string(),
                            serde_json::json!(r.rrf_score),
                        );
                        map.insert(
                            "similarity".to_string(),
                            serde_json::json!(r.similarity),
                        );
                    }
                    obj
                })
                .collect();

            Ok(NodeResult::ok(serde_json::json!({
                "results": results,
                "count": results.len(),
                "k": k,
            })))
        })
    })
}

struct MergedResult {
    data: serde_json::Value,
    similarity: f64,
    rrf_score: f64,
}

fn extract_results(value: &serde_json::Value) -> Result<Vec<serde_json::Value>, anyhow::Error> {
    // Handle direct array
    if let Some(arr) = value.as_array() {
        return Ok(arr.clone());
    }
    // Handle {results: [...]} format (from vector_search/text_search nodes)
    if let Some(arr) = value.get("results").and_then(|v| v.as_array()) {
        return Ok(arr.clone());
    }
    Err(anyhow::anyhow!(
        "MergeRRF: expected array or object with 'results' array"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merge_rrf_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "ai:merge_rrf");
        assert_eq!(meta.category, "ai");
    }

    #[tokio::test]
    async fn test_merge_rrf_vector_only() {
        let h = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "vector_results": {
                    "results": [
                        {"id": "a", "content": "chunk A", "similarity_score": 0.9},
                        {"id": "b", "content": "chunk B", "similarity_score": 0.7}
                    ]
                },
                "top_k": 5,
                "k": 60
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await.unwrap();
        let results = result.data["results"].as_array().unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0]["id"], "a");
        assert!(results[0]["rrf_score"].as_f64().unwrap() > 0.0);
    }

    #[tokio::test]
    async fn test_merge_rrf_hybrid() {
        let h = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "vector_results": [
                    {"id": "a", "content": "chunk A", "similarity_score": 0.9},
                    {"id": "b", "content": "chunk B", "similarity_score": 0.7}
                ],
                "text_results": [
                    {"id": "b", "content": "chunk B", "fts_rank": 0.5},
                    {"id": "c", "content": "chunk C", "fts_rank": 0.3}
                ],
                "top_k": 5,
                "k": 60
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await.unwrap();
        let results = result.data["results"].as_array().unwrap();
        assert_eq!(results.len(), 3);
        // "b" should rank higher because it appears in both
        let b_score = results
            .iter()
            .find(|r| r["id"] == "b")
            .unwrap()["rrf_score"]
            .as_f64()
            .unwrap();
        let a_score = results
            .iter()
            .find(|r| r["id"] == "a")
            .unwrap()["rrf_score"]
            .as_f64()
            .unwrap();
        assert!(b_score > a_score, "b should score higher than a (in both lists)");
    }

    #[tokio::test]
    async fn test_merge_rrf_filters_low_similarity() {
        let h = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "vector_results": [
                    {"id": "a", "content": "good", "similarity_score": 0.8},
                    {"id": "b", "content": "bad", "similarity_score": 0.1}
                ],
                "min_similarity": 0.5
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await.unwrap();
        let results = result.data["results"].as_array().unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["id"], "a");
    }

    #[tokio::test]
    async fn test_merge_rrf_respects_top_k() {
        let h = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "vector_results": [
                    {"id": "a", "content": "A", "similarity_score": 0.9},
                    {"id": "b", "content": "B", "similarity_score": 0.8},
                    {"id": "c", "content": "C", "similarity_score": 0.7}
                ],
                "top_k": 2
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await.unwrap();
        assert_eq!(result.data["count"], 2);
    }

    #[tokio::test]
    async fn test_merge_rrf_missing_vector_results() {
        let h = handler();
        let input = NodeInput::new(
            serde_json::json!({}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
    }
}
