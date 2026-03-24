# Cedar Guardrails Engine — Technical Design

**Version 0.2 · March 24, 2026 · Coignite ApS**

---

## 1. Problem Statement

Customers upload contracts, compliance documents, or internal policies and expect BusinessLogic to enforce the rules described in those documents as guardrails across their account's usage of calculators, AI, flows, and API access.

Today there is no structured way to go from "document" to "enforceable rule." Budget enforcement exists (5-layer system in AI API), but it's hardcoded. Subscription tiers exist, but they're static. There is no general-purpose, customer-configurable policy engine.

---

## 2. Decision: Cedar as the Policy Engine

### Why Cedar

| Concern | Custom DSL | Cedar (Rust-native) |
|---------|-----------|---------------------|
| Schema validation | Must build from scratch | Built-in — rejects malformed policies before storage |
| Formal verification | Not feasible | `Validator` proves policy properties against schema |
| AI generation reliability | Unknown format, no training data | JSON policy format well-documented, LLMs generate JSON reliably |
| Policy-to-text (human review) | Must build renderer | Bidirectional JSON ↔ Cedar text conversion |
| Partial evaluation | Must build | Built-in partial evaluation with residuals |
| Runtime performance | QuickJS eval ~sub-ms | Native Rust eval ~sub-μs (no WASM overhead, no FFI) |
| Maintenance burden | Full ownership | AWS-maintained, Apache 2.0, active (v4.9.1, 63 contributors) |
| Stack fit | N/A | Rust crate — same language as bl-flow, same build toolchain |

### Why Rust-native (not WASM, not cedar-go)

The platform already follows the principle "Rust for Compute, Node/Go for I/O" (evolution-plan.md). Policy evaluation is pure compute — CPU-bound, latency-sensitive, called on every request. This makes it a Rust service, the same way bl-flow is a Rust service for DAG execution.

| Option | Latency | Integration | Maintenance |
|--------|---------|-------------|-------------|
| `cedar-policy` Rust crate | ~μs (native) | Direct `use cedar_policy::*;` | Same toolchain as bl-flow |
| `@cedar-policy/cedar-wasm` in Node.js | ~ms (WASM overhead) | npm package in ai-api/formula-api | Separate from Rust services |
| `cedar-go` in gateway | ~ms (Go) | Go library in bl-gateway | Third implementation to maintain |
| HTTP sidecar | ~2-5ms (network) | Any language | Operational overhead |

**Decision:** Build `bl-policy` as a Rust/Axum service using the `cedar-policy` crate directly. Other services call it over the private network. The gateway calls it for every public request (coarse check), individual services call it for fine-grained context checks.

### What Cedar gives us

1. **`Authorizer::is_authorized()`** — deterministic allow/deny with diagnostics (which policies matched, which errored)
2. **`Validator::validate()`** — schema-validated policy sets (catches AI hallucinations at write time)
3. **`Policy::from_json()` / `policy.to_json()`** — bidirectional JSON ↔ Cedar text (JSON for AI, text for humans)
4. **`PolicySet` caching** — parse once at startup/cache-load, evaluate thousands of times
5. **Partial evaluation** — evaluate with incomplete context, return residual policies
6. **Policy templates** — reusable patterns with placeholders (`?principal`, `?resource`)

### What we build

1. `bl-policy` Rust service (Axum + Tokio) — validation, evaluation, storage, audit
2. Document-to-policy extraction prompt (executed by bl-ai-api)
3. Human review UI (CMS extension)
4. Gateway integration (HTTP call to bl-policy on private network)
5. Per-service integration (HTTP call to bl-policy with enriched context)

### License

Cedar is Apache 2.0 — fully commercial-friendly. No copyleft, no revenue sharing, explicit patent grant from contributors. We include the license in `LICENSES/apache-2.0-cedar.txt`. This is the most permissive license in our stack (Directus and HyperFormula are both GPL v3).

---

## 3. Service Design: bl-policy

### 3.1 Position in Architecture

```
services/
├── cms/            # Back-office (Node.js/Directus)
├── ai-api/         # AI chat, KB, embeddings (Node.js/Fastify)
├── formula-api/    # Formula eval, calculators (Node.js + Rust)
├── flow/           # DAG workflows (Rust/Axum/Tokio)        ← same pattern
├── gateway/        # Auth, rate limiting, routing (Go)
└── policy/         # Cedar guardrails engine (Rust/Axum/Tokio)  ← NEW
```

| Property | bl-flow | bl-policy (new) |
|----------|---------|-----------------|
| Language | Rust | Rust |
| Framework | Axum + Tokio | Axum + Tokio |
| Database | SQLx + PostgreSQL (`flow.*` schema) | SQLx + PostgreSQL (`policy.*` schema) |
| Cache | deadpool-redis | deadpool-redis |
| Tracing | tracing + OpenTelemetry | tracing + OpenTelemetry |
| Auth | X-Admin-Token | X-Admin-Token |
| Port | 3100 (trigger) / 3110 (worker) | 3300 (api) / 3310 (worker) |
| Docker | Multi-stage alpine | Multi-stage alpine |
| Binary structure | flow-trigger + flow-worker | policy-api + policy-worker |

### 3.2 Cargo Workspace

```
services/policy/
├── Cargo.toml                    # Workspace root
├── Cargo.lock
├── crates/
│   ├── policy-common/            # Shared types, Cedar schema definitions
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── schema.rs         # BusinessLogic Cedar schema (entity types, actions)
│   │       ├── types.rs          # PolicyDocument, Guardrail, Decision structs
│   │       └── errors.rs         # PolicyError enum (thiserror)
│   │
│   ├── policy-engine/            # Cedar evaluation + validation wrapper
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── evaluator.rs      # AccountPolicyEngine — cached PolicySet per account
│   │       ├── validator.rs      # Schema validation, conflict detection
│   │       ├── converter.rs      # JSON ↔ Cedar text, policy formatting
│   │       └── templates.rs      # Built-in policy templates
│   │
│   ├── policy-api/               # HTTP server (Axum)
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs           # Server startup, connection pools, graceful shutdown
│   │       ├── state.rs          # AppState (pools, config, cached engines)
│   │       ├── routes/
│   │       │   ├── mod.rs
│   │       │   ├── health.rs     # GET /health, GET /ping
│   │       │   ├── evaluate.rs   # POST /evaluate — hot path
│   │       │   ├── validate.rs   # POST /validate — policy validation
│   │       │   ├── policies.rs   # CRUD for guardrails
│   │       │   ├── documents.rs  # Policy document management
│   │       │   ├── schemas.rs    # Cedar schema management
│   │       │   ├── audit.rs      # Decision audit log queries
│   │       │   └── test.rs       # POST /test — dry-run evaluation
│   │       ├── middleware/
│   │       │   ├── mod.rs
│   │       │   ├── admin_auth.rs # X-Admin-Token verification
│   │       │   └── rate_limit.rs # Per-account rate limiting (Redis)
│   │       └── cache.rs          # Redis policy cache manager
│   │
│   └── policy-worker/            # Async processing (Redis Streams consumer)
│       ├── Cargo.toml
│       └── src/
│           ├── main.rs           # Worker startup, consumer group, graceful shutdown
│           ├── extraction.rs     # Process extraction results from AI API
│           ├── revalidation.rs   # Re-validate all policies when schema changes
│           └── cleanup.rs        # Archive old decisions, trim audit logs
│
├── migrations/
│   ├── 001_init.sql              # Core tables
│   └── 002_indexes.sql           # Performance indexes
│
├── docker/
│   └── Dockerfile                # Multi-stage: builder → policy-api, policy-worker
│
├── tests/
│   ├── fixtures/                 # Sample contracts, expected policies
│   └── integration/              # End-to-end tests
│
└── .env.example
```

### 3.3 Key Dependencies (Cargo.toml)

```toml
[workspace]
members = ["crates/*"]

[workspace.dependencies]
# Cedar (the core dependency)
cedar-policy = "4.9"

# HTTP server (same as bl-flow)
axum = "0.8"
tokio = { version = "1", features = ["full"] }
tower = "0.5"
tower-http = { version = "0.6", features = ["cors", "limit"] }

# Database (same as bl-flow)
sqlx = { version = "0.8", features = ["runtime-tokio-rustls", "postgres", "uuid", "chrono", "json"] }

# Redis (same as bl-flow)
deadpool-redis = "0.18"
redis = { version = "0.27", features = ["tokio-comp", "streams"] }

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# Error handling (same as bl-flow)
thiserror = "2"
anyhow = "1"

# Observability (same as bl-flow)
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
opentelemetry = "0.27"
opentelemetry-otlp = "0.27"

# Utilities
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
```

---

## 4. Domain Model: Cedar Entity Mapping

### 4.1 BusinessLogic Cedar Schema

This schema is the contract between AI extraction and policy evaluation. It defines what entities, actions, and context types exist. Stored in `policy-common/src/schema.rs` as a compiled constant.

```cedar
namespace BusinessLogic {
    // === Principals ===

    entity Account in [Tier] {
        name: String,
        status: String,            // "active", "suspended", "trial"
    };

    entity User in [Account] {
        email: String,
        role: String,              // "owner", "admin", "member", "viewer"
    };

    entity APIKey in [Account] {
        permissions: Set<String>,
        tier: String,
    };

    entity Tier {
        name: String,              // "free", "starter", "professional", "enterprise"
    };

    // === Resources ===

    entity Calculator in [Account] {
        name: String,
        public: Bool,
        category: String,
    };

    entity KnowledgeBase in [Account] {
        name: String,
        document_count: Long,
    };

    entity Flow in [Account] {
        name: String,
        node_count: Long,
    };

    entity AIModel {
        name: String,
        provider: String,
        cost_per_1k_tokens: Long,
    };

    // === Actions ===

    action calculate appliesTo {
        principal: [User, APIKey, Account],
        resource: [Calculator],
        context: CalculationContext,
    };

    action ai_chat appliesTo {
        principal: [User, APIKey, Account],
        resource: [KnowledgeBase, AIModel],
        context: AIContext,
    };

    action kb_search appliesTo {
        principal: [User, APIKey, Account],
        resource: [KnowledgeBase],
        context: SearchContext,
    };

    action trigger_flow appliesTo {
        principal: [User, APIKey, Account],
        resource: [Flow],
        context: FlowContext,
    };

    action export_data appliesTo {
        principal: [User, APIKey],
        resource: [Calculator, KnowledgeBase],
        context: ExportContext,
    };

    // === Context Types ===

    type CalculationContext = {
        input_values: Record,
        formula_count: Long,
        source_ip: String,
    };

    type AIContext = {
        model: String,
        max_tokens: Long,
        estimated_cost_cents: Long,
        conversation_length: Long,
        tools_requested: Set<String>,
    };

    type SearchContext = {
        query_length: Long,
        top_k: Long,
    };

    type FlowContext = {
        trigger_type: String,
        node_count: Long,
        estimated_steps: Long,
    };

    type ExportContext = {
        format: String,
        row_count: Long,
    };
}
```

### 4.2 Example Policies (AI-Generated from Contract Clauses)

**Contract clause:** "Revenue calculations must not exceed $1M input values without Enterprise tier."

```cedar
// Source: Contract #4521, Clause 4.2 | Confidence: 0.92
forbid (
    principal,
    action == BusinessLogic::Action::"calculate",
    resource
)
when {
    context.input_values.has("revenue") &&
    context.input_values.revenue > 1000000
}
unless {
    principal in BusinessLogic::Tier::"enterprise"
};
```

**Contract clause:** "AI responses must use Claude Sonnet only; Opus is not permitted."

```cedar
// Source: Contract #4521, Clause 7.1 | Confidence: 0.88
forbid (
    principal,
    action == BusinessLogic::Action::"ai_chat",
    resource
)
when {
    context.model == "claude-opus-4-20250514"
};
```

**Contract clause:** "Data exports are limited to 10,000 rows per request."

```cedar
// Source: Contract #4521, Clause 9.3 | Confidence: 0.95
forbid (
    principal,
    action == BusinessLogic::Action::"export_data",
    resource
)
when {
    context.row_count > 10000
};
```

---

## 5. API Design

### 5.1 Evaluation Endpoint (Hot Path)

```
POST /evaluate
X-Admin-Token: {token}
Content-Type: application/json

{
    "account_id": "uuid",
    "principal": { "type": "BusinessLogic::Account", "id": "acct-123" },
    "action": { "type": "BusinessLogic::Action", "id": "calculate" },
    "resource": { "type": "BusinessLogic::Calculator", "id": "calc-456" },
    "context": {
        "input_values": { "revenue": 1500000 },
        "formula_count": 12,
        "source_ip": "203.0.113.42"
    }
}

Response 200:
{
    "decision": "deny",
    "diagnostics": {
        "reason": ["contract-4521-clause-4.2"],
        "errors": []
    },
    "evaluation_time_us": 14
}
```

Target latency: **<500μs** per evaluation (native Rust Cedar, cached PolicySet). For comparison, the network round-trip from gateway to bl-policy over the private 10.0.0.0/16 network adds ~0.1-0.5ms, so total enforcement overhead is **<1ms**.

### 5.2 Validation Endpoint

```
POST /validate
X-Admin-Token: {token}

{
    "account_id": "uuid",
    "policies": [
        {
            "cedar_json": { "effect": "forbid", ... },
            "source_clause": "...",
            "confidence": 0.92
        }
    ]
}

Response 200:
{
    "results": [
        {
            "index": 0,
            "valid": true,
            "cedar_text": "forbid (\n    principal,\n    ...",
            "warnings": []
        }
    ]
}
```

### 5.3 Full API Surface

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| POST | `/evaluate` | Authorize a request (hot path) | X-Admin-Token |
| POST | `/evaluate/batch` | Batch evaluation (multiple requests) | X-Admin-Token |
| POST | `/test` | Dry-run evaluation (no audit log) | X-Admin-Token |
| POST | `/validate` | Validate policies against schema | X-Admin-Token |
| GET | `/policies?account_id=` | List guardrails for account | X-Admin-Token |
| POST | `/policies` | Create/import guardrails | X-Admin-Token |
| PATCH | `/policies/{id}` | Update guardrail status (approve/reject/disable) | X-Admin-Token |
| GET | `/policies/{id}` | Get single guardrail with source info | X-Admin-Token |
| GET | `/documents?account_id=` | List policy documents | X-Admin-Token |
| POST | `/documents` | Register policy document (triggers extraction) | X-Admin-Token |
| GET | `/decisions?account_id=` | Query audit log | X-Admin-Token |
| GET | `/schema` | Get current Cedar schema | X-Admin-Token |
| GET | `/health` | Health check | None |
| GET | `/ping` | Liveness probe | None |

---

## 6. Architecture: System Flow

### 6.1 Policy Creation

```
Customer uploads contract
    ▼
bl-cms (upload UI) ──HTTP──► bl-ai-api (KB ingest)
    │                              │
    │                              ├── Chunk document
    │                              ├── Generate embeddings
    │                              ├── Store in kb_documents / kb_chunks
    │                              │
    │                              ├── AI extraction prompt
    │                              │   (document chunks + Cedar schema + examples)
    │                              │
    │                              └── Output: Cedar JSON policies + metadata
    │                                        ▼
    │                              ──HTTP──► bl-policy /validate
    │                                        │
    │                                        ├── Cedar parse (syntax)
    │                                        ├── Cedar validate (schema)
    │                                        ├── Conflict detection
    │                                        │
    │                                        └── Store in policy.guardrails
    │                                            (status = 'pending_review')
    ▼
bl-cms (review UI) ──HTTP──► bl-policy /policies/{id} PATCH
                                │
                                ├── status = 'approved' / 'rejected'
                                ├── Invalidate Redis cache
                                └── Rebuild PolicySet for account
```

### 6.2 Policy Enforcement

```
Client request
    ▼
Cloudflare ──► bl-gateway (Go)
                    │
                    ├── Auth (existing)
                    ├── Rate limit (existing)
                    │
                    ├── ──HTTP──► bl-policy /evaluate   ← NEW (private network, <1ms)
                    │                 │
                    │                 ├── Load cached PolicySet (Redis → memory)
                    │                 ├── Build entities from request context
                    │                 ├── Cedar is_authorized()
                    │                 ├── Log decision to policy.decisions
                    │                 └── Return allow/deny + diagnostics
                    │
                    ├── If deny → 403 + violation details
                    ├── If allow → route to target service
                    ▼
               bl-formula-api / bl-ai-api / bl-flow
                    │
                    ├── Build rich context (input values, model, tokens, etc.)
                    ├── ──HTTP──► bl-policy /evaluate   ← Fine-grained check
                    │
                    └── If deny → 403 with policy violation
```

### 6.3 Two-Phase Enforcement

The gateway does **coarse-grained** enforcement (can this principal do this action on this resource type?). The target service does **fine-grained** enforcement (given the full request context, do the conditions pass?).

This avoids the gateway needing to understand service-specific context while still catching obvious violations early.

| Phase | Where | Context available | Catches |
|-------|-------|-------------------|---------|
| Coarse | Gateway → bl-policy | Principal, action, resource type | "Account X cannot use AI" |
| Fine | Service → bl-policy | Full request context (input values, model, tokens) | "Revenue input > $1M without Enterprise" |

---

## 7. Database Schema

**Owner: `policy.*` — owned exclusively by bl-policy**

```sql
-- Schema setup
CREATE SCHEMA IF NOT EXISTS policy;

-- Policy documents (source contracts/compliance docs)
CREATE TABLE policy.policy_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    title TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('contract', 'compliance', 'internal', 'manual')),
    kb_document_id UUID,
    status TEXT NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'extracted', 'reviewed', 'active', 'archived')),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual guardrail rules (Cedar policies)
CREATE TABLE policy.guardrails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES policy.policy_documents(id),
    account_id UUID NOT NULL,
    policy_id TEXT NOT NULL,
    cedar_json JSONB NOT NULL,
    cedar_text TEXT NOT NULL,
    source_clause TEXT,
    source_location JSONB,
    confidence REAL,
    status TEXT NOT NULL DEFAULT 'pending_review'
        CHECK (status IN ('pending_review', 'approved', 'rejected', 'disabled', 'superseded')),
    version INT NOT NULL DEFAULT 1,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(account_id, policy_id, version)
);

-- Cedar schema versions per account
CREATE TABLE policy.cedar_schemas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    schema_json JSONB NOT NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(account_id, version)
);

-- Audit trail — every authorization decision
CREATE TABLE policy.decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    context JSONB NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
    matched_policies TEXT[],
    errored_policies TEXT[],
    evaluation_time_us INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_guardrails_account_status ON policy.guardrails(account_id, status);
CREATE INDEX idx_guardrails_document ON policy.guardrails(document_id);
CREATE INDEX idx_decisions_account_time ON policy.decisions(account_id, created_at DESC);
CREATE INDEX idx_decisions_action ON policy.decisions(action, created_at DESC);
CREATE INDEX idx_policy_documents_account ON policy.policy_documents(account_id, status);

-- Auto-update timestamp trigger (same pattern as bl-flow)
CREATE OR REPLACE FUNCTION policy.update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_policy_documents_updated
    BEFORE UPDATE ON policy.policy_documents
    FOR EACH ROW
    EXECUTE FUNCTION policy.update_timestamp();
```

---

## 8. Core Engine: policy-engine Crate

### 8.1 AccountPolicyEngine

The central abstraction — one per account, cached in memory, rebuilt on policy changes.

```rust
use cedar_policy::{
    Authorizer, Context, Decision, Diagnostics, Entities,
    EntityUid, Policy, PolicySet, Request, Schema, Validator,
};

pub struct AccountPolicyEngine {
    account_id: Uuid,
    policy_set: PolicySet,
    schema: Schema,
    authorizer: Authorizer,
    loaded_at: chrono::DateTime<chrono::Utc>,
    policy_count: usize,
}

impl AccountPolicyEngine {
    /// Build from database records
    pub fn from_guardrails(
        account_id: Uuid,
        guardrails: &[GuardrailRecord],
        schema: &Schema,
    ) -> Result<Self, PolicyError> {
        let mut policy_set = PolicySet::new();

        for g in guardrails.iter().filter(|g| g.status == "approved") {
            let policy = Policy::from_json(
                Some(g.policy_id.clone().into()),
                g.cedar_json.clone(),
            )?;
            policy_set.add(policy)?;
        }

        Ok(Self {
            account_id,
            policy_count: policy_set.policies().count(),
            policy_set,
            schema: schema.clone(),
            authorizer: Authorizer::new(),
            loaded_at: chrono::Utc::now(),
        })
    }

    /// Evaluate an authorization request
    pub fn evaluate(
        &self,
        principal: EntityUid,
        action: EntityUid,
        resource: EntityUid,
        context: Context,
        entities: Entities,
    ) -> EvaluationResult {
        let start = std::time::Instant::now();

        let request = Request::new(
            principal.clone(),
            action.clone(),
            resource.clone(),
            context,
            Some(&self.schema),
        );

        let response = match request {
            Ok(req) => self.authorizer.is_authorized(&req, &self.policy_set, &entities),
            Err(e) => return EvaluationResult::error(e.to_string()),
        };

        let elapsed = start.elapsed();

        EvaluationResult {
            decision: match response.decision() {
                Decision::Allow => "allow".into(),
                Decision::Deny => "deny".into(),
            },
            matched_policies: response.diagnostics()
                .reason()
                .map(|id| id.to_string())
                .collect(),
            errors: response.diagnostics()
                .errors()
                .map(|e| e.to_string())
                .collect(),
            evaluation_time_us: elapsed.as_micros() as u32,
        }
    }

    /// Validate a new policy against the schema before storing
    pub fn validate_policy(&self, policy_json: &serde_json::Value) -> ValidationResult {
        let policy = match Policy::from_json(None, policy_json.clone()) {
            Ok(p) => p,
            Err(e) => return ValidationResult::parse_error(e.to_string()),
        };

        let mut test_set = self.policy_set.clone();
        if let Err(e) = test_set.add(policy) {
            return ValidationResult::conflict_error(e.to_string());
        }

        let validator = Validator::new(self.schema.clone());
        let validation = validator.validate(&test_set);

        ValidationResult {
            valid: validation.validation_passed(),
            errors: validation.validation_errors()
                .map(|e| e.to_string())
                .collect(),
            warnings: validation.validation_warnings()
                .map(|w| w.to_string())
                .collect(),
        }
    }
}
```

### 8.2 Engine Cache

```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct EngineCache {
    engines: Arc<RwLock<HashMap<Uuid, Arc<AccountPolicyEngine>>>>,
    redis_pool: deadpool_redis::Pool,
    postgres_pool: sqlx::PgPool,
}

impl EngineCache {
    /// Get or load the policy engine for an account
    pub async fn get_engine(
        &self,
        account_id: Uuid,
    ) -> Result<Arc<AccountPolicyEngine>, PolicyError> {
        // Check memory cache
        {
            let engines = self.engines.read().await;
            if let Some(engine) = engines.get(&account_id) {
                if engine.is_fresh() {
                    return Ok(engine.clone());
                }
            }
        }

        // Check Redis cache, fallback to PostgreSQL
        let engine = self.load_engine(account_id).await?;
        let engine = Arc::new(engine);

        // Store in memory cache
        {
            let mut engines = self.engines.write().await;
            engines.insert(account_id, engine.clone());
        }

        Ok(engine)
    }

    /// Invalidate cache for an account (called on policy approve/reject/disable)
    pub async fn invalidate(&self, account_id: Uuid) {
        let mut engines = self.engines.write().await;
        engines.remove(&account_id);

        // Also invalidate Redis
        if let Ok(mut conn) = self.redis_pool.get().await {
            let _ = redis::cmd("DEL")
                .arg(format!("pol:{}:policies", account_id))
                .query_async::<i32>(&mut *conn)
                .await;
        }
    }
}
```

---

## 9. Redis Namespacing

Following the established convention (`gw:`, `ai:`, `fa:`, `fl:`, `cms:`):

| Prefix | Purpose |
|--------|---------|
| `pol:` | Policy service keys |
| `pol:{account_id}:policies` | Cached PolicySet JSON for account |
| `pol:{account_id}:entities` | Cached Entities JSON for account |
| `pol:{account_id}:schema` | Cached Schema JSON for account |
| `pol:locks:{account_id}` | Distributed lock for cache rebuild |
| `pol:events` | Redis Stream for async processing |
| `rl:pol:rps:{account_id}:{epoch}` | Rate limiting (evaluation requests per second) |

---

## 10. Docker & Deployment

### 10.1 Dockerfile (same pattern as bl-flow)

```dockerfile
# Stage 1: Build
FROM rust:alpine AS builder

RUN apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static git

WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/

RUN cargo build --release --bin policy-api --bin policy-worker

# Stage 2: API service
FROM alpine:3.20 AS api

RUN apk add --no-cache ca-certificates && \
    adduser -D -u 1000 appuser

COPY --from=builder /build/target/release/policy-api /usr/local/bin/policy-api

USER appuser
EXPOSE 3300

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:3300/ping || exit 1

ENTRYPOINT ["policy-api"]

# Stage 3: Worker
FROM alpine:3.20 AS worker

RUN apk add --no-cache ca-certificates && \
    adduser -D -u 1000 appuser

COPY --from=builder /build/target/release/policy-worker /usr/local/bin/policy-worker

USER appuser
HEALTHCHECK NONE
ENTRYPOINT ["policy-worker"]
```

### 10.2 Environment Variables

```bash
# Required
DATABASE_URL=postgres://directus:password@10.0.0.3:5432/directus
REDIS_URL=redis://10.0.0.1:6379

# Server
PORT=3300                        # HTTP server port
DATABASE_POOL_SIZE=10            # PostgreSQL connection pool
ADMIN_TOKEN=secret               # X-Admin-Token for service auth

# Cedar
CEDAR_CACHE_TTL_SECS=300         # PolicySet cache TTL (default 5 min)
CEDAR_MAX_POLICIES_PER_ACCOUNT=500  # Safety limit

# Observability
RUST_LOG=info                    # Tracing filter
OTEL_EXPORTER_OTLP_ENDPOINT=    # Optional OpenTelemetry collector

# Worker
WORKER_CONSUMER_GROUP=policy-workers
WORKER_BATCH_SIZE=10
DECISION_RETENTION_DAYS=90       # Audit log retention
```

### 10.3 Service Topology Update

```
┌─────────────────────────────────────────────────────────────────┐
│                      Hetzner Private Network (10.0.0.0/16)       │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ App Server   │  │ Compute      │  │ DB Server             │   │
│  │              │  │              │  │                        │   │
│  │ bl-cms       │  │ bl-formula   │  │ PostgreSQL 16         │   │
│  │ bl-gateway   │  │ bl-ai-api    │  │  + pgvector           │   │
│  │ Redis 7      │  │ bl-flow      │  │                        │   │
│  │              │  │ bl-policy ←  │  │ Schemas:              │   │
│  │              │  │              │  │  cms.*, ai.*, formula.*│   │
│  │              │  │              │  │  flow.*, gateway.*     │   │
│  │              │  │              │  │  policy.* ←            │   │
│  └─────────────┘  └──────────────┘  └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

bl-policy runs on the Compute server alongside bl-flow — both are Rust services with similar resource profiles. The gateway calls bl-policy over the private network for every public request.

---

## 11. AI Extraction Pipeline

### 11.1 Flow

```
bl-ai-api receives extraction request
    │
    ├── Load document from KB (chunks + embeddings)
    ├── Load Cedar schema from bl-policy (GET /schema)
    │
    ├── AI prompt:
    │   System: "Extract enforceable rules as Cedar JSON policies."
    │   Context: Cedar schema + document chunks + example policies
    │   Output: Array of { cedar_json, source_clause, confidence, reasoning }
    │
    ├── For each extracted policy:
    │   └── POST bl-policy /validate (schema check + conflict detection)
    │
    └── POST bl-policy /policies (store with status = 'pending_review')
```

### 11.2 Extraction Prompt

```
You are a policy extraction agent for the BusinessLogic platform.
Given a document and a Cedar schema, extract enforceable guardrails.

Rules:
1. Output ONLY valid Cedar JSON matching the provided schema
2. Each policy must reference existing entity types and actions
3. Include the exact source clause text and your confidence (0.0-1.0)
4. When uncertain, prefer "forbid" (deny by default is safer)
5. Flag ambiguous clauses separately (confidence < 0.7)
6. Do NOT invent entity types, actions, or context fields

Cedar Schema:
{schema}

Document:
{chunks}

Output JSON:
{
  "policies": [
    {
      "cedar_json": { "effect": "forbid", "principal": {...}, ... },
      "source_clause": "exact quoted text from document",
      "source_location": { "chunk_index": 0, "offset": 142 },
      "confidence": 0.92,
      "reasoning": "This clause restricts X because Y"
    }
  ],
  "ambiguous_clauses": [
    { "text": "...", "reason": "Could mean X or Y" }
  ]
}
```

---

## 12. CMS Extension: Policy Review UI

New module: `project-extension-guardrails`

| Screen | Purpose |
|--------|---------|
| Policy Documents | List uploaded contracts with extraction status |
| Guardrail Review | Per-document extracted policies: Cedar text, source clause, confidence, approve/reject |
| Active Guardrails | All approved policies for account, enable/disable toggle |
| Decision Audit | Filterable log of all authorization decisions |
| Policy Tester | Dry-run: input hypothetical request, see which policies match |

The review UI calls bl-policy via the CMS hook extension (`project-extension-guardrails-api`), following the same pattern as flow-hooks and calculator-api.

---

## 13. Implementation Phases

### Phase 1: bl-policy Service Foundation (3 weeks)

- [ ] Scaffold Rust workspace (Cargo.toml, 4 crates, same structure as bl-flow)
- [ ] Define BusinessLogic Cedar schema in `policy-common`
- [ ] Implement `AccountPolicyEngine` with `cedar-policy` crate
- [ ] Build policy-api HTTP server (Axum): /evaluate, /validate, /health
- [ ] Create `policy.*` database schema (migrations)
- [ ] Redis caching layer (EngineCache)
- [ ] Dockerfile (multi-stage alpine, api + worker targets)
- [ ] Unit tests: schema validation, policy evaluation, JSON round-tripping
- [ ] Add to docker-compose.dev.yml

### Phase 2: AI Extraction Integration (2 weeks)

- [ ] Extraction prompt design (Cedar JSON output)
- [ ] bl-ai-api endpoint: POST /extract-guardrails (document → Cedar policies)
- [ ] Validation pipeline: ai-api → bl-policy /validate → store
- [ ] Integration tests with sample contracts
- [ ] Confidence scoring and ambiguity detection

### Phase 3: Gateway Enforcement (2 weeks)

- [ ] bl-gateway middleware: POST to bl-policy /evaluate on every public request
- [ ] Coarse-grained context extraction in gateway (principal, action, resource)
- [ ] Fine-grained evaluation in formula-api, ai-api, flow (POST to bl-policy with full context)
- [ ] Error responses: 403 with policy violation details + matched policy IDs
- [ ] Audit logging in policy.decisions

### Phase 4: CMS Review UI (3 weeks)

- [ ] Hook extension: project-extension-guardrails-api (proxy to bl-policy)
- [ ] Module extension: project-extension-guardrails (Vue.js UI)
- [ ] Policy document upload + extraction trigger
- [ ] Guardrail review interface with approve/reject
- [ ] Active guardrails dashboard
- [ ] Decision audit log viewer
- [ ] Policy tester (dry-run)

### Phase 5: Hardening + Templates (2 weeks)

- [ ] Performance benchmarks (target: <500μs per evaluation)
- [ ] Built-in policy templates (rate limits, model restrictions, export limits)
- [ ] Platform-level policies (cross-account guardrails managed by Coignite admin)
- [ ] Cache invalidation stress testing
- [ ] Edge cases: empty policy sets, conflicting policies, malformed context
- [ ] Documentation
- [ ] CTO review + DevOps review

**Total estimate: 12 weeks**

---

## 14. Service Communication Updates

### 14.1 New Environment Variables (Other Services)

```bash
# bl-gateway (Go)
POLICY_API_URL=http://10.0.0.x:3300     # bl-policy on private network
POLICY_API_ADMIN_TOKEN=secret             # X-Admin-Token for bl-policy
POLICY_ENFORCEMENT_ENABLED=true           # Feature flag (start disabled)

# bl-formula-api (Node.js)
POLICY_API_URL=http://10.0.0.x:3300
POLICY_API_ADMIN_TOKEN=secret

# bl-ai-api (Node.js)
POLICY_API_URL=http://10.0.0.x:3300
POLICY_API_ADMIN_TOKEN=secret

# bl-flow (Rust)
POLICY_API_URL=http://10.0.0.x:3300
POLICY_API_ADMIN_TOKEN=secret
```

### 14.2 Feature Flag

Enforcement starts **disabled** (`POLICY_ENFORCEMENT_ENABLED=false`). This allows the service to be deployed, policies to be created and reviewed, without affecting any existing traffic. Once validated, flip the flag per-service.

---

## 15. Updates to Platform Documentation

### CLAUDE.md Service Table

```
| **bl-policy** | `services/policy/` | Axum + Tokio (Rust) | 3300/3310 | Cedar guardrails engine |
```

### evolution-plan.md Service Topology

Add bl-policy to the 6-service topology. Update architecture diagram.

### database-strategy.md

Add `policy.*` schema with ownership rules. bl-policy WRITES. All other services READ (for audit queries). Gateway, formula-api, ai-api, flow call bl-policy HTTP API — they never query policy.* directly.

### service-auth.md

Add bl-policy admin token pattern (consistent with existing FORMULA_API_ADMIN_TOKEN, FLOW_TRIGGER_ADMIN_TOKEN, AI_API_ADMIN_TOKEN).

---

## 16. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| AI extraction accuracy | Wrong guardrails block legitimate requests | Human review mandatory; nothing live without approval; confidence scoring |
| Evaluation latency | Adds overhead to every request | Native Rust Cedar (<500μs); private network (<0.5ms); feature flag to disable |
| Schema evolution | New entity types break existing policies | Schema versioning; re-validate all policies on schema change (policy-worker job) |
| Policy conflicts | Two policies contradict | Cedar's default-deny model; conflict detection in validation; review UI highlights conflicts |
| Adoption complexity | Customers confused by policy language | AI does extraction; review UI shows plain language; tester builds confidence |
| Service dependency | bl-policy down → all requests fail | Feature flag fallback (allow-all if unreachable); health checks; circuit breaker in gateway |

---

## 17. Open Questions

1. **Should bl-flow call bl-policy before each node execution, or only at flow trigger time?** Per-node would be very granular but adds latency to every step. Recommendation: trigger-time only for Phase 1, per-node in Phase 2 if customers need it.

2. **Policy templates as a product feature?** Ship pre-built Cedar templates for common guardrails (GDPR data handling, financial calculation limits, AI model restrictions). Customers select and customize rather than extracting from scratch. This could be a differentiator.

3. **Multi-document policy sets?** A customer might upload 3 contracts that together form their guardrail set. Need to handle merging and conflict resolution across documents.

4. **Platform-level policies?** Coignite admin sets guardrails that apply to all accounts (e.g., global AI spend limits). These would be a separate PolicySet evaluated before account-specific ones.

5. **Billing integration?** Policy evaluation count could be a billable metric (e.g., free tier: 10K evaluations/month, enterprise: unlimited). Ties into cms/08-pricing-billing.md.
