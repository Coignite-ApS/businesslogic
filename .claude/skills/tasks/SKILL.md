---
name: tasks
description: Review task backlog across all services, pick next project, update status, or add new ideas
user_invocable: true
---

# Tasks Backlog

Review and manage platform task projects across all services.

## Instructions

1. Read `docs/tasks/README.md` to get the full backlog overview with statuses.
2. If user specifies a service (e.g., `/tasks cms`, `/tasks formula-api`), read that service's README:
   - `docs/tasks/cms/` — CMS back-office (Directus modules, UI, billing)
   - `docs/tasks/ai-api/` — AI API service (chat, KB, public API)
   - `docs/tasks/formula-api/` — Formula API service + engine
   - `docs/tasks/formula-api/engine/` — bl-excel Rust engine specifically
   - `docs/tasks/flow/` — Flow engine (Rust/Axum)
   - `docs/tasks/gateway/` — API gateway (Go)
   - `docs/tasks/cross-cutting/` — Infrastructure, multi-service concerns
3. Present a summary table showing tasks grouped by service, with current status.
4. Ask the user what they want to do:
   - **Pick next**: Recommend the next task based on priority and dependencies
   - **Start <service> #N**: Mark task N in service as `in-progress`, read its doc, begin planning
   - **Complete <service> #N**: Mark as `completed`, confirm docs done, remove the doc and update README
   - **Add <service>**: Create a new task doc with the next number in that service
   - **Update <service> #N**: Open task N's doc for editing
   - **Drop <service> #N**: Remove task from backlog
   - **Review <service> #N**: Display full detail doc for task N

## Service Mapping

When a user describes work without specifying a service, map it:

| Domain | Service |
|--------|---------|
| Calculator UI, admin modules, billing, Directus extensions | cms |
| AI chat, knowledge base backend, embeddings, public AI API | ai-api |
| Formula evaluation, MCP, calculator CRUD, execute endpoints | formula-api |
| Excel formula engine, Rust, functions, parsing | formula-api/engine |
| Workflow DAGs, triggers, workers | flow |
| Auth, rate limiting, routing, CORS | gateway |
| Hetzner, Coolify, Docker, Terraform, cross-service | cross-cutting |

## Status Updates

When changing status:
- Update the status in the service's section in `docs/tasks/README.md`
- Update the `**Status:**` line in the individual doc
- When completing: confirm docs are updated, then remove the task file and its row from README

## Adding New Tasks

When the user says `/tasks add <service>` or describes work to add:

1. Ask: What is the task about? (if not already described)
2. Map to the correct service using Service Mapping above
3. Determine next available number: list `docs/tasks/<service>/` and pick next NN
4. Create the doc using this template:

```markdown
# NN. <Title>

**Status:** planned
**Mirrors:** (optional — if related to another service's task)

---

## Goal

<One paragraph describing what this task achieves>

---

## Key Tasks

- [ ] <Task 1>
- [ ] <Task 2>
- [ ] ...

---

## Key Files

- `services/<service>/path/to/file.js`
- ...

---

## Acceptance Criteria

- [ ] <Criterion 1>
- [ ] <Criterion 2>
- [ ] ...
```

5. Save to `docs/tasks/<service>/NN-slug.md`
6. Add row to the service table in `docs/tasks/README.md`
7. Confirm to the user: task created, ready for `/robo-task <service>/NN-slug`

## Important

- Not all ideas will be implemented — some may be dropped
- Each task doc can be freely edited to refine scope over time
- When a task is completed and documented, remove it from the backlog
- Tasks that span multiple services go in `cross-cutting/`
