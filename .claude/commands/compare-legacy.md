# Compare Legacy vs New

Run legacy and new services side-by-side and compare behavior.

## Steps

1. Start both stacks:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.dev.yml --profile legacy up -d
   ```

2. Wait for both to be healthy (new on :8055, legacy on :8056)

3. Compare endpoints:
   - CMS ping: `curl localhost:8055/server/ping` vs `curl localhost:8056/server/ping`
   - Formula API: `curl localhost:3000/ping`
   - Flow Trigger: `curl localhost:3100/ping`

4. If services have data, compare API responses:
   - Same calculator execution should return same results
   - Same KB search query should return same results (after AI migration)

5. Run contract tests against both: `./scripts/test-contracts.sh`

6. Report any behavioral differences between legacy and new
