# 07. AI Safety Quick Fixes

**Status:** completed
**Phase:** 1B+ — Cost Optimization (immediate)
**Estimated effort:** 2-3 days total

---

## Goal

Four low-effort, high-impact fixes for AI cost and safety gaps identified in the platform review. None require architectural changes — all are surgical fixes in existing code.

---

## Fix 1: Prompt Caching in Flow Engine LLM Node

**Problem:** The flow engine's `core:llm` node sends raw API requests without Anthropic prompt caching headers. Flows that call the LLM multiple times with the same system prompt pay full input token price every time.

**Impact:** 10x cost reduction on cached prompt prefixes. For a flow with 5 LLM calls sharing a system prompt, this saves ~80% of system prompt tokens.

**Fix:** Add `cache_control` block to the system prompt in the Anthropic API request body.

**File:** `services/flow/crates/flow-engine/src/nodes/ai/llm.rs`

```rust
// In the request body construction:
"system": [{
    "type": "text",
    "text": system_prompt,
    "cache_control": { "type": "ephemeral" }  // 5-min TTL
}]
```

### Tasks
- [ ] Add `cache_control` to system prompt block in LLM node API request
- [ ] Add `anthropic-beta: prompt-caching-2024-07-31` header
- [ ] Test: verify cache hit via `x-cache` response header logging
- [ ] Log cache hit/miss ratio in node output metadata

---

## Fix 2: Conversation Summarization at Context Window Limit

**Problem:** Hard 50-message sliding window drops oldest messages without summarization. For long calculator-building sessions, the AI loses the original requirements and design decisions.

**Impact:** Better conversation quality for sessions >25 messages. Prevents "what were we building again?" failures.

**Fix:** When conversation hits 70% of message limit (35 messages), trigger a summarization pass that compresses the first 20 messages into a structured summary, keeping the last 15 intact.

**File:** `services/ai-api/src/routes/chat.js`

```javascript
// Before trimming messages:
if (messages.length > MAX_MESSAGES * 0.7) {
  const olderMessages = messages.slice(0, messages.length - 15);
  const summary = await summarizeMessages(olderMessages);
  // Replace older messages with single summary message
  messages = [{ role: 'user', content: `[Conversation summary]\n${summary}` }, ...messages.slice(-15)];
}
```

**Summarization prompt:** "Summarize this conversation. Preserve: (1) the user's original goal, (2) key decisions made, (3) calculator configuration details, (4) any requirements or constraints stated. Be concise."

**Model:** Use Haiku for summarization — cheap and fast enough. ~$0.001 per summarization.

### Tasks
- [ ] Implement `summarizeMessages()` function using Haiku
- [ ] Add summarization trigger at 70% of MAX_MESSAGES
- [ ] Preserve key context: original goal, decisions, configuration, constraints
- [ ] Test: long conversation (40+ messages) retains original requirements after summarization
- [ ] Test: summarization cost stays under $0.005 per trigger
- [ ] Add `summarized_at` timestamp to conversation record

---

## Fix 3: Unknown Model Pricing — Warn and Fail

**Problem:** In `flow-engine/src/nodes/ai/provider.rs`, unknown model IDs silently default to Sonnet pricing ($3/M input). If someone specifies `claude-opus-4-6-latest` (a valid future model), cost tracking silently underreports by 5x.

**Impact:** Prevents silent cost underreporting. Small fix, big trust gain.

**Fix:** Log a warning for unknown models and use the most expensive pricing as the safe default (Opus rates), not the cheapest.

**File:** `services/flow/crates/flow-engine/src/nodes/ai/provider.rs`

```rust
_ => {
    tracing::warn!(model = model, "Unknown model for cost calculation — using Opus pricing as safe default");
    ModelPricing { input_per_m: 15.0, output_per_m: 75.0 }  // Opus rates, not Sonnet
}
```

### Tasks
- [ ] Change unknown model default from Sonnet pricing to Opus pricing
- [ ] Add `tracing::warn!` log for unknown model IDs
- [ ] Test: unknown model ID logs warning and uses Opus pricing
- [ ] Test: all known model IDs still use correct pricing

---

## Fix 4: Hard Circuit Breaker for Per-Execution Cost

**Problem:** Budget checks use estimates before LLM calls, but actual costs are recorded after. If an LLM generates an unexpectedly large response, the account is charged beyond its budget. No per-execution hard limit exists.

**Impact:** Prevents runaway costs on individual flow executions. Safety net for the entire budget system.

**Fix:** Add a per-execution cost circuit breaker. After each LLM call, check if cumulative execution cost exceeds 2x the flow's `budget_limit_usd`. If so, abort remaining nodes.

**File:** `services/flow/crates/flow-engine/src/executor/mod.rs`

```rust
// After recording cost in the execution context:
if let Some(limit) = flow.settings.budget_limit_usd {
    let hard_limit = limit * 2.0;  // 2x safety factor
    if ctx.meta.cumulative_cost_usd > hard_limit {
        return Err(FlowError::BudgetExceeded {
            limit: hard_limit,
            spent: ctx.meta.cumulative_cost_usd,
            message: format!("Hard circuit breaker: execution cost ${:.4} exceeded 2x budget limit ${:.4}",
                           ctx.meta.cumulative_cost_usd, limit),
        });
    }
}
```

### Tasks
- [ ] Add post-execution cost check in DAG executor (after each node completes)
- [ ] Circuit breaker threshold: 2x budget_limit_usd (configurable via env var)
- [ ] Log circuit breaker activations as warnings
- [ ] Test: execution aborts when cumulative cost exceeds 2x limit
- [ ] Test: normal executions within budget are unaffected

---

## Acceptance Criteria

- [ ] Flow engine LLM calls use prompt caching (verified via response headers)
- [ ] Long conversations retain original requirements after summarization
- [ ] Unknown model IDs produce visible warnings and use safe (expensive) pricing
- [ ] Runaway flow executions are terminated at 2x budget limit
- [ ] All fixes have test coverage
- [ ] No regression in existing test suites

---

## Estimated Scope

| Fix | Lines Changed | Effort |
|-----|--------------|--------|
| Prompt caching | ~10 lines Rust | 2 hours |
| Conversation summarization | ~80 lines JS | 1-2 days |
| Unknown model pricing | ~5 lines Rust | 1 hour |
| Circuit breaker | ~20 lines Rust | 3-4 hours |
| **Total** | ~115 lines | **2-3 days** |
