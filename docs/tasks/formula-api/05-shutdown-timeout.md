# 05. Graceful Shutdown Timeout

**Status:** planned

---

## Goal

Add a hard timeout to graceful shutdown so the process exits within 5s even with stuck requests.

---

## Problem

`src/server.js` (lines 112–124) calls `app.close()` on SIGTERM/SIGINT but has no timeout. If a request is stuck (e.g. waiting on Redis or a slow formula), the process hangs indefinitely. Container orchestrators will SIGKILL after their own timeout, but that skips cleanup.

---

## Changes Required

- Wrap `app.close()` in `Promise.race` with a 5s timeout
- On timeout: log warning, `process.exit(1)`
- Make timeout configurable via `SHUTDOWN_TIMEOUT_MS` env var (default 5000)

---

## Key Tasks

- [ ] Add `SHUTDOWN_TIMEOUT_MS` to `src/config.js`
- [ ] Wrap shutdown in `Promise.race` with timeout in `src/server.js`
- [ ] Log warning on forced exit
- [ ] Update `docs/configuration.md` with new env var

---

## Acceptance

Process exits within 5s even with stuck requests. Timeout configurable via env var.

---

## Key Files

- `src/server.js` — shutdown handler (lines 112–124)
- `src/config.js` — env var config
- `docs/configuration.md` — env var documentation
