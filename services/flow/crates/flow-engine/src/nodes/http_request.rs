//! HTTP Request node — makes HTTP requests to external services.
//!
//! Configuration:
//! - `url`: Target URL (supports `{{$trigger.x}}` interpolation)
//! - `method`: HTTP method (GET, POST, PUT, DELETE, PATCH)
//! - `headers`: Optional object of header key-value pairs (values support interpolation)
//! - `body`: Optional request body (string supports interpolation, object sent as JSON)
//! - `timeout_ms`: Optional timeout in milliseconds (default: 30000)
//! - `allow_private_ips`: Optional bool to bypass SSRF protection (default: false)
//!
//! Output: `{ status, headers, body }`

use super::expression::{context_from_snapshot, interpolate_string};
use super::NodeHandler;
use flow_common::node::{RequiredRole, NodeInput, NodeResult, NodeTypeMeta, PortDef};
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "core:http_request".to_string(),
        name: "HTTP Request".to_string(),
        description: "Makes HTTP requests to external services and returns status, headers, and body."
            .to_string(),
        category: "integration".to_string(),
        tier: flow_common::node::NodeTier::Core,
        inputs: vec![PortDef {
            name: "input".to_string(),
            data_type: "object".to_string(),
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
                "url": {
                    "type": "string",
                    "description": "Target URL (supports {{$trigger.x}} interpolation)",
                },
                "method": {
                    "type": "string",
                    "enum": ["GET", "POST", "PUT", "DELETE", "PATCH"],
                    "default": "GET",
                },
                "headers": {
                    "type": "object",
                    "description": "Optional HTTP headers (values support interpolation)",
                    "additionalProperties": { "type": "string" }
                },
                "body": {
                    "description": "Optional request body (string supports interpolation)"
                },
                "timeout_ms": {
                    "type": "number",
                    "default": 30000,
                    "description": "Request timeout in milliseconds"
                },
                "allow_private_ips": {
                    "type": "boolean",
                    "default": false,
                    "description": "Bypass SSRF protection (use only for trusted flows)"
                }
            },
            "required": ["url"],
            "additionalProperties": false
        }),
        estimated_cost_usd: 0.0,
        required_role: RequiredRole::default(),
    }
}

/// Check if an IP address is in a private/internal range (SSRF protection).
fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()        // 127.0.0.0/8
            || v4.is_private()      // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
            || v4.is_link_local()   // 169.254.0.0/16 (cloud metadata!)
            || v4.is_unspecified()  // 0.0.0.0
            || v4.is_broadcast()    // 255.255.255.255
            // 100.64.0.0/10 (CGNAT / shared address space)
            || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()        // ::1
            || v6.is_unspecified()  // ::
            // fe80::/10 (link-local)
            || (v6.segments()[0] & 0xffc0) == 0xfe80
            // ::ffff:0:0/96 (IPv4-mapped — check the embedded IPv4)
            || v6.to_ipv4_mapped().is_some_and(|v4| is_private_ip(&IpAddr::V4(v4)))
        }
    }
}

/// Validate URL against SSRF denylist. Blocks private IPs, localhost, and non-HTTP schemes.
fn validate_url(url: &str) -> Result<(), anyhow::Error> {
    let parsed = url::Url::parse(url)
        .map_err(|e| anyhow::anyhow!("HTTP Request: invalid URL: {}", e))?;

    // Only allow http/https
    match parsed.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(anyhow::anyhow!(
                "HTTP Request: scheme '{}' not allowed, only http/https",
                scheme
            ))
        }
    }

    // Use url crate's parsed host for reliable IP detection
    let host = parsed
        .host()
        .ok_or_else(|| anyhow::anyhow!("HTTP Request: URL has no host"))?;

    match host {
        url::Host::Ipv4(v4) => {
            if is_private_ip(&IpAddr::V4(v4)) {
                return Err(anyhow::anyhow!(
                    "HTTP Request: requests to private/internal IP addresses are blocked"
                ));
            }
        }
        url::Host::Ipv6(v6) => {
            if is_private_ip(&IpAddr::V6(v6)) {
                return Err(anyhow::anyhow!(
                    "HTTP Request: requests to private/internal IP addresses are blocked"
                ));
            }
        }
        url::Host::Domain(domain) => {
            let domain_lower = domain.to_lowercase();
            if domain_lower == "localhost"
                || domain_lower.ends_with(".localhost")
                || domain_lower.ends_with(".local")
            {
                return Err(anyhow::anyhow!(
                    "HTTP Request: requests to localhost/local addresses are blocked"
                ));
            }
        }
    }

    Ok(())
}

pub fn handler() -> NodeHandler {
    Arc::new(|input: NodeInput| {
        Box::pin(async move {
            let url_raw = input
                .config
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("HTTP Request: missing or invalid 'url' config"))?;

            let method = input
                .config
                .get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("GET");

            let timeout_ms: u64 = input
                .config
                .get("timeout_ms")
                .and_then(|v| v.as_u64())
                .unwrap_or(30_000);

            let allow_private_ips = input
                .config
                .get("allow_private_ips")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let headers = input.config.get("headers");
            let body = input.config.get("body");

            // Resolve context for interpolation
            let context = context_from_snapshot(&input.context_snapshot);
            let trigger = &context.trigger;
            let last = &context.last;
            let nodes = &context.nodes;

            // Interpolate URL
            let url = interpolate_string(url_raw, trigger, last, nodes);

            // SSRF protection: validate URL against denylist
            if !allow_private_ips {
                validate_url(&url)?;
            }

            // Build HTTP request
            let client = reqwest::Client::new();
            let mut req = match method.to_uppercase().as_str() {
                "GET" => client.get(&url),
                "POST" => client.post(&url),
                "PUT" => client.put(&url),
                "DELETE" => client.delete(&url),
                "PATCH" => client.patch(&url),
                _ => {
                    return Err(anyhow::anyhow!(
                        "HTTP Request: unsupported method '{}'",
                        method
                    ))
                }
            };

            // Add headers with interpolation
            if let Some(headers_obj) = headers {
                if let Some(map) = headers_obj.as_object() {
                    for (key, value) in map {
                        if let Some(header_value) = value.as_str() {
                            let interpolated =
                                interpolate_string(header_value, trigger, last, nodes);
                            req = req.header(key, interpolated);
                        }
                    }
                }
            }

            // Add body with interpolation
            if let Some(body_value) = body {
                if let Some(body_str) = body_value.as_str() {
                    let interpolated = interpolate_string(body_str, trigger, last, nodes);
                    req = req.body(interpolated);
                } else {
                    req = req.json(body_value);
                }
            }

            req = req.timeout(Duration::from_millis(timeout_ms));

            // D3: Use tokio::select! with cancellation token
            tokio::select! {
                result = req.send() => {
                    match result {
                        Ok(response) => {
                            let status = response.status().as_u16();

                            let mut headers_map = serde_json::Map::new();
                            for (key, value) in response.headers() {
                                if let Ok(value_str) = value.to_str() {
                                    headers_map.insert(
                                        key.to_string(),
                                        serde_json::Value::String(value_str.to_string()),
                                    );
                                }
                            }

                            let body_text = response
                                .text()
                                .await
                                .unwrap_or_else(|_| String::new());

                            Ok(NodeResult::ok(serde_json::json!({
                                "status": status,
                                "headers": headers_map,
                                "body": body_text,
                            })))
                        }
                        Err(e) => {
                            let error_msg = if e.is_timeout() {
                                format!("HTTP Request: timeout after {}ms", timeout_ms)
                            } else if e.is_connect() {
                                format!("HTTP Request: connection error - {}", e)
                            } else {
                                format!("HTTP Request: {}", e)
                            };
                            Err(anyhow::anyhow!(error_msg))
                        }
                    }
                }
                _ = input.cancel.cancelled() => {
                    Err(anyhow::anyhow!("HTTP Request: cancelled"))
                }
            }
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_http_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "core:http_request");
        assert_eq!(meta.tier, flow_common::node::NodeTier::Core);
        assert!(meta.config_schema.get("properties").unwrap().get("url").is_some());
    }

    #[tokio::test]
    async fn test_http_invalid_url_config() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = handler(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("missing or invalid 'url'"));
    }

    #[tokio::test]
    async fn test_http_invalid_method() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "url": "https://example.com",
                "method": "INVALID"
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = handler(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("unsupported method"));
    }

    #[tokio::test]
    async fn test_http_timeout_config() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "url": "https://httpbin.org/delay/10",
                "timeout_ms": 100,
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let _ = handler(input).await;
    }

    // C1: SSRF protection tests
    #[test]
    fn test_ssrf_blocks_localhost() {
        assert!(validate_url("http://localhost/admin").is_err());
        assert!(validate_url("http://localhost:8080/admin").is_err());
        assert!(validate_url("http://sub.localhost/admin").is_err());
    }

    #[test]
    fn test_ssrf_blocks_private_ips() {
        assert!(validate_url("http://127.0.0.1/").is_err());
        assert!(validate_url("http://10.0.0.1/").is_err());
        assert!(validate_url("http://172.16.0.1/").is_err());
        assert!(validate_url("http://192.168.1.1/").is_err());
        assert!(validate_url("http://169.254.169.254/latest/meta-data/").is_err());
        assert!(validate_url("http://0.0.0.0/").is_err());
    }

    #[test]
    fn test_ssrf_blocks_ipv6_loopback() {
        assert!(validate_url("http://[::1]/").is_err());
    }

    #[test]
    fn test_ssrf_allows_public_ips() {
        assert!(validate_url("https://example.com/api").is_ok());
        assert!(validate_url("https://8.8.8.8/").is_ok());
        assert!(validate_url("http://93.184.216.34/").is_ok());
    }

    #[test]
    fn test_ssrf_blocks_non_http_schemes() {
        assert!(validate_url("file:///etc/passwd").is_err());
        assert!(validate_url("ftp://internal/file").is_err());
        assert!(validate_url("gopher://evil.com/").is_err());
    }

    #[tokio::test]
    async fn test_ssrf_bypass_with_allow_private_ips() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "url": "http://127.0.0.1:9999/internal",
                "allow_private_ips": true,
                "timeout_ms": 100,
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        // Should not fail with SSRF error (will fail with connection error instead)
        let result = handler(input).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(!err.contains("private/internal"));
    }

    #[tokio::test]
    async fn test_ssrf_blocks_private_ip_in_handler() {
        let handler = handler();
        let input = NodeInput::new(
            serde_json::json!({
                "url": "http://169.254.169.254/latest/meta-data/",
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = handler(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("private/internal"));
    }

    #[tokio::test]
    async fn test_http_cancellation() {
        let handler = handler();
        let cancel = tokio_util::sync::CancellationToken::new();
        cancel.cancel(); // Pre-cancel

        let input = NodeInput {
            config: serde_json::json!({
                "url": "https://httpbin.org/delay/10",
                "timeout_ms": 30000,
            }),
            data: serde_json::json!({}),
            context_snapshot: serde_json::json!({}),
            cancel,
        };
        let result = handler(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("cancelled"));
    }
}
