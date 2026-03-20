# Calculator API Proxy Extension

Hook extension that proxies all Formula API calls through Directus, enforces ownership, auto-syncs configs on save/launch, and self-heals expired calculators.

## Environment

| Variable | Required | Example |
|----------|----------|---------|
| `FORMULA_API_URL` | Yes | `http://formula-api:3000` |
| `FORMULA_API_ADMIN_TOKEN` | Yes | Admin token for Formula API CRUD |
| `TOKEN_ENCRYPTION_KEY` | Recommended | 64 hex chars (32 bytes) for AES-256-GCM token encryption |

If `FORMULA_API_URL` is not set, the extension logs a warning and disables all routes/hooks.

## Routes

All routes are registered at the Directus custom endpoint level (e.g. `POST /parse/xlsx`).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/parse/xlsx` | Authenticated user | Proxy multipart Excel upload to Formula API |
| GET | `/calculators/:configId` | Account member | Get calculator info from Formula API |
| POST | `/calculators/:configId` | Account member | Deploy (create/update) calculator from stored config |
| PATCH | `/calculators/:configId` | Account member | Re-sync calculator to Formula API from stored config |
| DELETE | `/calculators/:configId` | Account member | Remove from Formula API, clear `formula_api_id` |
| POST | `/calculators/:configId/execute` | Account member | Execute calculator with input values |
| GET | `/calculators/:configId/describe` | Account member | Get calculator parameter description |
| POST | `/calc/formula-tokens` | Authenticated user | Create new formula API key |
| GET | `/calc/formula-tokens` | Authenticated user | List formula API keys for active account |
| DELETE | `/calc/formula-tokens/:id` | Authenticated user | Revoke a formula API key |
| GET | `/management/calc/validate-token` | Formula API callback | Validate `X-Auth-Token`, resolve account |
| POST | `/calc/formula/execute` | Authenticated user | Proxy to Formula API `/execute` |
| POST | `/calc/formula/execute-batch` | Authenticated user | Proxy to Formula API `/execute/batch` |
| POST | `/calc/formula/execute-sheet` | Authenticated user | Proxy to Formula API `/execute/sheet` |

`:configId` = `calculator_configs.id` (UUID). The extension looks up the Formula API calculator ID from `data.formula_api_id`.

### Formula Execute Proxy Flow

The `/calc/formula/execute*` routes:
1. Authenticate user session (`requireAuth`)
2. Look up user's `active_account` from `directus_users`
3. Find first non-revoked `formula_tokens` row for that account
4. Decrypt the token (`TOKEN_ENCRYPTION_KEY`)
5. Forward request to Formula API with `X-Auth-Token` header
6. Return response as-is (including 422 errors for invalid formulas)

## Auth Middleware

- **requireAuth**: `req.accountability.user` must exist (logged-in Directus user)
- **requireCalculatorAccess**: Admin users bypass. Otherwise checks:
  ```
  calculator_configs → calculators → account → account_directus_users
  ```
  User must be a member of the calculator's account.

## Lifecycle Hooks

### Auto-sync on config save

`action('calculator_configs.items.create')` + `action('calculator_configs.items.update')`

When a config has all 4 fields (`sheets`, `formulas`, `input`, `output`):
- If `data.formula_api_id` exists → PATCH to Formula API
- If no ID or PATCH returns 410 → POST to create new → store ID
- Sends `name`, `description` from parent calculator row

### Cleanup on calculator delete

`filter('calculators.items.delete')`

Before cascade-deleting configs:
- Looks up all configs' `data.formula_api_id` values
- Fire-and-forget DELETE for each
- Non-blocking — Formula API calculators expire anyway

## Formula API ID Storage

Each `calculator_configs` row stores its Formula API calculator ID in `data.formula_api_id`. The `data` JSON field is used for this. Test and prod configs each get their own separate Formula API calculator.

## Self-Healing

When execute/describe/get returns 410 Gone from Formula API:

```
Request → Formula API
  200 → return response
  410 → POST /calculators with stored {sheets, formulas, input, output}
       → store new formula_api_id
       → retry original request
       → return response
```

## Error Mapping

| Formula API Response | Directus Response |
|---------------------|-------------------|
| 200-299 | Pass through |
| 400 | 400 + error body |
| 404 | 404 |
| 410 | Self-heal → retry |
| 410 + retry fails | 503 "Could not recreate" |
| 500+ / network error | 502 "Formula API unavailable" |

## Development

```bash
cd extensions/local/project-extension-calculator-api
npm install
npm run dev    # watch mode
npm run build  # production build
```

## File Structure

```
src/
├── index.ts           # Hook entry: routes + lifecycle hooks
├── formula-api.ts     # FormulaApiClient — HTTP client (native fetch)
├── crypto.ts          # AES-256-GCM encrypt/decrypt for token storage
├── helpers.ts         # Payload builders, deploy logic
├── auth.ts            # requireAuth + requireCalculatorAccess middleware
└── types.ts           # TypeScript interfaces
```
