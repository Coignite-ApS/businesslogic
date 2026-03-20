# Execute Migration Iteration

Run a specific migration iteration with TDD enforcement.

## Usage

Provide the iteration number as argument: `/migrate-iteration 00`

## Steps

1. **Branch setup:**
   - Ensure `dev` branch exists: `git branch dev main 2>/dev/null || true`
   - Check out iteration branch: `git checkout -b iteration/$ARGS dev` (or switch to it if exists)
   - Verify: `git branch --show-current` should show `iteration/$ARGS`

2. **Read the plan:** Read `docs/migrations/iteration-$ARGS.md` for the detailed steps

3. **For each step in the plan:**
   a. Announce what you're about to do
   b. If tests exist for this step — run them FIRST (TDD: they should fail or confirm baseline)
   c. Execute the step
   d. Write any new tests required
   e. Run the verification check listed in the plan
   f. Run `./scripts/test-all.sh --service <affected-service>` to verify no regressions
   g. If verification fails, STOP and report the issue — do NOT continue
   h. If verification passes, commit the step:
      ```bash
      git add <changed-files>
      git commit -m "chore(<scope>): step $STEP - <description>"
      ```
   i. Hooks will run tests automatically — if they block, fix issues first

4. **After all steps:**
   - Run `./scripts/test-all.sh` (full suite)
   - Run `./scripts/health-check.sh` (if services are running in Docker)
   - Run `./scripts/test-contracts.sh` (if services are running in Docker)

5. **Finalize:**
   - Push the iteration branch: `git push -u origin iteration/$ARGS`
   - Report: all steps completed, test results, any issues encountered
   - Suggest: `git checkout dev && git merge iteration/$ARGS` when ready
