# Admin API

External API for stats telemetry and recipe persistence. Auto-enabled when both `ADMIN_API_URL` and `ADMIN_API_KEY` are set.

| Var | Default | Description |
|---|---|---|
| `ADMIN_API_URL` | `null` | Base URL (no trailing slash) |
| `ADMIN_API_KEY` | `null` | Bearer token |

## Stats telemetry

Tracks `/execute/calculator/:id` calls. Records: `calculator_id`, `timestamp`, `cached`, `error`, `response_time_ms`, `error_message`, `test`. Buffer in-memory, flush via `POST {ADMIN_API_URL}/management/calc/stats`.

- No re-queue on failure (no duplicates; some loss during outage)
- Exponential backoff 10s → 5min on failure
- Buffer capped at 50k entries (oldest dropped on overflow)
- Graceful shutdown: final flush with 5s timeout

| Var | Default | Description |
|---|---|---|
| `STATS_FLUSH_INTERVAL_MS` | `10000` | Flush interval |
| `STATS_MAX_BATCH` | `1000` | Max items per POST |

Monitor: `GET /health` → `stats.buffered`, `stats.totalFlushed`, `stats.totalDropped`.

Implementation: `src/services/stats.js`

## Recipe persistence (read-only)

Admin API is source of truth for calculator recipes. Formula API reads as last-resort fallback.

- `GET {ADMIN_API_URL}/management/calc/recipes/{id}` — 30s timeout. 200 → rebuild, 404/error → 410 Gone.
- On hit, backfilled into Redis.
- **Rebuild chain:** LRU → Redis → Admin API → 410 Gone

## Account rate limiting

Recipe's `accountId` links calculator to account.

**Account endpoint:**
```
GET {ADMIN_API_URL}/accounts/{accountId}
Authorization: Bearer {ADMIN_API_KEY}
```

Response 200:
```json
{ "rateLimitRps": 50, "rateLimitMonthly": 100000, "monthlyUsed": 85000 }
```

- `rateLimitRps` / `rateLimitMonthly`: `number|null`. `null`/`0` = unlimited.
- `monthlyUsed`: warm-starts counter after restart.
- Lookup: in-memory → Redis (`accl:{accountId}`) → Admin API (5s timeout).
- On calculator rebuild: force-refresh from Admin API + update Redis.
