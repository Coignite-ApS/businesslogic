# 02. Agent Node — ReAct Loop in Flow Engine

**Status:** planned
**Phase:** 4 — Vision & Differentiation
**Inspired by:** [Hermes Agent](https://hermes-agent.nousresearch.com/) — ReAct loop, iteration budget, tool dispatch

---

## Goal

Add a `core:agent` node to the flow engine that runs an autonomous ReAct loop (Reason → Act → Observe → Repeat). This transforms flows from deterministic DAGs into adaptive AI orchestration — the LLM decides which tool-nodes to invoke, observes results, and iterates until the goal is met or budget is exhausted.

## Current State

- LLM nodes (`core:llm`) fire a single prompt and return text. No tool calling.
- Tool use exists only in `ai-api` (Anthropic SDK, synchronous, not composable in flows).
- Flows are deterministic DAGs — branching is explicit via `core:condition`, not LLM-driven.
- No iteration budget management beyond the existing 5-layer cost budget.

## Architecture

```
core:agent node
├── Config
│   ├── model (string — e.g., "claude-sonnet-4-6")
│   ├── system_prompt (string — agent instructions)
│   ├── goal (string — template, e.g., "{{ $trigger.task }}")
│   ├── available_tools (string[] — subset of registered node types)
│   ├── max_iterations (u32 — default 20, hard cap 100)
│   ├── iteration_budget (f64 — dollar cap for this agent run)
│   ├── fallback_model (string — cheaper model if budget runs low)
│   └── timeout_seconds (u32 — wall-clock timeout, default 300)
│
├── Execution Loop (ReAct)
│   1. Build system prompt + tool schemas from available_tools
│   2. Send goal + conversation history to LLM
│   3. If LLM returns tool_calls:
│       a. For each tool_call → instantiate the target node, execute it
│       b. Collect results as tool observations
│       c. Inject budget warning if remaining < 20%
│       d. Append observations to conversation history
│       e. Loop to step 2
│   4. If LLM returns text (no tool_calls) → treat as final answer
│   5. If max_iterations or budget exhausted → force summarization pass
│
├── Output
│   ├── result (string — final LLM response)
│   ├── tool_calls_log (array — full trace of actions taken)
│   ├── iterations_used (u32)
│   ├── cost (f64 — total LLM + tool cost)
│   └── exit_reason (enum: "completed" | "budget" | "iterations" | "timeout")
│
└── Integration
    ├── Uses existing core:llm infrastructure (model routing, caching, retry)
    ├── Tool schemas generated from node type registry
    ├── Budget enforcement via existing flow-level budget system
    └── OpenTelemetry span per iteration for observability
```

### Tool Schema Generation

Each available node type exposes its config as a JSON Schema tool definition:

```rust
// Node types register their tool schema
trait ToolCapable {
    fn tool_name(&self) -> &str;
    fn tool_description(&self) -> &str;
    fn tool_input_schema(&self) -> serde_json::Value;
    fn execute_as_tool(&self, input: serde_json::Value, ctx: &ExecutionContext) -> Result<Value>;
}
```

Available tools are a **whitelist** — the flow author decides which nodes the agent can invoke. This prevents the agent from accessing `core:database` (admin-only) unless explicitly granted.

### Budget Warning Injection (from Hermes)

Rather than sending a new message (which breaks prompt caching), inject warnings as a JSON field in tool results:

```json
{
  "status": "success",
  "output": "Calculator returned 42.5",
  "_budget_warning": "3 iterations remaining. Wrap up and provide your final answer."
}
```

This preserves cached prompt prefix tokens while giving the LLM soft signals.

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Loop model | Synchronous ReAct | Proven pattern (Hermes, Claude tool_use). Simpler than async multi-agent. Observable. |
| Tool dispatch | In-process node execution | Reuse existing node infrastructure. No network hop for core nodes. |
| Budget tracking | Per-iteration token counting | Extend existing `flow-engine/src/nodes/ai/budget.rs` |
| History format | Anthropic messages API | Direct mapping to Claude tool_use protocol |
| Fallback | Model downgrade at 80% budget | Switch from Opus→Sonnet or Sonnet→Haiku to complete within budget |

## Key Tasks

### Core Implementation (Rust)
- [ ] Define `ToolCapable` trait in `flow-common`
- [ ] Implement `ToolCapable` for core nodes: `http_request`, `formula`, `llm`, `embedding`, `vector_search`, `transform`
- [ ] Create `core:agent` node type in `flow-engine/src/nodes/ai/agent.rs`
- [ ] Implement ReAct loop with Anthropic tool_use message format
- [ ] Add iteration budget tracking (count + cost)
- [ ] Add budget warning injection at 20% remaining
- [ ] Add fallback model switching at 80% budget consumed
- [ ] Add wall-clock timeout enforcement
- [ ] Add forced summarization pass on budget/iteration exhaustion

### Integration
- [ ] Register `core:agent` as Tier 1 node in node registry
- [ ] Add OpenTelemetry spans: one per iteration, one per tool call
- [ ] Wire into existing budget enforcement (`budget.rs`)
- [ ] Add `tool_calls_log` to flow execution results (persisted to PostgreSQL)
- [ ] Expose agent node in flow trigger API schema

### Testing (TDD)
- [ ] Unit test: ReAct loop with mock LLM (tool call → observe → final answer)
- [ ] Unit test: Budget exhaustion triggers forced summarization
- [ ] Unit test: Max iterations cap respected
- [ ] Unit test: Tool whitelist enforced (unavailable tool → error, not hallucination)
- [ ] Unit test: Budget warning injected at correct threshold
- [ ] Unit test: Fallback model switch at budget threshold
- [ ] Integration test: Agent node within a full DAG execution
- [ ] Integration test: Agent calls `core:formula` + `core:vector_search` in sequence

### CMS Flow Editor
- [ ] Add `core:agent` to node palette in `project-extension-flows`
- [ ] Config UI: model selector, system prompt, tool whitelist (checkbox list), budget slider
- [ ] Display agent execution trace in flow execution detail view

## Acceptance Criteria

- [ ] Agent node executes a multi-step task using 2+ tool calls autonomously
- [ ] Budget enforcement prevents runaway cost (hard cap respected)
- [ ] Tool whitelist prevents access to non-permitted nodes
- [ ] Execution trace shows full ReAct history (reasoning + actions + observations)
- [ ] Existing DAG flows unaffected — agent node is opt-in
- [ ] Performance: <100ms overhead per iteration (excluding LLM latency)

## Dependencies

- Existing `core:llm` node infrastructure (model routing, caching, retry)
- Existing budget system in `flow-engine/src/nodes/ai/budget.rs`
- Anthropic API tool_use support (already used in `ai-api`)
- Node type registry in `flow-engine`

## Estimated Scope

- Rust (flow-engine): ~1500-2000 lines (agent node + ToolCapable trait + tests)
- CMS UI: ~400-500 lines (node config + execution trace view)
- Timeline: 2-3 weeks
