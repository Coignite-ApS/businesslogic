# 03. Volatile Function Tracking

**Status:** idea
**Category:** Coverage

---

## Goal

RAND, RANDBETWEEN, NOW, TODAY, RANDARRAY are volatile — they should always recalculate even in incremental mode (step 2.5). Need to mark these in function registry and propagate volatility through dependency graph so all dependents also recalculate.

---

## Key Tasks

- [ ] Add volatile flag to function registry
- [ ] Mark volatile functions
- [ ] Propagate in dep graph
- [ ] Always include volatile cells in dirty set
