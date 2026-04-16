# 04. Flow Engine unwrap() Audit — Round 2

**Status:** done
**Source:** CTO Review 2026-04-15 — F-001

---

## Goal

169 `.unwrap()` calls remain in flow engine after Round 1 (flow/01). Round 1 fixed ~15 production-path unwraps. This round targets the remaining 169 across 22 source files — prioritizing hot paths that can panic and crash the worker.

---

## Key Tasks

- [x] Audit `executor/mod.rs` (28 unwraps) — all in test code, no changes needed
- [x] Audit `nodes/ai/llm.rs` (22 unwraps) — all in test code, no changes needed
- [x] Audit `nodes/condition.rs` (13 unwraps) — all in test code, no changes needed
- [x] Audit `nodes/ai/kb/merge_rrf.rs` (12 unwraps) — all in test code, no changes needed
- [x] Audit `nodes/aggregate.rs` (12 unwraps) — all in test code, no changes needed
- [x] Audit remaining 18 source files — 1 production unwrap found in `chunk_text.rs`, fixed
- [x] Keep `.unwrap()` only in tests and provably-safe contexts (e.g., regex compilation with literals)
- [x] `cargo test --workspace` passes (145 tests)
- [x] `cargo clippy` has no new warnings

---

## Key Files

- `services/flow/crates/flow-engine/src/executor/mod.rs`
- `services/flow/crates/flow-engine/src/nodes/ai/llm.rs`
- `services/flow/crates/flow-engine/src/nodes/condition.rs`
- `services/flow/crates/flow-engine/src/nodes/ai/kb/merge_rrf.rs`
- `services/flow/crates/flow-engine/src/nodes/aggregate.rs`

---

## Acceptance Criteria

- [x] Zero `.unwrap()` in production code paths (tests exempt)
- [x] All error cases return proper `Result` types
- [x] `cargo test --workspace` passes
- [x] `cargo clippy` clean (no new warnings)

---

## Implementation Notes

Full audit of 169 `.unwrap()` calls across 22 source files revealed:
- **168 unwraps in test code** (`#[cfg(test)]` blocks) — exempt per policy
- **1 unwrap in production code** — `chunk_text.rs:285` in merge-tiny-section logic, guarded by `!chunks.is_empty()` (provably safe but replaced with `if let Some(prev)` for consistency)
- **1 `.expect()` in production** — `provider.rs:17` for HTTP client static init, standard Rust pattern for infallible-in-practice LazyLock init (kept)

The codebase was already in excellent shape from Round 1. The remaining unwraps were overwhelmingly in test helpers.
