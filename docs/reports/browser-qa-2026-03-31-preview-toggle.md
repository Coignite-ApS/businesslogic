# Browser QA Report — 2026-03-31 — Layout Builder Preview Toggle

## Summary
- **Total**: 5 test cases
- **Passed**: 0
- **Failed**: 0
- **Blocked**: 5

## Environment
- CMS: localhost:18055
- Branch (running): `dev` (bd4678c)
- Branch (layout-builder): `dm/layout-builder-phase2` (9ee612a) — **worktree only, not merged**
- Last commit (dev): "docs(cms): add widget layout builder Phase 2 design spec"
- Last commit (worktree): "feat(builder): use Directus v-icon, wireframe canvas, CSS var theming"
- Extensions built in worktree: Yes (`dist/index.js` exists)
- Extensions deployed to Docker: **No** — layout-builder extension not present in running container

## Blocker

The `project-extension-layout-builder` extension exists only on the `dm/layout-builder-phase2` worktree branch. The running Docker CMS is on `dev`, which does not contain this extension. All 5 test cases are **BLOCKED** because the layout builder module route (`/admin/layout-builder`) returns "Page Not Found".

**Evidence:**
- `docker exec businesslogic-bl-cms-1 ls /directus/extensions/local/` — no `layout-builder` directory
- Navigating to `http://localhost:18055/admin/layout-builder` shows Directus "Page Not Found"

## Results

### TC-01: Navigate to Layout Builder — BLOCKED
- **Reason**: Extension not deployed to running CMS
- **Actual**: "Page Not Found" at `/admin/layout-builder`
- **Screenshot**: `docs/reports/screenshots/browser-qa-2026-03-31-TC01-layout-builder-not-found.png`

### TC-02: Verify Design/Preview Toggle — BLOCKED
- **Reason**: Depends on TC-01

### TC-03: Add Components and Check Design Mode — BLOCKED
- **Reason**: Depends on TC-01

### TC-04: Switch to Preview Mode — BLOCKED
- **Reason**: Depends on TC-01

### TC-05: Save Layout — BLOCKED
- **Reason**: Depends on TC-01

## Console Errors
None relevant — page simply not found.

## Network Failures
None — standard 200 response but Directus SPA routes to 404 page internally.

## Recommendations
1. **Merge `dm/layout-builder-phase2` into `dev`** — or rebuild Docker image from the worktree branch
2. **Rebuild CMS Docker image** after merge: `make build` in `services/cms/`
3. **Re-run this QA plan** once the extension is deployed to the running environment
4. Alternative: temporarily copy the built extension into the running container for smoke testing
