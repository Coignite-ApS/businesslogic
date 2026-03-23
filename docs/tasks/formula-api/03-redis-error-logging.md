# 03. Redis Error Logging

**Status:** planned

---

## Goal

Replace silent `.catch(() => {})` on Redis operations with logged warnings. Currently Redis failures are swallowed — no way to know Redis is down without checking externally.

---

## Problem

Multiple files catch and discard Redis errors:

| File | Pattern |
|------|---------|
| `src/services/cache.js` | `.catch(() => {})` on get/set |
| `src/services/rate-limiter.js` | `.catch(() => {})` on increment/check |
| `src/services/health-push.js` | `.catch(() => {})` on push |
| `src/routes/calculators.js` | `.catch(() => {})` on recipe cache |

This is correct for fault tolerance (service works without Redis) but wrong for observability.

---

## Changes Required

- Replace silent catches with `fastify.log.warn()` calls
- Rate-limit log output: max once per 60s per caller to avoid spam during sustained outage
- Simple approach: track `lastLoggedAt` per module, skip if within window

---

## Key Tasks

- [ ] Add rate-limited warn logging to `src/services/cache.js`
- [ ] Add rate-limited warn logging to `src/services/rate-limiter.js`
- [ ] Add rate-limited warn logging to `src/services/health-push.js`
- [ ] Add rate-limited warn logging to `src/routes/calculators.js`
- [ ] Verify service still degrades gracefully (no thrown errors)

---

## Acceptance

Redis failure produces at least one warning in logs. Logs are rate-limited to avoid spam during sustained outage.

---

## Key Files

- `src/services/cache.js`
- `src/services/rate-limiter.js`
- `src/services/health-push.js`
- `src/routes/calculators.js`
