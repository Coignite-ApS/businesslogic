# 35. CI pipeline: run scripts/test-all.sh on PRs

**Status:** planned
**Severity:** HIGH (blocks test signal) / CRITICAL after Task 26 tests added
**Source:** Task 26 spec review — acceptance criterion "CI runs all of the above on every PR" not met

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
