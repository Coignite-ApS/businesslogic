# 16. Fix snapshot Makefile container name (cms)

**Status:** planned
**Severity:** MEDIUM
**Source:** db-admin report `docs/reports/db-admin-2026-04-18-pricing-v2-schema-064122.md`

## Problem

`services/cms/Makefile` snapshot targets (`snapshot`, `snapshot-pre`, `snapshot-post`, `snapshot-dryrun`, `snapshot-forensic`) use:

```makefile
docker compose exec directus node /directus/cli.js schema snapshot ...
```

But the actual running container in the dev stack (`infrastructure/docker/docker-compose.dev.yml`) uses service name `bl-cms` (container `businesslogic-bl-cms-1`). Result: `make snapshot-pre SLUG=...` reports "service directus is not running" and silently fails to write the YAML to disk.

The same issue affects `services/cms/snapshots/diff-schema.sh` line 31 (`docker compose exec directus npx directus schema diff ...`).

## Workaround currently used

Direct invocation via `docker exec` + `docker cp` to copy the snapshot out (the `/directus/snapshots/` directory inside the container is NOT bind-mounted to the host):

```bash
TS=$(date +%Y%m%d_%H%M%S) && OUT="pre_<slug>_${TS}.yaml"
docker exec businesslogic-bl-cms-1 node /directus/cli.js schema snapshot "/directus/snapshots/${OUT}"
docker cp businesslogic-bl-cms-1:/directus/snapshots/${OUT} services/cms/snapshots/${OUT}
```

## Fix

Two parts:

1. **Use the right service name**. Either:
   - (a) Detect the active compose context and use the correct service name (e.g. `bl-cms` when running via `infrastructure/docker/docker-compose.dev.yml`)
   - (b) Run the snapshot from the project root with explicit `-f infrastructure/docker/docker-compose.dev.yml exec bl-cms ...`
   - (c) Use `docker exec businesslogic-bl-cms-1` directly (bypasses compose service-name resolution)

2. **Mount `/directus/snapshots/` into the container**. Add a bind mount in `infrastructure/docker/docker-compose.dev.yml` so writes inside the container appear on the host:

```yaml
bl-cms:
  volumes:
    - ../../services/cms/snapshots:/directus/snapshots
```

Then `docker exec ... cli.js schema snapshot /directus/snapshots/...` writes directly to the host path; no `docker cp` needed.

## Acceptance

- `cd services/cms && make snapshot-pre SLUG=test` writes a file to `services/cms/snapshots/pre_test_<ts>.yaml` on the host
- `cd services/cms && ./snapshots/diff-schema.sh` works without "service directus is not running"
- All five snapshot make targets work end-to-end

## Key Tasks

- [ ] Decide approach (volume mount vs. service-name fix vs. both)
- [ ] Update `services/cms/Makefile` snapshot targets
- [ ] Update `services/cms/snapshots/diff-schema.sh` and `apply-schema.sh`
- [ ] Update `infrastructure/docker/docker-compose.dev.yml` if mounting the snapshots dir
- [ ] Test all 5 make snapshot targets
- [ ] Update `.claude/skills/db-admin/SKILL.md` Quick Command Reference if commands change

## Notes

The root `Makefile`'s `snapshot-pre` (PG dump version) works fine — it uses `docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres ...` with the correct service name. Only the CMS-level YAML snapshot targets are broken.
