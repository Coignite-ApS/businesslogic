# Cost Control & API Integration

## 1. Claude Messages API Configuration

### 1.1 SDK and Endpoint

All agent calls use the Anthropic TypeScript SDK (`@anthropic-ai/sdk`) calling the `/v1/messages` endpoint. This is mandatory — the OpenAI compatibility layer does not support prompt caching or the web search tool. Pin the SDK to a specific version in `package.json` to avoid breaking changes.

### 1.2 Model Identifiers

Always use pinned model version strings, never "latest" aliases. This ensures output consistency and allows you to correlate training data with specific model behavior.

| Model | Version String | Use Case |
|---|---|---|
| Opus 4.6 | `claude-opus-4-6` (pin to dated version) | Tier 3 Calculator Builder |
| Sonnet 4.6 | `claude-sonnet-4-6` (pin to dated version) | Tier 2 Calculator Builder, Research Agent |
| Haiku 4.5 | `claude-haiku-4-5-20251001` | Tier 1 Builder, Display, MCP, Skill agents |

### 1.3 Key API Parameters

| Parameter | Purpose | Recommendation |
|---|---|---|
| `max_tokens` | Caps output length. Prevents runaway generation that wastes money. | Set per agent type |
| `temperature` | Controls randomness. Lower = more deterministic JSON output. | 0.0 for generation, 0.3 for research |
| `cache_control` | Marks content for prompt caching. Place on last static block. | Always use on system prompt |
| `tools` | Enables web search tool for Research Agent. | Only on Research Agent |
| `tools[].max_uses` | Caps number of web searches per request. | 3–8 depending on scenario |

---

## 2. Prompt Caching Strategy

### 2.1 How Prompt Caching Works

Prompt caching stores the processed representation of your prompt prefix so subsequent calls with the same prefix skip re-processing. The cache is keyed on content identity — any change to cached content invalidates the cache.

### 2.2 Cache Architecture Per Agent

Each agent's prompt is split into a static prefix (cached) and dynamic suffix (never cached):

| Agent | Cached Content (~tokens) | Dynamic Content |
|---|---|---|
| Research Agent | Role def + output schema + guidelines (~1,500) | User prompt or Excel metadata |
| Calculator Builder | Role def + API schema + HyperFormula ref + examples (~12,000–20,000) | Excel JSON + research brief + user answers |
| Display Agent | Role def + Display JSON schema + examples (~3,000–5,000) | API JSON for this calculator |
| MCP Doc Agent | Role def + MCP schema + conventions + examples (~2,000–4,000) | API JSON for this calculator |
| Skill Agent | Role def + skill template + examples (~2,000–4,000) | API JSON + MCP def for this calculator |

### 2.3 Pricing Impact

Cache economics for the Calculator Builder (the most expensive agent):

| Scenario | Sonnet Input Cost | 15K cached tokens | Savings |
|---|---|---|---|
| No cache (cold) | $3.00/MTok | $0.045 | — |
| Cache write (first call) | $3.75/MTok (1.25x) | $0.056 | -25% (investment) |
| Cache hit (subsequent) | $0.30/MTok (0.1x) | $0.0045 | 90% savings |

The cache write pays for itself after a single subsequent call. Since your worker processes jobs sequentially, every call after the first in a 5-minute window gets the 90% discount on the system prompt portion.

### 2.4 Cache TTL Selection

Use the 5-minute TTL (default) if your system processes at least one job every 5 minutes during active hours. Use the 1-hour TTL if job frequency is lower — the write cost is 2x base instead of 1.25x, but the cache stays alive 12x longer. For batch eval runs, always use the 1-hour TTL.

### 2.5 Implementation Pattern

```typescript
const response = await anthropic.messages.create({
  model: selectedModel,
  max_tokens: maxTokensForAgent,
  system: [
    {
      type: "text",
      text: staticSystemPrompt, // schema + ref + examples
      cache_control: { type: "ephemeral" } // <-- enables caching
    }
  ],
  messages: [{
    role: "user",
    content: dynamicJobContent // Excel JSON, research brief, etc.
  }]
});
```

---

## 3. Web Search Integration

### 3.1 Pricing

Web search costs $0.01 per search ($10 per 1,000 searches) plus standard token costs. Search result content is added to the context, increasing input tokens for the model's response generation.

### 3.2 Cost Control

- Set `max_uses` per scenario: 8 for no-Excel builds, 5 for domain research, 3 for supplemental research.
- Track `web_search_requests` from the usage response and store in `job_steps`.
- Set a per-job web search budget ceiling (e.g., max 10 searches = $0.10).
- Use domain allow/block lists to prevent searches on irrelevant sites.

### 3.3 Domain Allow List Recommendations

Configure at the Anthropic organization level and/or per-request:

- **Financial calculators:** investopedia.com, bankrate.com, sec.gov, treasury.gov
- **Health calculators:** cdc.gov, who.int, nih.gov, mayoclinic.org
- **Tax calculators:** irs.gov, gov.uk/hmrc, local tax authority sites
- **Engineering/science:** nist.gov, engineering-toolbox.com, wolframalpha.com
- **General reference:** wikipedia.org, mathworld.wolfram.com

---

## 4. Budget Management System

### 4.1 Cost Tracking Per API Call

Every API call returns a usage object with token counts. Compute the USD cost immediately and store it:

```typescript
function calculateCost(model: string, usage: Usage): number {
  const rates = {
    'claude-opus-4-6':   { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
    'claude-sonnet-4-6': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-haiku-4-5':  { input: 1.0, output: 5.0,  cacheRead: 0.1, cacheWrite: 1.25 },
  };
  const r = rates[model];
  const inputCost = (usage.input_tokens / 1_000_000) * r.input;
  const outputCost = (usage.output_tokens / 1_000_000) * r.output;
  const cacheReadCost = ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * r.cacheRead;
  const cacheWriteCost = ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * r.cacheWrite;
  const searchCost = (usage.server_tool_use?.web_search_requests ?? 0) * 0.01;
  return inputCost + outputCost + cacheReadCost + cacheWriteCost + searchCost;
}
```

### 4.2 Budget Layers

| Layer | Limit | Enforced By | Action on Breach |
|---|---|---|---|
| Per-call | `max_tokens` setting | API parameter | Response truncated |
| Per-agent step | $0.50–$2.00 | Worker pre-check | Skip retries, flag for review |
| Per-job total | $0.50–$5.00 by tier | Worker cumulative check | Stop pipeline, notify user |
| Daily total | $50–$200 configurable | Redis counter with TTL | Queue new jobs, alert admin |
| Monthly total | Anthropic usage tier | Anthropic platform | Requests throttled/rejected |

### 4.3 Redis Cost Counter Implementation

```typescript
// After each API call:
const cost = calculateCost(model, usage);
const dailyKey = `cost:daily:${format(new Date(), 'yyyy-MM-dd')}`;
const jobKey = `cost:job:${jobId}`;

await redis.incrbyfloat(dailyKey, cost);
await redis.expire(dailyKey, 86400 * 2); // 2-day TTL for safety
await redis.incrbyfloat(jobKey, cost);
await redis.expire(jobKey, 3600 * 24); // 24-hour TTL

// Before each API call:
const dailySpend = parseFloat(await redis.get(dailyKey) ?? '0');
if (dailySpend >= DAILY_BUDGET) {
  throw new BudgetExceededError('Daily budget reached');
}
const jobSpend = parseFloat(await redis.get(jobKey) ?? '0');
if (jobSpend >= JOB_BUDGET[tier]) {
  throw new BudgetExceededError('Job budget reached');
}
```

---

## 5. Batch API for Evaluations

The Batch API provides a 50% discount on all token costs with results delivered within 24 hours. Use it for non-interactive bulk operations:

- **Evaluation runs:** Re-process all approved calculators against a new prompt version to measure quality changes.
- **Bulk enrichment:** Generate Display/MCP/Skill outputs for a backlog of approved API JSONs.
- **Template regeneration:** When you update your JSON schema, regenerate all templates to the new format.

Batch API and prompt caching discounts stack. For eval runs with repeated system prompts, you get 50% off output tokens and 90% off cached input tokens, making your eval suite extremely cost-efficient.

When using Batch API with caching, send a single "primer" request first with the 1-hour TTL to warm the cache, then submit the batch. Monitor the primer's completion before submitting the batch to ensure cache hits.

---

## 6. Cost Forecasting Model

Use historical job data to forecast monthly costs:

| Volume | Mix (T1/T2/T3) | Estimated Monthly | With Caching |
|---|---|---|---|
| 50 jobs/month | 60/30/10% | $15–$30 | $8–$18 |
| 200 jobs/month | 60/30/10% | $50–$100 | $30–$60 |
| 500 jobs/month | 60/30/10% | $120–$250 | $70–$150 |
| 1000 jobs/month | 60/30/10% | $240–$500 | $140–$300 |

These estimates include all five agents per job, retries at a 15% rate, and web search for 30% of jobs. Actual costs depend heavily on calculator complexity distribution and retry rates. Track real costs from week one and adjust forecasts monthly.

---

## 7. Cost Reconciliation

Anthropic provides a Usage and Cost API for pulling account-level spend data. Implement a weekly reconciliation job that compares your internally tracked costs (summed from `job_steps`) against Anthropic's reported usage. Discrepancies indicate logging bugs or untracked API calls. Store reconciliation results for audit purposes.
