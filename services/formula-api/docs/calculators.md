# Calculators

Turn a spreadsheet into a typed function: define input fields mapped to cells, output fields mapped to cells/ranges, validate with JSON Schema (ajv), execute many times.

## Architecture

- Server-side LRU stores schemas, compiled ajv validators, property order, worker affinity
- Optional Redis persistence: recipe stored with long TTL (default 30d, `CALCULATOR_REDIS_TTL_SECONDS`)
- Optional Admin API persistence: last-resort fallback (see `docs/admin-api.md`)
- Rebuild chain: LRU → Redis → Admin API → 410 Gone (concurrent dedup via in-flight `Map<id, Promise>`)
- Each calculator pinned to specific worker via `_dispatchTo(workerIndex)`
- Worker stores engine + pre-computed mappings (sheetId-resolved, positional arrays)
- Hot path (`calculate`): positional `values[]` → `suspendEvaluation` → set inputs → `resumeEvaluation` → read outputs. Zero parsing.
- Engine rebuild safety net: if calculate throws, rebuild from stored data + retry once
- Worker TTL sweep every 30s destroys idle calculators
- Worker crash → rebuilt from Redis/Admin API if available, else 410 Gone

## Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/calculators` | Create: `{token, sheets, formulas, input, output, locale?, accountId?}` → 201 |
| POST | `/execute/calculator/:id` | Execute: flat input → flat output |
| GET | `/calculator/:id` | Metadata + schemas (with populated oneOf) |
| GET | `/calculator/:id/describe` | Clean schemas for UI: mapping/transform stripped, oneOf/title/order preserved |
| PATCH | `/calculator/:id` | Update any field (except `accountId`). Schema-only = fast, data change = engine rebuild |
| DELETE | `/calculator/:id` | Destroy engine, 204 |
| GET | `/calculators` | List all from LRU + Redis |

## Schema mapping format

- Single cell: `'SheetName'!C3` or `C3` (default sheet)
- Range (array output): `'Budget'!A45:F60`
- Column ref in array items: `mapping_item: "B"`

## Transforms

Preprocesses user values ↔ Excel values. Applied after validation (input) or after calculation (output). Null/undefined skip transforms.

| Transform | User → Excel | Excel → User |
|---|---|---|
| `date` | `"2025-02-27"` → `45715` | `45715` → `"2025-02-27"` |
| `time` | `"12:30:00"` → `0.520833` | `0.520833` → `"12:30:00"` |
| `datetime` | `"2025-02-27T12:30:00"` → `45715.520833` | `45715.520833` → `"2025-02-27T12:30:00"` |
| `percentage` | `15` → `0.15` | `0.15` → `15` |

Invalid transform format → 400. Implementation: `src/utils/transforms.js`.

## oneOf

Passed through as UI metadata for dropdown rendering. Not enforced server-side (stripped from ajv validation).

## Output error handling

After calculation, output fields are checked for engine errors (`{type, message, value}`). Any error → 422:

```json
{
  "error": "Calculation produced errors",
  "code": "OUTPUT_ERROR",
  "fields": [
    { "field": "total", "error": { "type": "VALUE", "message": "..." } },
    { "field": "expenses[0].amount", "error": { "type": "REF", "message": "..." } }
  ]
}
```

Errors never cached — only successful results cached.

## Unresolved functions

Create/PATCH responses may include `unresolvedFunctions` when formulas reference unknown function names. Array of `{name, references[]}` — each entry names the function and the cells that reference it. Only present with bl-excel engine.

## Metadata

`name`, `version`, `description`, `test`, `integration` — accepted on POST/PATCH, returned on all responses. Stored in LRU + Redis.

`integration` shape: `{skill: boolean, plugin: boolean}`. Requires `mcp.enabled: true`. See [Integration types](#integration-types-claude-skill--cowork-plugin).

## Result caching

- Cached in Redis with TTL (`CALCULATOR_RESULT_TTL_SECONDS`, default 1h)
- `X-Cache: HIT/MISS` header on responses
- Invalidated on PATCH

## Redis env vars

| Var | Default | Description |
|---|---|---|
| `CALCULATOR_REDIS_TTL_SECONDS` | `2592000` (30d) | Recipe TTL |
| `CALCULATOR_RESULT_TTL_SECONDS` | `3600` (1h) | Result cache TTL |
| `ACCOUNT_LIMITS_REDIS_TTL_SECONDS` | `86400` (24h) | Account limits TTL |

## MCP (Model Context Protocol)

Each calculator can be exposed as an MCP tool via Streamable HTTP transport.

**Opt-in:** Set `mcp` object on POST/PATCH: `{enabled, toolName, toolDescription?, responseTemplate?}`.

**Endpoint:** `POST /mcp/calculator/:id` — JSON-RPC 2.0 over HTTP, stateless.

**Methods:** `initialize`, `notifications/initialized` (202), `tools/list` (LLM-enriched schema), `tools/call` (executes calculator), `ping`.

**Auth:** `X-Auth-Token` required for `tools/call`. Rate limiting + allowlist apply.

**Admin:** `GET /calculator/:id/mcp` returns connection config + Claude Desktop snippet.

**Error mapping:** HTTP → JSON-RPC codes with `data.httpStatus`. See `docs/errors.md`.

**Implementation:** `src/routes/mcp.js`

## Integration types (Claude Skill + Cowork Plugin)

Calculators with MCP enabled can be exposed as additional integration types. Set `integration` object on POST/PATCH:

```json
{
  "integration": { "skill": true, "plugin": true }
}
```

Both require `mcp.enabled: true` — the tool metadata (name, description, response template) comes from the `mcp` config.

Skill and plugin generation is handled by the Admin API, not this service. The `integration` flags are stored on the calculator and read by admin to determine which integrations to generate.
