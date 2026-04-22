# 12. Container Resource Limits

**Status:** done
**Source:** CTO Review 2026-04-15 — F-004

---

## Goal

Production Docker Compose has no `deploy.resources.limits`. A runaway process can consume all host resources and affect co-located services.

---

## Key Tasks

- [x] Add `deploy.resources.limits` to each service in `infrastructure/coolify/docker-compose.prod.yml`:
  - gateway: `memory: 512M, cpus: '0.5'`
  - formula-api: `memory: 1G, cpus: '1.0'`
  - ai-api: `memory: 1G, cpus: '1.0'`
  - flow-worker: `memory: 2G, cpus: '2.0'`
  - flow-trigger: `memory: 1G, cpus: '1.0'`
  - cms: `memory: 1G, cpus: '1.0'`
  - postgres: `memory: 2G`
  - redis: `memory: 512M`
- [x] Add `deploy.resources.reservations` for minimum guarantees
- [x] Test locally with limits to verify no OOM under normal load
- [x] Document resource allocation rationale

---

## Key Files

- `infrastructure/coolify/docker-compose.prod.yml`
- `infrastructure/docker/docker-compose.dev.yml`

---

## Acceptance Criteria

- [x] Every production container has memory and CPU limits
- [x] Services start and operate normally within limits
- [x] Resource values documented

---

## Implementation Notes

### Resource Allocation Summary

| Service | Memory Limit | CPU Limit | Memory Reserve | CPU Reserve | Rationale |
|---------|-------------|-----------|----------------|-------------|-----------|
| postgres | 2G | — | 1G | — | pgvector + shared_buffers; no CPU limit to avoid throttling DB |
| redis | 512M | — | 256M | — | 256mb maxmemory + overhead for connections/AOF |
| otel-collector | 512M | 0.5 | 256M | 0.25 | Telemetry pipeline bounded by batch config |
| bl-gateway | 512M | 0.5 | 256M | 0.25 | Go binary ~30MB baseline; headroom for traffic spikes |
| bl-cms | 1G | 1.0 | 512M | 0.5 | Directus Node.js + extension builds |
| bl-ai-api | 1G | 1.0 | 512M | 0.5 | Fastify + streaming LLM + embedding ops |
| bl-flow-trigger | 1G | 1.0 | 512M | 0.5 | Rust binary; headroom for concurrent DAG dispatch |
| bl-formula-api | 1G | 1.0 | 512M | 0.5 | Node.js + Rust WASM engine pool (POOL_SIZE=4) |
| bl-flow-worker | 2G | 2.0 | 1G | 1.0 | 10 concurrent Rust workers + LLM tool calls |

### Design Decisions

- **No CPU limits on postgres/redis**: data services should never be CPU-throttled; memory is the real concern
- **Reservations at ~50% of limits**: guarantees minimum resources while allowing burst
- **Inline comments**: rationale documented directly in the compose file for discoverability
- **Total allocation**: ~10G memory limits across all services; fits comfortably on the 5-server topology
