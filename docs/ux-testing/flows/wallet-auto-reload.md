# Flow: Wallet Auto-Reload Configuration

Users can configure the AI Wallet to automatically top up when balance falls below a threshold. This flow tests the settings dialog (cms/36.1), the save path, and the eventual auto-reload trigger via the background consumer (task 31).

**Why this matters:** Auto-reload is a revenue-stability feature. Misconfigured or untrusted, users disable it → wallet empties → AI features stop working → churn. The configuration UX must be clear and the pending-consumer must be reliable.

## Prerequisites

- Account with active subscription + initial wallet balance (run `subscription-activation.md` + `wallet-top-up.md` first)
- Stripe test cards (see `docs/ux-testing/stripe-test-cards.md`)
- Stripe CLI running:
  ```bash
  stripe listen --forward-to localhost:18055/stripe/webhook
  ```
- Saved payment method on the Stripe customer (from a prior top-up or subscription activation)

## Accept Criteria

- [ ] Settings dialog accessible from AI Wallet card via a "Settings" button
- [ ] Auto top-up checkbox toggles threshold/amount inputs visibility
- [ ] Validation: Save disabled when auto-reload is on but threshold or amount is 0
- [ ] Save persists settings server-side + UI reflects active auto-reload via a badge
- [ ] Reopening the dialog pre-fills saved values (currently blocked by task 45 — document the gap)
- [ ] Simulated balance drop → auto-reload fires without user interaction → Stripe charges saved payment method → wallet credited
- [ ] Failure (declined card) → queued for retry via `ai_wallet_auto_reload_pending` + user notified

## Red Flags

- Checkbox doesn't toggle (dead widget) → (F) -3 (was the cms/36.1 QA blocker — now fixed via b13e040)
- Threshold/amount = 0 save succeeds → (F) -2
- Auto-reload fires but double-charges → (F) -3 critical
- User can't disable auto-reload after enabling → (F) -2
- Stripe charge fails silently (no email, no in-app warning) → First Impression -2

## Phases

### Phase 1: Discovery & Opening

**Actions:**
1. Navigate `/admin/account/subscription`
2. AI Wallet card is visible with current balance
3. Look for "Settings" button on the card
4. Click "Settings"

**Evaluate:** Navigation (discoverability), Visual Design (settings icon vs text button)

**Persona variations:**
- **Sarah:** Clicks immediately — wants convenience
- **Marcus:** Hesitant — reads card copy first to understand what settings affect
- **Anna:** Looks for tooltip / help icon explaining auto-reload
- **Raj:** Checks the POST /stripe/wallet-config endpoint docs (if any) before clicking

### Phase 2: Initial Dialog State

**Actions:**
1. Dialog opens — observe layout
2. Check initial state: Auto top-up toggle should be OFF (unless previously set)
3. Threshold + amount inputs should be hidden or disabled
4. Monthly cap input visible and accessible

**Evaluate:** Visual Design (dialog layout), Data Entry (default state matches expectation)

### Phase 3: Enable + Configure

**Actions:**
1. Click the Auto top-up checkbox → should flip to checked
2. Threshold + amount number inputs become visible
3. Type threshold = 5 (or €5)
4. Try Save → button should be DISABLED (amount still 0)
5. Click amount quick-select €50
6. Try Save → now ENABLED
7. Click Save

**Evaluate:** (F) Validation clarity, Data Entry (quick amount helpers)

**Expected network:**
- POST `/stripe/wallet-config` with:
  ```json
  {
    "auto_reload_enabled": true,
    "auto_reload_threshold_eur": 5,
    "auto_reload_amount_eur": 50,
    "monthly_cap_eur": null
  }
  ```
  → 200

### Phase 4: Post-Save Feedback

**Actions:**
1. Dialog closes
2. AI Wallet card now shows "Auto-reload on" badge or similar indicator
3. Reopen settings dialog
4. **Current limitation (task 45):** threshold + amount inputs may render empty even though data IS saved. Check if task 45 has shipped before flagging this as a regression.

**Evaluate:** (F) Feedback, Consistency (reopened values match saved state — task 45)

### Phase 5: Monthly Cap Validation

**Actions:**
1. Reopen dialog
2. Enter monthly cap = 30 (€30)
3. Enter threshold = 5, amount = 50
4. Save
5. Per-policy: `monthly_cap_eur = 30` + `auto_reload_amount_eur = 50` → first auto-reload fires, second would breach cap → blocked
6. (Test this behaviorally in Phase 7)

**Evaluate:** (F) Cap Semantics clarity, Data Entry (input helper text)

### Phase 6: Disable + Reset

**Actions:**
1. Uncheck Auto top-up
2. Threshold + amount hidden again
3. Save
4. AI Wallet card no longer shows auto-reload badge

**Evaluate:** (F) Disable UX, Navigation (reversibility)

**Expected network:**
- POST `/stripe/wallet-config` with `auto_reload_enabled: false` → 200
- Background consumer stops firing auto-reload for this account

### Phase 7: Trigger Auto-Reload (Simulated Low Balance)

**Setup:**
- Re-enable auto-reload: threshold=5, amount=50, cap=30 (set in Phase 5)
- Wallet balance: €8.00
- Saved Stripe payment method exists

**Actions:**
1. Debit the wallet below threshold:
   ```sql
   INSERT INTO ai_wallet_ledger (account_id, entry_type, amount_eur, source, metadata, occurred_at)
   VALUES ('<test>', 'debit', 4, 'test_setup', '{"note":"drop below threshold"}', NOW());
   ```
2. Wait for the `ai_wallet_pending_auto_reload` consumer to pick up the signal (task 31 polls on a cadence — check Stripe ext config for interval)
3. Consumer creates a Stripe PaymentIntent against the saved method for €50
4. On success, `ai_wallet_ledger` credit entry added
5. New balance: €4 + €50 = €54

**Evaluate:** (F) Background Fire reliability, Accounting (ledger entries correct)

**Expected webhooks:**
- `payment_intent.succeeded` → consumer confirms + updates pending queue status to 'completed'

### Phase 8: Monthly Cap Enforcement

**Setup:**
- Balance drops below threshold a second time this month
- Cap=€30, first top-up already consumed €50 (wait, that exceeds cap — should never have fired if properly enforced)
- Either: cap logic is `sum of auto-reloads this month <= cap` (top-up gets blocked)
- Or: cap logic is `next top-up must fit within remaining cap` (partial top-up or skipped)

**Expected:** second auto-reload attempt is BLOCKED by cap. User notified (in-app banner? email?).

**Actions:**
1. Drop balance below threshold again
2. Observe: auto-reload does NOT fire (cap breached)
3. Check `ai_wallet_auto_reload_pending` table state — should show 'skipped_cap_exceeded' or similar

**Evaluate:** (F) Cap Enforcement correctness, Error Handling (user notification)

### Phase 9: Failure Recovery (Declined Card)

**Setup:**
- Saved payment method is a declined test card (`4000 0000 0000 0002`)
- Balance drops below threshold

**Actions:**
1. Drop balance
2. Consumer attempts auto-reload
3. Stripe returns `card_declined`
4. `ai_wallet_auto_reload_pending` row status → 'failed'
5. User notified: in-app banner "Auto top-up failed — update payment method"
6. User can retry / update card via a link to Stripe billing portal

**Evaluate:** Error Handling, (F) Recovery UX

## Expected final state (happy path)

- `wallet_config` columns on account: `auto_reload_enabled=true`, `auto_reload_threshold_eur=5`, `auto_reload_amount_eur=50`, `monthly_cap_eur=30`
- `ai_wallet_ledger`: credit entry for €50, source='auto_reload', metadata.payment_intent_id=<pi>
- `ai_wallet_auto_reload_pending`: row with status='completed'
- Stripe test dashboard: €50 charge visible

## Known gaps

- `task 45`: `/wallet/balance` doesn't echo back threshold/amount — reopened dialog shows empty inputs (data IS saved)
- `task 46`: wallet dialog a11y labels pending

## Cleanup

- Disable auto-reload after testing so the consumer doesn't keep firing
- Cancel Stripe subscriptions + payment methods in test mode dashboard periodically
