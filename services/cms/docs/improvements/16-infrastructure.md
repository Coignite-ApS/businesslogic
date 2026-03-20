# 16. Infrastructure & Deployment

**Status:** planned
**Phase:** 0 — Foundation (parallel with #14 Tax & Billing)

---

## Goal

Define and deploy the production infrastructure for the full Businesslogic platform on Hetzner Cloud, managed via Coolify. Three separate servers for isolation: app (Directus), compute (Formula API), and database (PostgreSQL). EU-sovereign, cost-efficient, scalable.

---

## Current State

- **Directus**: local Docker Compose dev setup, no production deployment defined
- **Formula API**: GitHub Actions CI/CD → DigitalOcean App Platform ($5/mo basic tier)
- **Redis**: local only (Docker Compose)
- **PostgreSQL**: local only (Docker Compose)
- **Coolify**: already in use for configuration/deployment
- **No centralized infrastructure spec** — deployment is ad-hoc

---

## Architecture

```
                    ┌─────────────────────┐
                    │     Coolify          │
                    │  (deployment mgmt)   │
                    └──────────┬──────────┘
                               │ manages
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
   ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
   │   App Server     │ │  Compute Server  │ │   DB Server      │
   │   CX22 (2/4GB)   │ │  CX22 (2/4GB)    │ │   CX22 (2/4GB)   │
   │                   │ │                   │ │                   │
   │  Directus         │ │  Formula API      │ │  PostgreSQL 16    │
   │  Redis 7          │ │  (2 workers)      │ │  + pgvector       │
   │                   │ │                   │ │                   │
   │  Port 443 (TLS)   │ │  Port 3000        │ │  Port 5432        │
   │  (public)         │ │  (private network) │ │  (private network) │
   └─────────────────┘ └─────────────────┘ └─────────────────┘
            │                  │                  │
            └──────────────────┴──────────────────┘
                     Hetzner Private Network
                        (10.0.0.0/16)
```

### Network Design

- **Private network** between all three servers (Hetzner vSwitch or Cloud Network, free)
- **Only App Server is public-facing** — Directus serves both the CMS UI and proxies calculator API calls
- **Formula API**: private network only, accessed by Directus via `http://10.0.0.x:3000`
- **PostgreSQL**: private network only, accessed by Directus via `10.0.0.x:5432`
- **Redis**: runs on App Server, accessed locally by Directus + via private network by Formula API

### Why Separate Servers

| Concern | Shared server | Separate servers |
|---|---|---|
| CPU contention | Formula API workers starve Directus | Each service gets dedicated cores |
| Memory | 512MB heap cap + Directus + Redis = tight on 4GB | Formula API gets full 4GB headroom |
| Scaling | Scale everything or nothing | Scale compute independently |
| Security | One compromise = everything | Formula API not public-facing |
| Cost difference | ~€4.5 (one CX22) | ~€13.5 (three CX22s) |

The €9/mo extra buys isolation, security, and independent scaling. Worth it.

---

## Server Specifications

### App Server (Directus + Redis)

| Component | Config |
|---|---|
| **Server** | Hetzner CX22 — 2 vCPU, 4 GB RAM, 40 GB NVMe |
| **OS** | Ubuntu 24.04 LTS |
| **Directus** | Docker container via Coolify |
| **Redis** | Docker container via Coolify, 512 MB max memory |
| **Domain** | app.businesslogic.online (or similar) |
| **TLS** | Coolify auto-manages via Let's Encrypt |
| **Ports** | 443 (HTTPS), 80 (redirect to 443) |

Environment:
```
FORMULA_API_URL=http://10.0.0.x:3000
DB_HOST=10.0.0.x
DB_PORT=5432
REDIS_URL=redis://localhost:6379
```

### Compute Server (Formula API)

| Component | Config |
|---|---|
| **Server** | Hetzner CX22 — 2 vCPU, 4 GB RAM, 40 GB NVMe |
| **OS** | Ubuntu 24.04 LTS |
| **Formula API** | Docker container via Coolify |
| **Workers** | POOL_SIZE=2 (matches vCPU count) |
| **Memory** | --max-old-space-size=512 (per container) |
| **Ports** | 3000 (private network only, NOT public) |

Environment:
```
PORT=3000
POOL_SIZE=2
REDIS_URL=redis://10.0.0.x:6379
ADMIN_API_URL=http://10.0.0.x:8055
ADMIN_API_KEY=<formula-api-token>
REQUEST_TIMEOUT_MS=10000
```

### DB Server (PostgreSQL + pgvector)

| Component | Config |
|---|---|
| **Server** | Hetzner CX22 — 2 vCPU, 4 GB RAM, 40 GB NVMe |
| **OS** | Ubuntu 24.04 LTS |
| **PostgreSQL** | 16 with pgvector extension, Docker via Coolify |
| **Ports** | 5432 (private network only) |
| **Backups** | Automated daily pg_dump + Hetzner snapshots |

PostgreSQL tuning for 4GB RAM:
```
shared_buffers = 1GB
effective_cache_size = 3GB
work_mem = 16MB
maintenance_work_mem = 256MB
max_connections = 100
```

---

## Coolify Configuration

### Services to Deploy

| Service | Source | Deploy Method |
|---|---|---|
| Directus | GitHub repo (businesslogic-cms) | Docker Compose via Coolify |
| Formula API | GitHub repo (excel-formula-api) | Dockerfile via Coolify |
| PostgreSQL | Docker image (pgvector/pgvector:pg16) | Docker via Coolify |
| Redis | Docker image (redis:7-alpine) | Docker via Coolify |

### Coolify Setup

1. **Install Coolify** on App Server (or separate management — can self-manage)
2. **Connect all three servers** as Coolify destinations
3. **Create private network** in Hetzner Cloud Console
4. **Attach all servers** to private network
5. **Configure services** in Coolify:
   - Each service gets environment variables pointing to private network IPs
   - Coolify handles Docker image builds from GitHub repos
   - Coolify handles TLS certs for public-facing App Server
   - Coolify handles zero-downtime deploys (health checks + rolling restart)

### CI/CD Flow

```
Developer pushes to main
  → GitHub webhook triggers Coolify
  → Coolify builds Docker image on target server
  → Coolify runs health check
  → Coolify swaps containers (zero-downtime)
```

No separate CI/CD pipeline needed — Coolify replaces GitHub Actions for deployment.

### Deployment Environments

| Environment | Setup | Purpose |
|---|---|---|
| **Local** | Docker Compose (existing) | Development |
| **Staging** | Single Hetzner CX22 (all-in-one) | Testing, optional |
| **Production** | Three Hetzner CX22s | Live |

Staging is optional — a single CX22 (~€4.5/mo) running all services via Docker Compose is enough for pre-production testing.

---

## Backup Strategy

### Database Backups

| Method | Frequency | Retention | Storage |
|---|---|---|---|
| pg_dump (logical) | Daily 03:00 UTC | 30 days | Hetzner Object Storage (S3) |
| Hetzner snapshots | Weekly | 4 snapshots | Hetzner (20% of server cost) |
| WAL archiving | Continuous | 7 days | Local + S3 |

Backup script (cron on DB server):
```bash
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
pg_dump -U directus -d directus | gzip > /tmp/backup_$TIMESTAMP.sql.gz
# Upload to S3-compatible storage
s3cmd put /tmp/backup_$TIMESTAMP.sql.gz s3://bl-backups/db/
# Cleanup old local backups
find /tmp/backup_*.sql.gz -mtime +7 -delete
```

### Application Backups

- **Directus config**: versioned in Git (config.*.yaml, snapshots/)
- **Extensions**: versioned in Git
- **Uploaded files**: Directus file storage → Hetzner Object Storage (S3 driver)
- **Redis**: ephemeral cache, no backup needed

### Restore Procedure

1. Provision new server (Coolify makes this fast)
2. Restore PostgreSQL from latest pg_dump
3. Deploy application via Coolify from Git
4. Verify and switch DNS

---

## Monitoring

### Health Checks (Coolify built-in)

- Directus: `GET /server/health`
- Formula API: `GET /health`
- PostgreSQL: TCP check on 5432
- Redis: TCP check on 6379

### External Monitoring (recommended)

| Tool | Purpose | Cost |
|---|---|---|
| **Uptime Kuma** | Uptime monitoring + alerts | Free (self-hosted on App Server) |
| **Sentry** | Error tracking (already in base/) | Free tier |
| **Hetzner metrics** | CPU, RAM, disk, network | Free (built into Cloud Console) |

### Alerts

- Service down → Uptime Kuma → email/Slack notification
- CPU > 80% sustained → Hetzner alert → consider scaling
- Disk > 80% → Hetzner alert → expand or clean up
- PostgreSQL connections > 80 → alert → investigate connection leaks

---

## Security

### Network

- [x] Private network for inter-server communication
- [ ] Firewall rules: only port 443/80 on App Server, block all public on Compute/DB
- [ ] SSH key-only access (no password auth)
- [ ] Fail2ban on all servers

### Hetzner Firewall Rules

**App Server:**
| Direction | Port | Source | Action |
|---|---|---|---|
| Inbound | 443 | 0.0.0.0/0 | Allow (HTTPS) |
| Inbound | 80 | 0.0.0.0/0 | Allow (HTTP redirect) |
| Inbound | 22 | Your IP only | Allow (SSH) |
| Inbound | * | 10.0.0.0/16 | Allow (private network) |
| Inbound | * | * | Drop |

**Compute + DB Servers:**
| Direction | Port | Source | Action |
|---|---|---|---|
| Inbound | 22 | Your IP only | Allow (SSH) |
| Inbound | * | 10.0.0.0/16 | Allow (private network) |
| Inbound | * | * | Drop |

### TLS
- Coolify auto-provisions Let's Encrypt certificates
- Force HTTPS redirect on App Server
- Internal traffic (private network) is unencrypted — acceptable for private VLAN

---

## Scaling Path

| Trigger | Action | Cost impact |
|---|---|---|
| Directus slow under load | Upgrade App Server to CX32 (4 vCPU, 8GB) | +€3.5/mo |
| Formula API saturated | Upgrade Compute to CX32, increase POOL_SIZE=4 | +€3.5/mo |
| Formula API still saturated | Add second Compute Server + load balancer | +€9.5/mo |
| DB slow / pgvector queries slow | Upgrade DB to CX32 or CX42 | +€3.5-12/mo |
| Need HA / zero-downtime DB | Add PostgreSQL replica on separate server | +€4.5/mo |
| >100K KB chunks | Add HNSW index on pgvector, upgrade DB RAM | Part of DB upgrade |

---

## Migration Plan (from DigitalOcean)

### Phase 1: Provision Infrastructure
1. Create 3x Hetzner CX22 servers in same datacenter (Falkenstein or Nuremberg)
2. Create Hetzner Cloud Network, attach all servers
3. Configure Hetzner Firewall rules
4. Install Coolify, connect all servers

### Phase 2: Deploy Services
5. Deploy PostgreSQL via Coolify on DB server
6. Restore database from current environment (pg_dump → pg_restore)
7. Deploy Redis via Coolify on App Server
8. Deploy Directus via Coolify on App Server, point to new DB + Redis
9. Deploy Formula API via Coolify on Compute Server
10. Verify all services communicate via private network

### Phase 3: DNS Cutover
11. Test full stack on Hetzner (use temporary domain or /etc/hosts)
12. Switch DNS to Hetzner App Server IP
13. Verify TLS cert provisioned
14. Monitor for 24h
15. Decommission DigitalOcean

### Phase 4: Backups & Monitoring
16. Set up pg_dump cron + S3 upload
17. Deploy Uptime Kuma on App Server
18. Configure Hetzner snapshot schedule
19. Test restore procedure

---

## Cost Summary

### Production (3 servers)

| Item | Monthly | Yearly |
|---|---|---|
| App Server CX22 | €4.51 | €54 |
| Compute Server CX22 | €4.51 | €54 |
| DB Server CX22 | €4.51 | €54 |
| Hetzner Snapshots (3 servers) | ~€2.70 | €32 |
| Object Storage (50 GB) | ~€0.50 | €6 |
| **Total** | **~€16.73** | **~€200** |

### vs DigitalOcean equivalent

| Item | DO Monthly |
|---|---|
| App Platform (Directus) | $12-24 |
| App Platform (Formula API) | $5-12 |
| Managed PostgreSQL (1GB) | $15 |
| Managed Redis | $15 |
| **Total** | **$47-66** |

**Hetzner saves ~70%** ($47-66 → ~$18).

### Optional Staging

| Item | Monthly |
|---|---|
| Single CX22 (all-in-one) | €4.51 |

---

## Acceptance Criteria

- [ ] Three Hetzner servers provisioned and connected via private network
- [ ] Coolify managing all deployments across all servers
- [ ] Directus accessible via HTTPS on public domain
- [ ] Formula API accessible only via private network
- [ ] PostgreSQL accessible only via private network
- [ ] Firewall rules block all unnecessary public access
- [ ] GitHub push → Coolify auto-deploy (zero-downtime)
- [ ] Daily database backups to S3-compatible storage
- [ ] Uptime monitoring with alerting
- [ ] Restore procedure tested and documented
- [ ] Formula API migrated off DigitalOcean
- [ ] All environment variables configured via Coolify secrets

---

## Dependencies

- Hetzner Cloud account
- Domain DNS management access
- GitHub repo webhooks for Coolify
- Current database dump for migration

## Estimated Scope

- Server provisioning + network setup: ~2 hours
- Coolify installation + service configuration: ~3 hours
- Database migration + verification: ~2 hours
- DNS cutover + monitoring setup: ~2 hours
- Backup automation: ~1 hour
- **Total: ~1 day**
