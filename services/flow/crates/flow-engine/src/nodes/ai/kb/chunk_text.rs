//! Chunk Text node — section-aware variable-size document chunking.
//!
//! Port of the JavaScript chunker from bl-ai-api. Splits text at section
//! boundaries (markdown headings, all-caps lines), respects paragraph
//! boundaries within sections, and supports configurable overlap.

use std::sync::Arc;

use flow_common::node::{NodeInput, NodeResult, NodeTier, NodeTypeMeta, PortDef, RequiredRole};

use crate::nodes::expression::{context_from_snapshot, resolve_value};
use crate::nodes::NodeHandler;

const DEFAULT_TARGET_SIZE: usize = 512;
const DEFAULT_MIN_SIZE: usize = 128;
const DEFAULT_MAX_SIZE: usize = 768;
const DEFAULT_OVERLAP_RATIO: f64 = 0.1;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "ai:chunk_text".to_string(),
        name: "Chunk Text".to_string(),
        description: "Section-aware variable-size document chunking with overlap.".to_string(),
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
                "content": {
                    "description": "Text content to chunk (string or expression)"
                },
                "source_file": {
                    "type": "string",
                    "description": "Source filename for metadata"
                },
                "target_size": {
                    "type": "integer",
                    "default": DEFAULT_TARGET_SIZE,
                    "description": "Target chunk size in tokens"
                },
                "min_size": {
                    "type": "integer",
                    "default": DEFAULT_MIN_SIZE
                },
                "max_size": {
                    "type": "integer",
                    "default": DEFAULT_MAX_SIZE
                },
                "overlap_ratio": {
                    "type": "number",
                    "default": DEFAULT_OVERLAP_RATIO
                }
            },
            "required": ["content"],
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

            let content_expr = input
                .config
                .get("content")
                .ok_or_else(|| anyhow::anyhow!("ChunkText: missing 'content' config"))?;
            let resolved = resolve_value(content_expr, trigger, last, nodes);
            let text = resolved
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("ChunkText: 'content' must resolve to string"))?;

            if text.is_empty() {
                return Err(anyhow::anyhow!("ChunkText: empty content"));
            }

            let source_file = input
                .config
                .get("source_file")
                .and_then(|v| v.as_str())
                .map(|s| {
                    crate::nodes::expression::interpolate_string(s, trigger, last, nodes)
                })
                .unwrap_or_default();

            let target_size = input
                .config
                .get("target_size")
                .and_then(|v| v.as_u64())
                .unwrap_or(DEFAULT_TARGET_SIZE as u64) as usize;
            let min_size = input
                .config
                .get("min_size")
                .and_then(|v| v.as_u64())
                .unwrap_or(DEFAULT_MIN_SIZE as u64) as usize;
            let max_size = input
                .config
                .get("max_size")
                .and_then(|v| v.as_u64())
                .unwrap_or(DEFAULT_MAX_SIZE as u64) as usize;
            let overlap_ratio = input
                .config
                .get("overlap_ratio")
                .and_then(|v| v.as_f64())
                .unwrap_or(DEFAULT_OVERLAP_RATIO);

            if input.cancel.is_cancelled() {
                return Err(anyhow::anyhow!("ChunkText: cancelled"));
            }

            let cfg = ChunkConfig {
                target_size,
                min_size,
                max_size,
                overlap_ratio,
            };
            let chunks = chunk_document(text, &source_file, &cfg);

            let chunk_json: Vec<serde_json::Value> = chunks
                .iter()
                .map(|c| {
                    serde_json::json!({
                        "content": c.content,
                        "chunk_index": c.chunk_index,
                        "section_heading": c.section_heading,
                        "source_file": c.source_file,
                        "token_count": c.token_count,
                    })
                })
                .collect();

            let contents: Vec<&str> = chunks.iter().map(|c| c.content.as_str()).collect();

            Ok(NodeResult::ok(serde_json::json!({
                "chunks": chunk_json,
                "texts": contents,
                "count": chunks.len(),
                "total_tokens": chunks.iter().map(|c| c.token_count).sum::<usize>(),
            })))
        })
    })
}

struct ChunkConfig {
    target_size: usize,
    min_size: usize,
    max_size: usize,
    overlap_ratio: f64,
}

struct Chunk {
    content: String,
    chunk_index: usize,
    section_heading: Option<String>,
    source_file: String,
    token_count: usize,
}

/// Approximate token count: word count / 0.75
fn estimate_tokens(text: &str) -> usize {
    let words = text.split_whitespace().count();
    ((words as f64) / 0.75).ceil() as usize
}

/// Check if a line is a heading (markdown # or ALL-CAPS).
fn is_heading(line: &str) -> bool {
    if line.is_empty() {
        return false;
    }
    // Markdown headings
    if line.starts_with('#') {
        let after_hashes = line.trim_start_matches('#');
        if !after_hashes.is_empty() && after_hashes.starts_with(' ') {
            return true;
        }
    }
    // All-caps lines (min 3 chars, has uppercase, no lowercase)
    if line.len() >= 3
        && line.chars().any(|c| c.is_ascii_uppercase())
        && !line.chars().any(|c| c.is_ascii_lowercase())
    {
        return true;
    }
    false
}

struct Section {
    heading: Option<String>,
    text: String,
}

fn split_into_sections(text: &str) -> Vec<Section> {
    let mut sections = Vec::new();
    let mut current_heading: Option<String> = None;
    let mut current_lines: Vec<&str> = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if is_heading(trimmed) {
            if !current_lines.is_empty() {
                sections.push(Section {
                    heading: current_heading.take(),
                    text: current_lines.join("\n"),
                });
                current_lines.clear();
            }
            let heading_text = trimmed.trim_start_matches('#').trim_start().to_string();
            current_heading = Some(heading_text);
        } else {
            current_lines.push(line);
        }
    }

    if !current_lines.is_empty() || current_heading.is_some() {
        sections.push(Section {
            heading: current_heading,
            text: current_lines.join("\n"),
        });
    }

    if sections.is_empty() {
        sections.push(Section {
            heading: None,
            text: text.to_string(),
        });
    }

    sections
}

fn get_trailing_text(text: &str, target_tokens: usize) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    let approx_words = ((target_tokens as f64) * 0.75).ceil() as usize;
    let start = words.len().saturating_sub(approx_words);
    words[start..].join(" ")
}

fn chunk_document(text: &str, source_file: &str, cfg: &ChunkConfig) -> Vec<Chunk> {
    let sections = split_into_sections(text);
    let mut chunks = Vec::new();
    let mut global_index = 0usize;

    for section in &sections {
        let raw_text = section.text.trim();
        if raw_text.is_empty() {
            continue;
        }

        let heading = &section.heading;
        let content = match heading {
            Some(h) => format!("{}\n\n{}", h, raw_text),
            None => raw_text.to_string(),
        };
        let tokens = estimate_tokens(&content);

        // Section fits within max_size
        if tokens <= cfg.max_size {
            if tokens >= cfg.min_size || sections.len() == 1 {
                chunks.push(Chunk {
                    content,
                    chunk_index: global_index,
                    section_heading: heading.clone(),
                    source_file: source_file.to_string(),
                    token_count: tokens,
                });
                global_index += 1;
            } else if !chunks.is_empty() {
                // Merge tiny section into previous
                let prev = chunks.last_mut().unwrap();
                let merged = format!("{}\n\n{}", prev.content, content);
                let merged_tokens = estimate_tokens(&merged);
                if merged_tokens <= cfg.max_size {
                    prev.content = merged;
                    prev.token_count = merged_tokens;
                } else {
                    chunks.push(Chunk {
                        content,
                        chunk_index: global_index,
                        section_heading: heading.clone(),
                        source_file: source_file.to_string(),
                        token_count: tokens,
                    });
                    global_index += 1;
                }
            } else {
                chunks.push(Chunk {
                    content,
                    chunk_index: global_index,
                    section_heading: heading.clone(),
                    source_file: source_file.to_string(),
                    token_count: tokens,
                });
                global_index += 1;
            }
            continue;
        }

        // Section > max_size — split at paragraph boundaries
        let overlap_tokens =
            ((cfg.target_size as f64) * cfg.overlap_ratio).floor() as usize;
        let paragraphs: Vec<&str> = content.split("\n\n").collect();
        let mut buffer = String::new();
        let mut buffer_tokens = 0usize;

        for para in &paragraphs {
            let para_tokens = estimate_tokens(para);

            if buffer_tokens + para_tokens <= cfg.target_size {
                if !buffer.is_empty() {
                    buffer.push_str("\n\n");
                }
                buffer.push_str(para);
                buffer_tokens += para_tokens;
                continue;
            }

            if !buffer.is_empty() {
                chunks.push(Chunk {
                    content: buffer.clone(),
                    chunk_index: global_index,
                    section_heading: heading.clone(),
                    source_file: source_file.to_string(),
                    token_count: buffer_tokens,
                });
                global_index += 1;

                if overlap_tokens > 0 {
                    let overlap = get_trailing_text(&buffer, overlap_tokens);
                    buffer = format!("{}\n\n{}", overlap, para);
                    buffer_tokens = estimate_tokens(&buffer);
                } else {
                    buffer = para.to_string();
                    buffer_tokens = para_tokens;
                }
            } else {
                // Single paragraph too large — force add
                chunks.push(Chunk {
                    content: para.to_string(),
                    chunk_index: global_index,
                    section_heading: heading.clone(),
                    source_file: source_file.to_string(),
                    token_count: para_tokens,
                });
                global_index += 1;
            }
        }

        if !buffer.trim().is_empty() {
            let trimmed = buffer.trim().to_string();
            let tokens = estimate_tokens(&trimmed);
            chunks.push(Chunk {
                content: trimmed,
                chunk_index: global_index,
                section_heading: heading.clone(),
                source_file: source_file.to_string(),
                token_count: tokens,
            });
            global_index += 1;
        }
    }

    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_text_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "ai:chunk_text");
        assert_eq!(meta.category, "ai");
    }

    #[test]
    fn test_estimate_tokens() {
        assert_eq!(estimate_tokens("hello world"), 3); // 2 words / 0.75 = 2.67 → 3
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("one"), 2); // 1 / 0.75 = 1.33 → 2
    }

    #[test]
    fn test_is_heading() {
        assert!(is_heading("# Title"));
        assert!(is_heading("## Subtitle"));
        assert!(is_heading("INTRODUCTION"));
        assert!(is_heading("ALL CAPS HEADING"));
        assert!(!is_heading("normal text"));
        assert!(!is_heading(""));
        assert!(!is_heading("Mixed Case"));
    }

    #[test]
    fn test_split_into_sections() {
        let text = "# Section 1\nContent A\n\n# Section 2\nContent B";
        let sections = split_into_sections(text);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].heading.as_deref(), Some("Section 1"));
        assert!(sections[0].text.contains("Content A"));
        assert_eq!(sections[1].heading.as_deref(), Some("Section 2"));
        assert!(sections[1].text.contains("Content B"));
    }

    #[test]
    fn test_chunk_small_document() {
        let cfg = ChunkConfig {
            target_size: 512,
            min_size: 128,
            max_size: 768,
            overlap_ratio: 0.1,
        };
        let text = "This is a small document with just a few words.";
        let chunks = chunk_document(text, "test.txt", &cfg);
        // Single small doc should produce 1 chunk even if below min_size (single section)
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].chunk_index, 0);
        assert_eq!(chunks[0].source_file, "test.txt");
    }

    #[test]
    fn test_chunk_with_sections() {
        let cfg = ChunkConfig {
            target_size: 50,
            min_size: 10,
            max_size: 100,
            overlap_ratio: 0.0,
        };
        let text = "# Introduction\nThis is the intro section with some content.\n\n# Methods\nThis is the methods section with more content.";
        let chunks = chunk_document(text, "paper.md", &cfg);
        assert!(chunks.len() >= 2);
        assert_eq!(chunks[0].section_heading.as_deref(), Some("Introduction"));
    }

    #[test]
    fn test_chunk_large_section_splits() {
        let cfg = ChunkConfig {
            target_size: 20,
            min_size: 5,
            max_size: 30,
            overlap_ratio: 0.0,
        };
        // Create long text with paragraphs that exceed max_size
        let para: Vec<&str> = (0..20).map(|_| "word").collect();
        let paragraphs: Vec<String> = (0..5).map(|_| para.join(" ")).collect();
        let text = paragraphs.join("\n\n");
        let chunks = chunk_document(&text, "big.txt", &cfg);
        assert!(chunks.len() > 1, "Long text should produce multiple chunks");
    }

    #[tokio::test]
    async fn test_chunk_handler_missing_content() {
        let h = handler();
        let input = NodeInput::new(
            serde_json::json!({}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("missing 'content'"));
    }

    #[tokio::test]
    async fn test_chunk_handler_empty_content() {
        let h = handler();
        let input = NodeInput::new(
            serde_json::json!({"content": ""}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("empty content"));
    }

    #[tokio::test]
    async fn test_chunk_handler_success() {
        let h = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "content": "This is a test document with enough content to be chunked properly.",
                "source_file": "test.txt"
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = h(input).await.unwrap();
        assert!(result.data["count"].as_u64().unwrap() >= 1);
        assert!(result.data["chunks"].as_array().unwrap().len() >= 1);
        assert!(result.data["texts"].as_array().unwrap().len() >= 1);
        assert!(result.data["total_tokens"].as_u64().unwrap() > 0);
    }

    #[tokio::test]
    async fn test_chunk_handler_with_expression() {
        let h = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "content": "$trigger.body.content",
                "source_file": "{{$trigger.body.filename}}"
            }),
            serde_json::json!({}),
            serde_json::json!({
                "$trigger": {
                    "body": {
                        "content": "Document text from trigger.",
                        "filename": "uploaded.txt"
                    }
                },
                "$meta": {
                    "execution_id": "00000000-0000-0000-0000-000000000000",
                    "flow_id": "00000000-0000-0000-0000-000000000000",
                    "account_id": "00000000-0000-0000-0000-000000000000",
                    "started_at": "2026-01-01T00:00:00Z",
                    "cumulative_cost_usd": 0.0
                },
                "$nodes": {},
                "$env": {},
                "$last": null
            }),
        );
        let result = h(input).await.unwrap();
        assert!(result.data["count"].as_u64().unwrap() >= 1);
    }
}
