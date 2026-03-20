# Directus Memory Stats Extension

Memory monitoring, heap analysis, and Prometheus metrics for Directus.

## Configuration

Optional environment variables:

```yaml
MEMORY_STATS_RESTART_ON_RAM: 90    # Auto-restart threshold (% system RAM)
MEMORY_STATS_RESTART_ON_CPU: 95    # Auto-restart threshold (% CPU usage)
```

## Endpoints

All endpoints require **admin authentication**.

### GET /memory-stats
Current memory and CPU statistics.

```json
{
  "rss": "450MB",
  "heapTotal": "380MB",
  "heapUsed": "280MB",
  "heapUsedPercent": "73%",
  "external": "15MB",
  "arrayBuffers": "8MB",
  "systemTotal": "16384MB",
  "systemFree": "5500MB",
  "systemUsedPercent": "66%",
  "cpuUsage": 12.5,
  "uptime": "2d 5h 30m",
  "timestamp": "2024-12-02T18:00:00.000Z"
}
```

### GET /memory-stats/health
Simple health check with threshold warnings.

```json
{
  "status": "healthy",
  "heapUsedPercent": "73%",
  "systemUsedPercent": "66%",
  "warnings": []
}
```

### GET /memory-stats/heap-stats
V8 heap space breakdown.

```json
{
  "spaces": [
    { "name": "new_space", "size": "2MB", "used": "1MB", "available": "1MB" },
    { "name": "old_space", "size": "300MB", "used": "250MB", "available": "50MB" }
  ],
  "totalHeapSize": "380MB",
  "totalUsed": "280MB",
  "mallocedMemory": "10MB"
}
```

### GET /memory-stats/heap-snapshot
Generate and download V8 heap snapshot for memory leak analysis.

Query params:
- `?download=true` - Download as .heapsnapshot file

### POST /memory-stats/gc
Trigger manual garbage collection (requires `--expose-gc` flag).

```json
{
  "success": true,
  "before": { "heapUsed": "350MB" },
  "after": { "heapUsed": "280MB" },
  "freed": "70MB"
}
```

### GET /memory-stats/metrics
Prometheus-compatible metrics.

```
# HELP directus_memory_heap_used_bytes Heap memory used
# TYPE directus_memory_heap_used_bytes gauge
directus_memory_heap_used_bytes 293601280

# HELP directus_memory_rss_bytes Resident set size
# TYPE directus_memory_rss_bytes gauge
directus_memory_rss_bytes 471859200
```

## Auto-Restart

When thresholds are configured, the extension monitors memory/CPU and triggers graceful shutdown if exceeded. Container orchestration (Docker, K8s) handles restart.
