# 30. ai_wallet_ledger compound index for monthly cap query

**Status:** planned
**Severity:** LOW (defer until scale) — performance at 100k+ ledger rows
**Source:** Task 18 code review (commit `0823b8b`) — issue I2

## Problem

`services/ai-api/src/hooks/wallet-debit.js` runs this on every billable AI request when a wallet has `monthly_cap_eur` set:

```sql
SELECT COALESCE(SUM(amount_eur), 0) AS monthly_spent
FROM public.ai_wallet_ledger
WHERE account_id = $1
  AND entry_type = 'debit'
  AND occurred_at >= date_trunc('month', NOW());
```

The aggregate runs inside the wallet-row-locked transaction, extending hold time. At current scale (single customer, dev) the query is fast. At 100k+ ledger rows per month, without a compound index, it becomes O(n) per debit AND blocks concurrent debits for the same account.

## Required change

Add:
```sql
CREATE INDEX IF NOT EXISTS idx_ai_wallet_ledger_monthly_cap
  ON public.ai_wallet_ledger (account_id, entry_type, occurred_at);
```

Confirm planner uses it via `EXPLAIN ANALYZE` on a representative query. If the wallet has monthly_cap enabled AND there's no user-caused reason to scan outside current month, consider a partial index:
```sql
WHERE entry_type = 'debit'
```
which halves the index size at the cost of narrower usability.

## Acceptance

- Migration file in `migrations/cms/` (additive, reversible).
- Schema snapshot updated via `/db-admin`.
- `EXPLAIN ANALYZE` on the monthly-cap query after index landed shows Index Scan / Bitmap Index Scan, not Seq Scan.

## Dependencies

- Task 15 + Task 18 shipped.
- Blocked by: nothing; pure additive migration.

## Why LOW / deferred

At current scale this is a no-op improvement. Monitor with `SELECT count(*) FROM ai_wallet_ledger` quarterly; when any account crosses ~10k rows per month, promote to Sprint 2 or immediate.

## Use

`/db-admin <task-slug>` workflow — snapshot → migration → diff → apply → migrate → report.
