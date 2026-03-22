# 07. Numeric Precision

**Status:** idea
**Category:** Correctness

---

## Goal

f64 floating point causes precision issues in some formulas (e.g. 0.1+0.2 = 0.30000000000000004). Excel rounds display to 15 significant digits. HF has similar issues. bl-excel could optionally use epsilon-aware comparison and display rounding to match Excel's behavior more closely.

---

## Key Tasks

- [ ] Audit comparison operators for epsilon-aware equality (1e-15 tolerance)
- [ ] Round display output to 15 significant digits
- [ ] Test edge cases: 0.1+0.2, large number subtraction, ROUND precision
- [ ] Consider decimal128 or fixed-point for financial functions (PMT, NPV etc)
