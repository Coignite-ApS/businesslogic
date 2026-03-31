# 09. Progressive Tool Loading

**Status:** completed
**Phase:** 1B — Core Platform Sprint
**Inspired by:** [Hermes Agent](https://hermes-agent.nousresearch.com/) — three-level progressive disclosure, dynamic tool schema injection

---

## Goal

Reduce per-conversation token cost by 30-50% for simple queries. Instead of loading all 10+ tool schemas into every conversation, start with a lightweight manifest and dynamically inject full schemas only when the LLM signals intent to use a tool category.

## Current State

- All AI tools (calculator CRUD, KB search, KB ask, etc.) are loaded into every conversation system prompt.
- Tool schemas consume ~2,000-3,000 tokens per conversation regardless of whether tools are used.
- Simple "explain this formula" conversations pay the same token overhead as complex builder sessions.
- At scale, this is significant: 10,000 conversations/month × 2,500 wasted tokens = 25M tokens/month.

## Architecture

```
Progressive Tool Loading
├── Level 0 — Tool Manifest (always loaded, ~300 tokens)
│   "Available tool categories:
│    - calculators: list, describe, execute, create, update, configure, deploy
│    - knowledge: search, ask
│    - account: get info, usage stats
│    When you need to use tools, state which category you need."
│
├── Level 1 — Category Schemas (loaded on demand, ~500-1000 tokens each)
│   When LLM says "I need to use calculator tools" or attempts a tool call:
│   → Inject full JSON schemas for that category
│   → Re-send the last user message so LLM can now use the tools
│
├── Level 2 — Extended Context (loaded on explicit need)
│   When LLM needs deep reference (e.g., all calculator configs):
│   → Inject additional context documents
│
└── Detection Logic
    ├── Explicit: LLM text contains "I need to use [category] tools"
    ├── Implicit: LLM attempts tool_call with name matching a category
    ├── Heuristic: User message contains keywords ("build", "calculate", "search KB")
    └── Override: Conversation type pre-loads expected categories
```

### Tool Categories

| Category | Tools | Schema Size | Load Trigger |
|----------|-------|-------------|-------------|
| `calculators` | list, describe, execute, create, update, configure, deploy, get_config | ~1,200 tokens | User mentions calculator/build/create |
| `knowledge` | search_knowledge, ask_knowledge | ~400 tokens | User mentions KB/knowledge/search/document |
| `account` | get_info, usage_stats | ~200 tokens | User asks about account/usage/limits |

### Safety: No Cross-Category References

Following Hermes's critical constraint: tool descriptions must NOT reference tools from other categories. E.g., `search_knowledge` should not say "use execute_calculator to test results" because `calculators` category may not be loaded yet — this causes hallucinated tool calls.

Cross-references are injected dynamically only when both categories are loaded.

## Key Tasks

### Implementation
- [x] Create `tool-categories.js`: category map, keyword detection, manifest generator
- [x] SSE chat endpoint: detect categories from message + history, load Level 0 or 1
- [x] Sync chat endpoint: same logic applied identically
- [x] Sticky loading: prior assistant tool_use keeps categories loaded for follow-ups
- [x] Manifest appended to system prompt in Level 0 mode (replaces tool schemas)

### Testing
- [x] 24 unit tests in `test/tool-categories.test.js` — all pass
- [x] Keyword detection for both categories
- [x] Empty set for generic messages (hello, what can you do)
- [x] Both categories detected from combined message
- [x] Sticky loading via conversation history
- [x] Manifest respects permissions (calc/kb flags)
- [x] Public vs private manifest descriptions
- [x] Manifest <500 chars
- [x] Cross-category reference safety (calc ↔ knowledge)
- [x] All 14 AI_TOOLS covered by categories

## Implementation Notes

- `services/ai-api/src/services/tool-categories.js` — new module
- `services/ai-api/src/routes/chat.js` — both endpoints updated
- No dynamic mid-conversation injection (v1 simplicity tradeoff)
- Level 0 manifest ~120 chars vs ~2,500+ token tool schemas

## Acceptance Criteria

- [x] Simple conversations use Level 0 (no tool schemas loaded)
- [x] Calculator/KB keywords trigger Level 1 schema injection
- [x] Sticky: once a tool is used, category stays loaded
- [x] Permissions respected after category filtering
- [x] No cross-category references in tool descriptions
- [x] 156 total tests pass, 0 failures

## Dependencies

- Existing tool definitions in `ai-api/src/services/tools.js`
- Anthropic messages API (supports dynamic tool injection via `tools` parameter)

## Estimated Scope

- ai-api: ~300-400 lines (refactor + manifest + detection + injection)
- Tests: ~200 lines
- Timeline: 1 week
