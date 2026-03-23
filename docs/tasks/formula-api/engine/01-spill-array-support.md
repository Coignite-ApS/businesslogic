# 01. Spill Array Support

**Status:** idea
**Category:** Correctness

---

## Goal

Full dynamic array support — array functions (SORT, FILTER, SEQUENCE etc) spill results into adjacent cells. Current implementation returns scalar (first element) in non-array context. Need EvalResult::Array variant, spill logic in workbook layer, #SPILL! error when overlap detected.

---

## Key Tasks

- [ ] Add EvalResult enum (Single vs Array)
- [ ] Modify dispatch to handle array returns
- [ ] Implement spill write logic
- [ ] Add #SPILL! error type
- [ ] Update evalSheet to handle spill
