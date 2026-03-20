# Directus Sentry Extension

Comprehensive error tracking, performance monitoring, and profiling for Directus using Sentry SDK v10+.

## Architecture

Two-stage initialization for optimal instrumentation:

1. **Preload Script** (`docker/sentry-preload.cjs`) - Runs via `--require` before Directus loads, enabling full HTTP/Express/DB instrumentation
2. **Hook Extension** - Adds Directus-specific error tracking, health endpoint, and frontend monitoring

## Configuration

Add to your `config.*.yaml`:

```yaml
# Required
DE_SENTRY_DSN: 'https://your-key@sentry.example.com/project-id'

# Performance (0-1, percentage)
DE_SENTRY_TRACES_SAMPLE_RATE: 0.1      # Transactions to trace (dev: 0.5-1.0, prod: 0.1-0.2)
DE_SENTRY_PROFILES_SAMPLE_RATE: 0.1    # Traces to profile (dev: 0.1-0.5, prod: 0.05-0.1)

# Optional
DE_SENTRY_PROFILING_ENABLED: 'true'    # Enable CPU profiling
DE_SENTRY_LOGGER: 'false'              # Sentry/OpenTelemetry debug logs
DE_SENTRY_LOGS_LEVEL: ''               # Console capture: 'error', 'error,warn', or empty
DE_SENTRY_FRONTEND_ENABLED: 'true'     # Data Studio browser monitoring (default: true)
ENV: 'production'                       # Environment tag (falls back to NODE_ENV)
```

### Frontend Monitoring

Frontend monitoring injects Sentry browser SDK v10 into Data Studio via `/sentry/frontend.js`. Works with both sentry.io and self-hosted Sentry.

No CSP configuration required - Directus defaults allow the CDN and API connections.

Set `DE_SENTRY_FRONTEND_ENABLED: 'false'` to disable.

## Features

### Error Tracking

| Feature | Description |
|---------|-------------|
| **API Request Errors** | Captures with user ID, request path, method, query params |
| **Flow Errors** | Captures with flow ID, name, trigger type, accountability |
| **Unhandled Exceptions** | Via Express error handler |
| **Frontend Errors** | Data Studio JavaScript errors (browser SDK) |

### Performance Monitoring

| Integration | Description |
|-------------|-------------|
| **HTTP** | Incoming/outgoing request tracing |
| **Express** | Route performance (partial - see limitations) |
| **PostgreSQL** | Query tracing and performance |
| **Redis** | Operation tracing |
| **CPU Profiling** | Detailed performance profiles |

### Logging

| Integration | Description |
|-------------|-------------|
| **Pino** | Captures Directus native logs (warn, error, fatal) |
| **Console** | Optional capture of console.log/error (configurable levels) |

### Memory Monitoring

- **5-minute intervals**: Breadcrumbs with heap/system memory stats
- **High memory alerts**: Warning when system memory >85%
- **Context attachment**: Memory stats attached to all error events

### Database Breadcrumbs

Automatic breadcrumbs for:
- `items.create`
- `items.update`
- `items.delete`

Includes collection name, affected keys (first 5), and user ID.

### Version Tagging

All events tagged with:
- `directus_version` - Directus package version
- `project_version` - From `PROJECT_VERSION` env var
- `node_version` - Node.js version
- `release` - Project version for release tracking

### Graceful Shutdown

Flushes pending events on SIGTERM with 2-second timeout.

## Endpoints

### GET /sentry/health

Admin-only health check with connection test.

**Response:**
```json
{
  "status": "ok",
  "config": {
    "dsnConfigured": true,
    "host": "sentry.example.com",
    "projectId": "123",
    "environment": "production",
    "tracesSampleRate": 0.1,
    "profilesSampleRate": 0.1,
    "profilingEnabled": true
  },
  "client": {
    "initialized": true,
    "preloaded": true
  },
  "connection": {
    "status": "ok",
    "latencyMs": 150,
    "statusCode": 200
  },
  "memory": {
    "process_rss": "450MB",
    "process_heap_used": "280MB",
    "process_heap_total": "512MB",
    "process_heap_percent": 55,
    "system_total": "16384MB",
    "system_free": "8192MB",
    "system_used_percent": 50,
    "uptime_seconds": 86400
  },
  "timestamp": "2024-12-09T18:00:00.000Z"
}
```

## Error Context

### Request Errors

```
Tags:
  - request_type: 'api'
  - request_path: '/items/users'
  - request_method: 'POST'

Context:
  - memory: { process_rss, process_heap_used, ... }
  - request: { path, method, query }

User:
  - id: <accountability.user>
```

### Flow Errors

```
Tags:
  - error_source: 'flow'
  - flow_trigger: 'webhook' | 'schedule' | 'hook' | 'manual' | 'operation'
  - flow_id: <uuid>

Context:
  - memory: { ... }
  - flow: { id, name, status, trigger, accountability, description }
```

## Known Limitations

You may see this warning:
```
[Sentry] express is not instrumented. This is likely because you required/imported express before calling `Sentry.init()`.
```

This occurs when preload script doesn't run (non-Docker environments). Despite this:
- ✅ Error tracking works
- ✅ Profiling works
- ✅ Database/Redis tracing works
- ✅ Pino log capture works
- ⚠️ Express route auto-naming unavailable

## Ignored Errors

Common network errors are filtered:
- `ECONNRESET`
- `ENOTFOUND`
- `ETIMEDOUT`
- `socket hang up`

## Requirements

- Sentry SDK v10.0.0+ (for Pino integration)
- Directus 11.0.0+
- Node.js 18+
