# Ralph Loop: Execute Improvement

Run an autonomous Ralph loop scoped to a specific improvement from the backlog.

## Usage

```
/ralph-improvement formula-api/01-execute-auth
/ralph-improvement cms/03-some-improvement
/ralph-improvement cross-cutting/02-something
```

## What This Does

1. Reads the improvement doc at `docs/improvements/<argument>.md`
2. Reads `CLAUDE.md` for architecture rules and conventions
3. Constructs a scoped Ralph loop prompt from the improvement's Goal, Key Tasks, and Key Files
4. Starts the loop with `--max-iterations 15`

## Execution

When this command is invoked with an argument like `formula-api/01-execute-auth`:

1. First, read the improvement doc:
   ```
   Read docs/improvements/<argument>.md
   ```

2. Then start the Ralph loop with this prompt template:

```
/ralph-loop "
You are working on a BusinessLogic platform improvement.

## Project Rules
Read and follow CLAUDE.md in the project root. Key rules:
- TDD: write the test FIRST, watch it fail, then implement
- Conventional commits: feat(service):, fix(service):, etc.
- Stay on the current branch (never commit to main)
- Schema ownership: only the owning service writes to its schema

## Improvement Spec
Read the full improvement doc: docs/improvements/<argument>.md
Follow every requirement in that doc.

## Workflow Per Task
For each key task in the improvement doc:
1. Write a failing test that defines the expected behavior
2. Run the relevant test suite to confirm it fails
3. Implement the minimum code to make it pass
4. Run ALL tests for the affected service to catch regressions
5. If tests pass, commit with a conventional commit message
6. Move to the next task

## Completion
When ALL key tasks from the improvement doc are done AND all tests pass:
- Update the improvement doc status to 'completed'
- Run the full test suite one final time
- Output: <promise>IMPROVEMENT_COMPLETE</promise>

## If Stuck
After 10 iterations without meaningful progress:
- Document what's blocking in the improvement doc under a '## Blockers' section
- Commit the doc update
- Output: <promise>IMPROVEMENT_COMPLETE</promise>
" --max-iterations 15 --completion-promise "IMPROVEMENT_COMPLETE"
```

## Safety

- Max 15 iterations prevents runaway loops
- Tests must pass before each commit (enforced by hooks)
- Branch protection prevents commits to main
- Scope is limited to files listed in the improvement doc
