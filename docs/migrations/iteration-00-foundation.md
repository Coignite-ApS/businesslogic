# Iteration 0: Foundation

**Goal:** Set up monorepo structure, Docker dev environment, and verify existing services work. Move working parts FIRST for fast visible progress. Apply foundation fixes (HNSW, content hash) after services are verified.

**Duration:** 1-2 weeks
**Risk:** None (additive changes only)
**Rollback:** Revert SQL migrations, remove new files
**Branch:** `iteration/00-foundation` (branched from `dev`)

---

## Prerequisites

- Access to legacy-implementation/ projects
- Docker and Docker Compose installed
- `.env` file populated (copy from `infrastructure/docker/.env` or fill `.env.example`)
- `jq` installed (required by Claude Code hooks)

---

## Step 0.0: Initialize Git Repository

**Why first:** Without git, the hooks, branching strategy, and commit safety have no effect. This must happen before any other work.

**Actions:**
```bash
cd /path/to/businesslogic  # project root

# Initialize repo
git init
git add .gitignore CLAUDE.md docs/ .claude/settings.json .claude/hooks/ .claude/commands/ \
  infrastructure/docker/.env.example infrastructure/docker/docker-compose.dev.yml \
  migrations/ packages/ scripts/ services/
# NOTE: Do NOT add .env (real secrets), .claude/settings.local.json (local perms),
#       or legacy-implementation/ (has its own git history, add later with care)
git commit -m "chore(infra): initial monorepo structure with docs and tooling"

# Create dev branch and iteration branch
git checkout -b dev
git checkout -b iteration/00-foundation
```

**Verification:**
- `git branch --show-current` shows `iteration/00-foundation`
- `git log --oneline` shows the initial commit
- `git diff --cached` is empty (clean state)
- `.env` and `settings.local.json` are NOT tracked: `git status` should not show them

---

## Development Workflow (applies to ALL remaining steps)

**TDD Rules:**
1. Before modifying any service code, check if existing tests pass first
2. Write or update tests BEFORE implementing changes
3. Run `./scripts/test-all.sh --service <name>` after each step
4. Never commit with failing tests (hooks enforce this)

**Git Workflow:**
```bash
# We're already on iteration/00-foundation from Step 0.0

# After each step
git add <changed-files>
git commit -m "chore(infra): step 0.X - <description>"

# End of iteration
git checkout dev
git merge iteration/00-foundation
# Then PR from dev -> main
```

---

## Phase A: Move Working Services (Fast Wins)

These steps copy existing, already-working services into the monorepo structure. Each step ends with a verification that the service starts and its existing tests pass.

### Step 0.1: Set Up services/formula-api/ from Legacy (QUICK WIN)

**Why first:** Formula-api is the most mature service — it has 12 test suites, a clean Dockerfile, and zero Directus dependency. Moving it first gives immediate confidence.

**Actions:**
```bash
cp -r legacy-implementation/excel-formula-api/ services/formula-api/

# Clean up legacy Claude Code config (will use monorepo config)
rm -rf services/formula-api/.claude
rm -f services/formula-api/CLAUDE.md
```

**Test (TDD verification — existing tests must still pass):**
```bash
cd services/formula-api
npm install
npm test                    # Basic formula tests
npm run test:all            # Full suite (12 test files)
```

**Verification:**
- `ls services/formula-api/src/server.js` exists
- `ls services/formula-api/package.json` exists
- `npm test` in services/formula-api/ passes
- `ls services/formula-api/Dockerfile` exists

---

### Step 0.2: Set Up services/flow/ from Legacy (QUICK WIN)

**Why second:** Flow engine is self-contained Rust — cargo test validates everything without external deps.

**Actions:**
```bash
cp -r legacy-implementation/businesslogic-flow/ services/flow/

# Clean up legacy Claude Code config
rm -rf services/flow/.claude
rm -f services/flow/CLAUDE.md
```

**Test (TDD verification — existing tests must still pass):**
```bash
cd services/flow
cargo test --workspace
```

**Verification:**
- `ls services/flow/Cargo.toml` exists
- `ls services/flow/crates/` shows flow-common, flow-engine, flow-trigger, flow-worker
- `cargo test --workspace` passes
- `ls services/flow/docker/Dockerfile` exists

---

### Step 0.3: Set Up services/cms/ from Legacy

**Why third:** CMS is the most complex (base submodule, 12 extensions) — verify it carefully.

**Actions:**
```bash
cp -r legacy-implementation/businesslogic-cms/ services/cms/

# Clean up legacy Claude Code config
rm -rf services/cms/.claude
rm -f services/cms/CLAUDE.md

# Verify base submodule is intact
cd services/cms && ls base/Dockerfile base/docker-compose.base.yml base/dev.sh
```

**Test (TDD verification):**
```bash
cd services/cms
# If extensions have test scripts in package.json:
cd extensions && npm install && npm test
```

**Verification:**
- `ls services/cms/base/Dockerfile` exists
- `ls services/cms/extensions/local/` shows all 12 extensions
- `ls services/cms/config.local.yaml` exists
- Base submodule files present: Dockerfile, docker-compose.base.yml, dev.sh

---

## Phase B: Docker Stack Verification

### Step 0.4: Verify Docker Compose Configuration

**What:** Validate the docker-compose.dev.yml works with the services now in place.

**Actions:**
```bash
# Validate compose file syntax
docker compose -f infrastructure/docker/docker-compose.dev.yml config

# Start infrastructure services first
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d postgres redis maildev

# Wait for postgres to be ready
docker compose -f infrastructure/docker/docker-compose.dev.yml exec postgres pg_isready -U directus

# Verify Redis
docker compose -f infrastructure/docker/docker-compose.dev.yml exec redis redis-cli ping
```

**Verification:**
- `docker compose config` exits 0
- PostgreSQL responds to pg_isready
- Redis responds to PING

---

### Step 0.5: Start All Services in Docker

**What:** Bring up the complete stack and verify all services are healthy.

**Actions:**
```bash
# Start everything
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d

# Wait for services to initialize (CMS takes longest due to migrations)
sleep 45

# Health check
./scripts/health-check.sh
```

**Verification:**
- bl-cms: http://localhost:8055/server/ping returns 200
- bl-formula-api: http://localhost:3000/ping returns 200
- bl-flow-trigger: http://localhost:3100/ping returns 200

**If any service fails:**
```bash
# Check logs for the failing service
docker compose -f infrastructure/docker/docker-compose.dev.yml logs <service-name> --tail=100
```

---

### Step 0.6: Verify Legacy Can Run in Parallel

**What:** Start legacy Directus alongside new services on port 8056.

**Actions:**
```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml --profile legacy up -d
```

**Verification:**
- Legacy CMS: http://localhost:8056/server/ping returns 200
- New CMS: http://localhost:8055/server/ping returns 200
- Both connect to the SAME database and Redis
- No port conflicts in `docker compose ps`

---

### Step 0.7: Run Contract Tests

**What:** Verify API contracts between services match expectations.

**Actions:**
```bash
./scripts/test-contracts.sh
```

**Verification:**
- All reachable endpoints return expected status codes
- Response shapes match contracts

---

## Phase C: Foundation Improvements (Database)

These steps add performance improvements to the existing database. They are additive (new columns, new indexes) and cannot break existing functionality.

### Step 0.8: Add HNSW Index to pgvector

**What:** Add an HNSW index to kb_chunks.embedding for O(log n) vector search.

**Pre-test (verify current behavior):**
```sql
-- Check current index situation
SELECT indexname FROM pg_indexes WHERE tablename = 'kb_chunks';

-- If kb_chunks table exists, check current query plan
EXPLAIN SELECT * FROM kb_chunks ORDER BY embedding <=> '[0.1,0.2]'::vector LIMIT 10;
-- Should show "Seq Scan" (this is what we're fixing)
```

**Actions:**
```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml exec postgres \
  psql -U directus -d directus -f /dev/stdin < migrations/ai/001_add_hnsw_index.sql
```

**Post-test (verify improvement):**
```sql
-- Verify index exists
SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'idx_kb_chunks_embedding_hnsw';
-- Should return one row

-- Verify query plan uses index
EXPLAIN SELECT * FROM kb_chunks ORDER BY embedding <=> '[0.1,0.2]'::vector LIMIT 10;
-- Should show "Index Scan using idx_kb_chunks_embedding_hnsw"
```

**Rollback:** `DROP INDEX CONCURRENTLY IF EXISTS idx_kb_chunks_embedding_hnsw;`

---

### Step 0.9: Add Content Hash Column to kb_chunks

**What:** Add content_hash column for skip-if-unchanged during KB re-indexing.

**Pre-test:**
```sql
-- Verify column doesn't exist yet
SELECT column_name FROM information_schema.columns
WHERE table_name = 'kb_chunks' AND column_name = 'content_hash';
-- Should return 0 rows
```

**Actions:**
```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml exec postgres \
  psql -U directus -d directus -f /dev/stdin < migrations/ai/002_add_content_hash.sql
```

**Post-test:**
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'kb_chunks' AND column_name IN ('content_hash', 'embedding_model');
-- Should return both columns
```

**Rollback:**
```sql
ALTER TABLE kb_chunks DROP COLUMN IF EXISTS content_hash;
ALTER TABLE kb_chunks DROP COLUMN IF EXISTS embedding_model;
```

---

### Step 0.10: Update KB Ingestion to Use Content Hash

**What:** Modify the knowledge-api extension to compute SHA-256 of chunk content before embedding, and skip unchanged chunks.

**Write tests FIRST (TDD):**
```typescript
// services/cms/extensions/local/project-extension-knowledge-api/src/__tests__/content-hash.test.ts
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';

describe('Content Hash', () => {
  it('should generate consistent SHA-256 hash for same content', () => {
    const content = 'Hello, world!';
    const hash1 = createHash('sha256').update(content).digest('hex');
    const hash2 = createHash('sha256').update(content).digest('hex');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('should generate different hash for different content', () => {
    const hash1 = createHash('sha256').update('Content A').digest('hex');
    const hash2 = createHash('sha256').update('Content B').digest('hex');
    expect(hash1).not.toBe(hash2);
  });

  it('should detect unchanged chunks by hash comparison', () => {
    const existingChunks = [
      { id: 1, content_hash: createHash('sha256').update('chunk1').digest('hex') },
      { id: 2, content_hash: createHash('sha256').update('chunk2').digest('hex') },
    ];
    const newChunkHash = createHash('sha256').update('chunk1').digest('hex');
    const match = existingChunks.find(c => c.content_hash === newChunkHash);
    expect(match).toBeDefined();
    expect(match!.id).toBe(1);
  });
});
```

**Then implement:** Modify the chunking pipeline in `services/cms/extensions/local/project-extension-knowledge-api/src/`:
1. After generating chunk text, compute `contentHash = createHash('sha256').update(chunkText).digest('hex')`
2. Before calling OpenAI embeddings, check for existing chunk with same hash
3. If exists: skip embedding, reuse existing row
4. If not: embed as before, store with content_hash
5. After indexing: delete orphaned chunks

**Post-implementation tests:**
1. Run the new unit tests: `npm test` (content-hash.test.ts must pass)
2. Upload a document → all chunks get content_hash values
3. Re-upload the SAME document → logs show "X chunks skipped (unchanged)"
4. Modify document slightly → only changed chunks get re-embedded

---

## Phase D: Finalization

### Step 0.11: Run Full Test Suite

**What:** Final verification that everything works together.

**Actions:**
```bash
# Run all service tests
./scripts/test-all.sh

# Run contract tests with all services running
./scripts/test-contracts.sh

# Health check
./scripts/health-check.sh
```

**Verification:**
- All test suites pass
- All contract tests pass
- All services healthy

---

### Step 0.12: Commit and Prepare for Review

**Actions:**
```bash
# Ensure we're on the right branch
git branch --show-current  # Should be: iteration/00-foundation

# Stage and commit (hooks will run tests automatically)
git add -A
git commit -m "chore(infra): iteration 0 - foundation setup

- Copy formula-api, flow, cms from legacy to services/
- Verify Docker Compose stack with all services
- Add HNSW index for O(log n) vector search
- Add content_hash column for embedding skip
- Update KB ingestion to use content hash
- All existing tests pass, contract tests pass"

# Push branch for PR
git push -u origin iteration/00-foundation
```

---

## Completion Checklist

- [ ] services/formula-api/ contains formula API — tests pass
- [ ] services/flow/ contains flow engine — cargo test passes
- [ ] services/cms/ contains full Directus with base submodule
- [ ] Docker Compose starts all services — health check passes
- [ ] Legacy and new run side-by-side (8055 vs 8056)
- [ ] Contract tests pass
- [ ] HNSW index created on kb_chunks.embedding
- [ ] content_hash column added to kb_chunks
- [ ] KB ingestion skips unchanged chunks — tests written and passing
- [ ] Full test suite passes: `./scripts/test-all.sh`
- [ ] Changes committed on `iteration/00-foundation` branch
- [ ] PR created from `iteration/00-foundation` -> `dev`
