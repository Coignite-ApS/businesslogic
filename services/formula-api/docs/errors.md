# Error Handling

**Never expose engine name.** `sanitizeDetail()` replaces "HyperFormula" with "engine". Error types remapped via `errorTypeMap` (CYCLE→REF, SPILL→REF, LIC→NAME).

## Response shapes

**Standard:** `{ "error": "message" }`

**With detail:** `{ "error": "Category", "detail": "specifics" }`

**Validation (400):** `{ "error": "Input validation failed", "details": [...ajv errors] }` — note `details` (plural, array)

**Formula error (422):** `{ "error": "Formula error", "type": "VALUE", "formula": "SUM(abc)" }` — type is Excel error name

**Output error (422):** `{ "error": "Calculation produced errors", "code": "OUTPUT_ERROR", "fields": [{ "field": "total", "error": { "type": "NA", "message": "..." } }] }` — dot-notation for nested fields

## HTTP status codes

| Code | Meaning |
|---|---|
| 400 | Invalid input, bad params |
| 401 | Missing auth header |
| 403 | Invalid token, IP/origin denied, account not found |
| 404 | Resource not found |
| 410 | Calculator expired/gone |
| 413 | Payload too large |
| 415 | Wrong MIME type |
| 422 | Formula/engine error, OUTPUT_ERROR |
| 429 | Rate limit (RPS or monthly) |
| 500 | Unexpected error |
| 503 | Backpressure (queue/heap/event loop) |

## MCP error mapping (JSON-RPC 2.0)

| HTTP | JSON-RPC code | Message |
|---|---|---|
| 400 | -32602 | Error message |
| 401 | -32600 | Missing X-Auth-Token |
| 403 | -32600 | Invalid auth / Access denied |
| 410 | -32603 | Calculator not found or expired |
| 422 | -32602 | Error (OUTPUT_ERROR forwards `code` + `fields`) |
| 429 | -32600 | Rate limit exceeded |
| 500 | -32603 | Error message |

## `unresolvedFunctions` enrichment

`#NAME?` errors may include an `unresolvedFunctions` array listing function names the engine couldn't resolve. Present on:

- **`/execute` and `/execute/batch` 422 responses** — array of strings (function names)
- **Calculator create/patch 201/200 responses** — top-level array of `{name, references[]}` when formulas contain unresolved functions
- **Calculator OUTPUT_ERROR field errors** — per-field array of strings when the source formula had unresolved functions

Only present when the error involves unknown function names (bl-excel engine only).

## Rules for new error responses

1. Always include `error` (string) as primary field
2. Use `detail` (singular, string) for context, `details` (plural, array) for multi-item lists
3. Never expose engine name — use `sanitizeDetail()`
4. Remap engine error types via `errorTypeMap`
5. Use correct HTTP status code from table above
6. For MCP: update error mapping if adding new status codes
