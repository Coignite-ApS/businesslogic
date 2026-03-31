# Browser QA: Verify UI Changes in Chrome

Verify CMS extension and frontend changes by running automated browser tests via Chrome DevTools.

## Usage

```
/browser-qa cms/22-api-key-ui        # verify specific task
/browser-qa cms/22 cms/23            # verify multiple tasks
/browser-qa                          # verify all in-progress UI tasks
```

## Execution

When this command is invoked:

1. **Parse arguments** — resolve task doc paths from shorthand:
   - `cms/22` → find matching file in `docs/tasks/cms/` starting with `22-`
   - If no arguments, scan `docs/tasks/` for in-progress tasks with UI components

2. **Read task docs** — extract acceptance criteria and UI-testable behavior

3. **Generate test plan** — for each task, create structured test cases with:
   - Navigation target (which CMS module/page)
   - Interaction steps (clicks, form fills, etc.)
   - Expected outcomes (visible elements, data changes, no errors)

4. **Verify environment** — check Docker is running, CMS is accessible at localhost:8055, extensions are built

5. **Spawn Browser QA agent** (Opus):
   ```
   Agent tool → model: "opus"
   prompt: "You are a Browser QA Agent. Read and follow ALL instructions in
   .claude/skills/browser-qa/SKILL.md. Project root: [cwd].
   Test plan: [generated test cases].
   Execute all tests. Save report to docs/reports/browser-qa-YYYY-MM-DD.md.
   Return pass/fail summary with failure details."
   ```

6. **Report results** — display pass/fail summary, link to full report

## Prerequisites

- Docker dev environment running (`/dev-up`)
- CMS extensions built (`cd services/cms && make ext-build-all`)
- Chrome browser open (for DevTools MCP connection)
- Admin credentials in `services/cms/.env`

$ARGUMENTS
