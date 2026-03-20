# Configuration

All configuration is via environment variables with sensible defaults.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENGINE` | `hyperformula` | Formula engine: `hyperformula`, `bl-excel` (Rust napi), or `both` (shadow comparison) |
| `PORT` | `3000` | HTTP listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `POOL_SIZE` | CPU count | Worker thread pool size |
| `REQUEST_TIMEOUT_MS` | `10000` | Max time per formula evaluation |
| `MAX_QUEUE_DEPTH` | `POOL_SIZE * 64` | Max pending requests before 503. `0` = auto. |
| `MAX_HEAP_USED_BYTES` | `0` (disabled) | Heap limit for backpressure. Accepts `400MB`, `1GB`. |
| `LOG_LEVEL` | `warn` | Fastify log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`) |
| `DEFAULT_LOCALE` | `enUS` | Default formula locale |
| `REDIS_URL` | *(none)* | Optional Redis URL for cross-instance caching |
| `CACHE_TTL_SECONDS` | `3600` | Cache entry TTL (both LRU and Redis) |
| `CACHE_MAX_MEMORY_ITEMS` | `50000` | Max items in LRU cache per instance |
| `MAX_UPLOAD_SIZE` | `5MB` | Max xlsx file upload size for `/parse/xlsx`. Accepts `10MB`, `1GB`, etc. |
| `CALCULATOR_TTL_SECONDS` | `1800` | Auto-expire idle calculators (server LRU + worker TTL sweep) |
| `MAX_CALCULATORS_PER_WORKER` | `10` | Max calculator engines per worker thread (LRU eviction) |
| `MAX_CALCULATORS` | `100` | Max total calculators in server-side LRU store |
| `CALCULATOR_REDIS_TTL_SECONDS` | `86400` | Calculator recipe TTL in Redis (24h). Set longer than `CALCULATOR_TTL_SECONDS`. |
| `CALCULATOR_RESULT_TTL_SECONDS` | `3600` | Calculator execution result cache TTL in Redis (1h). |
| `INSTANCE_ID` | `{hostname}-{random}` | Unique instance identifier (auto-generated if not set) |
| `INTERNAL_URL` | *(none)* | Internal URL for this instance (e.g. `http://excel-api-1:3000`). Enables calculator routing. |
| `HEALTH_PUSH_INTERVAL_MS` | `15000` | How often to push health snapshot to Redis |
| `HASH_RING_REFRESH_MS` | `5000` | How often to rebuild the hash ring from Redis |

### Example

```bash
PORT=3000 POOL_SIZE=2 REDIS_URL=redis://10.0.0.1:6379 npm start
```

### Multi-instance example

```bash
# Instance 1
INSTANCE_ID=excel-api-1 INTERNAL_URL=http://excel-api-1:3000 \
  REDIS_URL=redis://redis:6379 npm start

# Instance 2
INSTANCE_ID=excel-api-2 INTERNAL_URL=http://excel-api-2:3000 \
  REDIS_URL=redis://redis:6379 npm start
```

---

## Caching

Two-layer cache architecture:

1. **LRU (in-memory)** — per-instance hot path, always active. Up to 50,000 items with 1hr TTL.
2. **Redis (optional)** — shared across instances. Enabled when `REDIS_URL` is set.

**Cache flow:**
- Request arrives → check LRU → check Redis → evaluate → store in both
- LRU miss + Redis hit → backfill LRU from Redis
- Redis is fire-and-forget (failures don't block responses)
- Redis disconnects gracefully — API falls back to LRU only

**Cache key format:** `f:{locale}:{formula}` — same formula with different locale = different cache entry.

**Cache skip:** Requests with the `data` parameter always skip cache (no read, no write). Formulas containing volatile functions (`RAND`, `RANDBETWEEN`, `NOW`, `TODAY`) also bypass cache.

---

## Locales

Pass short locale codes in API requests. The API maps them to engine locales:

| Short | Engine locale | IETF tag | Separator | Engine |
|-------|--------------|----------|-----------|--------|
| `en` | `enUS` | `en-US` | `,` | HF + BL |
| `da` | `daDK` | `da-DK` | `;` | HF + BL |
| `de` | `deDE` | `de-DE` | `;` | HF + BL |
| `es` | `esES` | `es-ES` | `;` | HF + BL |
| `fi` | `fiFI` | `fi-FI` | `;` | HF + BL |
| `fr` | `frFR` | `fr-FR` | `;` | HF + BL |
| `hu` | `huHU` | `hu-HU` | `;` | HF + BL |
| `it` | `itIT` | `it-IT` | `;` | HF + BL |
| `nb` | `nbNO` | `nb-NO` | `;` | HF + BL |
| `nl` | `nlNL` | `nl-NL` | `;` | HF + BL |
| `pl` | `plPL` | `pl-PL` | `;` | HF + BL |
| `pt` | `ptPT` | `pt-PT` | `;` | HF + BL |
| `sv` | `svSE` | `sv-SE` | `;` | HF + BL |
| `tr` | `trTR` | `tr-TR` | `;` | HF + BL |
| `cs` | `csCZ` | `cs-CZ` | `;` | HF + BL |
| `ru` | `ruRU` | `ru-RU` | `;` | HF + BL |
| `el` | `elGR` | `el-GR` | `;` | BL only |
| `et` | `etEE` | `et-EE` | `;` | BL only |
| `id` | `idID` | `id-ID` | `;` | BL only |
| `ja` | `jaJP` | `ja-JP` | `,` | BL only |
| `ko` | `koKR` | `ko-KR` | `,` | BL only |
| `ms` | `msMY` | `ms-MY` | `;` | BL only |
| `pt-br` | `ptBR` | `pt-BR` | `;` | BL only |
| `sl` | `slSI` | `sl-SI` | `;` | BL only |
| `uk` | `ukUA` | `uk-UA` | `;` | BL only |

English (`en`) uses `,` separator. All other locales use `;` and have localized function names (e.g. German `SUMME`, French `SOMME`).

**BL-only locales** (last 9 rows) are supported only by the `bl-excel` engine. When `ENGINE=hyperformula`, these fall back to `enUS`.

**IETF tag extraction:** `/parse/xlsx` reads the `dc:language` tag from xlsx files and returns the matching engine locale code. `/generate/xlsx` accepts a locale and embeds the IETF tag back into the generated xlsx. This enables full locale round-trip: parse → store → evaluate → generate.

**Performance note:** English locale uses a persistent engine (fastest). Non-default locales create a temporary engine per request (~2ms overhead).

---

## Blocked Functions

Some functions are blocked to prevent engine fingerprinting. They return the same `NAME` error as any unknown function.

Edit `src/blocked.js` to modify the list.

### Currently Blocked

| Function | Reason |
|----------|--------|
| `VERSION` | Returns engine name and version |
| `ISBINARY` | Engine-specific, not in Excel |
| `MAXPOOL` | Engine-specific ML function |
| `MEDIANPOOL` | Engine-specific ML function |
| `COUNTUNIQUE` | Google Sheets only (Excel: `COUNTA(UNIQUE())`) |
| `ARRAY_CONSTRAIN` | Google Sheets only |
| `ARRAYFORMULA` | Google Sheets only |
| `INTERVAL` | Google Sheets only |
| `SPLIT` | Google Sheets only (Excel: `TEXTSPLIT`) |

### Adding a Blocked Function

Add the function name to the `blockedFunctions` array in `src/blocked.js`:

```js
export const blockedFunctions = [
  'VERSION',
  'ISBINARY',
  // ... existing entries
  'NEW_FUNCTION',  // add here
];
```

The regex is compiled at startup — no runtime cost to adding entries.

### Volatile Functions (Non-Cacheable)

Formulas containing these functions bypass cache entirely — no read, no write. The formula still executes normally but always hits the worker pool. Detected via regex at any nesting depth (e.g. `SUM(RAND(),1)` is volatile).

Currently volatile: `RAND`, `RANDBETWEEN`, `NOW`, `TODAY`.

### Error Type Remapping

Engine-specific error types are remapped to standard Excel equivalents in `src/blocked.js`:

| Engine Error | Mapped To | Reason |
|-------------|-----------|--------|
| `CYCLE` | `REF` | Excel returns `#REF!` for circular references |
| `SPILL` | `REF` | Engine-specific array spill error |
| `LIC` | `NAME` | License error (never fires with GPL key) |

---

## Worker Thread Pool

The API runs formula evaluation in worker threads to keep the main event loop responsive.

- Pool size controlled by `POOL_SIZE` (default: CPU count)
- Round-robin dispatch with Promise-based message correlation
- Workers auto-respawn on crash
- Default locale uses a persistent engine per worker; non-default locales create temporary engines
- Requests with `data` param always use temporary engines (isolated state)
- Monitor via `GET /server/stats` → instance → `queue.pending`, `queue.max`

### Calculator Engines

Each calculator is pinned to a specific worker (affinity routing via `_dispatchTo(workerIndex)`). The worker stores the engine + pre-computed mappings.

- Max calculators per worker: `MAX_CALCULATORS_PER_WORKER` (LRU eviction of least-recently-used when full)
- TTL sweep runs every 30s in each worker, destroying calculators idle beyond `CALCULATOR_TTL_SECONDS`
- Server-side LRU also has TTL + max size (`MAX_CALCULATORS`), with dispose callback that destroys worker engine
- Worker crash → all calculators on that worker are lost → next execute returns 410 → client must recreate

### Backpressure

Two layers protect from overload:

1. **Queue-depth cap** — rejects with 503 when pending requests exceed `MAX_QUEUE_DEPTH`
2. **Heap memory cap** — `@fastify/under-pressure` rejects with 503 when `MAX_HEAP_USED_BYTES` exceeded

All 503 responses include `Retry-After: 5` header.
