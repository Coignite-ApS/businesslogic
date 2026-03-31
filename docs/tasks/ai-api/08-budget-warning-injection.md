# 08. Budget Warning Injection for Tool Use

**Status:** completed
**Phase:** 1B — Core Platform Sprint
**Inspired by:** [Hermes Agent](https://hermes-agent.nousresearch.com/) — budget warning as JSON field in tool results

---

## Goal

Give the LLM soft signals when conversation or account budget is running low, so it naturally wraps up rather than hitting a hard wall. Inject warnings as JSON fields inside tool results — not as new messages — to preserve Anthropic prompt caching.

## Current State

- 5-layer budget system exists (per-request → per-conversation → per-day → per-month → global).
- Budget enforcement is binary: allow the call or deny it.
- When budget is exhausted, the conversation just stops — poor UX.
- No signal to the LLM that it should be economical with remaining budget.
- Prompt caching is used in `core:llm` node (5min + 1hr TTL) — new messages break cache.

## Architecture

```
Budget Warning Injection Points
├── ai-api/src/services/tools.js
│   └── After each tool execution, before returning result:
│       if (budgetRemaining < 0.20 * budgetTotal) {
│         result._budget_warning = `${roundsLeft} tool calls remaining. Summarize findings.`;
│       }
│
├── flow-engine: core:agent node (future — flow/02)
│   └── Same pattern in Rust agent loop
│
└── Warning Thresholds
    ├── 20% remaining → "Wrap up soon. N calls remaining."
    ├── 10% remaining → "Final call. Provide your answer now."
    └── 0% remaining → Hard deny (existing behavior)
```

### Why JSON Field, Not New Message

Anthropic charges 10x less for cached prompt tokens. When you append a new `system` or `user` message mid-conversation, the cache prefix is invalidated from that point forward. By injecting the warning inside the `tool` result (which the LLM expects), the prompt prefix stays cached.

Cost difference on a 50-turn conversation:
- New message approach: ~$0.015 extra per conversation
- JSON field approach: ~$0.001 extra per conversation
- At 10,000 conversations/month: **$140/mo saved**

## Key Tasks

### Implementation
- [ ] Add `getBudgetStatus()` helper to ai-api budget service
- [ ] Modify tool result wrapper in `tools.js` to inject `_budget_warning` field
- [ ] Add threshold config: `AI_BUDGET_WARN_PCT=20`, `AI_BUDGET_CRITICAL_PCT=10`
- [ ] Add graceful termination message when budget hits 0% (instead of silent stop)

### System Prompt Update
- [ ] Add instruction to AI system prompt: "When you see `_budget_warning` in a tool result, prioritize completing your current task and providing a final answer."

### Testing (TDD)
- [ ] Unit test: Warning injected at exactly 20% threshold
- [ ] Unit test: Critical warning at 10% threshold
- [ ] Unit test: No warning above 20%
- [ ] Unit test: Warning content includes remaining count
- [ ] Integration test: LLM actually wraps up faster with warning (measure avg tool calls)

## Acceptance Criteria

- [ ] Budget warnings appear in tool results at correct thresholds
- [ ] Prompt cache hit rate unchanged (verified via Anthropic API headers)
- [ ] Conversations end gracefully instead of abruptly
- [ ] Average cost per conversation decreases measurably
- [ ] No regression in conversation quality for within-budget conversations

## Dependencies

- Existing budget tracking in ai-api
- Existing tool execution wrapper in `tools.js`

## Estimated Scope

- ai-api: ~100-150 lines (budget helper + tool wrapper modification)
- Tests: ~100 lines
- Timeline: 2-3 days
