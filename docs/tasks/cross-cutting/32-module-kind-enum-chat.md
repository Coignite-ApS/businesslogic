# 32. Extend `module_kind` enum to include `'chat'` → **resolved via existing `'ai'` value**

**Status:** completed 2026-04-21 — no new enum value added; chat debits now use `'ai'` (already added by migration 029).
**Severity:** LOW — analytics taxonomy, not a functional bug
**Source:** Task 18 code review (commit `0823b8b`) — issue I4

## Resolution (2026-04-21)

Deviates from the original plan: **no new `'chat'` enum value was added.** Rationale: migration `029_module_kind_add_ai.sql` (shipped 2026-04-19) already added `'ai'` to the enum, and `emitAiMessage()` in `services/ai-api/src/services/usage-events.js` already tags events as `module: 'ai' / event_kind: 'ai.message'`. The wallet-debit path was the only place still masquerading chat events as `'kb'`. Harmonizing chat.js to also use `'ai'` avoids introducing a 3rd vocabulary (`kb`, `ai`, `chat`) while achieving the same taxonomy goal.

Shipped on `dm/task-32-module-kind-chat`:
- `services/ai-api/src/routes/chat.js` — 6 call sites changed from `module: 'kb'` → `module: 'ai'` (both sync + SSE handlers, happy path + failure/threw branches).
- `services/ai-api/src/hooks/wallet-debit.js` — JSDoc updated to list `'ai'` alongside the other module values and explain the 'ai' vs 'kb' split.
- `services/ai-api/test/wallet-debit.test.js` — 13 chat-flow test cases updated.
- `services/ai-api/test/wallet-failed-debits.test.js` — 11 chat-flow test cases updated.

**Backfill:** not required. Live `public.usage_events` contains zero `event_kind='ai.message' AND module='kb'` rows (only 5 `calc_call` events exist in dev), so the historical data migration step the task doc contemplated is a no-op.

**feature_quotas:** no new rows needed — `'ai'` module is already a valid quota target.

Tests: 313/313 ai-api pass (78 suites).

## Known remaining reference to `'chat'` as a name

The task 32 filename keeps `module-kind-enum-chat` for archaeology. Future reports should reference module `'ai'` not `'chat'`.

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
