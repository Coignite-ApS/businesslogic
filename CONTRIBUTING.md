# Contributing

## Branching

- Branch from `dev`: `git checkout -b feat/XX-description dev`
- Merge completed features into `dev`
- PR from `dev` → `main` when verified and stable
- Direct commits to `main` are blocked by hooks

## Testing & CI

### Gate

Every PR targeting `dev` or `main` triggers the **Buddy "Test on PR"** pipeline defined in `buddy.yml`. The pipeline:

1. Checks out the branch (including the `coignite-directus-base` submodule)
2. Boots the Docker dev stack (postgres, redis, bl-cms, bl-formula-api, bl-ai-api)
3. Waits for services to be healthy (`make health`)
4. Runs `./scripts/test-all.sh` — all suites across all services
5. Fails the PR check if any test suite exits non-zero
6. Tears down containers

Draft PRs are skipped. Only ready-for-review PRs run the full suite.

### Reproduce locally

```bash
make up               # start full dev stack
make health           # confirm all services healthy
./scripts/test-all.sh # run all tests
make down             # tear down
```

For a single service:

```bash
./scripts/test-all.sh --service formula-api
./scripts/test-all.sh --quick   # unit tests only, skip e2e
```

### Required secrets in Buddy

Configure these in the Buddy pipeline's **Variables** tab (mark all as secret):

| Variable | Purpose |
|---|---|
| `NPM_TOKEN` | Access to private `@coignite` npm packages |
| `ANTHROPIC_API_KEY` | Required by ai-api and KB embedding tests |
| `OPENAI_API_KEY` | Required by KB embedding tests |
| `FORMULA_TEST_TOKEN` | Auth token for formula-api integration tests |
| `FORMULA_ADMIN_TOKEN` | Admin token for formula-api tests |

**Submodule SSH key (not an env var):** The `coignite-directus-base` submodule requires an SSH deploy key registered as a **Buddy workspace SSH key** (Settings → SSH keys), then referenced by its numeric ID in `buddy.yml` under the Checkout action (`ssh_key_id:`). Buddy YAML does not accept env-var-based SSH keys.

### `TEST_ALLOW_SKIP`

This env var is intentionally **not set** in CI. Tests that depend on Postgres or Directus being reachable will fail (not skip) if those services aren't healthy. This is by design — a skipped test provides no signal.

## Conventional Commits

```
feat(service):   new feature
fix(service):    bug fix
chore(infra):    tooling / config
ci:              pipeline changes
docs:            documentation only
test(service):   test-only changes
```

## Commit hooks

Pre-commit hooks (`.claude/hooks/`) run automatically:

- **protect-branches.sh** — blocks commits directly to `main`
- **pre-commit-tests.sh** — runs tests for services with staged changes
- **post-edit-lint.sh** — auto-formats edited files (eslint / cargo fmt / gofmt)

Fix any test failures before retrying the commit.
