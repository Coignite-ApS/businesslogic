# 01. Replace Production unwrap() with Error Handling

**Status:** completed
**Source:** CTO Review 2026-03-23 — F-008

---

## Goal

Replace `.unwrap()` calls in production Rust code paths with proper `?` operator or `.map_err()`. 157 total `.unwrap()` calls exist — most are in tests (acceptable), but ~15 are in production paths that would panic and crash workers.

---

## Key Tasks

- [x] Audit all `.unwrap()` in `services/flow/crates/flow-engine/src/` — replace production instances with `?` or `.map_err()`
- [x] Audit `services/flow/crates/flow-common/src/context.rs:212` — known production unwrap (in tests, no change needed)
- [x] Audit `services/flow/crates/flow-engine/src/nodes/formula.rs:215` — known production unwrap
- [x] Keep `.unwrap()` in tests and guaranteed-safe contexts (e.g., regex compilation with known-good patterns)
- [x] Run `cargo test --workspace` to verify no regressions

---

## Key Files

- `services/flow/crates/flow-engine/src/nodes/formula.rs`
- `services/flow/crates/flow-common/src/context.rs`
- `services/flow/crates/flow-engine/src/executor/mod.rs`

---

## Acceptance Criteria

- [x] Zero `.unwrap()` in production code paths (tests exempt)
- [x] All error cases return proper `Result` types instead of panicking
- [x] `cargo test --workspace` passes
- [x] `cargo clippy` has no new warnings
