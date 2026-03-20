# #33 — Knowledge Base × AI Assistant Isolation

**Status:** completed
**Phase:** 6 — AI Assistant (bridges Phase 3)
**Depends on:** #12, #13 (completed), #30A–D (completed)

---

## Goal

Ensure **complete separation between knowledge bases** when the AI Assistant searches or answers questions. Today `knowledge_base_id` is optional in KB tools — Claude can search across all KBs for an account. This must be tightened so each query targets exactly the KB(s) the user intends, with no cross-contamination.

---

## Problem

### Current State
- `search_knowledge` and `ask_knowledge` tools accept optional `knowledge_base_id`
- When omitted, search spans **all KBs in the account** — chunks from unrelated KBs can pollute results
- System prompt doesn't instruct Claude to ask which KB to use
- No per-conversation KB binding — user must specify KB every message
- Risk: legal KB chunks appearing in product support answers, HR docs leaking into customer-facing responses

### Why This Matters
- Knowledge bases often contain **domain-separated** content (HR policies vs product docs vs legal contracts)
- Cross-KB contamination produces misleading citations and incorrect answers
- Enterprise users expect strict data boundaries between knowledge domains
- MCP and public API consumers need predictable, scoped retrieval

---

## Design

### 1. Keep `knowledge_base_id` Optional — But Isolate Results

When `knowledge_base_id` is omitted, search across all KBs in the account (current behavior) — but **group and label results by KB**. Never merge chunks from different KBs into a single undifferentiated list.

```typescript
// Response when searching across all KBs
{
  "results_by_kb": [
    {
      "knowledge_base": { "id": "uuid", "name": "Product Docs" },
      "chunks": [ ... ]
    },
    {
      "knowledge_base": { "id": "uuid", "name": "Legal Contracts" },
      "chunks": [ ... ]
    }
  ]
}
```

When `knowledge_base_id` is provided, search only that KB (current behavior, unchanged).

### 2. System Prompt Instructions

Add explicit instructions to the AI system prompt:

```
KNOWLEDGE BASE RULES:
- NEVER search across all knowledge bases at once
- ALWAYS ask the user which knowledge base to use before searching
- If the user references a KB by name, resolve it via list_knowledge_bases first
- Each search/ask call must target exactly ONE knowledge base
- If the user wants to compare across KBs, make separate calls per KB and label results clearly
- NEVER mix chunks from different knowledge bases in a single answer
```

### 3. Conversation-Level KB Context (Optional Enhancement)

Allow users to "pin" a KB to a conversation:
- New field: `ai_conversations.knowledge_base_id` (nullable FK)
- When set, all KB tool calls in that conversation auto-scope to this KB
- UI: KB selector dropdown in chat header or conversation settings
- System prompt includes: "This conversation is scoped to KB: {name}. All knowledge queries target this KB."

### 4. Multi-KB Queries (Explicit Only)

For cases where cross-KB search is intentional:
- New tool: `search_multiple_knowledge_bases` with required `knowledge_base_ids: string[]`
- Results grouped by KB with clear labels: `[KB: Product Docs] ...` vs `[KB: Legal] ...`
- Never merge chunks from different KBs into a single answer
- Each KB's results get separate citation blocks

### 5. API-Level Isolation

Tighten the `/kb/search` and `/kb/ask` endpoints:
- When `knowledge_base_id` omitted: search all KBs but return results **grouped by KB**
- When `knowledge_base_id` provided: search only that KB (unchanged)
- Answer generation (`/kb/ask`): when cross-KB, generate **separate answers per KB** or clearly attribute each citation to its KB

### 6. MCP & Public API Scoping

For account-level MCP (`/mcp/account/{id}`):
- `search_knowledge` tool schema: `knowledge_base_id` required
- `ask_knowledge` tool schema: `knowledge_base_id` required
- Tool descriptions explicitly state: "Searches within a single knowledge base"

---

## Key Tasks

- [ ] Group cross-KB search results by knowledge base in API responses
- [ ] Update system prompt with KB isolation rules (attribute citations to their KB)
- [ ] Ensure `/kb/ask` cross-KB answers clearly cite which KB each source comes from
- [ ] Update MCP tool response format to group by KB
- [ ] Add conversation-level KB pinning (optional, nice-to-have)
- [ ] Update AI prompts/templates that reference KB tools
- [ ] Test: cross-KB results clearly labeled/grouped per KB
- [ ] Test: single-KB search unchanged
- [ ] Test: Claude attributes citations to correct KB in answers

---

## Acceptance Criteria

1. **Cross-KB results grouped by KB** — never a flat mixed list of chunks from different KBs
2. **System prompt enforces attribution** — Claude always states which KB a citation comes from
3. **API returns grouped results** — search/ask responses structured per-KB when no ID specified
4. **MCP tools return grouped results** — external AI agents get clearly separated KB results
5. **Single-KB queries unchanged** — providing `knowledge_base_id` works exactly as before
6. **Answer citations attributed** — every `[SOURCE_N]` tied to its KB name, not just document

---

## Notes

- Account-level scoping (existing) prevents cross-account leakage — this improvement adds KB-level **presentation isolation** within an account
- Conversation KB pinning is a UX convenience — narrows scope without requiring user to specify KB each time
- Cross-KB search is allowed but results must always be grouped/labeled so the user knows which KB each chunk came from
- For `ask_knowledge` cross-KB: answer should attribute each claim to its source KB, e.g. "[Product Docs] ..." vs "[Legal] ..."
