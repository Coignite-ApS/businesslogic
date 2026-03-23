# 02. OpenAPI Spec Completion

**Status:** planned

---

## Goal

Add all missing endpoints to `docs/openapi.yaml`. Currently ~12 endpoints are undocumented.

---

## Missing Endpoints

| Endpoint | File | Method |
|----------|------|--------|
| `POST /calculators` | `src/routes/calculators.js` | Create calculator |
| `GET /calculators` | `src/routes/calculators.js` | List calculators |
| `GET /calculator/:id` | `src/routes/calculators.js` | Get calculator |
| `PATCH /calculator/:id` | `src/routes/calculators.js` | Update calculator |
| `DELETE /calculator/:id` | `src/routes/calculators.js` | Delete calculator |
| `POST /execute/calculator/:id` | `src/routes/calculators.js` | Execute calculator |
| `POST /calculator/:id/describe` | `src/routes/calculators.js` | Describe calculator |
| `GET /calculator/:id/health` | `src/routes/calculators.js` | Calculator health |
| `POST /mcp/calculator/:id` | `src/routes/mcp.js` | MCP Streamable HTTP |
| `POST /generate/xlsx` | `src/routes/generate.js` | Generate xlsx |

---

## Key Tasks

- [ ] Document all calculator CRUD endpoints with request/response schemas
- [ ] Document `/execute/calculator/:id` with input/output mapping shapes
- [ ] Document `/calculator/:id/describe` response shape
- [ ] Document `/calculator/:id/health` response
- [ ] Document MCP endpoint (JSON-RPC 2.0 request/response)
- [ ] Document `/generate/xlsx` multipart response
- [ ] Bump `info.version` to match `package.json`

---

## Acceptance

Every route registered in `src/routes/*.js` has a matching OpenAPI path in `docs/openapi.yaml`.

---

## Key Files

- `docs/openapi.yaml` — spec to update
- `src/routes/calculators.js` — calculator CRUD + execute + describe
- `src/routes/mcp.js` — MCP endpoint
- `src/routes/generate.js` — xlsx generation
