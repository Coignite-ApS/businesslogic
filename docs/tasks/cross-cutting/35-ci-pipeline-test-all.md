# 35. CI pipeline: run scripts/test-all.sh on PRs

**Status:** completed 2026-04-19 (`fefcfe9` + `5957bf8`) — **pending operator wiring in Buddy UI**
**Severity:** HIGH (blocks test signal) / CRITICAL after Task 26 tests added
**Source:** Task 26 spec review — acceptance criterion "CI runs all of the above on every PR" not met

## Implementation (what shipped)

- **`buddy.yml`** at repo root — pipeline named "Test on PR", triggered on PR to `dev` or `main`, skips draft PRs. Actions:
  1. Checkout + submodule init (TODO: operator must set `ssh_key_id` to the numeric ID of the `coignite-directus-base` deploy key in the Buddy workspace — Buddy does not accept SSH keys via env var)
  2. Write CI `.env` from `.env.example` + inject secrets from Buddy env vars (heredoc uses unquoted delimiter so shell expansion works)
  3. npm cache restore keyed on `package.json` checksums; pre-installs deps for formula-api and cms/extensions
  4. Start dev stack via `DOCKER_COMPOSE` action (postgres + redis + bl-cms + bl-formula-api + bl-ai-api)
  5. Health check with `retry_count: 5`, `retry_interval: 30s`, plus a `sleep 15` warmup — ~165s total budget for cold Directus boot
  6. Run `./scripts/test-all.sh` (TEST_ALLOW_SKIP explicitly NOT set)
  7. Teardown with `trigger_time: "ON_EVERY_EXECUTION"` — should run even if tests failed (verify on first execution; fallback pattern documented inline)
- **`CONTRIBUTING.md`** at repo root — short Testing & CI section: every PR triggers the pipeline, red blocks merge. Local reproduction steps. Table of required Buddy env vars (NPM_TOKEN, ANTHROPIC_API_KEY, OPENAI_API_KEY, FORMULA_TEST_TOKEN, FORMULA_ADMIN_TOKEN). Note that `DIRECTUS_SUBMODULE_SSH_KEY` must be a Buddy **workspace SSH key** (not env var).

## Remaining operator steps (Buddy UI work)

1. Connect the repo to a Buddy workspace if not already.
2. Load `buddy.yml` via Settings → YAML config.
3. Configure env vars listed in `CONTRIBUTING.md` (mark NPM_TOKEN + API keys as Secret).
4. Add the `coignite-directus-base` deploy key as a workspace SSH key; copy its numeric ID into `buddy.yml` (`ssh_key_id: N`).
5. Connect the pipeline as a required check on `dev` and `main` in GitHub branch protection.
6. Trigger a test PR; verify the pipeline goes green on clean `dev` HEAD.
7. If teardown doesn't run on failure, apply the documented fallback (split into success + ON_FAILURE actions).

## Known follow-ups

- cargo/go installed via `apk add` on every run (~2min). A prebuilt CI image with toolchains preinstalled would save the time.
- Optional JUnit XML publishing for PR annotations was skipped — spec marked optional.

## Problem

Repo has only one CI workflow: `services/cms/.github/workflows/build-and-deploy.yml` which builds + pushes a Docker image. It does NOT run tests.

`scripts/test-all.sh` exists and runs all service + extension test suites, but nothing invokes it on PR. Task 26 added a 29-test account isolation E2E suite and 6 real-Postgres Stripe tests — all currently rely on developer discipline to run locally before committing. Memory `project_decisions.md` notes the team uses **Buddy** for CI.

Additionally, Task 26 quality fix `9101118` wired tests to fail-loud when Postgres/Directus is unreachable, with escape hatch `TEST_ALLOW_SKIP=1`. CI must either boot the services OR set the skip env var intentionally — which is less useful.

## Required design

### 1. Buddy pipeline

A `buddy.yml` (or Buddy web-UI-managed pipeline) that on every PR to `dev` or `main`:

1. Checkout the branch
2. Start the dev Docker stack via `make up` (or a subset: postgres + directus + ai-api + formula-api at minimum)
3. Wait for services healthy: `make health`
4. Run: `./scripts/test-all.sh`
5. Fail pipeline on any non-zero exit
6. Publish JUnit XML / test reports (optional; useful for PR annotations)
7. Tear down

### 2. Env management

- Secrets injected via Buddy's env variable system (never committed).
- `TEST_ALLOW_SKIP` explicitly NOT set in CI — tests must run or fail.
- `DATABASE_URL`, `DIRECTUS_URL`, etc. pointed at the CI-spun Docker stack.

### 3. Fast-fail gate

For DRAFT PRs, skip heavy E2E. For ready PRs, run full suite. Configure via Buddy trigger conditions.

### 4. Cache layer

npm install + Docker layer caching to keep pipeline under 5 min.

## Acceptance

- Every PR to `dev` or `main` triggers the pipeline.
- All 121 + 68 + 29 + 20 pricing v2 tests run (calculator-api, formula-api, _shared isolation, stripe).
- Pipeline fails the PR check if any test fails.
- Green pipeline on a clean `dev` HEAD.
- Documentation: README.md or CONTRIBUTING.md section explaining the gate.

## Dependencies

- Task 26 shipped (tests exist).
- Blocked by: nothing.
- Blocks: confidence in any future PR.

## Risks

- Flaky tests from timing-sensitive real-DB assertions. Mitigation: retry policy on the Buddy action (up to 2x), and track flakes explicitly in a dashboard.
- Container start time: if too slow, consider a persistent Postgres snapshot in a Buddy cache layer.

## Why HIGH+

Without this, no automated verification that Sprint 1 work actually runs. The tests are dead weight if nothing forces them to execute.
