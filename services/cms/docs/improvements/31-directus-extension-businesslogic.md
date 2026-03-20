# #31 — directus-extension-businesslogic

**Status:** planned
**Phase:** 7 (Distribution & Ecosystem)
**NPM:** `directus-extension-businesslogic`
**Repo:** separate repository (easier to test, publish, and maintain independently)
**Publishing guide:** [../directus-marketplace-publishing.md](../directus-marketplace-publishing.md)

## Goal

Public Directus extension that watches collection/field changes and triggers calculations via the Businesslogic Formula API — writing results back to targeted fields. Turns any Directus collection into a live, computed data layer powered by Excel-grade formulas.

## Why

No existing Directus extension does this properly:

| Extension | Server-side | Persists to DB | Safe | Maintained | External API |
|-----------|-------------|----------------|------|------------|-------------|
| Voldemorten (calculated-fields) | Yes (filter+cron) | Yes | No (`new Function()`) | No | No |
| Rezo Labs (computed-interface) | No (client only) | Configurable | Yes | No (abandoned) | No |
| Directus Labs (calculated-fields-bundle) | No (client only) | No | Yes | Yes | No |
| **This extension** | **Yes (action hooks)** | **Yes** | **Yes (no eval)** | **Yes** | **Yes (Formula API)** |

Distribution/marketing vehicle — every Directus user who installs it becomes a Businesslogic API customer. Existing trial covers onboarding friction.

## Sandbox Constraint Analysis

The Directus Sandbox SDK is extremely limited — only 3 functions exist:

| SDK Function | Can Do | Cannot Do |
|-------------|--------|-----------|
| `request(url, opts)` | HTTP calls to external APIs | — |
| `sleep(ms)` | Async delay | — |
| `log(msg)` | Write to Directus logger | — |

**No access to:** database, environment variables, Directus services, ItemsService, schema, accountability, filesystem, third-party imports.

**Sandboxed hooks** only support `action` and `filter` (no `init`, `schedule`, `embed`). Callbacks receive only `payload: unknown` — no meta, context, schema, or accountability.

### Our Needs vs Sandbox Capabilities

| Requirement | Sandbox? | Why Not |
|-------------|----------|---------|
| Call Formula API | Yes | `request()` works |
| Read/write Directus items | **No** | No DB/items SDK |
| Read env vars for API tokens | **No** | No `env` access |
| Auto-create collections on init | **No** | No `init` hook, no services |
| Register dynamic action hooks | Partial | Only `action`/`filter`, no dynamic registration |
| Cache rules in memory | **No** | No persistent state, no `init` |
| Encrypt/decrypt tokens | **No** | No crypto, no third-party imports |

### Decision: Non-sandboxed hook + App extensions

- **Hook:** Non-sandboxed (requires `MARKETPLACE_TRUST=all` for Marketplace install)
- **Interface:** App extension (always installable from Marketplace)
- **Operation:** App extension (always installable from Marketplace)

This matches what many community extensions and even some Directus Labs extensions do. Document the `MARKETPLACE_TRUST=all` requirement prominently in README.

**Workaround considered and rejected:** Using `request()` to call the Directus REST API in loopback for item CRUD. Fragile (needs to know its own URL), no env vars for auth, and sandbox payload lacks accountability context needed for proper permission scoping.

## Architecture

### Extension Type: Bundle

```
directus-extension-businesslogic/     # Separate repo
├── src/
│   ├── hook/          # Action hooks — watches collections, calls API, writes results
│   │   └── index.ts
│   ├── interface/     # Config UI — field-level formula/calculator binding editor
│   │   ├── index.ts
│   │   └── interface.vue
│   └── operation/     # Flow operation — use in Directus Flows for manual triggers
│       └── index.ts
├── package.json       # type: "bundle", entries: [hook, interface, operation]
└── README.md
```

### Core Concept: Calculation Rules

A **rule** binds a trigger (collection + fields) to a calculation (Formula API calculator or inline formula) and a target (collection + fields to write results to).

Rules stored in a `bl_calculation_rules` collection (auto-created on first run):

```
bl_calculation_rules
├── id                  UUID
├── name                string          "Price Calculator"
├── enabled             boolean         true
├── trigger_collection  string          "products"
├── trigger_fields      json            ["price", "quantity", "discount"]
├── trigger_on          string          "create,update"  (or "create" / "update" only)
├── mode                string          "calculator" | "formula"
├── calculator_id       string          "price-calc" (for mode=calculator)
├── api_url             string          "https://api.businesslogic.online"
├── api_token           string          (encrypted, Formula API token)
├── input_mapping       json            { "base_price": "{{price}}", "qty": "{{quantity}}" }
├── output_mapping      json            { "total": "total_price", "tax": "tax_amount" }
├── target_collection   string          "products" (same or different collection)
├── target_item         string          "{{$trigger.id}}" (or FK expression for cross-collection)
├── formula             string          "{{price}} * {{quantity}} * (1 - {{discount}})" (mode=formula)
├── target_field        string          "total_price" (for mode=formula, single output)
├── error_handling      string          "ignore" | "log" | "null"
├── sort                integer
├── date_created        timestamp
├── date_updated        timestamp
```

### Two Modes

**Mode: `calculator`** — Full Excel-powered calculation via Formula API
- Maps trigger item fields → calculator inputs via `input_mapping`
- Calls `POST /execute/calculator/{calculator_id}` with mapped inputs
- Maps calculator outputs → target fields via `output_mapping`
- Supports cross-collection writes (e.g., product change → update order line totals)

**Mode: `formula`** — Simple inline expression (no API call)
- Template syntax: `{{field}}` references + basic math operators
- Evaluated server-side with a safe expression parser (e.g., `expr-eval` or `mathjs`)
- Single output → single target field
- Zero latency, no external dependency

### Hook Flow

```
item.create / item.update on "products"
  ↓
Hook checks: any enabled rules where trigger_collection = "products"
  AND trigger_fields ∩ changed_fields ≠ ∅ ?
  ↓
For each matching rule:
  ├── mode=formula → evaluate expression, write result
  └── mode=calculator → build input from mapping
       ↓
       POST {api_url}/execute/calculator/{calculator_id}
       Headers: X-Auth-Token: {decrypted api_token}
       Body: { "base_price": 99.99, "qty": 5 }
       ↓
       Response: { "total": 474.95, "tax": 47.49 }
       ↓
       Write via output_mapping:
         target_collection.target_item.total_price = 474.95
         target_collection.target_item.tax_amount = 47.49
```

### Interface Component

A field interface that shows a read-only computed value with a "recalculate" button. Configuration panel lets admins:
- Select calculator ID (fetched from API via `/describe`)
- Map input fields (autocomplete from collection schema)
- Map output fields
- Test with sample data

### Flow Operation

A Directus Flow operation node that executes a Businesslogic calculator:
- Inputs: calculator_id, api_url, api_token, input values (from flow data)
- Output: calculator results (available to downstream nodes)
- Enables: scheduled recalculations, batch processing, webhook-triggered calcs

## Configuration

### Environment Variables

```env
BUSINESSLOGIC_API_URL=https://api.businesslogic.online
BUSINESSLOGIC_API_TOKEN=your-formula-token
```

These are defaults — each rule can override with its own `api_url` and `api_token`.

### Auto-Setup

On first `init`, the hook:
1. Checks if `bl_calculation_rules` collection exists
2. If not, creates it via Directus schema (FieldsService + CollectionsService)
3. Registers action hooks for all collections referenced in enabled rules
4. Caches rules in memory, refreshes on `bl_calculation_rules` changes

## Key Design Decisions

1. **Action hooks, not filter hooks** — Calculations happen AFTER save (async), not blocking the write pipeline. Avoids timeout issues with slow API calls.

2. **No `new Function()` / `eval()`** — Inline formulas use a safe expression parser. Calculator mode delegates all logic to Formula API.

3. **Rules in a collection, not field options** — Unlike Voldemorten (stores code in field meta), rules live in their own collection. This enables: admin UI for managing rules, cross-collection rules, multiple rules per trigger, API access to rule definitions.

4. **Encrypted tokens** — API tokens stored with the same AES-256-GCM encryption used elsewhere in the platform.

5. **Debounced execution** — If a rule triggers but the same item+rule combo is already queued, skip duplicate. Prevents cascading loops.

6. **Loop prevention** — If a rule writes to a field that triggers another rule, track execution depth. Max depth = 3 (configurable). Log warning on loop detection.

7. **Non-sandboxed by necessity** — Sandbox SDK lacks DB access, env vars, init hooks, and third-party imports. Document `MARKETPLACE_TRUST=all` requirement. Revisit when Directus adds items/database scopes to sandbox SDK.

## Scope / Key Tasks

- [ ] Create separate repo `directus-extension-businesslogic`
- [ ] Scaffold bundle extension (`npx create-directus-extension@latest`)
- [ ] Hook: auto-create `bl_calculation_rules` collection on init
- [ ] Hook: load rules, register action listeners per trigger collection
- [ ] Hook: rule cache invalidation when rules change
- [ ] Hook: formula mode — safe expression evaluator
- [ ] Hook: calculator mode — API client, input/output mapping
- [ ] Hook: loop detection + debounce
- [ ] Hook: error handling (log, ignore, null)
- [ ] Hook: encrypted token storage
- [ ] Interface: rule editor UI (calculator picker, field mapping)
- [ ] Interface: test/preview panel
- [ ] Operation: Flow operation node for manual/scheduled triggers
- [ ] README with setup guide, screenshots (raw.githubusercontent.com)
- [ ] NPM publish config + validation (`npx create-directus-extension@latest validate`)
- [ ] Tests (vitest)
- [ ] Marketplace listing verification

## Acceptance Criteria

- Install via `npm install directus-extension-businesslogic` or Directus Marketplace (with `MARKETPLACE_TRUST=all`)
- Configure a rule via Data Studio UI (no code required)
- Item create/update triggers calculation, result persisted to target field
- Calculator mode calls Businesslogic API, handles errors gracefully
- Formula mode evaluates simple expressions without external calls
- No arbitrary code execution (no eval/Function)
- Works with Directus 11.x
- Loop detection prevents infinite cascades
- Passes `npx create-directus-extension@latest validate`

## Notes

- **Revenue angle:** Every installation drives Formula API usage. Existing trial covers onboarding.
- **Future: `mode: "webhook"`** for calling arbitrary URLs — broader appeal, more installs → more Businesslogic awareness.
- **Future: sandboxed version** when Directus adds items/database scopes to the sandbox SDK (tracked in directus/directus#22984, closed but roadmapped).
