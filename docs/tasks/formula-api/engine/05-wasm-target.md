# 05. WASM Target

**Status:** idea
**Category:** Developer Experience

---

## Goal

Compile bl-excel to WebAssembly for browser-side formula evaluation. Would enable client-side preview without server round-trip. Need to abstract napi-rs-specific code and add wasm-bindgen bindings.

---

## Key Tasks

- [ ] Feature-gate napi-rs code
- [ ] Add wasm-bindgen bindings
- [ ] Test in browser
- [ ] Publish npm package with WASM
