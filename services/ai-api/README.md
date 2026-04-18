# bl-ai-api

AI chat, knowledge base, and embeddings service.

## AI Wallet debit (task 18)

Every billable AI call atomically debits `ai_wallet.balance_eur`.

### Endpoints billed

| Endpoint | Event kind | Module |
|---|---|---|
| `POST /v1/ai/chat` (SSE) | `ai.message` | `kb` |
| `POST /v1/ai/chat/sync` | `ai.message` | `kb` |
| `POST /v1/ai/kb/ask` | `kb.ask` | `kb` |

KB search (`/v1/ai/kb/search`) has no AI token cost — not billed.

### Transaction sequence (one PG transaction)

1. `SELECT ... FROM ai_wallet WHERE account_id = $1 FOR UPDATE` — locks the row
2. Check: `balance_eur >= cost_eur` — else 402
3. Check: `monthly_cap_eur` — if set, sum debits this month + cost must not exceed cap — else 402
4. `UPDATE ai_wallet SET balance_eur = balance_eur - cost_eur`
5. `INSERT INTO usage_events` — returns BIGSERIAL `id`
6. `INSERT INTO ai_wallet_ledger (usage_event_id = step 5 id)`
7. `COMMIT`

### Pre-flight (separate, before AI call)

`checkAiQuota()` in `auth.js` checks `balance_eur > 0` before spending any Anthropic tokens. Returns **402** if empty.

### 402 conditions

| Condition | HTTP |
|---|---|
| Wallet row missing | 402 |
| `balance_eur <= 0` | 402 |
| `balance_eur < cost_eur` | 402 |
| Monthly cap would be exceeded | 402 |

### Auto-reload

When `auto_reload_enabled = true` and post-debit balance falls below `auto_reload_threshold_eur`, `debitWallet()` returns `{ autoReloadTriggered: true, autoReloadAmountEur }`. The route handler logs this. Stripe charge is NOT triggered from ai-api (Stripe lives in CMS extension). Future: queue a reload job.

### Currency

Costs are computed in USD via `calculateCost()` (`utils/cost.js`), then converted to EUR at the rate in `AI_USD_TO_EUR_RATE` env var (default `0.92`).

### Hook file

`src/hooks/wallet-debit.js` — `debitWallet(opts)` — one function, pure PG transaction.

### Tests

`test/wallet-debit.test.js` — 7 real-DB tests:
- sufficient balance: all rows written
- insufficient balance: 402, no rows
- monthly cap exceeded: 402, no rows
- zero balance: 402
- missing wallet: 402
- concurrent debits: FOR UPDATE serializes, exactly 1 succeeds
- auto-reload trigger: flag returned

Requires `DATABASE_URL` to point at a running postgres. Run with:
```bash
DATABASE_URL=postgresql://directus:directus@localhost:15432/directus npm run test:all
```
