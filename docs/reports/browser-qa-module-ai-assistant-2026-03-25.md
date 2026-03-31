# Browser QA Report — AI Assistant Module — 2026-03-25

## Summary
- **Total**: 6 test cases
- **Passed**: 6
- **Failed**: 0
- **Blocked**: 0

## Environment
- CMS: localhost:18055
- Branch: `dev`
- Last commit: `3802a43` — docs(reports): browser QA account module
- Module URL: `/admin/ai-assistant` (custom module, NOT `/admin/content/ai-assistant`)

## Results

### TC-01: AI Assistant — Initial Load — PASS
- Module loads at `/admin/ai-assistant`
- Conversation list renders in left nav with 2 existing conversations: "Mortgage calculation help", "ROI formula explanation"
- "New Chat" button present with add icon
- Main area shows "How can I help?" heading with prompt picker
- Two prompt suggestions: "Calculator Assistant" and "Knowledge Base Search"
- Message input field visible at bottom with disabled send button
- No console errors
- Screenshot: `screenshots/browser-qa-2026-03-25-TC01-ai-initial-load.jpg`

### TC-02: AI Assistant — Open Existing Conversation — PASS
- Clicked "Mortgage calculation help" conversation
- URL updated to `/admin/ai-assistant/{uuid}`
- 2 message exchanges rendered correctly:
  - User: "How do I calculate a mortgage payment?"
  - Assistant: Formula explanation with M = P[r(1+r)^n]/[(1+r)^n-1]
  - User: "What about a $300k loan at 6.5% for 30 years?"
  - Assistant: Monthly payment calculation result
- DOM structure confirmed: `.message.user` / `.message.assistant` classes, `.message-bubble` containers, `.markdown-content` with `<p>` tags for assistant responses
- Input field visible at bottom
- No console errors
- Screenshot: `screenshots/browser-qa-2026-03-25-TC02-ai-open-conversation.jpg`

### TC-03: AI Assistant — Create New Chat — PASS
- Clicked "New Chat" button
- Navigated back to `/admin/ai-assistant` (no UUID)
- Empty chat state shown with "How can I help?" heading
- Prompt picker displayed with 2 suggestion buttons
- Message input field visible
- No console errors
- Screenshot: `screenshots/browser-qa-2026-03-25-TC03-ai-new-chat.jpg`

### TC-04: AI Assistant — Send Message — PASS
- Typed "What is 2+2?" in message input
- Send button became enabled (was disabled when empty)
- Clicked send
- User message appeared immediately in chat
- AI service responded successfully: "2 + 2 = 4!" with follow-up offer
- New conversation created with UUID, URL updated
- Conversation appeared in nav list as "What is 2+2?"
- Network: `POST /assistant/chat` returned 200
- Network: `GET /assistant/conversations` refreshed after send (200)
- Network: `GET /assistant/usage` called after send (200)
- All network requests returned 200/304 — no failures
- No console errors
- Note: Uses regular POST request (not SSE/EventSource streaming) — response arrives as complete payload
- Screenshot: `screenshots/browser-qa-2026-03-25-TC04-ai-send-message.jpg`

### TC-05: AI Assistant — Usage Meter — PASS (Conditional)
- `/assistant/usage` endpoint called and returned 200
- Response data: `queries_used: 0`, `queries_limit: null` (unlimited account)
- Usage bar is **intentionally hidden** — code shows it only when `usagePercent >= 70` AND account is NOT unlimited
- This is correct behavior for an unlimited admin account
- Implementation verified in source: `conversation-nav.vue` line 33 — `v-if="usage && !isUnlimited && usagePercent >= 70"`
- Limit card also implemented: shows "You've used all X queries this month" when at limit
- Screenshot: `screenshots/browser-qa-2026-03-25-TC05-ai-usage-meter.jpg`

### TC-06: AI Assistant — Archive Conversation — PASS
- Clicked archive button (close icon) next to "ROI formula explanation"
- Conversation immediately removed from active list
- Remaining conversations: "What is 2+2?" and "Mortgage calculation help"
- No confirmation dialog (immediate archive)
- No console errors
- Screenshot: `screenshots/browser-qa-2026-03-25-TC06-ai-archive-conversation.jpg`

## Console Errors
None across all test cases.

## Network Failures
None across all test cases. All requests returned 200/204/304.

## Notable Observations

### Directus Built-in AI Assistant Sidebar Conflict
The Directus built-in AI Assistant sidebar panel (showing "Claude Sonnet 4.6" with its own chat input) is present on all pages. When expanded, it can intercept focus and cause unintended page navigations. This was observed multiple times during testing — clicking elements while the sidebar was expanded occasionally caused navigation to `/admin/formulas` or `/admin/content/formulas`. Collapsing the sidebar before interacting with the custom AI Assistant module resolved the issue.

**Severity**: MEDIUM — Does not block functionality but can confuse users who have both the built-in sidebar and the custom module visible.

**Recommendation**: Consider either:
1. Auto-collapsing the built-in AI sidebar when the custom AI Assistant module is active
2. Hiding the built-in AI sidebar on the AI Assistant module page to avoid confusion

## Recommendations
1. **Streaming**: Consider implementing SSE/streaming for longer AI responses to improve perceived performance (currently uses single POST)
2. **Sidebar conflict**: Address the built-in Directus AI Assistant sidebar overlapping with the custom module (see above)
3. **Usage meter testing**: To fully verify the usage bar, test with a non-admin account that has a limited subscription plan
