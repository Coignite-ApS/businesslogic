# 03. Node.js Process Reliability

**Status:** completed
**Source:** CTO Review 2026-03-23 — F-003, F-010

---

## Goal

Add missing process-level error handlers and replace `console.log` with structured Pino logging in both Node.js services. Prevents silent crashes and enables production log aggregation.

---

## Key Tasks

### F-003: Add Process Error Handlers (HIGH)
- [x] Add `process.on('unhandledRejection')` to `services/formula-api/src/server.js` — log with Pino `.fatal()`, then `process.exit(1)`
- [x] Add `process.on('uncaughtException')` to `services/formula-api/src/server.js` — same pattern
- [x] Add both handlers to `services/ai-api/src/server.js`
- [x] Write tests: verify handlers are registered (check `process.listenerCount`)

### F-010: Replace console.log with Structured Logging (MEDIUM)
- [x] Replace `console.log` request logging in `services/formula-api/src/server.js` with `req.log.info()`
- [x] Replace `console.log` in `services/ai-api/src/server.js` with `req.log.info()`
- [x] Audit remaining `console.log` in both services' `src/` dirs — replace with fastify logger
- [x] Ensure log output is JSON in production (Pino default) and pretty in dev

---

## Key Files

- `services/formula-api/src/server.js`
- `services/ai-api/src/server.js`

---

## Acceptance Criteria

- [x] Both services handle unhandledRejection + uncaughtException with fatal log + exit
- [x] Zero `console.log` calls in production code paths (tests exempt)
- [x] Logs are structured JSON when `NODE_ENV=production`
- [x] All existing tests still pass
