# 18. Pricing v2 — ai_wallet atomic debit hook in ai-api

**Status:** planned
**Severity:** HIGH (without this, AI wallet balance is decorative — no enforcement)
**Source:** db-admin report `docs/reports/db-admin-2026-04-18-pricing-v2-schema-064122.md`

## Problem

`public.ai_wallet.balance_eur` and `ai_wallet_ledger` exist after Inv 1 but `balance_eur` is **not auto-decremented** when ledger debit rows are inserted. The plan deliberately deferred this to a code task because the debit must be **atomic** with the AI request (otherwise debits and ledger entries can drift).

## Required behavior

On every billable AI request in `services/ai-api/`:

1. Compute cost in EUR (cost-per-token × tokens used)
2. Begin transaction
3. SELECT current balance FOR UPDATE
4. If balance < cost OR (sum of debits this month + cost) > monthly_cap_eur → REJECT with 402 Payment Required
5. UPDATE ai_wallet SET balance_eur = balance_eur - cost, date_updated = NOW()
6. INSERT INTO ai_wallet_ledger (entry_type='debit', amount_eur=cost, balance_after_eur=new_balance, source='usage', usage_event_id=...)
7. INSERT INTO usage_events (account_id, module='kb' or service-specific, event_kind='ai.message', cost_eur=cost, ...)
8. COMMIT
9. Stream/return the AI response

## Auto-reload check (separate transaction)

After commit, if `ai_wallet.auto_reload_enabled = true` AND `balance_eur < auto_reload_threshold_eur`:
- Trigger a Stripe charge for `auto_reload_amount_eur`
- Webhook handler inserts a top-up + ledger 'credit' row + updates balance
- Best-effort; failure logged but does not block AI request

## Hard cap enforcement

`monthly_cap_eur` is a **hard ceiling**. Sum of debits this month MUST NOT exceed it. Check via:

```sql
SELECT SUM(amount_eur) FROM ai_wallet_ledger
WHERE account_id = $1 AND entry_type = 'debit' AND occurred_at >= date_trunc('month', NOW());
```

(Or pre-aggregate into `monthly_aggregates.ai_cost_eur` once task 21 ships.)

## Key Tasks

- [ ] Implement debit hook in `services/ai-api/src/hooks/wallet-debit.js` (new file)
- [ ] Wire into chat / KB ask / embedding endpoints
- [ ] Add 402 Payment Required handling to API responses
- [ ] Add tests: insufficient balance, hard cap, auto-reload trigger
- [ ] Document in `services/ai-api/README.md`

## Acceptance

- AI request with sufficient balance: succeeds, balance decremented, ledger row written, usage_events row written — all in one transaction
- AI request with insufficient balance: 402 returned, no balance change, no ledger row
- AI request that would exceed monthly_cap_eur: 402 returned
- Auto-reload triggers Stripe charge when threshold crossed
- Concurrent requests do not double-debit (FOR UPDATE locking verified)
