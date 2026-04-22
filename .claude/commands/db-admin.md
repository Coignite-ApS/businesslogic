Spawn the DB Admin as an **independent agent** that does NOT consume the main conversation's context window.

## Model Policy

**This command MUST use Opus.** DB schema changes require careful reasoning about data integrity, downstream impact, rollback strategy, and Directus best practices. Always specify `model: "opus"` when spawning.

## How It Works

The db-admin sub-agent runs the workflow defined in `.claude/skills/db-admin/SKILL.md`:

1. Snapshot first (PG dump + Directus YAML, both dated, both via Makefile)
2. Classify change (MINOR vs MAJOR) and stage it
3. **Pause and return a consultation block** if MAJOR or if the diff shows anything unexpected
4. After approval, apply, write migration scripts, write a dated report, plan follow-up tasks if structural risk

Because the agent has its own context, it researches Directus docs itself (WebFetch / WebSearch) instead of asking the main thread.

## State File (Multi-Phase Tasks)

For tasks that need user consultation mid-workflow, the agent persists progress to `docs/reports/db-admin-WIP-<slug>.md`. On a follow-up `/db-admin continue <slug>` or `/db-admin <slug> approved`, the agent reads this file and resumes.

## How to Execute (from main thread)

Use the Agent tool with `model: "opus"`:

```
You are the DB Admin Agent. Read and follow ALL instructions in
.claude/skills/db-admin/SKILL.md.

Project root: [cwd]
Task: $ARGUMENTS

Execute the workflow. If you reach a consultation gate (MAJOR change,
unexpected diff, or any doubt), STOP, persist your state to the WIP file,
and return the consultation block to the main thread. Otherwise complete
the workflow and return an executive summary.
```

## Arguments

- `<task description>` — start a new task (e.g., `/db-admin add a "widgets" collection with title,html,owner`)
- `continue <slug>` — resume a paused WIP task
- `<slug> approved` — resume after user approval, proceed to apply
- `status` — list active WIP tasks in `docs/reports/db-admin-WIP-*.md`
- `prune` — run `make prune` to rotate old snapshots/dumps and archive old reports
- `diff` — run a quick `make diff` to show current schema drift (read-only, no changes)

$ARGUMENTS
