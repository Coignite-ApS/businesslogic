# Formulas Module

Directus module for testing Formula API execute endpoints directly from the admin UI.

## Features

- **Single mode** — evaluate one formula (e.g. `=SUM(1,2,3)`)
- **Batch mode** — evaluate multiple formulas at once
- **Sheet mode** — evaluate formulas with cell references across data grids
- **16 locales** — test localized formulas (e.g. `SUMME(1;2;3)` in German)
- **No-token notice** — links to Account settings if no API key exists

## How It Works

```
User → Formulas module → POST /calc/formula/execute
                        → calculator-api hook (requireAuth)
                        → looks up user's formula_tokens
                        → decrypts token
                        → forwards to Formula API with X-Auth-Token
                        → returns result (or 422 error) to UI
```

The module does NOT call the Formula API directly — all requests go through the calculator-api proxy routes which handle auth and token management.

## Prerequisites

- User must have an `active_account`
- Account must have at least one non-revoked `formula_tokens` entry
- A default API key is auto-created on account registration

## File Structure

```
src/
├── index.ts                    # defineModule registration
├── types.ts                    # Payload interfaces
├── routes/
│   └── module.vue              # Main UI (tabs, input, results)
└── composables/
    └── use-formulas.ts         # API wrapper (execute, executeBatch, executeSheet)
```

## Development

```bash
cd extensions/local/project-extension-formulas
npm install
npm run dev    # watch mode
npm run build  # production build
```
