# Robo-Sprint: Parallel Multi-Service Task Execution with Agent Teams

Run multiple tasks in parallel across services using Claude Code Agent Teams.
Spawns a team of specialized teammates, each owning tasks within a single service to prevent file conflicts.

## Usage

```
/robo-sprint                          # Run all ready tasks across services
/robo-sprint formula-api ai-api       # Run ready tasks for specific services only
/robo-sprint --dry-run                # Preview the plan without executing
/robo-sprint --max-tasks 8            # Limit total tasks (default: 10)
```

## Prerequisites

- Agent Teams enabled (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings.json)
- Must be on `dev` branch or a `feat/*` branch (never main)
- Tasks must be in `ready` status (dependencies met)

## Model Policy

- **Lead agent: Opus** — orchestrates, resolves cross-service contracts, reviews quality
- **QA reviewer: Opus** — spawned when 6+ tasks are running; reviews commits, validates tests
- **Implementation teammates: Sonnet** — cost-effective for TDD implementation work

## Execution

When this command is invoked:

### 1. Analyze Ready Tasks

1. Read `docs/tasks/README.md` to get full task list
2. Identify all tasks with `ready` status
3. If service names are provided as arguments, filter to only those services
4. Read each ready task doc: `docs/tasks/<service>/<NN>-*.md`
5. Check dependency status — confirm all dependencies are `completed`
6. If `--dry-run` is passed, output the proposed team plan and stop

### 2. Group by Service and Build Dependency Graph

Group tasks by owning service:
- `cms/*` → CMS teammate
- `ai-api/*` → AI API teammate
- `formula-api/*` → Formula API teammate
- `flow/*` → Flow Engine teammate
- `gateway/*` → Gateway teammate
- `cross-cutting/*` → Assigned to the teammate whose service is most affected

Within each service, classify into dependency tiers:
- **Tier 0**: No intra-service dependencies (start immediately)
- **Tier 1**: Depends on Tier 0
- **Tier 2**: Depends on Tier 1

Cross-service dependencies: if Task A (ai-api) depends on Task B (gateway), the lead holds Task A until Task B completes.

### 3. Spawn the Agent Team

Create an agent team with this structure:

```
Create an agent team to execute a sprint of tasks for the BusinessLogic platform.

## Project Context
All teammates MUST read and follow CLAUDE.md in the project root.

Key rules:
- TDD: write the test FIRST, watch it fail, then implement
- Conventional commits: feat(service):, fix(service):, chore(infra):, etc.
- Stay on the current branch (never commit to main)
- Schema ownership: only the owning service WRITES to its schema
- Redis namespacing: each service prefixes keys (gw:, ai:, fa:, fl:, cms:)
- Gateway for public traffic only; internal traffic goes direct

## Model Policy
- **Lead agent: Opus** — orchestrates, reviews, resolves cross-service contracts
- **QA reviewer: Opus** — reviews each teammate's commits before marking tasks complete
- **Implementation teammates: Sonnet** — TDD implementation work

## Team Structure
- Spawn 1 implementation teammate (Sonnet) per active service (max 5)
- If 6+ total tasks: spawn 1 QA reviewer teammate (Opus)
- Each teammate owns ALL tasks for their service — NO cross-service file edits
- If a teammate needs an interface from another service, they message that teammate to agree on the contract

## Task Assignment

### <Service A> Teammate (Sonnet):
<list tasks with their doc paths and tier>

### <Service B> Teammate (Sonnet):
<list tasks with their doc paths and tier>

... (one section per active service)

## Teammate Instructions
Each teammate must follow this workflow for every task:

1. Read their assigned task doc: docs/tasks/<service>/<NN>-*.md
2. Read CLAUDE.md for architecture rules
3. Write a failing test that defines expected behavior
4. Run the relevant test suite to confirm it fails:
   - Node.js services: cd services/<service> && npm test
   - Rust (flow): cd services/flow && cargo test --workspace
   - Go (gateway): cd services/gateway && go test ./...
   - CMS extensions: cd services/cms/extensions && npm test
5. Implement the minimum code to make it pass
6. Run ALL tests for the service to catch regressions
7. If tests pass, commit with a conventional commit message
8. Update the task doc status to 'completed'
9. Message the lead when done — the lead assigns next-tier tasks or cross-service unlocks

## QA Reviewer Teammate (Opus) — spawned for sprints with 6+ tasks

The QA teammate does NOT implement code. Its role:
1. After each implementation teammate completes a task, QA reviews the commit:
   - Code quality, naming conventions, idiomatic patterns (Node.js/Rust/Go as appropriate)
   - Test coverage — are edge cases tested?
   - Schema ownership — no cross-schema writes
   - Security — no secrets, no SQL injection, proper auth checks
   - Service auth patterns — follows docs/service-auth.md
2. If issues found: message the implementation teammate with specific feedback
3. If clean: confirm to the lead that the task passes review
4. At sprint end: write a brief QA summary (saved to docs/reports/qa-sprint-[DATE].md)

The lead should NOT mark a task as fully complete until QA has signed off (when QA teammate is present).

## Cross-Service Coordination
- If a task requires changes in multiple services, split it: one sub-task per service
- Teammates agree on interface contracts via direct messaging
- The lead monitors cross-service dependencies and unlocks blocked tasks
- Contract tests (./scripts/test-contracts.sh) run at the end to verify integration

## Completion
When ALL sprint tasks are completed:
- Update docs/tasks/README.md with all status changes
- Run the full test suite: ./scripts/test-all.sh
- Run contract tests if any API changed: ./scripts/test-contracts.sh
- The lead synthesizes a summary of what was built
- The lead recommends running /cto-review for a post-sprint technical review
```

### 4. Monitor and Steer

The lead (you) should:
- Watch for task completion messages from teammates
- Unlock cross-service dependent tasks as their blockers complete
- Redirect teammates that are stuck
- Resolve interface contract disagreements between service teammates

### 5. Post-Sprint Wrap-Up

After all tasks complete:
1. Run full test suite: `./scripts/test-all.sh`
2. Run contract tests: `./scripts/test-contracts.sh`
3. Update all task statuses in `docs/tasks/README.md`
4. Suggest running `/cto-review` for technical review
5. Suggest running `/project-review` for health check
6. Output completion summary

## Team Sizing Guidelines

| Total Tasks | Service Teammates (Sonnet) | QA (Opus) | Lead (Opus) | Total |
|-------------|---------------------------|-----------|-------------|-------|
| 2-5 tasks   | 2-3                       | —         | 1           | 3-4   |
| 6-10 tasks  | 3-5                       | 1         | 1           | 5-7   |
| 10+ tasks   | 4-5                       | 1         | 1           | 6-7   |

## Safety

- All existing hooks apply to teammates (branch protection, pre-commit tests, post-edit lint)
- Teammates inherit the lead's permission settings
- Max team size capped at 7 (5 service teammates + QA + lead)
- Each teammate scoped to one service's files — prevents merge conflicts
- Full test suite + contract tests run at the end as a gate
- Schema ownership enforced: teammates only write to their service's schema

## Cost Note

Agent teams use 3-4x the tokens of sequential execution. The time savings are significant when you have ready tasks across multiple services. For single-service work with sequential dependencies, prefer `/robo-task` instead.

$ARGUMENTS
