# 02. OFFSET/INDIRECT Aggregates

**Status:** idea
**Category:** Correctness

---

## Goal

SUM(OFFSET(A1,0,0,5,1)) should sum 5 cells, but currently OFFSET returns a single cell value when used standalone. Need OFFSET/INDIRECT to return dynamic RangeGrid that aggregate functions can iterate over. Requires extending the evaluator to pass range context through function calls.

---

## Key Tasks

- [ ] Add dynamic range return type
- [ ] Modify collect_values to handle OFFSET/INDIRECT results
- [ ] Test SUM(OFFSET(...)) patterns
- [ ] Test SUMIF with OFFSET ranges
