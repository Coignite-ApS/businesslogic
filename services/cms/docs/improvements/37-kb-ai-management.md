# #37 — Knowledge Base — AI-Assisted Management

**Status:** completed
**Phase:** 6 — AI Assistant
**Depends on:** #12 (completed), #30A (completed), #33

---

## Goal

Let users manage knowledge bases from the AI Assistant — create KBs, upload documents, pick icons, and control which KB documents go into. The AI Assistant becomes the primary interface for KB management alongside the dedicated module.

---

## Scope

### A. Icon picker on KB create/edit
- Add icon field to KB create dialog and KB settings in the module UI
- Use Directus built-in `v-icon` picker component
- Default remains `menu_book`

### B. AI-assisted icon selection
- When creating a KB via AI Assistant, AI analyzes the name/description and picks an appropriate Material icon
- Tool: `create_knowledge_base({ name, description })` → AI picks icon from predefined set
- Predefined icon set: `menu_book`, `gavel`, `account_balance`, `science`, `engineering`, `health_and_safety`, `school`, `business`, `support_agent`, `inventory`, `security`, `policy`, `receipt_long`, `analytics`, `code`, `design_services`

### C. Document upload from AI Assistant
- "Upload this document to my [KB name] knowledge base"
- AI resolves KB by name, handles file upload, triggers indexing
- Tool: `upload_to_knowledge_base({ knowledge_base_id, file_id, title? })`
- If KB doesn't exist, AI asks whether to create it first

### D. KB listing and status from AI Assistant
- "What knowledge bases do I have?"
- "How many documents are in [KB name]?"
- "Is the indexing done?"
- Tool: `list_knowledge_bases()`, `get_knowledge_base({ id })`

---

## Key Tasks

- [x] Add icon picker to KB create dialog (module UI)
- [x] Add icon picker to KB detail/settings (module UI)
- [x] Add `create_knowledge_base` tool to AI Assistant
- [x] Add `upload_to_knowledge_base` tool to AI Assistant
- [x] Add `list_knowledge_bases` / `get_knowledge_base` tools to AI Assistant
- [x] AI icon selection logic (map name/description → best Material icon)

---

## Notes

- Depends on #33 (KB × AI Assistant isolation) for proper account scoping in tools
- Icon selection is a nice UX touch but low complexity — predefined map, not generative
- Document upload from assistant requires file upload support (#30C, completed)
