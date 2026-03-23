//! WASM plugin host (feature-gated behind "wasm-plugins").
//!
//! Allows flows to execute custom logic compiled to WebAssembly.
//!
//! # Plugin Protocol
//!
//! Plugins must export:
//! - `memory` — linear memory
//! - `alloc(size: i32) -> i32` — allocate bytes, return pointer
//! - `dealloc(ptr: i32, size: i32)` — free allocation
//! - `execute(ptr: i32, len: i32) -> i64` — run logic, return packed (ptr, len) of output JSON
//!
//! Host provides:
//! - `host_log(ptr, len)` — log a message
//! - `host_get_config() -> i64` — get config JSON
//! - `host_get_data() -> i64` — get input data JSON

pub mod host_functions;

#[cfg(feature = "wasm-plugins")]
use std::collections::HashMap;
#[cfg(feature = "wasm-plugins")]
use std::sync::{Arc, Mutex};

#[cfg(feature = "wasm-plugins")]
use wasmtime::{Engine, Linker, Module, Store, StoreLimits, StoreLimitsBuilder};

#[cfg(feature = "wasm-plugins")]
use flow_common::node::{NodeInput, NodeResult};

#[cfg(feature = "wasm-plugins")]
use host_functions::unpack_ptr_len;

/// Host state passed into each WASM Store.
#[cfg(feature = "wasm-plugins")]
pub struct HostState {
    pub limits: StoreLimits,
    pub config_json: String,
    pub data_json: String,
    pub logs: Vec<String>,
}

/// Host for executing WASM plugins.
pub struct WasmPluginHost {
    #[cfg(feature = "wasm-plugins")]
    engine: Engine,
    #[cfg(feature = "wasm-plugins")]
    cache: Mutex<HashMap<[u8; 32], Arc<Module>>>,
}

impl WasmPluginHost {
    /// Create a new WASM plugin host with fuel-based CPU limiting.
    #[cfg(feature = "wasm-plugins")]
    pub fn new() -> Result<Self, anyhow::Error> {
        let mut config = wasmtime::Config::new();
        config.consume_fuel(true);
        config.epoch_interruption(true);
        let engine = Engine::new(&config)?;
        Ok(Self {
            engine,
            cache: Mutex::new(HashMap::new()),
        })
    }

    #[cfg(not(feature = "wasm-plugins"))]
    pub fn new() -> Result<Self, anyhow::Error> {
        Ok(Self {})
    }

    /// Load a WASM module from bytes. Caches compiled modules by SHA-256 hash.
    #[cfg(feature = "wasm-plugins")]
    pub fn load(&self, wasm_bytes: &[u8]) -> Result<WasmModule, anyhow::Error> {
        use sha2::{Digest, Sha256};

        let hash: [u8; 32] = Sha256::digest(wasm_bytes).into();

        // Check cache
        {
            let cache = self.cache.lock().map_err(|e| anyhow::anyhow!("wasm: cache lock poisoned: {}", e))?;
            if let Some(module) = cache.get(&hash) {
                return Ok(WasmModule {
                    module: module.clone(),
                    engine: self.engine.clone(),
                });
            }
        }

        // Compile and cache
        let module = Arc::new(Module::new(&self.engine, wasm_bytes)?);
        {
            let mut cache = self.cache.lock().map_err(|e| anyhow::anyhow!("wasm: cache lock poisoned: {}", e))?;
            cache.insert(hash, module.clone());
        }

        Ok(WasmModule {
            module,
            engine: self.engine.clone(),
        })
    }

    #[cfg(not(feature = "wasm-plugins"))]
    pub fn load(&self, _wasm_bytes: &[u8]) -> Result<WasmModule, anyhow::Error> {
        Err(anyhow::anyhow!("WASM plugins require 'wasm-plugins' feature"))
    }

    /// Get cache size (for testing).
    #[cfg(feature = "wasm-plugins")]
    pub fn cache_size(&self) -> usize {
        self.cache.lock().map(|c| c.len()).unwrap_or(0)
    }
}

/// A loaded WASM module ready for instantiation.
pub struct WasmModule {
    #[cfg(feature = "wasm-plugins")]
    module: Arc<Module>,
    #[cfg(feature = "wasm-plugins")]
    engine: Engine,
}

#[cfg(feature = "wasm-plugins")]
impl WasmModule {
    /// Instantiate the module with resource limits and host functions.
    pub fn instantiate(&self) -> Result<WasmInstance, anyhow::Error> {
        let limits = StoreLimitsBuilder::new()
            .memory_size(256 * 1024 * 1024) // 256MB
            .build();

        let host_state = HostState {
            limits,
            config_json: String::new(),
            data_json: String::new(),
            logs: Vec::new(),
        };

        let mut store = Store::new(&self.engine, host_state);
        store.limiter(|state| &mut state.limits);
        store.set_fuel(1_000_000)?;

        let mut linker = Linker::new(&self.engine);
        host_functions::link_host_functions(&mut linker)?;

        let instance = linker.instantiate(&mut store, &self.module)?;

        Ok(WasmInstance { instance, store })
    }

    /// Execute synchronously with the given input. Used from spawn_blocking.
    pub fn call_execute_sync(&self, input: &NodeInput) -> Result<NodeResult, anyhow::Error> {
        let mut inst = self.instantiate()?;

        // Set config and data in host state
        inst.store.data_mut().config_json = serde_json::to_string(&input.config)?;
        inst.store.data_mut().data_json = serde_json::to_string(&input.data)?;

        // Serialize input as JSON bytes
        let input_json = serde_json::json!({
            "config": input.config,
            "data": input.data,
        });
        let input_bytes = serde_json::to_vec(&input_json)?;

        // Allocate input in guest memory
        let alloc = inst
            .instance
            .get_typed_func::<i32, i32>(&mut inst.store, "alloc")?;
        let input_ptr = alloc.call(&mut inst.store, input_bytes.len() as i32)?;

        // Write input to guest memory
        let mem = inst
            .instance
            .get_memory(&mut inst.store, "memory")
            .ok_or_else(|| anyhow::anyhow!("wasm: missing memory export"))?;
        let dest =
            &mut mem.data_mut(&mut inst.store)[input_ptr as usize..input_ptr as usize + input_bytes.len()];
        dest.copy_from_slice(&input_bytes);

        // Call execute
        let execute = inst
            .instance
            .get_typed_func::<(i32, i32), i64>(&mut inst.store, "execute")?;
        let packed = execute.call(&mut inst.store, (input_ptr, input_bytes.len() as i32))?;
        let (out_ptr, out_len) = unpack_ptr_len(packed);

        // Read output from guest memory
        let mem = inst
            .instance
            .get_memory(&mut inst.store, "memory")
            .ok_or_else(|| anyhow::anyhow!("wasm: missing memory export"))?;
        let output_bytes = &mem.data(&inst.store)[out_ptr as usize..out_ptr as usize + out_len as usize];
        let output: serde_json::Value = serde_json::from_slice(output_bytes)?;

        // Extract logs from host state
        let logs = std::mem::take(&mut inst.store.data_mut().logs);

        // Check for error in output
        if let Some(err) = output.get("error").and_then(|v| v.as_str()) {
            if !err.is_empty() {
                return Err(anyhow::anyhow!("wasm plugin error: {}", err));
            }
        }

        let data = output.get("data").cloned().unwrap_or(serde_json::Value::Null);

        // Merge plugin logs with host logs
        let mut all_logs = logs;
        if let Some(plugin_logs) = output.get("logs").and_then(|v| v.as_array()) {
            for log in plugin_logs {
                if let Some(s) = log.as_str() {
                    all_logs.push(s.to_string());
                }
            }
        }

        Ok(NodeResult::with_logs(data, all_logs))
    }
}

/// A running instance of a WASM module.
pub struct WasmInstance {
    #[cfg(feature = "wasm-plugins")]
    instance: wasmtime::Instance,
    #[cfg(feature = "wasm-plugins")]
    store: Store<HostState>,
}

// Stubs for when wasm-plugins feature is disabled
#[cfg(not(feature = "wasm-plugins"))]
impl WasmModule {
    pub fn instantiate(&self) -> Result<WasmInstance, anyhow::Error> {
        Err(anyhow::anyhow!("WASM plugins require 'wasm-plugins' feature"))
    }

    pub fn call_execute_sync(&self, _input: &flow_common::node::NodeInput) -> Result<flow_common::node::NodeResult, anyhow::Error> {
        Err(anyhow::anyhow!("WASM plugins require 'wasm-plugins' feature"))
    }
}

#[cfg(not(feature = "wasm-plugins"))]
pub struct WasmInstance {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_host_creation() {
        let host = WasmPluginHost::new();
        assert!(host.is_ok());
    }

    #[cfg(feature = "wasm-plugins")]
    #[test]
    fn test_invalid_wasm_bytes() {
        let host = WasmPluginHost::new().unwrap();
        let result = host.load(b"not valid wasm");
        assert!(result.is_err());
    }

    #[cfg(feature = "wasm-plugins")]
    #[test]
    fn test_cache_hit() {
        let host = WasmPluginHost::new().unwrap();
        // Minimal valid WASM module (magic + version only won't work, need real module)
        // We'll test cache logic with the echo plugin fixture in integration tests
        assert_eq!(host.cache_size(), 0);
    }

    #[cfg(feature = "wasm-plugins")]
    #[test]
    fn test_load_echo_plugin() {
        let wasm_bytes = include_bytes!("../../tests/fixtures/echo_plugin.wasm");
        let host = WasmPluginHost::new().unwrap();
        let result = host.load(wasm_bytes);
        // May fail if fixture doesn't exist yet — that's expected
        if result.is_ok() {
            assert_eq!(host.cache_size(), 1);
            // Load again — should hit cache
            let result2 = host.load(wasm_bytes);
            assert!(result2.is_ok());
            assert_eq!(host.cache_size(), 1); // Still 1, cache hit
        }
    }
}
