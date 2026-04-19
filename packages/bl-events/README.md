# @coignite/bl-events — Canonical Schema Reference

**Not imported at runtime by any service.** Services (`formula-api`, `ai-api`) inline their own emit helpers based on this spec.

## Purpose

- `src/types.ts` — canonical TypeScript types for `UsageEventEnvelope` and all metadata shapes
- `src/emit.ts` — reference implementation of `emitUsageEvent` / `buildEvent`
- `test/` — TS-side emit tests; fixture used by cross-language contract tests

## Schema Contract

`packages/bl-events/test/fixtures/envelope-samples.json` is the **canonical JSON fixture** for all 8 event kinds. Both the TypeScript and Rust suites assert against it. Task 21's aggregator must parse envelopes that match this shape.

## Inlining Policy

Each JS service inlines `USAGE_STREAM_KEY`, `buildEvent`, `emitUsageEvent`, and `getDroppedEventCount` in its own `src/services/usage-events.js`. Changes to the canonical spec here must be manually reflected in:

- `services/formula-api/src/services/usage-events.js`
- `services/ai-api/src/services/usage-events.js`
- `services/flow/crates/flow-common/src/usage_events.rs` (Rust)
- `services/cms/extensions/local/project-extension-usage-consumer/src/consumer.ts` (consumer)

See `docs/architecture/usage-events.md` for full pipeline diagram.
