# Iteration 5: Hardening, Observability & Production Deploy

**Goal:** OpenTelemetry across all services, load testing, security audit, chaos testing. Then deploy to Hetzner via Terraform + Coolify.

**Duration:** 3-4 weeks
**Risk:** Low (observability is additive; Hetzner deploy uses Terraform for reproducibility)

**Depends on:** Iterations 0-3 complete (all services running in Docker)
**Branch:** `iteration/05-hardening` (from `dev` after all iterations merged)

---

## Development Workflow

**Git:** `git checkout dev && git checkout -b iteration/05-hardening`

**TDD for every step:**
1. Write tests first (load tests, chaos tests, security tests — define pass/fail criteria before running)
2. Run tests — verify they fail or establish baselines
3. Implement fixes/improvements to meet criteria
4. Run `./scripts/test-all.sh` — no regressions
5. Commit: `git add <files> && git commit -m "chore(hardening): step 5.X - <desc>"`

---

## Steps

### 5.1: OpenTelemetry Instrumentation

Add traces, metrics, and structured logs to every service:

| Service | Library | Traces | Metrics |
|---------|---------|--------|---------|
| bl-gateway | go.opentelemetry.io | Request → backend proxy span | RPS, latency histogram, error rate |
| bl-ai-api | @opentelemetry/sdk-node | Chat → tool → LLM span chain | Token usage, budget consumption, cache hit rate |
| bl-formula-api | @opentelemetry/sdk-node | Execute → worker → engine span | Eval latency, cache hit rate, queue depth |
| bl-flow | opentelemetry-rust | Trigger → DAG → node spans | Execution time, node latency, budget consumption |
| bl-cms | @opentelemetry/sdk-node | Extension hooks traced | Request latency, extension build times |

**Collector:** Deploy Grafana Alloy (or OTEL Collector) on S1 → ship to Grafana Cloud free tier (50GB traces/month).

### 5.2: Grafana Dashboards

Create dashboards for:
- **Overview:** All services health, request rates, error rates
- **AI API:** Chat latency, tool call distribution, budget consumption, cache hit rate
- **Formula API:** Eval latency, calculator build time, queue depth, cache efficiency
- **Flow Engine:** Execution time, node latency distribution, budget consumption
- **Infrastructure:** CPU, memory, disk per server, PostgreSQL connections, Redis memory

### 5.3: Load Testing with k6

Create k6 scenarios for each service:

| Scenario | VUs | Duration | Target |
|----------|-----|----------|--------|
| Gateway auth + proxy | 200 | 5min | <5ms p95 overhead |
| AI chat streaming | 50 | 5min | <3s p95 end-to-end |
| KB search | 100 | 5min | <100ms p95 |
| Calculator execute | 200 | 5min | <50ms p95 |
| Flow webhook trigger | 100 | 5min | <10ms p95 trigger, <5s flow completion |

### 5.4: Security Audit

- [ ] Dependency scanning (npm audit, cargo audit, govulncheck)
- [ ] API key rotation procedure tested
- [ ] Rate limit bypass attempts (header spoofing, etc.)
- [ ] SQL injection testing on all query parameters
- [ ] SSE connection exhaustion test
- [ ] Redis key enumeration prevention
- [ ] Secret management review (no secrets in code/logs)

### 5.5: Chaos Testing

- [ ] Kill bl-ai-api → verify CMS still works, AI returns 503
- [ ] Kill bl-formula-api → verify AI chat works (tool calls fail gracefully)
- [ ] Kill Redis → verify in-memory fallbacks activate
- [ ] Kill PostgreSQL → verify all services return 503 (not crash)
- [ ] Network partition between S1 and S3 → verify gateway returns 503
- [ ] OOM bl-ai-api worker → verify auto-respawn, pending requests rejected

### 5.6: Terraform Hetzner Provisioning

Apply `infrastructure/terraform/` to create:
- 5 servers with private network
- Firewalls (only gateway gets public access)
- SSH keys for deployment
- DNS records in Cloudflare

```bash
cd infrastructure/terraform
terraform init
terraform plan
terraform apply
```

### 5.7: Coolify Setup on Hetzner

1. Install Coolify on S1 (gateway server)
2. Add S2-S5 as Coolify agents
3. Create service for each component
4. Configure environment variables from Buddy Vault
5. Deploy all services
6. Verify health checks pass

### 5.8: Production Smoke Tests

Run against production:
- Create API key via CMS admin
- Execute calculator via gateway
- Chat with AI via gateway
- Upload KB document, search, get answer
- Trigger a flow via webhook
- Verify all monitoring dashboards show data

---

## Completion Checklist

- [ ] OpenTelemetry traces across all services
- [ ] Grafana dashboards for all services
- [ ] k6 load test baselines established
- [ ] Security audit complete, no critical findings
- [ ] Chaos tests all pass (graceful degradation)
- [ ] Terraform provisions all Hetzner infrastructure
- [ ] Coolify manages all services on Hetzner
- [ ] Production smoke tests pass
- [ ] Runbook documentation complete
- [ ] On-call procedures defined
