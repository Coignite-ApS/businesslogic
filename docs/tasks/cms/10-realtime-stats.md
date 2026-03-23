# 10 — Real-time Statistics via WebSockets

**Status:** planned
**Phase:** 4 — Calculator Authoring & Platform

## Goal

Replace HTTP polling with Directus WebSocket subscriptions for live calculator statistics, reducing unnecessary network traffic and delivering instant updates.

## Problem

`calculator-stats.vue` polls `GET /items/calculator_calls` every **5 seconds** with `setInterval`. This is:
- **Wasteful** — most polls return no new data
- **Laggy** — up to 5s delay before new calls appear
- **Unscalable** — N open tabs = N×12 requests/minute, each fetching ALL records (last 12 months, `limit: -1`)

## Current Architecture

```
Formula API → POST /calculator/stats → calculator_calls table
                                            ↓
Frontend polls GET /items/calculator_calls every 5s (setInterval)
                                            ↓
calculator-stats.vue renders bar chart
```

## Proposed Architecture

```
Formula API → POST /calculator/stats → calculator_calls table
                                            ↓
Directus WebSocket subscription (auto-notifies on insert)
                                            ↓
calculator-stats.vue receives new records instantly
```

## Key Challenge: WebSocket Authentication

Directus WebSocket requires an auth token. The frontend uses cookie-based sessions (`directus_session_token`), which can't be directly passed to a WebSocket connection.

**Solution:** Expose a session token endpoint that extracts the token from the cookie so the frontend can authenticate the WebSocket handshake:

```ts
// Already prototyped by developer:
function getSessionToken(req, res) {
  const cookies = req.headers.cookie?.split(';').reduce((acc, c) => {
    const [name, value] = c.split('=').map(s => s.trim())
    acc[name] = value
    return acc
  }, {})
  const token = cookies?.['directus_session_token']
  token ? res.send({ session_token: token }) : res.status(404).send('not found')
}
```

**Improvement needed:** This endpoint should:
- Use a proper cookie parser (handle edge cases like encoded values, `=` in values)
- Consider using Directus SDK internals if available to get the current access token
- Rate-limit or cache to avoid abuse
- Investigate if `useApi()` from Directus extensions SDK already provides a token that can be reused for WS auth (may eliminate need for this endpoint entirely)

## Scope

### Phase A — Calculator Stats (primary target)

| Task | File |
|------|------|
| Add session token endpoint to calculator-api hook | `project-extension-calculator-api/src/index.ts` |
| Replace `setInterval` polling with WS subscription in stats component | `calculator-stats.vue` |
| Subscribe to `calculator_calls` filtered by calculator ID | — |
| Append new records to `records.value` on WS message | — |
| Keep initial HTTP fetch for historical data, WS for live updates only | — |
| Fallback: if WS disconnects, resume polling until reconnected | — |
| Remove 5s polling interval | — |

### Phase B — Admin Infrastructure Stats (optional)

| Task | File |
|------|------|
| Replace 30s polling of `/calc/server-stats` with WS on `system_health_snapshots` | `use-health.ts` |
| Lower priority — 30s polling is less wasteful than 5s | — |

## Technical Notes

### Directus WebSocket API

WebSockets are already enabled in all environments:
```yaml
WEBSOCKETS_ENABLED: 'true'
WEBSOCKETS_HEARTBEAT_ENABLED: 'true'
WEBSOCKETS_HEARTBEAT_PERIOD: 30
WEBSOCKETS_REST_ENABLED: 'true'
```

Directus REST-over-WebSocket subscription format:
```json
{
  "type": "subscribe",
  "collection": "calculator_calls",
  "query": {
    "filter": { "calculator": { "_eq": "<calculator-id>" } },
    "fields": ["timestamp", "error", "cached", "response_time_ms", "error_message", "test"],
    "sort": ["-timestamp"]
  }
}
```

### Auth Flow

1. Frontend calls `GET /calc/session-token` (cookie-authenticated)
2. Receives `{ session_token: "..." }`
3. Opens WebSocket to `ws://host/websocket`
4. Sends `{ type: "auth", access_token: "<token>" }`
5. Subscribes to `calculator_calls` collection
6. Receives `{ type: "subscription", event: "create", data: [...] }` on new inserts

### Alternative: Directus SDK `useItems` with `subscribeToItems`

Directus Vue composables may support real-time subscriptions natively. Investigate whether the extensions SDK provides this — could simplify implementation significantly and handle auth automatically.

## Acceptance Criteria

- [ ] Calculator stats update within 1s of a new call (no polling)
- [ ] No `setInterval` for stats fetching in `calculator-stats.vue`
- [ ] Graceful fallback to polling on WS disconnect
- [ ] Historical data still loaded via initial HTTP fetch
- [ ] No increase in server load (WS should reduce load vs polling)
- [ ] Works in all environments (local, dev, live)

## Dependencies

- None — WebSockets already enabled, `calculator_calls` collection exists

## Notes

- The `getSessionToken` pattern was previously prototyped but never integrated into stats
- Consider whether `useApi()` token can be reused — Directus extensions SDK may expose the access token internally, avoiding the cookie-parsing endpoint entirely
- The current poll also fetches ALL records every 5s (`limit: -1`, last 12 months) — even without WS, this should be optimized to only fetch records newer than the last known timestamp
- Quick win regardless of WS: add `filter[timestamp][_gte]` based on last fetched record to reduce payload size
