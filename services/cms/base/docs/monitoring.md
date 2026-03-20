# Monitoring and Resource Management

This document describes the monitoring capabilities and auto-restart features available in the Coignite Cockpit Directus deployment.

## Memory Stats Endpoint

The `memory-stats` extension provides HTTP endpoints for monitoring memory and CPU usage.

**Important**: All endpoints require **admin authentication**. Non-admin users receive 403 Forbidden.

### Authentication

All requests must include a valid admin access token:

```bash
# Get admin token
TOKEN=$(curl -s -X POST https://your-directus/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"xxx"}' | jq -r '.data.access_token')

# Use with Authorization header
curl -H "Authorization: Bearer $TOKEN" https://your-directus/memory-stats/
```

### Endpoints

#### GET `/memory-stats/`

Returns detailed memory and CPU statistics:

```json
{
  "rss": "256MB",
  "heapTotal": "128MB",
  "heapUsed": "96MB",
  "heapUsedPercent": "75%",
  "external": "12MB",
  "arrayBuffers": "4MB",
  "systemTotal": "2048MB",
  "systemFree": "512MB",
  "systemUsedPercent": "75%",
  "cpuUsage": 12.5,
  "uptime": "2d 5h 30m",
  "timestamp": "2024-12-02T10:30:00.000Z",
  "thresholds": {
    "ramPercent": 85,
    "cpuPercent": 90,
    "configured": true
  },
  "warnings": ["RAM usage (86%) exceeds threshold (85%)"],
  "status": "warning"
}
```

#### GET `/memory-stats/health`

Health check endpoint for monitoring systems. Returns:
- `200 OK` with `{"status": "healthy"}` when within thresholds
- `503 Service Unavailable` with details when thresholds exceeded

This can be used with Docker health checks or load balancers.

#### GET `/memory-stats/metrics`

Prometheus-compatible metrics in text format:

```
# HELP directus_process_memory_rss_bytes Process resident set size
# TYPE directus_process_memory_rss_bytes gauge
directus_process_memory_rss_bytes 268435456

# HELP directus_process_memory_heap_used_bytes Process heap used
# TYPE directus_process_memory_heap_used_bytes gauge
directus_process_memory_heap_used_bytes 100663296
...
```

## Heap Analysis (Finding Memory Leaks)

These endpoints help identify what's consuming memory.

### GET `/memory-stats/heap-stats`

Quick overview of V8 heap composition without creating a snapshot:

```json
{
  "summary": {
    "heapTotal": "143MB",
    "heapUsed": "137MB",
    "heapLimit": "2096MB",
    "heapUtilization": "7%",
    "external": "4MB",
    "mallocedMemory": "3MB"
  },
  "spaces": [
    { "name": "old_space", "size": "91MB", "used": "87MB", "utilization": "95%" },
    { "name": "large_object_space", "size": "34MB", "used": "34MB", "utilization": "99%" }
  ]
}
```

**Key indicators:**
- `old_space` growing = long-lived objects accumulating (likely leak)
- `large_object_space` growing = large arrays/buffers not being freed
- `numberOfDetachedContexts > 0` = potential iframe/context leaks

### GET `/memory-stats/heap-snapshot`

Downloads a full V8 heap snapshot for analysis in Chrome DevTools.

**Warning**: This is expensive (~100-200MB file) and briefly blocks the event loop.

```bash
# Download snapshot (requires admin token)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8055/memory-stats/heap-snapshot" \
  -o heap-$(date +%Y%m%d-%H%M%S).heapsnapshot
```

**How to analyze:**
1. Open Chrome DevTools → Memory tab
2. Load the `.heapsnapshot` file
3. Sort by "Retained Size" to find largest objects
4. Take multiple snapshots over time and use "Comparison" view to see what's growing

### POST `/memory-stats/gc`

Force garbage collection (requires `NODE_OPTIONS='--expose-gc'`):

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:8055/memory-stats/gc
```

Response shows memory freed:
```json
{
  "success": true,
  "freed": { "heapUsed": "12MB", "rss": "8MB" },
  "before": { "heapUsed": "150MB", "rss": "320MB" },
  "after": { "heapUsed": "138MB", "rss": "312MB" }
}
```

If little memory is freed, the objects are still referenced (actual leak vs lazy GC).

## Debugging Memory Leaks Workflow

First, get an admin token:
```bash
TOKEN=$(curl -s -X POST https://your-directus/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"xxx"}' | jq -r '.data.access_token')
```

1. **Get baseline** after fresh restart:
   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:8055/memory-stats/heap-stats > baseline.json
   ```

2. **Wait for memory to grow** (hours/days depending on leak speed)

3. **Compare heap stats**:
   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:8055/memory-stats/heap-stats > after.json
   diff baseline.json after.json
   ```

4. **Take heap snapshots** if needed:
   ```bash
   # After restart
   curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:8055/memory-stats/heap-snapshot -o heap-start.heapsnapshot

   # After memory grows
   curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:8055/memory-stats/heap-snapshot -o heap-grown.heapsnapshot
   ```

5. **Compare in Chrome DevTools**:
   - Load both snapshots
   - Select "Comparison" view
   - Sort by "# Delta" or "Size Delta"
   - Look for objects that increased significantly

## Auto-Restart on Resource Thresholds

The entrypoint script supports automatic container restart when resource usage exceeds configured thresholds.

### Configuration

Set these environment variables to enable auto-restart:

| Variable | Description | Example |
|----------|-------------|---------|
| `MEMORY_STATS_RESTART_ON_RAM` | Restart when RAM usage exceeds this percentage | `85` |
| `MEMORY_STATS_RESTART_ON_CPU` | Restart when CPU usage exceeds this percentage | `90` |
| `MEMORY_STATS_CHECK_INTERVAL` | Seconds between resource checks (default: 60) | `30` |

### Example Configuration

In `config.live.yaml`:

```yaml
# Enable auto-restart when RAM exceeds 85% (optional)
MEMORY_STATS_RESTART_ON_RAM: '85'

# Enable auto-restart when CPU exceeds 90% (optional)
MEMORY_STATS_RESTART_ON_CPU: '90'

# Check every 30 seconds instead of default 60
MEMORY_STATS_CHECK_INTERVAL: '30'
```

### How It Works

1. The resource monitor starts after Directus is healthy
2. Every `CHECK_INTERVAL` seconds, it measures RAM and CPU usage
3. If thresholds are exceeded, a warning is logged
4. After 3 consecutive threshold breaches, a graceful restart is triggered
5. The container orchestrator (Docker/Kubernetes) will restart the container

The 3-consecutive-check requirement prevents restarts from transient spikes.

### Log Output

When active, you'll see:

```
==========================================
  Resource Monitor Active
==========================================
  RAM threshold:  85%
  CPU threshold:  90%
  Check interval: 60s
==========================================

[Resource Monitor] Warning: RAM usage 86% >= 85% (1/3)
[Resource Monitor] Warning: RAM usage 87% >= 85% (2/3)
[Resource Monitor] Warning: RAM usage 88% >= 85% (3/3)
[Resource Monitor] Threshold exceeded 3 times - triggering restart
```

## Sentry Integration

The `base-extension-sentry` extension provides error tracking and performance monitoring.

### Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `DE_SENTRY_DSN` | Sentry DSN (required to enable) | `https://xxx@sentry.io/123` |
| `DE_SENTRY_TRACES_SAMPLE_RATE` | Transaction sample rate (0-1) | `0.2` |
| `DE_SENTRY_PROFILING_ENABLED` | Enable profiling | `true` |
| `DE_SENTRY_PROFILES_SAMPLE_RATE` | Profile sample rate (0-1) | `0.1` |

### Features

- Captures all console errors and warnings
- Tracks HTTP requests, PostgreSQL queries, and Redis operations
- Attaches memory context to all error events
- Logs memory breadcrumbs every 5 minutes
- Alerts on high memory usage (>85%)
- Tracks Flow execution errors

### Memory Context in Errors

Every Sentry error includes memory information:

```json
{
  "contexts": {
    "memory": {
      "process_rss": "256MB",
      "process_heap_used": "96MB",
      "system_used_percent": 75,
      "uptime_seconds": 86400
    }
  }
}
```

This helps correlate errors with memory pressure.

## Recommended Production Configuration

```yaml
# Sentry error tracking
DE_SENTRY_DSN: 'https://your-dsn@sentry.io/project'
DE_SENTRY_TRACES_SAMPLE_RATE: 0.2
DE_SENTRY_PROFILING_ENABLED: true
DE_SENTRY_PROFILES_SAMPLE_RATE: 0.1

# Auto-restart (optional - use if experiencing memory leaks)
# MEMORY_STATS_RESTART_ON_RAM: '85'
# MEMORY_STATS_RESTART_ON_CPU: '90'
```

## Debugging Memory Issues

All commands require admin authentication (see workflow above for getting `$TOKEN`).

1. **Check current memory**: `curl -H "Authorization: Bearer $TOKEN" http://localhost:8055/memory-stats/`

2. **Check heap composition**: `curl -H "Authorization: Bearer $TOKEN" http://localhost:8055/memory-stats/heap-stats`

3. **Monitor over time**: Set up Prometheus scraping of `/memory-stats/metrics` (requires auth)

4. **Review Sentry breadcrumbs**: Memory is logged every 5 minutes

5. **Take heap snapshots**: Download and compare in Chrome DevTools (see workflow above)

6. **Force garbage collection**: `curl -X POST -H "Authorization: Bearer $TOKEN" .../gc` (requires `NODE_OPTIONS=--expose-gc`)

## Troubleshooting

### Memory keeps growing

1. Check Sentry for correlations between errors and high memory
2. Review which extensions are loaded
3. Disable extensions one by one to isolate the leak
4. Check for unbounded caches or event listener leaks

### CPU spikes

1. Check Sentry for slow transactions
2. Review database query performance
3. Check for infinite loops in Flows

### Container restarts frequently

1. Increase the threshold values
2. Increase `MEMORY_STATS_CHECK_INTERVAL`
3. Review and fix the underlying resource issue
