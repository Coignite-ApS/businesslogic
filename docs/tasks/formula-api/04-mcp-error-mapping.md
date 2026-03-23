# 04. MCP Error Code Mapping

**Status:** planned

---

## Goal

Map HTTP error codes to appropriate JSON-RPC error codes in the MCP endpoint so clients can distinguish retryable from permanent errors.

---

## Problem

Currently all errors return generic JSON-RPC error codes. MCP clients can't tell if they should retry (503 queue full) or give up (410 calculator gone).

---

## Mapping

| HTTP | Meaning | JSON-RPC Code | Retryable |
|------|---------|---------------|-----------|
| 503 | Queue full / overloaded | -32000 | Yes |
| 429 | Rate limited | -32000 | Yes (after backoff) |
| 410 | Calculator gone | -32001 | No |

---

## Changes Required

- In `src/routes/mcp.js`, update error handling to map HTTP status codes to distinct JSON-RPC error codes
- Include `retryable` hint in error data object

---

## Key Tasks

- [ ] Map 503 → `-32000` with `retryable: true` in error data
- [ ] Map 429 → `-32000` with `retryable: true` and `retryAfterMs` in error data
- [ ] Map 410 → `-32001` with `retryable: false` in error data
- [ ] Update `docs/errors.md` MCP error mapping section

---

## Acceptance

MCP clients get distinct error codes for retryable vs permanent errors.

---

## Key Files

- `src/routes/mcp.js` — MCP endpoint error handling
- `docs/errors.md` — error documentation
