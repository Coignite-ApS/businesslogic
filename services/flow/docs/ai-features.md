# AI Features Architecture

## Philosophy

Every AI feature in the BusinessLogic platform becomes a **configurable flow**, not standalone code. This principle ensures:

1. **Visual monitoring** — Trace AI logic in the flow editor
2. **Swappable models** — Change LLM providers or embeddings without code changes
3. **Configurable thresholds** — Adjust confidence, similarity, or cost limits via YAML
4. **Cost tracking per-node** — Know exactly which operations consume which budgets
5. **Retry policies** — Handle LLM timeouts, rate limits, and failures declaratively
6. **A/B testing** — Split flows to compare different LLM strategies

**Alternative (rejected):** Embedding LLM calls directly in application code creates black boxes, makes monitoring impossible, and locks in specific providers.

## AI Features as Flows

### Feature Roadmap Integration

| Feature | Project | Core Nodes | Benefit vs. Standalone |
|---------|---------|-----------|----------------------|
| Knowledge Ingest | #12 | Trigger(upload) → Parse → Chunk → Embed → DB Write | Visual pipeline, swap embedding model in config, monitor chunk quality |
| Knowledge Retrieval | #13 | Embed Query → Vector Search → Confidence Filter → Cache Check → LLM Generate → Validate → Cache Store | Swap LLM, adjust thresholds, add post-processing (rank, filter, format) without code changes |
| AI Calculator Builder | #09 | Parse → Detect(LLM) → Design(LLM) → Build(Formula) → Preview | Replaces BullMQ architecture entirely. Cost tracking per-node, observability, easier to maintain |
| Account MCP | #06 | Trigger(MCP call) → Route → Calculator/Knowledge/Flow → Response | Expose any flow as an MCP tool. AI assistants call your calculators like native functions |

### Example: Knowledge Retrieval Flow

```yaml
name: "Retrieve Answer from KB"
description: "Embed user query, search similar documents, generate answer with LLM"

nodes:
  - id: embed_query
    type: embedding
    model: "text-embedding-3-small"
    input: "$trigger.user_query"
    output: embeddings

  - id: vector_search
    type: vector_search
    kb_id: "$trigger.knowledge_base_id"
    query_embedding: "$embed_query.output"
    top_k: 5
    similarity_threshold: 0.7
    output: search_results

  - id: check_cache
    type: cache
    key: "kb_answer:{{ $trigger.user_query | hash }}"
    ttl_seconds: 3600
    output: cached_answer

  - id: generate_answer
    type: llm
    condition: "$check_cache.hit == false"  # Skip if cached
    model: "claude-sonnet-4-6"
    system_prompt: |
      You are a knowledge base assistant. Answer the user's question based only on
      the provided documents. If the documents don't contain relevant information,
      say so clearly.
    prompt: |
      User question: {{ $trigger.user_query }}

      Relevant documents:
      {{ #each $vector_search.results }}
      - {{ this.content }} (similarity: {{ this.score }})
      {{ /each }}
    temperature: 0.3
    max_tokens: 500
    output: generated_answer

  - id: store_cache
    type: cache
    key: "kb_answer:{{ $trigger.user_query | hash }}"
    value: "$generate_answer.output"
    ttl_seconds: 3600

  - id: validate_answer
    type: llm
    condition: "$generate_answer.output != nil"
    model: "claude-haiku-4-5"
    prompt: |
      Is this answer helpful and grounded in the provided documents?
      Answer: {{ $generate_answer.output }}

      Respond with exactly "YES" or "NO".
    temperature: 0.0
    max_tokens: 10
    output: validation_result

  - id: return_answer
    type: transform
    input: |
      {
        answer: "$generate_answer.output || $check_cache.value",
        sources: "$vector_search.results[*].document_id",
        confidence: "$validate_answer.output == 'YES' ? 'high' : 'low'",
        cached: "$check_cache.hit"
      }
```

**Benefits:**
- Visual representation in editor
- Cost breakdown: embedding cost + LLM input/output tokens
- Easy to swap `claude-sonnet-4-6` for `gpt-4` in config
- Adjust `similarity_threshold` or `temperature` without code changes
- Monitor cache hit rate, validation success rate
- Add post-processing (ranking, filtering) as new nodes
- A/B test: branch at `generate_answer` to compare two LLMs

## AI-Specific Core Nodes

### LLM Node

**Type:** `type: llm`

**Configuration:**

```yaml
- id: my_llm_call
  type: llm

  # Model selection (routing)
  model: "claude-sonnet-4-6"  # Default. Also supports gpt-4, claude-haiku-4-5
  fallback_model: "claude-haiku-4-5"  # If primary fails and retries exhausted

  # Prompt engineering
  system_prompt: "You are a helpful assistant."
  prompt: "User input: {{ $trigger.query }}"

  # Sampling
  temperature: 0.7  # 0 = deterministic, 1 = creative
  top_p: 0.9  # Nucleus sampling
  max_tokens: 1000

  # Cost control
  budget_tier: "standard"  # "fast" (haiku), "standard" (sonnet), "premium" (opus)

  # Caching
  prompt_caching_tier: "5min"  # "5min" (short-lived), "1hr", "none"

  # Retry policy
  max_retries: 3
  timeout_seconds: 30
  backoff_strategy: "exponential"  # or "linear"

  # Output
  output: generated_text
```

**Execution:**

1. **Model routing:** Check flow budget. If `$meta.cumulative_cost > flow.budget_limit`, use `fallback_model` or abort
2. **Prompt caching:** Serialize prompt, check if identical to previous call in TTL window (5min, 1hr)
3. **API call:** Send to Anthropic API (primary) with configured model, temp, tokens
4. **Cost tracking:**
   ```json
   {
     "node_id": "my_llm_call",
     "input_tokens": 150,
     "output_tokens": 250,
     "cost_usd": 0.0045,
     "model": "claude-sonnet-4-6",
     "duration_ms": 450
   }
   ```
5. **Retry:** On timeout or rate limit, backoff and retry up to `max_retries` times
6. **Store in execution context:** `$meta.cumulative_cost += cost_usd`

**Output:**

```json
{
  "text": "Generated response...",
  "stop_reason": "end_turn",
  "input_tokens": 150,
  "output_tokens": 250,
  "cost_usd": 0.0045,
  "cached": false
}
```

**Model Routing Logic:**

```yaml
- id: smart_llm_call
  type: llm
  model: "{{ $trigger.complexity > 7 ? 'claude-sonnet-4-6' : 'claude-haiku-4-5' }}"
  # Simple query → fast haiku ($0.8/M input)
  # Complex query → powerful sonnet ($3/M input)
```

**Prompt Caching:**

Anthropic's prompt caching stores repeated prefixes in KV cache, reducing cost 90% on cached tokens:

```yaml
- id: retrieve_kb
  type: vector_search
  # Returns { results: [{ content, document_id }, ...] }

- id: generate_with_cache
  type: llm
  model: "claude-sonnet-4-6"
  prompt_caching_tier: "1hr"
  system_prompt: |
    You are a knowledge base assistant.
    {{#each $retrieve_kb.results}}
    Document {{ @index }}: {{ this.content }}
    {{/each}}
    # This prefix (KB content) is cached and reused for 1 hour
  prompt: "User question: {{ $trigger.query }}"
  # Only the query (few tokens) is charged at full rate; KB content is cached
```

**Budget Circuit Breaker:**

```yaml
- id: maybe_call_llm
  type: conditional
  condition: "$meta.cumulative_cost < $meta.flow_budget_limit"
  on_false: "abort"  # Stop execution, return error

- id: expensive_llm
  type: llm
  model: "claude-opus-4-6"  # $15/M input tokens
  prompt: "{{ complex_prompt }}"
```

### Embedding Node

**Type:** `type: embedding`

**Configuration:**

```yaml
- id: embed_documents
  type: embedding

  # Model (pinned version)
  model: "text-embedding-3-small"  # 1536 dimensions, $0.02/M tokens
  # text-embedding-3-large available for higher precision (3072 dim, $0.13/M)

  # Batch processing
  input: "$trigger.documents"  # Array of strings
  batch_size: 2048  # Max per API call

  # Retry policy
  max_retries: 3
  timeout_seconds: 30

  # Output
  output: embeddings
```

**Execution:**

1. **Batch:** Group input documents into chunks of 2048
2. **API call:** Send to OpenAI text-embedding-3-small
3. **Cost tracking:** Count input tokens, track cost
4. **Return:** Array of embeddings (1536-dimensional vectors)

**Output:**

```json
{
  "embeddings": [
    { "index": 0, "vector": [0.123, -0.456, ...], "text": "doc1" },
    { "index": 1, "vector": [0.789, 0.012, ...], "text": "doc2" }
  ],
  "total_tokens": 5000,
  "cost_usd": 0.10
}
```

**Example: Ingest Documents**

```yaml
- id: upload_trigger
  type: trigger
  event: "file_upload"

- id: parse_file
  type: file_parser
  input: "$upload_trigger.file"
  output: documents  # Array of text chunks

- id: chunk_documents
  type: chunker
  documents: "$parse_file.documents"
  chunk_size: 1000
  chunk_overlap: 100
  output: chunks

- id: embed_chunks
  type: embedding
  model: "text-embedding-3-small"
  input: "$chunk_documents.output"
  output: embeddings

- id: store_in_db
  type: db_write
  table: "kb_chunks"
  rows: |
    {{#each $embed_chunks.embeddings}}
    {
      "document_id": "{{ $upload_trigger.file.id }}",
      "content": "{{ this.text }}",
      "embedding": "{{ this.vector }}",
      "metadata": { "chunk_index": {{ @index }} }
    }
    {{/each}}
```

### Vector Search Node

**Type:** `type: vector_search`

**Configuration:**

```yaml
- id: search_kb
  type: vector_search

  # Vector DB (pgvector in PostgreSQL)
  kb_id: "{{ $trigger.knowledge_base_id }}"

  # Query vector
  query_embedding: "$embed_query.embeddings[0].vector"

  # Search parameters
  top_k: 5
  similarity_threshold: 0.7  # Cosine distance

  # Scoping
  filters: |
    status = 'published' AND created_at > NOW() - INTERVAL '1 year'

  # Output
  output: search_results
```

**Execution:**

1. **Build query:** `SELECT * FROM kb_chunks WHERE kb_id = ? AND ...`
2. **Vector search:** `ORDER BY embedding <=> query_vector LIMIT 5`
3. **Threshold:** Filter results by `score >= similarity_threshold`
4. **Return:** Ranked results with scores

**Output:**

```json
{
  "results": [
    {
      "chunk_id": "abc123",
      "document_id": "doc1",
      "content": "Found text...",
      "similarity_score": 0.92,
      "metadata": { "page": 5, "section": "Intro" }
    },
    // ... more results
  ],
  "query_time_ms": 45
}
```

**Similarity Threshold Logic:**

- `0.9+` — Near-exact match (typos OK)
- `0.8–0.9` — Very relevant
- `0.7–0.8` — Relevant
- `<0.7` — Marginal (exclude by default)

Adjust per knowledge base or use case:

```yaml
- id: strict_search
  type: vector_search
  similarity_threshold: 0.85  # Only high-confidence matches

- id: permissive_search
  type: vector_search
  similarity_threshold: 0.65  # Include marginal results
```

## Knowledge Base Schema (Future)

### Tables

#### `kb_documents`

```sql
CREATE TABLE kb_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id),
  filename TEXT NOT NULL,
  file_size BIGINT,
  file_mime_type TEXT,
  version_hash TEXT NOT NULL,
  status TEXT DEFAULT 'processing',  -- processing, ready, error
  error_message TEXT,
  chunks_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(knowledge_base_id, filename, version_hash)
);

CREATE INDEX idx_kb_docs_kb_id ON kb_documents(knowledge_base_id, status);
```

#### `kb_chunks`

```sql
CREATE TABLE kb_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,  -- pgvector type
  metadata JSONB DEFAULT '{}',  -- { "page": 5, "section": "Intro" }
  created_at TIMESTAMP DEFAULT NOW(),

  FOREIGN KEY (document_id, chunk_index) UNIQUE
);

-- Vector index for cosine similarity search
CREATE INDEX idx_kb_chunks_embedding ON kb_chunks
USING ivfflat (embedding vector_cosine_ops);

-- Text search index
CREATE INDEX idx_kb_chunks_content ON kb_chunks USING GIN(to_tsvector('english', content));

-- Metadata filtering
CREATE INDEX idx_kb_chunks_metadata ON kb_chunks USING GIN(metadata);
```

#### `kb_cache`

```sql
CREATE TABLE kb_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash TEXT NOT NULL,  -- SHA256(query text)
  knowledge_base_id UUID NOT NULL,
  cached_answer TEXT NOT NULL,
  ttl_expires_at TIMESTAMP NOT NULL,
  hit_count INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(knowledge_base_id, query_hash)
);

CREATE INDEX idx_kb_cache_expires ON kb_cache(ttl_expires_at);
```

### Queries

**Ingest chunk:**
```sql
INSERT INTO kb_chunks (document_id, chunk_index, content, embedding, metadata)
VALUES ($1, $2, $3, $4::vector, $5::jsonb)
RETURNING id;
```

**Search:**
```sql
SELECT
  id, document_id, content, metadata,
  1 - (embedding <=> $1::vector) as similarity_score
FROM kb_chunks
WHERE knowledge_base_id = $2
ORDER BY embedding <=> $1::vector
LIMIT $3;
```

**Cache check:**
```sql
SELECT cached_answer FROM kb_cache
WHERE knowledge_base_id = $1 AND query_hash = $2
  AND ttl_expires_at > NOW();
```

## Budget System

5-layer defense against runaway AI costs:

### Layer 1: Per-Node Cost Reporting

Every LLM/Embedding node tracks its own cost:

```json
{
  "node_id": "generate_answer",
  "model": "claude-sonnet-4-6",
  "input_tokens": 500,
  "output_tokens": 150,
  "cost_usd": 0.0024,
  "duration_ms": 1200
}
```

**Used for:** Debugging, monitoring, understanding which features are expensive.

### Layer 2: Per-Execution Cumulative Cost

ExecutionContext tracks total spend for one flow run:

```rust
pub struct ExecutionContext {
    pub cumulative_cost_usd: f64,
    pub node_costs: Vec<NodeCost>,
    pub flow_budget_limit: f64,
}
```

**Used for:** Budget circuit breaker (reject expensive nodes if budget exceeded).

### Layer 3: Per-Flow Budget Limit

FlowSettings defines ceiling for a single execution:

```yaml
name: "Retrieve Answer"
budget_limit_usd: 0.05  # ~100 queries worth of claude-haiku-4-5

nodes:
  - id: check_budget
    type: conditional
    condition: "$meta.cumulative_cost < $meta.flow_budget_limit"
    on_false: "abort_with_error"
```

**Used for:** Prevent single runaway flow from exceeding cost envelope.

### Layer 4: Per-Account Monthly Budget

Rate limiter enforces account-level cap:

```sql
CREATE TABLE account_budgets (
  account_id UUID PRIMARY KEY,
  month_year DATE NOT NULL,  -- First day of month
  budget_limit_usd DECIMAL(10, 2) DEFAULT 100.00,
  cost_ytd_usd DECIMAL(10, 2) DEFAULT 0.00,

  UNIQUE(account_id, month_year)
);
```

**Logic:** Before executing any LLM node, check:
```
IF account.cost_ytd + estimated_cost > account.budget_limit
  THEN reject request with 429 Too Many Requests
```

**Used for:** Prevent entire account from exceeding subscription tier.

### Layer 5: Daily Platform-Wide Circuit Breaker

Global safety net:

```yaml
# config.yaml
ai:
  daily_cost_limit_usd: 500
  daily_cost_reset_hour: 0  # UTC midnight
```

**Logic:** If total platform spend today > limit, reject all new LLM requests until reset.

**Used for:** Catastrophic failure protection (compromised flow, malicious input, bug).

### Cost Enforcement Flow

```yaml
- id: check_platform_budget
  type: conditional
  condition: "$meta.platform_daily_cost < $meta.platform_daily_limit"
  on_false: "abort"

- id: check_account_budget
  type: db_read
  query: "SELECT cost_ytd FROM account_budgets WHERE account_id = ? AND month_year = ?"
  output: account_budget

- id: check_flow_budget
  type: conditional
  condition: |
    $account_budget.cost_ytd + $trigger.estimated_cost < $account_budget.limit AND
    $meta.cumulative_cost < $meta.flow_budget_limit
  on_false: "abort"

- id: call_llm
  type: llm
  model: "claude-sonnet-4-6"
  # ... prompt ...
```

## Model Routing & Fallbacks

**Default tier:** `claude-sonnet-4-6` ($3/M input, $15/M output)

**Fast tier:** `claude-haiku-4-5` ($0.8/M input, $4/M output) — Use for simple tasks, summaries

**Premium tier:** `claude-opus-4-6` ($15/M input, $75/M output) — Use for complex reasoning

**Model selection:**

```yaml
- id: smart_routing
  type: llm
  model: |
    {{#if $trigger.complexity > 8}}
      claude-opus-4-6
    {{else if $trigger.complexity > 5}}
      claude-sonnet-4-6
    {{else}}
      claude-haiku-4-5
    {{/if}}
  fallback_model: "claude-haiku-4-5"
```

**Cost optimization:**

```yaml
- id: two_stage_answer
  type: llm
  model: "claude-haiku-4-5"  # Quick answer generation
  prompt: "Generate a short answer: {{ $trigger.query }}"

- id: validate_with_sonnet
  type: llm
  condition: "$two_stage_answer.output != nil"
  model: "claude-sonnet-4-6"  # Expensive validation
  prompt: "Is this answer correct? {{ $two_stage_answer.output }}"
```

## Observability & Monitoring

Every AI node emits metrics:

| Metric | Cardinality | Use |
|--------|-------------|-----|
| `flow_execution_duration_ms` | flow_id, account_id | Latency SLA |
| `flow_execution_cost_usd` | flow_id, account_id | Cost tracking |
| `llm_node_tokens` | flow_id, node_id, model | Usage patterns |
| `llm_node_latency_ms` | flow_id, node_id, model | Performance |
| `cache_hit_rate` | flow_id, node_id | Optimization |
| `validation_success_rate` | flow_id, node_id | Quality |
| `vector_search_qps` | knowledge_base_id | Throughput |

**Dashboards:**

1. **Cost Dashboard:** Total spend by account/flow/node, budget utilization, trend
2. **Quality Dashboard:** Validation success rate, cache hit rate, user satisfaction
3. **Performance Dashboard:** LLM latency, embedding throughput, search QPS
4. **Error Dashboard:** API failures, rate limits, circuit breaker triggers

## Security & Compliance

1. **Prompt injection defense:** Never execute user input as template code. Use explicit `{{ $trigger.field }}` syntax, not `{{ eval(...) }}`
2. **Token leakage:** LLM responses may contain API keys or secrets. Sanitize before storing in cache/logs
3. **Rate limiting:** Use per-account token budgets, not just API rate limits
4. **Data privacy:** Embedding model has no fine-tuning on user data. Vectors stored encrypted at rest
5. **Audit trail:** Log all LLM calls with prompt, model, result, cost, user, timestamp

## References

- [Anthropic API Docs](https://docs.anthropic.com/)
- [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings)
- [pgvector Extension](https://github.com/pgvector/pgvector)
- [Prompt Caching](https://docs.anthropic.com/en/docs/build-a-quick-start-with-the-text-api#prompt-caching) — Reduces cost 90% on repeated prefixes
