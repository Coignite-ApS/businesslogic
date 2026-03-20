# #27 — Go Live Button on Test Page Topbar

**Status:** completed
**Phase:** 4 — Calculator Authoring & Platform
**Priority:** TBD

## Goal

Add a prominent "Go Live" button in the Test page topbar that opens a confirmation modal before publishing.

## Scope

- "Go Live" button in Test page topbar
- Confirmation modal with version context, e.g.:
  ```
  Publish Test Version?

  You're about to publish test version 1.1, replacing the
  current live version 0.1.

  This will make version 1.1 available to all API consumers,
  widgets, and AI integrations.

  [Cancel]  [Go Live 1.1]
  ```
- Confirm button labeled "Go Live {version}" (same pattern as dashboard page)
- Cancel to dismiss without action

## Key Tasks

- [ ] Add "Go Live" button to Test page topbar
- [ ] Build confirmation modal showing test and live version numbers
- [ ] Clear, friendly copy explaining what publishing does
- [ ] Confirm button: "Go Live {version}" (primary style)
- [ ] Cancel button to dismiss
- [ ] Trigger deploy/publish action on confirm
- [ ] Disable button if no changes between test and live

## Acceptance Criteria

- [ ] "Go Live" button visible in Test page topbar
- [ ] Modal shows both test and live version numbers
- [ ] Confirm button labeled "Go Live {version}"
- [ ] Publishing works same as existing deploy flow
- [ ] Button disabled/hidden when test = live (nothing to publish)

## Notes

- Relates to #26 (Test/Live topbar tabs)
- Must feel safe — user should never accidentally publish
