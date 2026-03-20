# Creating New Nodes

This guide covers how to add a new node to the flow engine.

## File Structure

Every node lives in `crates/flow-engine/src/nodes/` and exports three things:

```
your_node.rs
├── metadata()  → NodeTypeMeta   (describes the node)
├── handler()   → NodeHandler    (executes the logic)
└── tests       → #[cfg(test)]   (unit tests)
```

## Step-by-Step

### 1. Create the file

`crates/flow-engine/src/nodes/your_node.rs`

### 2. Implement metadata

Metadata describes the node for the registry and future visual editor.

```rust
use super::NodeHandler;
use flow_common::node::{NodeInput, NodeResult, NodeTypeMeta, PortDef};
use std::sync::Arc;

pub fn metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "core:your_node".to_string(),
        name: "Human Readable Name".to_string(),
        description: "One sentence of what it does.".to_string(),
        category: "integration".to_string(),
        tier: flow_common::node::NodeTier::Core,
        inputs: vec![PortDef {
            name: "input".into(),
            data_type: "any".into(),
            required: false,
        }],
        outputs: vec![PortDef {
            name: "output".into(),
            data_type: "object".into(),
            required: true,
        }],
        config_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "your_setting": {
                    "type": "string",
                    "description": "What this setting does"
                }
            },
            "required": ["your_setting"],
            "additionalProperties": false
        }),
        estimated_cost_usd: 0.0,
    }
}
```

**Fields:**

| Field | Notes |
|-------|-------|
| `id` | Format: `core:snake_case`. Must be unique across registry. |
| `category` | One of: `utility`, `data`, `logic`, `integration`, `ai` |
| `tier` | `Core` for compiled Rust, `Wasm` for plugins, `External` for HTTP services |
| `config_schema` | JSON Schema — validated in the visual editor |
| `estimated_cost_usd` | Non-zero for LLM/AI nodes. Used for budget pre-checks. |

### 3. Implement handler

The handler is an async function wrapped in `Arc`. It receives `NodeInput` and returns `Result<NodeResult, anyhow::Error>`.

```rust
pub fn handler() -> NodeHandler {
    Arc::new(|input: NodeInput| {
        Box::pin(async move {
            // 1. Read config
            let setting = input.config.get("your_setting")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("YourNode: missing 'your_setting'"))?;

            // 2. Do work
            let result = do_something(setting).await?;

            // 3. Return
            Ok(NodeResult::ok(serde_json::json!({ "result": result })))
        })
    })
}
```

**NodeInput fields:**

| Field | Type | Description |
|-------|------|-------------|
| `config` | `serde_json::Value` | Node config from the flow definition |
| `data` | `serde_json::Value` | `$last` — output of most recent completed node |
| `context_snapshot` | `serde_json::Value` | Full serialized ExecutionContext |
| `cancel` | `CancellationToken` | Fires when flow is cancelled/timed out |

**NodeResult constructors:**

| Constructor | When |
|-------------|------|
| `NodeResult::ok(data)` | Simple output, no cost, no logs |
| `NodeResult::with_logs(data, vec!["...".into()])` | Output + debug logs |
| `NodeResult::with_cost(data, 0.003)` | Output + LLM cost tracking |

### 4. Register the node

In `crates/flow-engine/src/nodes/mod.rs`:

```rust
// Add module declaration (alphabetical order)
pub mod your_node;

// Inside register_core_nodes():
self.register("core:your_node", your_node::metadata(), your_node::handler());
```

### 5. Write tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_basic() {
        let h = handler();
        let input = NodeInput::new(
            serde_json::json!({"your_setting": "value"}),
            serde_json::json!({}),  // $last
            serde_json::json!({}),  // context snapshot
        );
        let result = h(input).await.unwrap();
        assert_eq!(result.data["result"], "value");
    }

    #[tokio::test]
    async fn test_missing_config() {
        let h = handler();
        let input = NodeInput::new(
            serde_json::json!({}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        assert!(h(input).await.is_err());
    }

    #[test]
    fn test_metadata() {
        let m = metadata();
        assert_eq!(m.id, "core:your_node");
    }
}
```

**Required test coverage:**
- Normal case with valid config
- Missing/invalid config returns error
- Edge cases specific to your node
- Metadata assertions

## Common Patterns

### Reading upstream context

```rust
use super::expression::{context_from_snapshot, resolve_value, interpolate_string};

// Full context access
let ctx = context_from_snapshot(&input.context_snapshot);
let trigger = &ctx.trigger;    // $trigger
let last = &ctx.last;          // $last (Option<Value>)
let nodes = &ctx.nodes;        // $nodes map

// Resolve a config value that might be an expression
let resolved = resolve_value(
    input.config.get("source").unwrap(),
    trigger, last, nodes,
);

// Interpolate {{$trigger.x}} in strings
let url = interpolate_string(url_template, trigger, last, nodes);
```

### Cooperative cancellation

For any node that does I/O or long computation:

```rust
tokio::select! {
    result = do_io_work() => {
        // process result
    }
    _ = input.cancel.cancelled() => {
        Err(anyhow::anyhow!("YourNode: cancelled"))
    }
}
```

### Feature-gating

For nodes with heavy optional dependencies:

```rust
// In the node file:
#[cfg(feature = "your_feature")]
// ... entire file contents

// In Cargo.toml:
your_dep = { workspace = true, optional = true }

// In features section:
your_feature = ["dep:your_dep"]

// In nodes/mod.rs:
#[cfg(feature = "your_feature")]
pub mod your_node;

// In register_core_nodes():
#[cfg(feature = "your_feature")]
self.register("core:your_node", your_node::metadata(), your_node::handler());
```

### Error message convention

Prefix errors with the node name for traceability:

```rust
Err(anyhow::anyhow!("YourNode: missing 'url' config"))
Err(anyhow::anyhow!("YourNode: connection failed - {}", e))
```

## Checklist

- [ ] File created at `nodes/your_node.rs`
- [ ] `metadata()` with valid config_schema
- [ ] `handler()` with proper error handling
- [ ] Module declared in `nodes/mod.rs`
- [ ] Registered in `register_core_nodes()`
- [ ] Tests: normal case, error case, metadata
- [ ] `cargo test --workspace` passes
- [ ] `cargo clippy --workspace -- -D warnings` clean
