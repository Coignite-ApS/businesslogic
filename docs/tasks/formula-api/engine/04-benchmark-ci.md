# 04. Benchmark CI

**Status:** idea
**Category:** Developer Experience

---

## Goal

Track performance regressions via cargo bench + criterion. Run benchmarks in CI (GitHub Actions), compare against baseline, fail on significant regression. Current perf tests in side_by_side.js are informational only.

---

## Key Tasks

- [ ] Add criterion dependency
- [ ] Write benchmarks for parse/eval/sheet-eval hot paths
- [ ] CI workflow with benchmark comparison
