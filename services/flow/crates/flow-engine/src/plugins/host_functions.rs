//! Host functions exposed to WASM plugins.
//!
//! These functions are linked into the WASM module's import table and allow
//! plugins to interact with the host runtime (logging, reading config/data).

#[cfg(feature = "wasm-plugins")]
use wasmtime::{AsContext, AsContextMut, Caller, Linker};

#[cfg(feature = "wasm-plugins")]
use super::HostState;

/// Link all host functions into the WASM linker.
#[cfg(feature = "wasm-plugins")]
pub fn link_host_functions(linker: &mut Linker<HostState>) -> Result<(), anyhow::Error> {
    // host_log(ptr, len) — log a message from guest memory
    linker.func_wrap("env", "host_log", |mut caller: Caller<'_, HostState>, ptr: i32, len: i32| {
        let mem = caller
            .get_export("memory")
            .and_then(|e| e.into_memory())
            .ok_or_else(|| wasmtime::Error::msg("missing memory export"))?;

        let data = mem.data(&caller);
        let start = ptr as usize;
        let end = start + len as usize;
        if end > data.len() {
            return Err(wasmtime::Error::msg("host_log: out of bounds"));
        }

        let message = String::from_utf8_lossy(&data[start..end]).to_string();
        tracing::info!(target: "wasm_plugin", "{}", message);
        caller.data_mut().logs.push(message);
        Ok(())
    })?;

    // host_get_config() -> i64 — returns packed (ptr, len) of config JSON in guest memory
    linker.func_wrap("env", "host_get_config", |mut caller: Caller<'_, HostState>| -> Result<i64, wasmtime::Error> {
        let json = caller.data().config_json.clone();
        write_to_guest(&mut caller, json.as_bytes())
    })?;

    // host_get_data() -> i64 — returns packed (ptr, len) of data JSON in guest memory
    linker.func_wrap("env", "host_get_data", |mut caller: Caller<'_, HostState>| -> Result<i64, wasmtime::Error> {
        let json = caller.data().data_json.clone();
        write_to_guest(&mut caller, json.as_bytes())
    })?;

    Ok(())
}

/// Write bytes to guest memory via the guest's `alloc` export.
/// Returns packed i64: high 32 = ptr, low 32 = len.
#[cfg(feature = "wasm-plugins")]
fn write_to_guest(caller: &mut Caller<'_, HostState>, bytes: &[u8]) -> Result<i64, wasmtime::Error> {
    let alloc = caller
        .get_export("alloc")
        .and_then(|e| e.into_func())
        .ok_or_else(|| wasmtime::Error::msg("missing alloc export"))?;

    let alloc_fn = alloc.typed::<i32, i32>(caller.as_context())?;
    let ptr = alloc_fn.call(caller.as_context_mut(), bytes.len() as i32)?;

    let mem = caller
        .get_export("memory")
        .and_then(|e| e.into_memory())
        .ok_or_else(|| wasmtime::Error::msg("missing memory export"))?;

    let dest = &mut mem.data_mut(caller.as_context_mut())[ptr as usize..ptr as usize + bytes.len()];
    dest.copy_from_slice(bytes);

    Ok(pack_ptr_len(ptr, bytes.len() as i32))
}

/// Pack pointer and length into a single i64.
#[cfg(feature = "wasm-plugins")]
pub(crate) fn pack_ptr_len(ptr: i32, len: i32) -> i64 {
    ((ptr as i64) << 32) | (len as u32 as i64)
}

/// Unpack pointer and length from a packed i64.
#[cfg(feature = "wasm-plugins")]
pub(crate) fn unpack_ptr_len(packed: i64) -> (i32, i32) {
    let ptr = (packed >> 32) as i32;
    let len = packed as i32;
    (ptr, len)
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "wasm-plugins")]
    use super::*;

    #[cfg(feature = "wasm-plugins")]
    #[test]
    fn test_pack_unpack() {
        let (ptr, len) = (1024, 256);
        let packed = pack_ptr_len(ptr, len);
        let (p, l) = unpack_ptr_len(packed);
        assert_eq!(p, ptr);
        assert_eq!(l, len);
    }

    #[cfg(feature = "wasm-plugins")]
    #[test]
    fn test_pack_zero() {
        let packed = pack_ptr_len(0, 0);
        let (p, l) = unpack_ptr_len(packed);
        assert_eq!(p, 0);
        assert_eq!(l, 0);
    }

    #[cfg(feature = "wasm-plugins")]
    #[test]
    fn test_pack_large_values() {
        let packed = pack_ptr_len(65536, 8192);
        let (p, l) = unpack_ptr_len(packed);
        assert_eq!(p, 65536);
        assert_eq!(l, 8192);
    }
}
