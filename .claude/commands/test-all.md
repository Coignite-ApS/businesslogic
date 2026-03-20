# Run All Tests

Run the complete test suite across all services and report results.

## Steps

1. Check which services are set up (have source code, not empty directories)
2. Run `./scripts/test-all.sh` and capture output
3. If any tests fail:
   - Report EXACTLY which tests failed with error messages
   - Suggest specific fixes
   - Do NOT mark the task as complete
4. If all tests pass:
   - Report pass counts per service
   - If Docker is running, also run `./scripts/test-contracts.sh`
5. Summary: total passed, failed, skipped

## Options

- `/test-all` — run everything
- `/test-all --service cms` — run only CMS tests
- `/test-all --quick` — skip e2e/integration, unit tests only
