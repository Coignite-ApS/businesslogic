# 32. Extend `module_kind` enum to include `'chat'`

**Status:** planned
**Severity:** LOW — analytics taxonomy, not a functional bug
**Source:** Task 18 code review (commit `0823b8b`) — issue I4

## Problem

The `module_kind` PostgreSQL enum currently contains `('calculators','kb','flows')`. Task 18's wallet-debit hook needs to record chat events into `usage_events`, but there is no `'chat'` value. The implementer chose `'kb'` as the closest legal value, which means:

- Chat events in `usage_events` are masquerading as KB events.
- Per-module billing reports will attribute chat costs to KB.
- `event_kind` (`'ai.message'` vs `'kb.ask'`) disambiguates at the row level, but module-level aggregates are wrong.

## Required change

### 1. Extend the enum

```sql
ALTER TYPE module_kind ADD VALUE 'chat';
```

Note: `ALTER TYPE ADD VALUE` in Postgres is not transactional with other DDL in some versions — run in its own statement.

### 2. Code updates

- `services/ai-api/src/routes/chat.js`: both `/v1/ai/chat` (SSE) and `/v1/ai/chat/sync` handlers currently pass `module: 'kb'` to `debitWallet`. Change to `module: 'chat'`.
- `services/ai-api/src/hooks/wallet-debit.js`: update JSDoc on `opts.module` to reflect 4-value enum.
- `services/ai-api/test/wallet-debit.test.js`: adjust assertions that expect `module='kb'` on chat test cases.

### 3. Data migration (optional but recommended)

Backfill historical rows:
```sql
UPDATE public.usage_events
SET module = 'chat'
WHERE event_kind = 'ai.message'
  AND module = 'kb';
```
Add as a one-time migration script; do NOT run automatically.

### 4. Downstream updates

- `feature_quotas` rows: check if any `module='chat'` rows need to be added (if quotas differ for chat vs KB) or if the existing `module='kb'` quota covers both.
- Admin analytics views: any GROUP BY `module` will now show `chat` separately — update dashboards.
- Subscription plan catalog: if a chat-specific plan tier is needed, add it.

## Acceptance

- Enum includes `'chat'`.
- Chat endpoints record `module='chat'` in `usage_events`.
- Historical ai.message rows backfilled (or left + documented).
- Tests updated.
- Admin dashboard correctly splits chat from kb.

## Dependencies

- Task 15 + Task 18 shipped.
- Blocked by: Task 17 (feature_quotas refresh), Task 21 (monthly_aggregates) — both of those read `module` for aggregation; decide if they need updating in concert.

## Use

`/db-admin <task-slug>` for enum + data migration. Code changes in ai-api afterward.
