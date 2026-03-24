# 23. Widget Client Gateway Mode

**Service:** cms
**Status:** completed
**Depends on:** GW-03 (Widget Routes + Cache), CC-04 (Formula-API Gateway Auth)

---

## Goal

Widget `<bl-calculator>` supports dual mode: `api-key` attribute routes through gateway, `token` attribute uses legacy direct path. Gateway mode is the recommended path for new integrations.

---

## Integration Modes

```html
<!-- Gateway mode (new, recommended) -->
<bl-calculator api-key="blk_xxx" calculator-id="vat-calc"></bl-calculator>

<!-- Legacy mode (backward compat) -->
<bl-calculator token="abc123" calculator-id="vat-calc"></bl-calculator>
```

- `api-key` present → all requests go through gateway (`/v1/widget/*`)
- `token` present → direct to formula-api (existing behavior)
- Both present → `api-key` takes precedence
- Neither → error message rendered in widget

---

## Key Tasks

- [x] Widget API client: detect `api-key` vs `token` attribute
- [x] Gateway base URL config (default: `https://gateway.businesslogic.online`)
- [x] Route config/execute/catalog requests through gateway when `api-key`
- [x] Handle gateway-specific errors (403 insufficient permissions, 429 rate limit)
- [x] Update embed snippet generator in CMS to use `api-key` mode
- [x] CMS integration tab: show gateway embed code for keys with widget perms
- [x] Unit tests for dual-mode routing logic (4 gateway tests)
- [ ] E2E test: widget renders via gateway path

---

## Key Files

- `services/cms/extensions/local/project-extension-widget/src/api-client.ts` (modify)
- `services/cms/extensions/local/project-extension-calculators/` (embed snippet)
