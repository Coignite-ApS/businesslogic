# Usage Events Pipeline

Canonical billable-event log for the BusinessLogic platform.
Every service emits rows here for every billable action.
The CMS consumer drains the stream and inserts into `public.usage_events`.

## Flow

```
Service (formula-api | ai-api | flow)
  │
  │ emitUsageEvent() — fire-and-forget, never throws
  ▼
Redis Stream: bl:usage_events:in   (MAXLEN ~ 100_000)
  │
  │ XREADGROUP — cms-consumer group, batch 100, BLOCK 1s
  ▼
project-extension-usage-consumer (Directus hook)
  │
  │ Batch INSERT into public.usage_events (cost_eur = NULL)
  │ XACK after commit
  ▼
public.usage_events   ←  task 21 aggregator computes cost_eur
```

## Event Kinds

| Service     | event_kind       | quantity       | metadata keys                                              |
|-------------|------------------|----------------|------------------------------------------------------------|
| formula-api | `calc.call`      | 1              | `formula_id`, `duration_ms`, `inputs_size_bytes`           |
| ai-api (KB) | `kb.search`      | 1              | `kb_id`, `query`, `results_count`                          |
| ai-api (KB) | `kb.ask`         | 1              | `kb_id`, `query`, `model`, `input_tokens`, `output_tokens` |
| ai-api      | `ai.message`     | total tokens   | `model`, `conversation_id`, `input_tokens`, `output_tokens`|
| ai-api      | `embed.tokens`   | token_count    | `model`, `kb_id`, `doc_id`                                 |
| flow        | `flow.execution` | 1              | `flow_id`, `duration_ms`, `status`                         |
| flow        | `flow.step`      | 1              | `flow_id`, `step_id`, `step_kind`, `duration_ms`           |
| flow        | `flow.failed`    | 1              | `flow_id`, `step_id`, `error`                              |

All events include: `account_id`, `api_key_id` (or null), `module`, `cost_eur` (always NULL from emitters).

## Canonical Schema Reference

`packages/bl-events/` — **NOT imported at runtime**. It is a schema reference only.

- `src/types.ts` — canonical `UsageEventEnvelope` TypeScript types
- `src/emit.ts` — reference `emitUsageEvent` / `buildEvent` implementation
- `test/fixtures/envelope-samples.json` — **canonical JSON fixture**: one sample per event kind; both TS and Rust suites assert against it. Task 21 must parse envelopes matching this shape.

Each JS service inlines its own emit helper (`src/services/usage-events.js`) derived from `src/emit.ts`.
The Rust flow service mirrors the shape in `flow-common/src/usage_events.rs`.
The CMS consumer (`project-extension-usage-consumer`) declares `USAGE_STREAM_KEY` itself.

See `packages/bl-events/README.md` for inlining policy.

## Backpressure

- Stream capped at `MAXLEN ~ 100_000` (approximate trim, fast). Each emitter uses this.
- If Redis is unavailable, `emitUsageEvent` logs WARN, increments `droppedEventCount`, returns without throwing.
- Consumer reads 100 messages per tick, inserts in one batch, ACKs after commit.
- On DB failure: consumer logs error, sleeps 2s, retries. Messages remain in Redis PEL for redelivery.

## Consumer (CMS Extension)

`services/cms/extensions/local/project-extension-usage-consumer/`

- Hook type: `hook` (runs on Directus boot via `app.before`)
- Consumer group: `cms-consumer`, consumer name: `cms-consumer-1`
- MKSTREAM: group created idempotently on startup
- BLOCK 1s per tick — avoids busy-loop
- Batch INSERT: one `INSERT ... VALUES (...)` per batch (uses knex `insert`)
- XACK issued only after successful DB commit
- Graceful shutdown: `SIGTERM` / `SIGINT` signal loop to stop

## Schema

`public.usage_events` (created by migration `009_pricing_v2_usage_events.sql`):

```sql
id          bigserial PRIMARY KEY
account_id  uuid NOT NULL REFERENCES public.account(id)
api_key_id  uuid  -- no FK (keys can be revoked, history must persist)
module      module_kind NOT NULL
event_kind  text NOT NULL
quantity    numeric(20,6) NOT NULL DEFAULT 1
cost_eur    numeric(12,6)  -- NULL until task 21 aggregator runs
metadata    jsonb
occurred_at timestamptz NOT NULL DEFAULT now()
aggregated_at timestamptz  -- NULL until task 21 sets it
```

## Cost Calculation

`cost_eur = NULL` from all emitters. Task 21 (`monthly_aggregates` rollup job) reads
unaggregated rows (`aggregated_at IS NULL`) and computes cost from `metadata` fields
using per-model rates from `ai_model_config` and plan rates from `subscription_plans`.

## Build

```bash
make ext-usage-consumer    # build single extension
make ext                   # build all extensions (includes this one)
make cms-restart           # build all + restart CMS
```

## Test

```bash
# unit tests (consumer.ts pure functions)
cd services/cms/extensions/local/project-extension-usage-consumer && npm test

# bl-events package tests (emit + envelope shape contract)
cd packages/bl-events && npm test

# formula-api emitter tests
cd services/formula-api && node --test test/usage-events.test.js

# ai-api emitter tests
cd services/ai-api && node --test test/usage-events.test.js

# Rust: flow-common unit + envelope shape contract (reads fixture from packages/bl-events)
cd services/flow && cargo test -p flow-common
```
