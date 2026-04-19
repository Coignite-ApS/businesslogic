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

## Monthly Aggregates Rollup (Task 21)

`public.aggregate_usage_events()` — PL/pgSQL function (migration 030) called hourly by the CMS consumer hook.

### Behavior
1. Selects rows where `aggregated_at IS NULL`, groups by `(account_id, period_yyyymm)`.
2. UPSERTs per-kind counters into `public.monthly_aggregates` (additive: `existing + EXCLUDED`).
3. Sets `aggregated_at = NOW()` on processed rows — in the same transaction.
4. Returns `jsonb { events_aggregated, accounts_touched, periods_touched, lag_seconds }`.

### Schedule
- Hourly cron: `0 * * * *` via `schedule()` in `project-extension-usage-consumer/src/index.ts`.
- On-boot run via `app.after` init hook — avoids up-to-1h wait on restart.

### Idempotency
- `aggregated_at IS NULL` filter ensures already-processed rows are skipped.
- Re-running the job when all rows are marked produces `events_aggregated=0`, no double-counts.

### Monitoring
Structured log line after each run:
```
[usage-consumer] monthly_aggregates rollup: done — events_aggregated=N accounts_touched=N periods_touched=N lag_seconds=N
```
`lag_seconds` = `NOW() - MIN(occurred_at)` of oldest unaggregated event before the run. Target: < 3600s (hourly schedule).

### Schema reference
`public.monthly_aggregates` composite PK `(account_id, period_yyyymm)` — 19 columns.
Not tracked by Directus admin UI (composite PK limitation — see Task 25 follow-up).

## Cost Calculation

`cost_eur = NULL` from all emitters. The `aggregate_usage_events()` function sums `cost_eur`
from event rows into `total_cost_eur` and `ai_cost_eur` in `monthly_aggregates`.
Per-call cost is set by services when emitting (ai-api, formula-api) rather than by the aggregator.

## Build

```bash
make ext-usage-consumer    # build single extension
make ext                   # build all extensions (includes this one)
make cms-restart           # build all + restart CMS
```

## Test

```bash
# unit tests (consumer.ts + cron.ts pure functions)
cd services/cms/extensions/local/project-extension-usage-consumer && npm test

# E2E cron test (aggregate_usage_events function + idempotency + lag)
cd services/cms/extensions/local/project-extension-usage-consumer && npm run test:e2e:cron

# bl-events package tests (emit + envelope shape contract)
cd packages/bl-events && npm test

# formula-api emitter tests
cd services/formula-api && node --test test/usage-events.test.js

# ai-api emitter tests
cd services/ai-api && node --test test/usage-events.test.js

# Rust: flow-common unit + envelope shape contract (reads fixture from packages/bl-events)
cd services/flow && cargo test -p flow-common
```
