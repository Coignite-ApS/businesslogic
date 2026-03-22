# 09. Event-Driven Communication & Client Data

**Status:** planned
**Phase:** 2 — Go-to-Market
**Depends on:** #08 (Pricing) for subscription events

---

## Goal

Build a platform-wide event capture system and bind templated email communication to those events. Give operators full control over what emails go out, when, and to whom — plus the ability to export client data sheets for analysis and outreach.

---

## Current State

- **No automated emails** — signup, trial expiry, limit warnings, subscription changes: all silent
- **No event bus** — events happen (trial created, calculator activated, limit hit) but are not captured or routed
- **No Directus Flows** configured — zero flows in the system
- **One email template** — `email-templates/base.liquid` (generic Directus base template)
- **Stripe webhooks** update DB but trigger no notifications
- **Crons** expire trials and deactivate calculators silently — user gets no warning

This means: a user's trial expires and they have no idea why their calculators stopped working.

---

## Architecture

### 1. Platform Events (capture layer)

Define a standard set of events that the platform emits. Each event has a type, account context, and payload.

```
platform_events (new collection — event log)
  id              uuid
  account         M2O → account
  user            M2O → directus_users (nullable — some events are system-triggered)
  event_type      string — e.g. "trial.started", "subscription.upgraded"
  payload         JSON — event-specific data
  date_created    timestamp
```

#### Event Catalog

| Category | Event | Trigger Point | Payload |
|----------|-------|---------------|---------|
| **Auth** | `user.registered` | POST /register | {user_id, email, account_id} |
| **Trial** | `trial.started` | account.items.create hook | {plan, trial_end} |
| **Trial** | `trial.expiring_soon` | Cron (3 days before end) | {trial_end, days_remaining} |
| **Trial** | `trial.expired` | Cron (on expiry) | {trial_end} |
| **Subscription** | `subscription.activated` | checkout.session.completed | {plan, price, billing_period} |
| **Subscription** | `subscription.upgraded` | customer.subscription.updated | {old_plan, new_plan} |
| **Subscription** | `subscription.downgraded` | customer.subscription.updated | {old_plan, new_plan} |
| **Subscription** | `subscription.canceled` | customer.subscription.deleted | {plan, reason} |
| **Subscription** | `subscription.payment_failed` | invoice.payment_failed | {amount, next_retry} |
| **Usage** | `usage.warning_80` | Cron or on-call check | {resource, used, limit, percent} |
| **Usage** | `usage.warning_100` | Cron or on-call check | {resource, used, limit} |
| **Usage** | `usage.hard_limit` | Enforcement middleware | {resource, limit, blocked_action} |
| **Calculator** | `calculator.created` | calculators.items.create | {calculator_id, name} |
| **Calculator** | `calculator.activated` | /calc/activate | {calculator_id, mode} |
| **Calculator** | `calculator.deactivated` | Cron or manual | {calculator_id, reason} |
| **Calculator** | `calculator.over_limit` | /calc/activate | {calculator_id, limit, active_count} |
| **Lead** | `lead.captured` | Lead capture endpoint (#06) | {calculator_id, email, fields} |
| **Knowledge** | `kb.document_indexed` | Indexing pipeline (#12) | {kb_id, document_id, chunks} |
| **Knowledge** | `kb.storage_warning` | Cron | {kb_id, used_mb, limit_mb} |

Events are extensible — new features register new event types without changing the core system.

### 2. Email Templates (content layer)

```
email_templates (new collection)
  id              uuid
  account         M2O → account (null = system-wide template)
  slug            string — unique identifier (e.g. "trial-expiring")
  name            string — display name
  subject         string — Liquid template (e.g. "Your trial expires in {{ days_remaining }} days")
  body_html       text — Liquid template with HTML
  body_text       text — plain text fallback
  status          string — "published" | "draft"
  date_created    timestamp
  date_updated    timestamp
```

Templates use **Liquid** (already used by Directus email system) with event payload variables + account/user context variables.

#### Available Template Variables (all templates)

```liquid
{{ user.first_name }}
{{ user.last_name }}
{{ user.email }}
{{ account.name }}
{{ subscription.plan_name }}
{{ subscription.status }}
{{ subscription.trial_end | date: "%B %d, %Y" }}
{{ app_url }}
{{ support_email }}
```

Plus event-specific payload variables injected per trigger.

#### Seeded System Templates

| Slug | Event | Subject |
|------|-------|---------|
| `welcome` | user.registered | Welcome to Businesslogic |
| `trial-started` | trial.started | Your 14-day trial has started |
| `trial-expiring` | trial.expiring_soon | Your trial expires in {{ days_remaining }} days |
| `trial-expired` | trial.expired | Your trial has ended |
| `subscription-activated` | subscription.activated | Subscription confirmed — {{ plan }} plan |
| `payment-failed` | subscription.payment_failed | Payment failed — action required |
| `usage-warning` | usage.warning_80 | You've used 80% of your {{ resource }} |
| `usage-limit` | usage.warning_100 | {{ resource }} limit reached |
| `calculator-over-limit` | calculator.over_limit | Calculator limit reached — upgrade to add more |

System templates are defaults — accounts can override with custom templates for their own events (future: white-label communication).

### 3. Event-Template Bindings (routing layer)

```
email_triggers (new collection)
  id              uuid
  account         M2O → account (null = system-wide)
  event_type      string — matches platform_events.event_type
  template        M2O → email_templates
  enabled         boolean (default true)
  delay_minutes   integer (default 0 — send immediately, or delay for batching)
  conditions      JSON (optional — extra conditions, e.g. {plan: "starter"})
  recipient       string — "user" | "account_owner" | "admin" | custom email
  status          string — "active" | "paused"
```

When an event fires:
1. Log to `platform_events`
2. Query `email_triggers` for matching `event_type` (system-wide + account-specific)
3. If match found + enabled: render template with event payload + context → send via Directus mail

### 4. Client Data Export (data layer)

Endpoint + UI to pull account/user data sheets for analysis and outreach.

```
GET /calc/admin/export/accounts
  → CSV/JSON with: account name, owner email, plan, status, calculator count,
    calls this month, trial end, signup date, last active date

GET /calc/admin/export/events
  → CSV/JSON with: event log filtered by date range, event type, account
```

Admin-only endpoints. UI in Admin Dashboard (#05) with:
- Filter by date range, plan, status, event type
- Download CSV button
- Preview table

---

## Key Tasks

### Phase A: Event Capture

1. **Create `platform_events` collection** — schema migration
2. **Event emitter utility** — `emitEvent(db, {type, account, user, payload})` function
   - Writes to `platform_events`
   - Triggers email routing (sync or via queue)
3. **Instrument existing hooks**:
   - Registration → `user.registered`
   - Trial creation → `trial.started`
   - Trial expiry cron → `trial.expired` + add `trial.expiring_soon` (3-day warning)
   - Stripe webhooks → `subscription.*` events
   - Calculator activation → `calculator.activated`, `calculator.over_limit`
4. **Usage warning cron** — new cron (hourly) checks all accounts' usage against limits
   - Emit `usage.warning_80` and `usage.warning_100` events
   - Deduplicate: don't re-emit same warning within 24h (check `platform_events`)

### Phase B: Email Templates & Sending

5. **Create `email_templates` collection** — schema migration
6. **Create `email_triggers` collection** — schema migration
7. **Seed system templates** — migration script populates default templates
8. **Email rendering** — Liquid template engine (Directus already has it)
   - Inject event payload + user/account/subscription context
   - Render HTML + text versions
9. **Email sending** — use Directus `MailService`
   - Respects configured SMTP/transport
   - Fallback: log email to `platform_events` if mail transport fails
10. **Trigger routing** — on event emit, query matching triggers, render, send
    - Support `delay_minutes` via setTimeout or scheduled Directus Flow

### Phase C: Admin UI

11. **Email template editor** — Directus module page
    - List/edit templates with Liquid syntax
    - Preview with sample data
    - Test send button
12. **Event log viewer** — timeline of platform events per account
    - Filter by type, date, account
    - Shows which emails were triggered
13. **Trigger management** — enable/disable triggers, bind templates to events
14. **Data export** — CSV download endpoints + UI in Admin Dashboard

### Phase D: Account-Level Overrides (future)

15. **Account-specific templates** — accounts can customize email content for their brand
16. **Account-specific triggers** — e.g. send custom email when lead is captured on their calculator
17. **Webhook triggers** — alongside email, fire webhooks on events (extends #06 Lead Capture)

---

## Acceptance Criteria

- [ ] Platform events logged to `platform_events` collection for all defined event types
- [ ] Welcome email sent on registration
- [ ] Trial expiring email sent 3 days before trial end
- [ ] Trial expired email sent on expiry
- [ ] Subscription confirmation email sent on checkout
- [ ] Payment failed email sent with retry info
- [ ] Usage warning emails at 80% and 100% of each metered resource
- [ ] Email templates editable in admin UI with Liquid variables
- [ ] Triggers can be enabled/disabled per event type
- [ ] Client data exportable as CSV (accounts, events)
- [ ] Event log viewable per account in admin UI
- [ ] No duplicate warning emails within 24h window

---

## Dependencies

- **#08 (Pricing)** — usage limits must exist to trigger usage warnings
- **#05 (Admin Dashboard)** — event log + data export UI lives here
- **#06 (Lead Capture)** — `lead.captured` event
- **#12/#13 (Knowledge)** — `kb.*` events
- Directus MailService (exists) — SMTP must be configured
- Liquid template engine (exists in Directus)

## Technical Notes

- `platform_events` will grow — add retention policy (delete events older than 90 days, or archive)
- Event emission should be non-blocking — don't slow down the triggering action if email fails
- Consider Redis pub/sub for event routing if volume grows (currently: direct function call is fine)
- Deduplication for usage warnings: query `platform_events` for same event_type + account in last 24h before emitting

## Estimated Scope

- Event capture + emitter utility: ~150-200 lines
- Instrumenting existing hooks: ~100-150 lines (spread across extensions)
- Email templates + triggers collections: schema migration
- Seed templates: ~200 lines (HTML templates)
- Email rendering + sending: ~150 lines
- Trigger routing: ~100 lines
- Admin UI (template editor, event log, triggers): ~500-600 lines
- Data export endpoints: ~150 lines
