# Flow: AI Wallet Top-Up

The AI Wallet funds AI/LLM-powered features (chat, KB Q&A, embeddings). When balance runs low, the user must top up via Stripe Checkout. This flow tests the discovery, execution, and post-top-up UX.

**Why this matters:** Wallet is the primary monetization surface for AI usage. Friction here directly reduces revenue. Also: low-balance prompts must not be aggressive or the user will churn.

## Prerequisites

- Account with an active subscription (any module — run `subscription-activation.md` first)
- Wallet balance under €1.00 (or above — test both scenarios)
- Stripe test cards ready (see `docs/ux-testing/stripe-test-cards.md`)
- Stripe CLI running for webhook verification:
  ```bash
  stripe listen --forward-to localhost:18055/stripe/webhook
  ```

## Accept Criteria

- [ ] User can discover wallet top-up from multiple entry points (subscription page, AI Assistant low-balance banner, upgrade dialog)
- [ ] Quick-select amounts (€20 / €50 / €200) work without manual entry
- [ ] Stripe Checkout loads quickly and returns the user to the correct page
- [ ] Wallet balance updates within 5s of checkout completion (or shows "pending" with clear copy)
- [ ] Receipt / invoice accessible from somewhere (likely Stripe email + Subscription page history)

## Red Flags

- Manual amount entry required (no quick amounts) → (F) -1
- Balance doesn't update after checkout → (F) -3 critical
- No feedback during Stripe redirect → First Impression -1
- Can't find wallet top-up after noticing low balance → Navigation -2
- Duplicate top-ups possible (double-submit) → (F) -2

## Phases

### Phase 1: Low-Balance Discovery

Simulate: manually set wallet balance to €0.50 for a test account:

```sql
-- via `make db`
UPDATE ai_wallet_ledger SET amount_eur = -4.50 WHERE account_id = '<test>' AND entry_type = 'debit' ORDER BY occurred_at DESC LIMIT 1;
-- or easier: add a debit entry
INSERT INTO ai_wallet_ledger (account_id, entry_type, amount_eur, source, metadata, occurred_at)
VALUES ('<test>', 'debit', 4.50, 'test_setup', '{"note":"ux testing"}', NOW());
```

**Actions:**
1. Navigate to `/admin/ai-assistant`
2. Observe: amber low-balance banner above conversation ("AI Wallet low: €0.50 — Top up to keep using AI")
3. Click "Top up" in banner

**Evaluate:** First Impression (amber warn color, non-aggressive copy), Navigation (banner→topup mapping)

**Persona variations:**
- **Sarah:** Notices banner, clicks immediately without second thought
- **Marcus:** Wants to see breakdown of what consumed the €4.50 first — looks for usage history link
- **Anna:** Finds banner mildly stressful; hesitates
- **Raj:** Inspects the banner element — verifies `aria-live="polite"` or similar for accessibility

### Phase 2: Top-Up Dialog — Amount Selection

**Actions:**
1. Dialog opens with 3 quick-select buttons: €20 / €50 / €200
2. Option for custom amount visible
3. Pick €50 (persona-appropriate amount)
4. Click "Top up €50"

**Evaluate:** (F) Amount selection UX, Data Entry (quick vs custom)

**Expected network:**
- POST `/stripe/wallet-topup` with `{ amount_eur: 50 }` → returns `{ checkout_url: "..." }`

### Phase 3: Stripe Checkout (Test Mode)

**Actions:**
1. Browser redirects to Stripe hosted Checkout
2. Line item: "AI Wallet Credit — €50"
3. Fill test card `4242 4242 4242 4242`
4. Submit
5. Return to BusinessLogic

**Evaluate:** (F) Checkout speed, Error Handling

**Expected webhooks:**
- `checkout.session.completed` → cms consumer adds `ai_wallet_ledger` credit entry for €50
- Balance should become €50.50 (existing €0.50 + new €50)

### Phase 4: Post-Top-Up Feedback

**Actions:**
1. User returns to `/admin/account/subscription` (or redirect destination)
2. Wallet card shows updated balance (€50.50)
3. Any confetti / success toast / visible confirmation

**Evaluate:** First Impression (delight moment), (F) Wallet Feedback

**Persona variations:**
- **Sarah:** Relieved, back to using AI
- **Marcus:** Checks the new wallet amount against the Stripe dashboard to verify
- **Anna:** Looks for a receipt or invoice link
- **Raj:** Confirms the debit + credit via DB query, checks idempotency (refresh page ≠ duplicate credit)

### Phase 5: Webhook Latency Case

If network is flaky or Stripe webhook delays:

**Actions:**
1. Complete Phase 3
2. Immediately check wallet balance — may still be €0.50 (webhook not processed yet)
3. Observe any "pending top-up" indicator
4. Wait up to 30s — balance should catch up

**Evaluate:** (F) Async UX, Error Handling (stale data copy)

### Phase 6: Decline Card Run (Alt Flow)

**Actions:**
1. Restart with balance at €0.50
2. Attempt top-up with `4000 0000 0000 0002` (generic_decline)
3. Observe error message in Checkout
4. Return to BusinessLogic with error
5. Wallet balance unchanged (no spurious credit from failed payment)

**Evaluate:** Error Handling, (F) Recovery (can user retry easily?)

### Phase 7: Insufficient Funds Case

**Actions:**
1. Balance at €0.50
2. Top up with `4000 0000 0000 9995` (insufficient_funds)
3. Stripe Checkout shows appropriate error
4. Return flow same as Phase 6

**Evaluate:** Error Handling (specific error copy vs generic)

### Phase 8: Alt Entry Points

Test the SAME top-up flow from these entry points to verify they all work:

**8a. Subscription page AI Wallet card**
- Navigate `/admin/account/subscription`
- Click "Top up" button on AI Wallet card
- Same dialog as Phase 2

**8b. Upgrade Plan dialog**
- Some upgrade dialogs have inline "Top up wallet first" CTAs
- Verify they link to the same flow

**8c. AI Assistant upgrade prompt**
- When the AI chat rejects a request due to empty wallet, the error should offer a top-up path

**Evaluate:** Consistency (same dialog / same outcome across entry points), Navigation (all paths lead to Stripe Checkout correctly)

## Expected final state

- `ai_wallet_ledger` row: account_id, entry_type='credit', amount_eur=50.00, source='stripe_topup', metadata.checkout_session_id=<sid>
- Wallet balance reflects new amount
- Stripe test dashboard shows the charge in "Succeeded"
- No duplicate entries from double-click or webhook replay (idempotency via Stripe event id + consumer dedup)

## Cleanup

Test mode data accumulates. Periodically:
- Stripe dashboard (test mode) → Payments → bulk delete test charges
- Consider resetting test account ledger: `DELETE FROM ai_wallet_ledger WHERE account_id = '<test>' AND source LIKE 'test%'`
