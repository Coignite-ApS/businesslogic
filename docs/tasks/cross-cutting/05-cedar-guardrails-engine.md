# 05. Cedar Guardrails Engine (bl-policy)

**Status:** planned
**Phase:** New service — cross-cutting (touches gateway, ai-api, formula-api, flow, cms)
**Design doc:** [docs/cedar-guardrails-design.md](../../cedar-guardrails-design.md)
**Estimate:** 12 weeks (5 phases)

---

## Goal

Build a Rust-native policy evaluation service (`bl-policy`) using the [Cedar policy engine](https://github.com/cedar-policy/cedar) that enables customers to upload contracts or compliance documents and have AI extract enforceable guardrails. Cedar provides schema-validated, formally verifiable policy evaluation — the same way HyperFormula provides deterministic formula evaluation for calculators.

---

## Why

No existing mechanism to go from "customer document" → "enforceable rules." Budget enforcement is hardcoded, subscription tiers are static. Customers with enterprise contracts need custom guardrails (model restrictions, data export limits, calculation thresholds) that are specific to their agreement.

---

## Architecture Decision

**Rust-native Cedar** (`cedar-policy` crate) running as a dedicated service, following the same patterns as bl-flow (Axum/Tokio, SQLx, deadpool-redis, multi-stage Docker). Other services call bl-policy over the private network. Gateway calls it for coarse-grained enforcement on every public request; target services call it for fine-grained enforcement with full context.

**License:** Apache 2.0 — fully commercial-friendly, most permissive in our stack.

---

## Key Tasks

### Phase 1: Service Foundation (3 weeks)

- [ ] Scaffold `services/policy/` Rust workspace (4 crates: common, engine, api, worker)
- [ ] Define BusinessLogic Cedar schema (entity types, actions, context types)
- [ ] Implement `AccountPolicyEngine` (cached PolicySet per account, evaluate, validate)
- [ ] Build policy-api HTTP server: `/evaluate`, `/validate`, `/health`, `/policies` CRUD
- [ ] Create `policy.*` database schema (migrations)
- [ ] Redis caching layer with `pol:` prefix
- [ ] Dockerfile (multi-stage alpine, api + worker targets)
- [ ] Add to docker-compose.dev.yml
- [ ] Unit tests for schema validation, policy evaluation, JSON round-tripping

### Phase 2: AI Extraction (2 weeks)

- [ ] Design extraction prompt (Cedar JSON output from document + schema)
- [ ] bl-ai-api endpoint: POST /extract-guardrails
- [ ] Validation pipeline: ai-api → bl-policy /validate → store as pending_review
- [ ] Integration tests with sample contracts
- [ ] Confidence scoring and ambiguity detection

### Phase 3: Gateway Enforcement (2 weeks)

- [ ] bl-gateway middleware: POST to bl-policy /evaluate (feature-flagged)
- [ ] Coarse-grained context extraction in gateway
- [ ] Fine-grained evaluation in formula-api, ai-api, flow
- [ ] 403 error responses with policy violation details
- [ ] Audit logging in policy.decisions

### Phase 4: CMS Review UI (3 weeks)

- [ ] Hook extension: project-extension-guardrails-api
- [ ] Module extension: project-extension-guardrails
- [ ] Document upload + extraction trigger
- [ ] Guardrail review: Cedar text, source clause, confidence, approve/reject
- [ ] Active guardrails dashboard
- [ ] Decision audit log
- [ ] Policy tester (dry-run)

### Phase 5: Hardening (2 weeks)

- [ ] Performance benchmarks (target: <500μs per evaluation)
- [ ] Built-in policy templates
- [ ] Platform-level policies (cross-account)
- [ ] Cache invalidation stress testing
- [ ] Documentation update (CLAUDE.md, evolution-plan, database-strategy, service-auth)
- [ ] CTO review + DevOps review

---

## Dependencies

- `cedar-policy` v4.9 (Rust crate, Apache 2.0)
- Existing bl-ai-api KB pipeline (document ingestion, chunking, embeddings)
- Existing Redis infrastructure
- Existing private network (10.0.0.0/16)

---

## New Infrastructure

- Port 3300 (policy-api) / 3310 (policy-worker) on Compute server
- `policy.*` PostgreSQL schema
- `POLICY_API_URL` + `POLICY_API_ADMIN_TOKEN` env vars on gateway, formula-api, ai-api, flow
- `POLICY_ENFORCEMENT_ENABLED` feature flag (starts disabled)

---

## Affected Services

| Service | Change |
|---------|--------|
| **bl-policy** (new) | Entire service |
| **bl-gateway** | Add policy enforcement middleware |
| **bl-ai-api** | Add /extract-guardrails endpoint |
| **bl-formula-api** | Add fine-grained policy check before calculation |
| **bl-flow** | Add policy check at flow trigger time |
| **bl-cms** | Two new extensions (hook + module) |
| **infrastructure** | Docker compose, Coolify config, env vars |

---

## Success Criteria

1. Upload a sample contract → AI extracts Cedar policies → human reviews → approved policies enforce on API requests
2. Policy evaluation adds <1ms total overhead per request (Cedar eval + network)
3. Feature-flagged — zero impact when disabled
4. Audit trail captures every allow/deny decision with matched policies
5. All existing tests pass (no regression)
