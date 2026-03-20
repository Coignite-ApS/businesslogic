//! Script node — executes sandboxed JavaScript via rquickjs.
//!
//! Each execution gets a fresh runtime (no state leakage between runs).
//! Memory limit: 64MB. Stack limit: 1MB. CPU timeout via interrupt handler.

#![cfg(feature = "scripting")]

use super::NodeHandler;
use flow_common::node::{RequiredRole, NodeInput, NodeResult, NodeTypeMeta, PortDef};
use std::sync::Arc;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "core:script".to_string(),
        name: "Script".to_string(),
        description: "Execute JavaScript code with access to flow context variables.".to_string(),
        category: "utility".to_string(),
        tier: flow_common::node::NodeTier::Core,
        inputs: vec![PortDef {
            name: "input".to_string(),
            data_type: "any".to_string(),
            required: false,
        }],
        outputs: vec![PortDef {
            name: "output".to_string(),
            data_type: "any".to_string(),
            required: true,
        }],
        config_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "code": { "type": "string", "description": "JavaScript code to execute" },
                "timeout_ms": { "type": "integer", "default": 100, "description": "CPU time limit in milliseconds" }
            },
            "required": ["code"]
        }),
        estimated_cost_usd: 0.0,
        required_role: RequiredRole::default(),
    }
}

pub fn handler() -> NodeHandler {
    Arc::new(|input: NodeInput| {
        Box::pin(async move { execute_script(input).await })
    })
}

async fn execute_script(input: NodeInput) -> Result<NodeResult, anyhow::Error> {
    let code = input
        .config
        .get("code")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("script node requires 'code' config"))?
        .to_string();

    let timeout_ms = input
        .config
        .get("timeout_ms")
        .and_then(|v| v.as_u64())
        .unwrap_or(100);

    // Extract context variables for injection
    let ctx = super::expression::context_from_snapshot(&input.context_snapshot);
    let trigger_json = serde_json::to_string(&ctx.trigger)?;
    let last_json = serde_json::to_string(&ctx.last)?;
    let nodes_json = serde_json::to_string(&ctx.nodes)?;
    let env_json = serde_json::to_string(&ctx.env)?;

    // Run JS in a blocking task since rquickjs Runtime is not Send across
    // await points, but the sync API works fine inside spawn_blocking.
    let result = tokio::task::spawn_blocking(move || {
        run_js_sync(&code, timeout_ms, &trigger_json, &last_json, &nodes_json, &env_json)
    })
    .await??;

    Ok(result)
}

fn run_js_sync(
    code: &str,
    timeout_ms: u64,
    trigger_json: &str,
    last_json: &str,
    nodes_json: &str,
    env_json: &str,
) -> Result<NodeResult, anyhow::Error> {
    let rt = rquickjs::Runtime::new()?;
    rt.set_memory_limit(64 * 1024 * 1024);
    rt.set_max_stack_size(1024 * 1024);

    // Interrupt handler for CPU timeout
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_millis(timeout_ms);
    rt.set_interrupt_handler(Some(Box::new(move || start.elapsed() > timeout)));

    let ctx = rquickjs::Context::full(&rt)?;

    ctx.with(|ctx| {
        let globals = ctx.globals();

        // Inject frozen context variables
        inject_frozen_global(&ctx, &globals, "$trigger", trigger_json)?;
        inject_frozen_global(&ctx, &globals, "$last", last_json)?;
        inject_frozen_global(&ctx, &globals, "$nodes", nodes_json)?;
        inject_frozen_global(&ctx, &globals, "$env", env_json)?;

        // Inject console.log that captures to an array
        let setup_console = r#"
            var __logs = [];
            var console = Object.freeze({
                log: function() {
                    var parts = [];
                    for (var i = 0; i < arguments.length; i++) {
                        var v = arguments[i];
                        parts.push(typeof v === 'object' ? JSON.stringify(v) : String(v));
                    }
                    __logs.push(parts.join(' '));
                }
            });
        "#;
        ctx.eval::<(), _>(setup_console)
            .map_err(|e| anyhow::anyhow!("console setup failed: {e}"))?;

        // Evaluate user code
        let result: rquickjs::Value = ctx
            .eval(code)
            .map_err(|e| anyhow::anyhow!("script execution failed: {e}"))?;

        // Convert result to JSON
        let data = js_value_to_json(&ctx, &result)?;

        // Collect console.log output
        let logs_val: rquickjs::Value = ctx
            .eval("__logs")
            .map_err(|e| anyhow::anyhow!("failed to read logs: {e}"))?;
        let logs = js_array_to_strings(&ctx, &logs_val);

        if logs.is_empty() {
            Ok(NodeResult::ok(data))
        } else {
            Ok(NodeResult::with_logs(data, logs))
        }
    })
}

/// Parse JSON string and freeze it as a global variable.
fn inject_frozen_global<'js>(
    ctx: &rquickjs::Ctx<'js>,
    globals: &rquickjs::Object<'js>,
    name: &str,
    json_str: &str,
) -> Result<(), anyhow::Error> {
    // Parse the JSON string into a JS value, then freeze and assign to global
    let parse_code = format!(
        "Object.freeze(JSON.parse({}))",
        serde_json::to_string(json_str)?
    );
    let val: rquickjs::Value = ctx
        .eval(parse_code.as_bytes())
        .map_err(|e| anyhow::anyhow!("failed to inject {name}: {e}"))?;
    globals
        .set(name, val)
        .map_err(|e| anyhow::anyhow!("failed to set global {name}: {e}"))?;
    Ok(())
}

/// Convert a rquickjs Value to serde_json::Value.
fn js_value_to_json<'js>(
    ctx: &rquickjs::Ctx<'js>,
    val: &rquickjs::Value<'js>,
) -> Result<serde_json::Value, anyhow::Error> {
    if val.is_undefined() || val.is_null() {
        return Ok(serde_json::Value::Null);
    }
    if let Some(b) = val.as_bool() {
        return Ok(serde_json::Value::Bool(b));
    }
    if let Some(n) = val.as_int() {
        return Ok(serde_json::json!(n));
    }
    if let Some(n) = val.as_float() {
        // Check for integer-valued floats
        if n.fract() == 0.0 && n.abs() < (i64::MAX as f64) {
            return Ok(serde_json::json!(n as i64));
        }
        return Ok(serde_json::json!(n));
    }
    if let Some(s) = val.as_string() {
        let s = s
            .to_string()
            .map_err(|e| anyhow::anyhow!("string conversion: {e}"))?;
        return Ok(serde_json::Value::String(s));
    }

    // For objects/arrays, round-trip through JSON.stringify
    let stringify_code = "JSON.stringify";
    let stringify_fn: rquickjs::Value = ctx
        .eval(stringify_code)
        .map_err(|e| anyhow::anyhow!("JSON.stringify lookup: {e}"))?;
    let stringify_fn = stringify_fn
        .as_function()
        .ok_or_else(|| anyhow::anyhow!("JSON.stringify is not a function"))?;

    let json_str: rquickjs::Value = stringify_fn
        .call((val.clone(),))
        .map_err(|e| anyhow::anyhow!("JSON.stringify failed: {e}"))?;

    if json_str.is_undefined() {
        return Ok(serde_json::Value::Null);
    }

    let s = json_str
        .as_string()
        .ok_or_else(|| anyhow::anyhow!("JSON.stringify returned non-string"))?
        .to_string()
        .map_err(|e| anyhow::anyhow!("stringify result conversion: {e}"))?;

    serde_json::from_str(&s).map_err(|e| anyhow::anyhow!("JSON parse: {e}"))
}

/// Extract string array from a JS array value.
fn js_array_to_strings<'js>(_ctx: &rquickjs::Ctx<'js>, val: &rquickjs::Value<'js>) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(arr) = val.as_array() {
        for i in 0..arr.len() {
            if let Ok(item) = arr.get::<rquickjs::Value>(i) {
                if let Some(s) = item.as_string() {
                    if let Ok(s) = s.to_string() {
                        out.push(s);
                    }
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    fn empty_snapshot() -> serde_json::Value {
        let ctx = flow_common::context::ExecutionContext::new(
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            serde_json::Value::Null,
            HashMap::new(),
        );
        serde_json::to_value(&ctx).unwrap()
    }

    fn snapshot_with_trigger(trigger: serde_json::Value) -> serde_json::Value {
        let ctx = flow_common::context::ExecutionContext::new(
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            uuid::Uuid::nil(),
            trigger,
            HashMap::new(),
        );
        serde_json::to_value(&ctx).unwrap()
    }

    #[tokio::test]
    async fn test_basic_eval() {
        let h = handler();
        let input = NodeInput::new(
            json!({"code": "1 + 2"}),
            json!(null),
            empty_snapshot(),
        );
        let result = h(input).await.unwrap();
        assert_eq!(result.data, json!(3));
        assert!(result.logs.is_empty());
    }

    #[tokio::test]
    async fn test_context_injection() {
        let h = handler();
        let snapshot = snapshot_with_trigger(json!({"x": 42}));
        let input = NodeInput::new(
            json!({"code": "$trigger.x"}),
            json!(null),
            snapshot,
        );
        let result = h(input).await.unwrap();
        assert_eq!(result.data, json!(42));
    }

    #[tokio::test]
    async fn test_console_log_capture() {
        let h = handler();
        let input = NodeInput::new(
            json!({"code": "console.log('hello', 'world'); 42"}),
            json!(null),
            empty_snapshot(),
        );
        let result = h(input).await.unwrap();
        assert_eq!(result.data, json!(42));
        assert_eq!(result.logs, vec!["hello world".to_string()]);
    }

    #[tokio::test]
    async fn test_missing_code_config() {
        let h = handler();
        let input = NodeInput::new(
            json!({}),
            json!(null),
            empty_snapshot(),
        );
        let err = h(input).await.unwrap_err();
        assert!(err.to_string().contains("code"));
    }

    #[tokio::test]
    async fn test_return_object() {
        let h = handler();
        let input = NodeInput::new(
            json!({"code": "({a: 1, b: 'hello'})"}),
            json!(null),
            empty_snapshot(),
        );
        let result = h(input).await.unwrap();
        assert_eq!(result.data, json!({"a": 1, "b": "hello"}));
    }

    #[tokio::test]
    async fn test_return_array() {
        let h = handler();
        let input = NodeInput::new(
            json!({"code": "[1, 2, 3]"}),
            json!(null),
            empty_snapshot(),
        );
        let result = h(input).await.unwrap();
        assert_eq!(result.data, json!([1, 2, 3]));
    }

    #[tokio::test]
    async fn test_syntax_error() {
        let h = handler();
        let input = NodeInput::new(
            json!({"code": "function("}),
            json!(null),
            empty_snapshot(),
        );
        let err = h(input).await.unwrap_err();
        assert!(err.to_string().contains("script execution failed"));
    }

    #[tokio::test]
    async fn test_timeout() {
        let h = handler();
        let input = NodeInput::new(
            json!({"code": "while(true) {}", "timeout_ms": 10}),
            json!(null),
            empty_snapshot(),
        );
        let err = h(input).await.unwrap_err();
        assert!(err.to_string().contains("script execution failed")
            || err.to_string().contains("Interrupted"));
    }

    #[tokio::test]
    async fn test_metadata() {
        let meta = metadata();
        assert_eq!(meta.id, "core:script");
        assert_eq!(meta.category, "utility");
        assert_eq!(meta.estimated_cost_usd, 0.0);
    }
}
