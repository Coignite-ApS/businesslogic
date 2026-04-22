# Browser QA Report — 2026-03-31

## Summary
- **Total**: 4 test cases
- **Passed**: 2
- **Failed**: 1
- **Blocked**: 1

## Environment
- CMS: localhost:18055
- Branch: dev
- Last commit: dbe431f feat(ai-api): add widget tests to CI, create task doc
- All Docker services: healthy (CMS, ai-api, formula-api, flow, gateway)
- Extensions built: 2026-03-30 23:55 (dist/index.js)

## Results

### TC-01: Environment & Login — PASS
- Docker stack running, all services healthy
- CMS accessible at localhost:18055
- Already authenticated as Admin User, clicked Continue
- Redirected to admin dashboard successfully
- Screenshot: `screenshots/browser-qa-2026-03-31-env-check.png`

### TC-02: AI Assistant Chat with Tool Execution — PASS
- Navigated to AI Assistant module via sidebar (`smart_toy` icon)
- Module loaded with empty state, prompt picker, and existing conversations
- Started new chat, typed "List all my calculators"
- AI response streamed successfully via SSE (`POST /assistant/chat` → 200)
- Tool pipeline executed correctly: `tool_use_start` → `tool_executing` → `tool_result` → `widget` → `text_delta` → `done`
- `list_calculators` tool returned all 11 calculators with correct data
- AI rendered a markdown table with all calculators, statuses, and summary
- No console errors, no network failures
- Screenshot: `screenshots/browser-qa-2026-03-31-TC02-chat-response.png`

### TC-03: Widget Rendering as Card Component — FAIL (HIGH)
- **Failed at**: Widget rendering step
- **Expected**: `bl-chatkit` custom element renders a Card with ListView showing calculators as interactive items
- **Actual**: `<bl-chatkit>` element exists in DOM but renders as empty (height: 0px). The custom element is **not registered** — `customElements.get('bl-chatkit')` returns `undefined`. Element constructor is plain `HTMLElement`, not a Lit-based class.
- **Root cause**: The `@customElement('bl-chatkit')` decorator from `packages/bl-widget/src/bl-chatkit.ts` is **tree-shaken** during the Directus extension build (rollup). The AI assistant extension imports `@businesslogic/widget` as a side-effect, but rollup strips the `BlChatKit` class because it's not directly referenced in application code.
  - **Evidence**: The built bundle (`dist/index.js`) contains `ia("bl-calculator")` and 20 other `bl-*` custom element registrations, but `bl-chatkit` is missing entirely.
  - The `chatkit-wrapper.vue` creates the element via `document.createElement('bl-chatkit')` — this is a runtime reference that rollup cannot detect as a dependency on the class.
  - Newer ChatKit components also missing from bundle: `bl-divider`, `bl-list-view`, `bl-list-view-item`, `bl-caption`, `bl-badge`, `bl-button`, `bl-icon`, `bl-image`, `bl-markdown`, `bl-label`, `bl-textarea`, `bl-form`, `bl-box`, `bl-spacer`, `bl-basic`, `bl-transition`
- **Server-side working correctly**: The SSE stream contains a proper `event: widget` with a full ChatKit tree (Card → Caption + Divider + ListView with 11 ListViewItems, each with Icon, Col, Text, Caption). Widget data structure is well-formed with `onClickAction` handlers for each calculator.
- **Fix needed**: Force the `BlChatKit` class (and its dependency tree of sub-components) to be included in the bundle. Options:
  1. Add explicit import in `chatkit-wrapper.vue`: `import { BlChatKit } from '@businesslogic/widget';` (and reference it)
  2. Add `/*#__PURE__*/` annotations or `sideEffects: false` adjustments
  3. Create a dedicated entry point in bl-widget that only exports ChatKit-related classes
- Screenshot: `screenshots/browser-qa-2026-03-31-TC03-widget-not-rendered.png`

### TC-04: Widget Interactivity (Click Actions) — BLOCKED
- Blocked by TC-03 failure — widget does not render, so click actions cannot be tested
- The SSE payload includes `onClickAction` with `type: "assistant.message"` and `payload.text` for each calculator item
- The Vue `handleWidgetAction` function in `message-bubble.vue` is wired to handle `assistant.message` and `navigate` action types
- Cannot verify until widget renders

## Console Errors
None — no JavaScript errors detected during the entire session.

## Network Failures
None — all requests returned 200/204/304.

## Key Technical Findings

### Backend (ai-api) — Working Correctly
1. SSE stream properly emits `event: widget` with ChatKit tree data
2. Widget tree structure is valid: `Card` → `Caption` + `Divider` + `ListView` → `ListViewItem[]`
3. Each ListViewItem has `onClickAction` with `assistant.message` type
4. Tool execution pipeline works: `tool_use_start` → `tool_executing` → `tool_result` → `widget` → `text_delta` → `done`
5. Model used: claude-sonnet-4-6 (1,132 input / 514 output tokens)

### Frontend (ai-assistant extension) — Widget Not Rendering
1. `chatkit-wrapper.vue` correctly creates `<bl-chatkit>` and sets `.tree` property
2. The `.tree` property IS set on the DOM element (verified: `component: "Card"`, 3 children)
3. But the custom element class is not registered, so the element is inert
4. The `widgetTrees` map in the message object is populated correctly by the SSE handler

## Recommendations

1. **[CRITICAL FIX]** Ensure `BlChatKit` class is not tree-shaken from the extension bundle. The simplest fix: in `chatkit-wrapper.vue`, add a direct reference to the class:
   ```ts
   import { BlChatKit } from '@businesslogic/widget';
   // Force side-effect registration
   void BlChatKit;
   ```
2. **[CRITICAL FIX]** Also ensure all ChatKit sub-components used in widget trees are registered. The widget tree uses `Card`, `Caption`, `Divider`, `ListView`, `ListViewItem`, `Icon`, `Col`, `Text` — their corresponding `bl-*` elements must all be defined. Some (`bl-card`, `bl-col`, `bl-text`) are present; others (`bl-caption`, `bl-divider`, `bl-list-view`, `bl-list-view-item`, `bl-icon`) are missing.
3. **Rebuild extension** after fix: `cd services/cms/extensions/local/project-extension-ai-assistant && npm run build`
4. **Rebuild Docker image** to pick up the new bundle
5. **Retest** to verify widget renders as interactive Card with clickable calculator items
