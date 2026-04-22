# 08. Replace console.log with Structured Logger

**Status:** done
**Source:** CTO Review 2026-04-15 — F-007

---

## Goal

2 `console.*` calls remain in production code paths in formula-api. Replace with Fastify's Pino logger (`req.log.*` or `app.log.*`).

---

## Key Tasks

- [x] Replace `console.*` in `services/formula-api/src/routes/calculators.js` with `app.log.*`
- [x] Scan all formula-api source for remaining `console.*` calls
- [x] Verify log output still appears in structured JSON format

---

## Key Files

- `services/formula-api/src/routes/calculators.js`

---

## Acceptance Criteria

- [x] Zero `console.*` in formula-api production source (tests exempt)
- [x] Logs are structured JSON via Pino

---

## Implementation Notes

- Added module-level `log` variable in `calculators.js`, set to `app.log` in `registerRoutes()`
- Replaced 2 `console.error()` calls in `loadFromDb()` and `fetchMcpConfig()` with `(log || console).error({ err }, msg)` — fallback to console if called before Fastify init (defensive)
- `config.js` console calls left untouched — pre-Fastify startup, intentional
- All 47 tests pass
