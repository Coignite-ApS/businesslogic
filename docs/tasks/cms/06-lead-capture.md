# 06. Lead Capture & CRM Integration

**Status:** planned
**Phase:** 2 — Go-to-Market Foundation
**New project** — identified from competitive analysis (March 2026)

---

## Goal

Turn embeddable calculator widgets into lead generation tools by adding optional email gating, submission webhooks, native CRM integrations, and branded PDF result downloads. This is what separates a "calculator" from a "marketing tool" — every competitor in the space (Outgrow, Calconic, ConvertCalculator) has lead capture. We don't.

---

## Why This Matters

- Interactive calculators drive **2x more conversions** than static content
- **81% of B2B buyers** prefer interactive content over static
- ROI calculators convert at **11%+** in financial services
- But without lead capture, the calculator is a utility, not a funnel
- B2B marketing teams won't adopt a calculator tool that doesn't feed their CRM

---

## Current State

- No lead capture mechanism exists
- No webhook/integration system for calculator submissions
- Calculator results are ephemeral — computed and displayed, never stored
- No PDF export of results
- The widget (#04) will render calculators, but has no conversion layer

---

## Architecture

Lead capture is a layer between the widget and the calculation result. It can be enabled/disabled per calculator.

```
User fills calculator inputs
        ↓
Widget calls execute API → gets results
        ↓
Lead gate enabled?
  ├── NO  → show results immediately
  └── YES → show partial results + email form
               ↓
             User submits email
               ↓
             POST /calc/lead/:calcId
               ├── Store lead in calculator_leads collection
               ├── Fire webhook (if configured)
               ├── Send result email to user (optional)
               └── Return full results to widget
```

---

## Data Model

```
calculator_leads (new collection)
  ├── id (uuid)
  ├── calculator (M2O → calculators)
  ├── account (M2O → account)
  ├── email (string)
  ├── name (string, optional)
  ├── company (string, optional)
  ├── custom_fields (JSON — configurable extra fields)
  ├── inputs (JSON — the calculator inputs they used)
  ├── outputs (JSON — the calculator results)
  ├── source_url (string — page where calculator was embedded)
  ├── ip_address (string, optional — for spam detection)
  ├── date_created (timestamp)
  └── utm_params (JSON — utm_source, utm_medium, utm_campaign from embed page)

calculator_lead_settings (fields on calculator_configs or separate collection)
  ├── lead_gate_enabled (boolean, default false)
  ├── lead_gate_mode (string — "full" = block all results, "partial" = show highlights, gate details)
  ├── required_fields (JSON array — ["email"] minimum, optionally ["email", "name", "company"])
  ├── custom_fields (JSON array — [{name, label, type, required}])
  ├── gate_title (string — "Get your full results")
  ├── gate_description (string — "Enter your email to see the detailed breakdown")
  ├── send_results_email (boolean — email results to lead)
  ├── webhook_url (string — POST webhook on submission)
  ├── webhook_secret (string — HMAC signing for webhook verification)
  └── pdf_enabled (boolean — include PDF download link in results)
```

---

## Key Tasks

### API (calculator-api extension)
- `POST /calc/lead/:calcId` — submit lead data + get full results
  - Validate email format
  - Rate limit per IP (prevent spam)
  - Store in `calculator_leads`
  - Fire webhook if configured (async, non-blocking)
  - Return full calculator results
- `GET /calc/leads/:calcId` — list leads for a calculator (authenticated, account-scoped)
- `GET /calc/leads/:calcId/export` — CSV export of leads
- Webhook delivery:
  - POST to configured URL with JSON payload (lead data + calculator results)
  - HMAC-SHA256 signature in `X-Webhook-Signature` header
  - Retry 3x with exponential backoff on failure

### Widget Integration (render library #04)
- Lead gate component: email form overlaying results
- Two modes:
  - **Full gate**: results hidden until email submitted
  - **Partial gate**: show 1-2 headline metrics, gate the detailed breakdown
- Smooth transition: form submits → results animate in
- UTM parameter capture from embedding page URL
- Source URL capture via `document.referrer` or `window.location`

### PDF Result Export
- Generate branded PDF with:
  - Calculator name and description
  - All inputs with labels and values
  - All outputs with labels, values, and formatting
  - Account branding (logo, colors) if configured
  - Date generated
  - CTA / next steps text (configurable)
- Generate server-side (puppeteer/html-to-pdf or simple HTML template → PDF)
- Return as download link in results and/or email attachment

### Email Results
- Send calculator results to the lead's email
- Use Directus email system (already configured for Mailgun)
- Template: clean HTML with inputs, outputs, PDF attachment
- Configurable: enabled/disabled per calculator

### CRM Integrations (phase 2 of this project)
- **Webhook** (phase 1 — universal, works with Zapier/Make/n8n for any CRM)
- **HubSpot** native: create/update contact + log activity
- **Salesforce** native: create lead + attach calculator data
- Store integration credentials per account in `account_integrations` collection

### UI (calculators module)
- Lead settings tab on calculator configure page
- Toggle lead gate on/off
- Configure required fields, custom fields
- Set gate copy (title, description)
- Webhook URL + test button ("Send test webhook")
- Lead list view with search, filter by date, CSV export
- Per-lead detail: inputs used, results, source URL, UTMs

---

## Acceptance Criteria

- [ ] Lead gate can be enabled per calculator
- [ ] Email submission stores lead + returns full results
- [ ] Partial gate mode shows headline metrics, gates details
- [ ] Webhook fires on lead submission with signed payload
- [ ] CSV export of leads works
- [ ] PDF result download generates branded document
- [ ] Email results sends formatted calculator output to lead
- [ ] UTM parameters and source URL are captured
- [ ] Lead data is scoped to account (multi-tenant isolation)
- [ ] Rate limiting prevents spam submissions

---

## Dependencies

- **#04a (Core Widget)** — the widget must exist to add the lead gate layer
- **#04 (Formula API Security)** — public-facing endpoint must be secured
- Directus email configuration (exists)

## Competitive Context

| Feature | Us (after this) | Outgrow | Calconic | ConvertCalc | SpreadsheetWeb | SpreadAPI |
|---------|----------------|---------|----------|-------------|----------------|-----------|
| Lead gate | Yes | Yes | Yes | Yes | Yes | No |
| Webhook | Yes | Yes | Zapier only | No | Yes | Webhook |
| HubSpot | Phase 2 | Yes | No | No | Yes | No |
| Salesforce | Phase 2 | Yes | No | No | Yes | No |
| PDF export | Yes | No | No | No | Yes | No |
| Email results | Yes | Yes | Yes | No | No | No |

PDF export is a differentiator — only SpreadsheetWeb has it among direct competitors. For B2B, a branded PDF that a prospect can forward to their CFO is extremely valuable.

## Estimated Scope

- API: ~400-500 lines (lead endpoint, webhook delivery, CSV export)
- Widget lead gate: ~200-300 lines (Lit component)
- PDF generation: ~200-300 lines (HTML template + PDF lib)
- Email template: ~100 lines
- UI: ~400-500 lines (lead settings, lead list, lead detail)
- CRM integrations: ~300-400 lines per integration (phase 2)
