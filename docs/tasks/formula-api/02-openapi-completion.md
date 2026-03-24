# 02. OpenAPI Spec Completion

**Status:** completed

---

## Goal

Add all missing endpoints to `docs/openapi.yaml`. Currently ~12 endpoints are undocumented.

---

## Findings

All 10 endpoints were already fully documented in the spec. The task description was outdated. Two broken `$ref` links were found and fixed:

1. `#/components/parameters/AdminToken` — undefined; replaced with inline header parameter
2. `#/components/schemas/Error` (5 occurrences) — undefined; corrected to `#/components/schemas/ErrorResponse`

Version `1.23.0` already matches `package.json`.

---

## Key Tasks

- [x] Document all calculator CRUD endpoints with request/response schemas
- [x] Document `/execute/calculator/:id` with input/output mapping shapes
- [x] Document `/calculator/:id/describe` response shape
- [x] Document `/calculator/:id/health` response
- [x] Document MCP endpoint (JSON-RPC 2.0 request/response)
- [x] Document `/generate/xlsx` multipart response
- [x] Bump `info.version` to match `package.json`
- [x] Fix broken `$ref` links (AdminToken parameter, Error schema)

---

## Acceptance

Every route registered in `src/routes/*.js` has a matching OpenAPI path in `docs/openapi.yaml`.

---

## Key Files

- `docs/openapi.yaml` — spec to update
- `src/routes/calculators.js` — calculator CRUD + execute + describe
- `src/routes/mcp.js` — MCP endpoint
- `src/routes/generate.js` — xlsx generation
