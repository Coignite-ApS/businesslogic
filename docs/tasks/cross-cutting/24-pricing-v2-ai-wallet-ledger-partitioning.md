# 24. Pricing v2 — ai_wallet_ledger partitioning (deferred)

**Status:** planned
**Severity:** LOW (defer until row count > 10M)
**Source:** db-admin report `docs/reports/db-admin-2026-04-18-pricing-v2-schema-064122.md`

## Problem

`public.ai_wallet_ledger` is BIGSERIAL append-only. At scale (every AI request writes ≥1 ledger row) the table will grow to millions of rows per month per active account. Postgres handles this fine up to ~10–50M rows per table, but beyond that:

- Vacuum cycles slow down
- Index bloat increases query latency
- Backups grow large

## Recommended pattern

Partition by `RANGE (occurred_at)` monthly:

```sql
ALTER TABLE public.ai_wallet_ledger RENAME TO ai_wallet_ledger_legacy;

CREATE TABLE public.ai_wallet_ledger (
  ... -- same columns
) PARTITION BY RANGE (occurred_at);

CREATE TABLE public.ai_wallet_ledger_2026_04 PARTITION OF public.ai_wallet_ledger
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
-- ... per month ...

INSERT INTO public.ai_wallet_ledger SELECT * FROM ai_wallet_ledger_legacy;
DROP TABLE ai_wallet_ledger_legacy;
```

Plus: monthly cron to create next month's partition; old partition detach for archive.

## When to do this

Trigger thresholds (whichever comes first):
- Row count > 10M
- Table size > 5 GB
- INSERT P99 latency > 10ms

Until then: leave as-is. Premature partitioning has its own complexity tax.

## Key Tasks (when triggered)

- [ ] Verify thresholds breached (data baseline)
- [ ] Author partition migration via `/db-admin`
- [ ] Implement monthly partition-creation cron
- [ ] Implement archive policy for partitions older than N months
- [ ] Verify query performance is restored

## Acceptance

- Same query performance at 10x current row count
- Old partitions detachable for archive
- New partitions created automatically each month
