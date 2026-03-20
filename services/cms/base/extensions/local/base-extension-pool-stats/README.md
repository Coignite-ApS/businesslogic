# Directus Pool Stats Extension

Database connection pool monitoring for Directus (Knex/Tarn).

## Endpoints

All endpoints require **admin authentication**.

| Endpoint | Description |
|----------|-------------|
| GET /pool-stats | Full stats, config, health |
| GET /pool-stats/health | Simple health check (503 on critical) |
| GET /pool-stats/metrics | Prometheus format |
| GET /pool-stats/test | Connection acquire latency |

## Configuration

Optional environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| POOL_STATS_UTILIZATION_WARNING | 70 | Warning threshold (%) |
| POOL_STATS_UTILIZATION_CRITICAL | 90 | Critical threshold (%) |
| POOL_STATS_PENDING_WARNING | 5 | Pending acquires warning |

## Response Examples

### GET /pool-stats

```json
{
  "stats": {
    "used": 3,
    "free": 7,
    "pendingAcquires": 0,
    "pendingCreates": 0,
    "total": 10
  },
  "config": {
    "min": 2,
    "max": 10,
    "acquireTimeoutMillis": 30000,
    "idleTimeoutMillis": 30000
  },
  "health": {
    "status": "healthy",
    "poolUtilization": 30,
    "availableConnections": 7,
    "warnings": []
  },
  "client": { "dialect": "pg" }
}
```

### GET /pool-stats/health

Returns 200 for healthy/warning, 503 for critical.

```json
{
  "status": "healthy",
  "poolUtilization": 30,
  "availableConnections": 7,
  "pendingAcquires": 0
}
```

### GET /pool-stats/test

```json
{
  "status": "ok",
  "latencyMs": 2,
  "timestamp": "2024-12-08T10:00:00.000Z"
}
```
