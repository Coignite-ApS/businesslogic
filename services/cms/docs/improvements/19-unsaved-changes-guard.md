# #19 — Unsaved Changes Navigation Guard

**Status:** planned
**Phase:** 4 — Calculator Authoring & Platform
**Priority:** TBD

## Goal

Prevent users from accidentally losing unsaved configuration changes by prompting before navigation.

## Scope

- Detect dirty state (unsaved changes) on calculator configuration screens
- Show confirmation dialog when user attempts to navigate away with unsaved changes
- Cover both in-app navigation (Vue Router) and browser close/refresh (beforeunload)

## Key Tasks

- [ ] Track dirty state: compare current form values against last-saved values
- [ ] Add Vue Router `beforeRouteLeave` / `onBeforeRouteLeave` navigation guard
- [ ] Add `beforeunload` event listener for browser close/tab close/refresh
- [ ] Show Directus-styled confirmation dialog ("Unsaved changes will be lost. Leave anyway?")
- [ ] Clear dirty flag on successful save
- [ ] Apply to all configuration tabs (Configure, Integration, Test, etc.)

## Acceptance Criteria

- [ ] Navigating away from a dirty config page shows a confirmation prompt
- [ ] Closing/refreshing the browser with unsaved changes shows native browser prompt
- [ ] Saving clears the dirty flag — no prompt on subsequent navigation
- [ ] No false positives: navigating away from a clean page triggers no prompt

## Notes

- Keep implementation simple: shallow compare or JSON.stringify diff of form state vs saved state
- Reuse Directus dialog components where possible
