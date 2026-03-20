# #26 — Test/Live Tabs in Topbar

**Status:** completed
**Phase:** 4 — Calculator Authoring & Platform
**Priority:** TBD

## Goal

Move Test and Live environment switching to tabs in the topbar, right of the page title. Default to Live when active, with primary-colored border on selected tab.

## Scope

- Test/Live tabs positioned to the right of the page title in the topbar
- Each tab shows version number (e.g. "Live v2.1", "Test v2.2")
- Default selection: Live (if calculator is live/deployed), else Test
- Selected tab border uses primary color
- Applies to Integrate page (not Configure or Test pages)

## Key Tasks

- [ ] Add Test/Live tab component to topbar, right of page title
- [ ] Show version number in each tab (e.g. "Live v2.1", "Test v2.2")
- [ ] Default to Live tab when calculator has active live deployment
- [ ] Style selected tab with primary color border
- [ ] Wire tab selection to switch context (test vs live endpoints, stats, integration info)

## Acceptance Criteria

- [ ] Test/Live tabs visible in topbar next to page title on Integrate page
- [ ] Live selected by default when calculator is active
- [ ] Selected tab has primary-colored border with version number
- [ ] Switching tabs updates page content to reflect test/live context
