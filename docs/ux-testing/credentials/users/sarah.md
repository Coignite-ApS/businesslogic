# Sarah — Test Credentials

- **Email:** sarah-uxtest-1776658880@coignite.dk
- **Password:** TestPass123!
- **User ID:** 9ddb41cc-c488-4501-9c78-4736a4b0824d
- **Account ID:** e84f7866-dca1-4e14-891a-4d221c13ccd0
- **Account Name:** PriceWise Analytics
- **Role:** User (a3317ba7-1036-4304-b5e0-9df23321d627)
- **Created:** 2026-04-20
- **Last used:** 2026-04-20

## Test artifacts in Stripe (test mode)

- Checkout sessions: `cs_test_a1LLptYg0997AH10Aw1jphZDoDzfjpIR6YKIYMpOBj5At9WZGJMoCSanYq` (trial), `cs_test_a1MYssujjdPTPCNwoJAjT7zbKBPv2pczaEUryidgeRVSltheYDz9KJO1sC` (€20 cancelled), `cs_test_a11GvfUwJ60PFrr6nT78oWbVvIxu7GekLUVd10My1lwrHwO9DOjtkWw0aT` (€50 successful)
- Stripe customer: created under this email (lookup by `stripe customers list --email sarah-uxtest-1776658880@coignite.dk`)

## Cleanup commands

```sql
-- Remove test account + cascade
DELETE FROM directus_users WHERE id='9ddb41cc-c488-4501-9c78-4736a4b0824d';
DELETE FROM account WHERE id='e84f7866-dca1-4e14-891a-4d221c13ccd0';
```

```bash
# Stripe (optional — test data auto-expires)
stripe customers delete $(stripe customers list --email "sarah-uxtest-1776658880@coignite.dk" | jq -r '.data[0].id')
```
