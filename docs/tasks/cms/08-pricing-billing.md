# 08. Pricing & Billing Evolution

**Status:** planned
**Phase:** 1 — Foundation (should evolve alongside platform features)
**Priority:** High — pricing model must scale with platform, not bolt on after

---

## Goal

Evolve the pricing model from calculator-only tiers to a full-platform billing system that covers Calculators, Knowledge Bases, AI queries, MCP access, and lead capture — while keeping it simple, fair, and self-serve. Add purchasable add-ons so users can scale individual resources without forced tier jumps.

---

## Current State

### Tiers (USD, 17% yearly discount)

| | Basic | Premium | Professional |
|---|---|---|---|
| Monthly | $9.90 | $49.90 | $149.90 |
| Yearly | $99/yr | $499/yr | $1,499/yr |
| Calculators | 1 | 5 | 25 |
| Calls/mo | 10,000 | 100,000 | 1,000,000 |
| Rate limit | 10 RPS | 50 RPS | 200 RPS |

### Trial
- 14-day trial on Basic tier, auto-created on registration
- Full feature access during trial (good — keep this)
- Hourly cron expires trial subscriptions past `trial_end`

### What's Enforced vs Not

| Limit | Enforced? |
|---|---|
| Calculator count | Yes — hard gate at activation, 1-hour over-limit grace |
| Calls/mo | **No** — tracked in `calculator_calls`, never checked |
| Rate limit (RPS) | **No** — passed to Formula API via `/accounts/:id`, not enforced by us |
| Seats | Not tracked |
| Everything else | Doesn't exist yet |

### Known Issues
- "proffesional" misspelled in Stripe product name (propagates to UI)
- `calls_per_month` not enforced — users can exceed without consequence
- No soft-limit warnings (80%, 100% email notifications)
- Currency is USD — consider EUR for EU-sovereign positioning
- Only calculator metrics — no Knowledge Base, AI, MCP, lead metering

---

## Proposed Pricing Model

### Principles

1. **Trial gives full access** — 14 days with highest-tier features, user picks tier after experiencing value
2. **Tiers set the base** — each tier includes bundled resources
3. **Add-ons for flexibility** — buy more of any resource without upgrading tier
4. **Meter what costs us money** — calculators (memory), API calls (CPU), storage (disk), AI queries (inference)
5. **Soft limits preferred** — warn at 80%, email at 100%, grace period before hard cutoff. Never kill a live widget without warning.
6. **Stripe is source of truth** — prices and limits sync from Stripe product metadata, not hardcoded

### Revised Tiers

| | **Trial** | **Starter** | **Growth** | **Business** |
|---|---|---|---|---|
| **Price** | Free (14 days) | $19/mo | $79/mo | $249/mo |
| **Yearly** | — | $190/yr | $790/yr | $2,490/yr |
| **Trial access** | Full Business | — | — | — |
| | | | | |
| **Calculators** | 10 | 3 | 15 | 50 |
| **API calls/mo** | 50,000 | 5,000 | 50,000 | 500,000 |
| **Rate limit** | 25 RPS | 10 RPS | 50 RPS | 200 RPS |
| | | | | |
| **Knowledge Bases** | 2 | — | 3 | 10 |
| **KB storage** | 100 MB | — | 500 MB | 5 GB |
| **AI queries/mo** | 100 | — | 500 | 5,000 |
| | | | | |
| **MCP access** | Account-level | Per-calculator | Per-calculator | Account-level |
| **Lead capture** | Full | Basic (email) | Full + webhooks | Full + CRM |
| **White-label** | Yes | No | No | Yes |
| **Seats** | 3 | 1 | 3 | 10 |

### Tier Naming Rationale
- **Starter** (not "Basic") — friendlier, no negative connotation
- **Growth** (not "Premium") — signals who it's for: growing businesses with real traffic
- **Business** (not "Professional") — signals team/enterprise use. Avoids spelling issues.
- Three paid tiers, not two or four. Three is the sweet spot for decision-making.

### Trial Strategy
- 14 days, full Business-tier access (current approach, keep it)
- Trial creates a local subscription with `status: trialing`, no Stripe subscription yet
- On checkout: remaining trial days preserved as Stripe trial period (already implemented)
- Post-trial: downgrade to read-only (can view but not execute/edit), not account deletion

### Purchasable Add-ons

Available on any paid tier. Each add-on = separate Stripe Price on the subscription.

| Add-on | Unit | Price/mo | Stripe metadata |
|---|---|---|---|
| +5 calculators | per pack | $15 | `bl_addon_type: calculator` |
| +1 seat | per seat | $9 | `bl_addon_type: seat` |
| +25,000 API calls | per pack | $19 | `bl_addon_type: calls` |
| +1 Knowledge Base | per KB | $19 | `bl_addon_type: kb` |
| +1 GB KB storage | per pack | $9 | `bl_addon_type: storage` |
| +1,000 AI queries | per pack | $15 | `bl_addon_type: ai_queries` |

**Implementation**: Stripe subscription items. Each add-on is a recurring price added to the existing subscription. Quantity = number of packs purchased. Effective limit = tier base + (addon quantity * pack size).

### Enterprise (Contact Sales)
Not a self-serve tier. Shown as "Need more?" below Business tier.
- Custom limits, SLA, SSO, on-prem deployment, dedicated support
- Custom Stripe subscription created manually

### Lifetime Deal (Launch Strategy)

For initial traction (AppSumo, ProductHunt, direct sales):

| LTD Tier | One-time | Equivalent to | Cap |
|---|---|---|---|
| Tier 1 | $99 | Starter (lifetime) | 300 codes |
| Tier 2 | $249 | Growth (lifetime) | 200 codes |
| Tier 3 | $499 | Business (lifetime) | 100 codes |

Rules:
- Stackable (2x Tier 1 = double the Starter limits)
- No add-ons on LTD accounts (prevents abuse)
- New major features (Knowledge Bases) available to LTD users — they paid for the platform
- Implement as `account.exempt_from_subscription = true` + custom limits stored on account
- Cap total LTD volume to avoid cannibalizing recurring revenue

---

## Tax, Currency & EU Compliance

### Recommended: Stripe Tax + EUR-only + Sequential Invoicing

This is the minimum viable tax-compliant setup for an EU-based B2B SaaS.

### Currency: USD as primary, EUR as secondary
- US is the biggest potential market — USD removes friction for US signups
- EU B2B customers are accustomed to seeing USD pricing for SaaS tools
- Stripe supports multiple Prices per Product — create USD and EUR prices for each plan
- EUR prices should be round numbers, not FX-converted (e.g. $79 → €79, not €72.34)
- Checkout auto-detects location and shows appropriate currency
- Invoices issued in the currency the customer paid in
- Accounting: Stripe reports in your settlement currency (DKK or EUR), handles FX

### Stripe Tax: Enable it
- **Cost**: 0.5% per transaction (on $79/mo = $0.40/transaction — negligible)
- **What it does**: auto-calculates correct VAT rate per EU country, applies reverse charge for B2B with VAT ID, validates VAT IDs against EU VIES database
- **What it doesn't do**: file VAT returns — we file via Danish Skat using EU VAT OSS
- **US sales tax**: handled automatically when US customers sign up (nexus tracking, state-by-state rates). No action needed until we have US presence/nexus — digital goods sold from Denmark to US customers have no US sales tax obligation until nexus is established (typically: employees, office, or exceeding state economic thresholds ~$100K/year in that state)

### B2B Invoice Requirements (EU law)
Stripe Invoicing handles all of these when configured:
- Sequential invoice numbers (configurable prefix, e.g. `BL-0001`)
- Seller name, address, VAT number
- Buyer name, address, VAT number (if B2B)
- Net amount, VAT rate, VAT amount, gross amount
- "Reverse charge" notation (auto-added when applicable)
- Invoice date + date of supply

### VAT Reverse Charge (B2B)
When an EU business provides a valid VAT ID:
- Stripe Tax auto-applies 0% VAT with "reverse charge" notation
- Customer self-accounts for VAT in their own country
- No VAT collected by us → simpler for both parties
- If no VAT ID: treated as B2C, local VAT rate charged

### Code Changes for Tax Compliance
```javascript
// Checkout session creation — add these parameters:
{
  automatic_tax: { enabled: true },
  tax_id_collection: { enabled: true },
  customer_update: { address: 'auto', name: 'auto' }
}

// Subscription creation — add:
{
  automatic_tax: { enabled: true }
}
```

### Stripe Dashboard Configuration
1. Enable Stripe Tax
2. Register tax jurisdictions (home country + EU VAT OSS for cross-border B2C)
3. Set company VAT number in account settings
4. Configure sequential invoice numbering with prefix
5. Set tax code on all products: `txcd_10000000` (SaaS / digital services)
6. Enable Customer Portal: tax ID collection + invoice downloads + address updates
7. Set pricing to **tax-exclusive** (B2B standard: show net price, VAT added at checkout)

### Customer Portal Self-Service
Already using Stripe Billing Portal. Enable these additional features:
- Tax ID collection (customer adds/updates VAT number)
- Invoice PDF downloads (all past invoices)
- Billing address updates (used for tax calculation)

### Filing & Accounting
- **Company**: VAT-registered in Denmark
- **EU VAT OSS** (One-Stop Shop): file once via Danish Skat, covers all EU cross-border sales
  - Applies to B2C sales (B2B with VAT ID uses reverse charge, no VAT collected)
  - OSS quarterly filing deadline: end of month following quarter
- **Digital goods**: SaaS is classified as electronically supplied services — straightforward VAT OSS category, no physical goods complexity
- **Stripe data export** to accounting software for VAT returns
- Keep records of all invoices for minimum 7 years (EU requirement)
- **US sales tax**: not applicable until US nexus established. Stripe Tax will auto-handle when the time comes.

---



### `subscription_plans` — new fields

```
kb_limit              integer    — Knowledge Bases included (null = not available on this tier)
kb_storage_mb         integer    — KB storage in MB
ai_queries_per_month  integer    — AI query quota
mcp_access            string     — "none" | "per_calculator" | "account_level"
lead_capture_level    string     — "none" | "basic" | "full" | "full_crm"
white_label           boolean    — Remove Businesslogic branding
seat_limit            integer    — Max team members
```

Stripe metadata mapping (add to existing sync):
```
bl_kb_limit           → kb_limit
bl_kb_storage_mb      → kb_storage_mb
bl_ai_queries         → ai_queries_per_month
bl_mcp_access         → mcp_access
bl_lead_capture       → lead_capture_level
bl_white_label        → white_label
bl_seat_limit         → seat_limit
```

### `subscription_addons` — new collection

```
subscription_addons
  id              uuid
  subscription    M2O → subscriptions
  addon_type      string — "calculator" | "seat" | "calls" | "kb" | "storage" | "ai_queries"
  quantity        integer — number of packs
  stripe_price_id string — Stripe Price ID for this addon
  date_created    timestamp
  date_updated    timestamp
```

Or: skip this collection and compute add-ons from Stripe subscription items on demand (simpler, Stripe is source of truth). **Recommended: compute from Stripe**, store only in Stripe.

### Effective Limits Calculation

```
effective_calculator_limit = plan.calculator_limit + (addon_calculator_packs * 5)
effective_calls_per_month  = plan.calls_per_month + (addon_calls_packs * 25000)
effective_kb_limit         = plan.kb_limit + addon_kb_count
// etc.
```

Fetch addon quantities from Stripe subscription items (cached in Redis, 5-min TTL).

---

## Key Tasks

### Phase 0: Tax & Compliance (do first)

1. **Enable Stripe Tax** in Dashboard, register tax jurisdictions
2. **Set tax code** on all existing products (`txcd_10000000` — SaaS)
3. **Add `automatic_tax: { enabled: true }` and `tax_id_collection: { enabled: true }`** to Checkout session creation in Stripe extension
4. **Add `automatic_tax: { enabled: true }`** to subscription creation
5. **Configure sequential invoice numbering** with `BL-` prefix
6. **Enable tax ID + address + invoice download** in Customer Portal settings
7. **Set company VAT number** in Stripe account settings
8. **Create dual-currency Prices** — USD (primary) + EUR on each Product. Keep existing USD Prices for current subscriber.
9. **Set tax-exclusive pricing** (standard B2B: net + VAT at checkout)
10. **Register EU VAT OSS** via Danish Skat (if not already) for cross-border EU B2C sales

### Phase A: Fix Current Gaps

1. **Enforce `calls_per_month`** — middleware in calculator-api that checks monthly usage against limit before executing
   - Count calls from `calculator_calls` where `timestamp >= start_of_month` (already queryable)
   - Cache count in Redis (increment on each call, reset monthly)
   - Return 429 with `{error: "Monthly call limit reached", limit: N, used: N, upgrade_url: "..."}`
   - Soft enforcement: allow 10% overage grace, then hard block

2. **Usage warning emails** — Directus Flow or cron hook
   - At 80%: "You've used 80% of your monthly API calls"
   - At 100%: "You've reached your limit. Calls will be blocked after 10% grace."
   - Per resource type (calculators, calls, KB storage, AI queries)

3. **Fix "proffesional" typo** — rename in Stripe Dashboard, sync propagates to UI

4. **Track seat count** — count users per account, enforce against `seat_limit`

### Phase B-C: New Plan Structure & Add-on System

5. **Create new Stripe Products** — Starter, Growth, Business with all `bl_*` metadata fields
6. **Update metadata sync** — extend `handleProductUpdated` to sync new fields
7. **Migrate existing subscribers** — map Basic→Starter, Premium→Growth, Professional→Business
   - Grandfather existing prices for current subscribers
   - New pricing for new subscribers only
8. **Update subscription UI** — show new tier names, new limit metrics, add-on purchase buttons
9. **Create Stripe Prices for add-ons** — recurring prices, each with `bl_addon_type` metadata
10. **Add-on purchase flow** — button per resource type → Stripe Checkout with `mode: subscription` adding line item to existing subscription
11. **Effective limits resolver** — function that computes tier limits + add-on quantities
    - Used by all enforcement middleware
    - Cached in Redis (bust on webhook events)
12. **Add-on management UI** — show current add-ons, quantity adjustment, remove

### Phase E: Lifetime Deal Support

13. **LTD flag on account** — `account.lifetime_deal = true`, `account.ltd_tier` field
14. **Custom limits for LTD** — stored directly on account, override plan limits
15. **LTD redemption endpoint** — `POST /register` variant that accepts LTD code
16. **LTD code management** — admin UI to generate/track/expire codes

---

## Acceptance Criteria

- [ ] `calls_per_month` is enforced with 10% grace period
- [ ] Users receive email warnings at 80% and 100% of each metered resource
- [ ] New tier structure (Starter/Growth/Business) live in Stripe and UI
- [ ] Add-ons purchasable from account subscription page
- [ ] Effective limits correctly sum tier base + add-on quantities
- [ ] All new resource types (KB, AI, seats, MCP, lead capture) tracked and enforced
- [ ] Existing subscribers grandfathered at current prices
- [ ] Trial still gives full Business-tier access for 14 days
- [ ] Post-trial accounts downgrade to read-only (not deleted)
- [ ] Usage dashboard shows all resource meters with progress bars
- [ ] Typo fixed ("proffesional" → "Professional")
- [ ] Stripe Tax enabled — correct VAT calculated per EU country
- [ ] B2B reverse charge applied when customer provides VAT ID
- [ ] Sequential invoice numbering with BL- prefix
- [ ] Customer Portal allows tax ID collection + invoice downloads
- [ ] Dual-currency prices (USD + EUR) on all products
- [ ] Existing $149.90 subscriber grandfathered on current price
- [ ] EU VAT OSS registered via Danish Skat

---

## Dependencies

- **#20 (Account-Level MCP)** — for MCP access gating
- **#06 (Lead Capture)** — for lead capture level gating
- Stripe Dashboard access for product/price creation
- Email templates for usage warnings

## Existing Customer Migration

One existing customer on $149.90/mo (Professional, v1 platform, EU-based).

**Migration plan:**
- Grandfather at current $149.90 USD price — do NOT change their subscription
- Their Stripe Price remains active but hidden from new signups
- New customers see new tier structure (Starter/Growth/Business)
- Offer existing customer optional migration to new Business tier ($249/mo) with added KB/AI features when Knowledge Platform ships — position as upgrade, not price hike
- If they prefer to stay on $149.90: they keep 25 calculators, 1M calls/mo, 200 RPS but no KB/AI access (those are new features on new tiers)

## Risk Notes

- **Grandfathering** — only one customer to manage. Keep their Stripe Price active, create new Prices for new tiers. Low complexity.
- **Add-on UX** — must be dead simple. "Need more calculators? +$15/mo" with one-click purchase. Don't make users think.
- **LTD abuse** — cap volume, no add-ons on LTD, monitor usage. LTD users tend to be heavy testers but low actual usage.
- **USD + EUR dual pricing** — create two Prices per Product in Stripe. UI shows price in detected currency. Stripe Checkout handles the rest. Accounting settles in your Stripe settlement currency.

## Estimated Scope

- Phase 0 (tax & compliance): Stripe config + ~50 lines code
- Phase A (fix gaps): ~200-300 lines (middleware + cron + emails)
- Phase B-C (new tiers + add-ons): ~400-500 lines (purchase flow, resolver, UI) + Stripe config
- Phase E (LTD): ~200 lines (redemption flow, admin UI)
