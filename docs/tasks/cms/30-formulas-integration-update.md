# CMS-30: Formulas Module — Integration Page Update

**Status:** completed
**Priority:** MEDIUM
**Depends on:** CMS-26

## Problem

The formulas module has its own integration page with code snippets that reference `X-Auth-Token` and direct formula-api URLs. Same issue as CMS-26 (calculators snippets) but in a separate extension.

## Implementation

### code-snippets.ts
- Renamed `FormulaSnippetParams.token` → `apiKey`
- Replaced `X-Auth-Token` → `X-API-Key` in all 7 languages (curl, JS, Python, PHP, Go, Rust, Java)
- All snippet functions now destructure `{ baseUrl, apiKey }` instead of `{ baseUrl, token }`

### code-examples.vue
- Updated `maskedParams` computed to mask `apiKey` instead of `token`

### use-formula-token.ts (composable)
- Switched from `/calc/formula-tokens` + `/calc/formula-token-value` to `/calc/api-keys` (gateway API keys)
- Still uses `/calc/formula-api-url` for gateway URL
- Picks first available API key for snippet display

### integration.vue
- Sidebar text: `X-Auth-Token` → `X-API-Key`
- `snippetParams` computed: `token` → `apiKey`

### Tests added
- `src/__tests__/code-snippets.test.ts` — 39 tests covering:
  - All 7 languages × 3 endpoints use `X-API-Key` (not `X-Auth-Token`)
  - All snippets include gateway baseUrl
  - All snippets include apiKey value
  - Interface uses `apiKey` property
  - `maskToken()` utility

## Key Files

- `services/cms/extensions/local/project-extension-formulas/src/utils/code-snippets.ts`
- `services/cms/extensions/local/project-extension-formulas/src/routes/integration.vue`
- `services/cms/extensions/local/project-extension-formulas/src/components/code-examples.vue`
- `services/cms/extensions/local/project-extension-formulas/src/composables/use-formula-token.ts`
- `services/cms/extensions/local/project-extension-formulas/src/__tests__/code-snippets.test.ts`

## Tests

- [x] All 7 language snippets generate with X-API-Key
- [x] Gateway URL used in all snippets
- [x] Integration page displays correct header name
