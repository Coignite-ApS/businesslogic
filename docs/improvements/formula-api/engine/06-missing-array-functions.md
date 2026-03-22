# 06. Missing Array Functions

**Status:** idea
**Category:** Coverage

---

## Goal

Implement remaining Excel 365 dynamic array functions not yet covered: SORTBY, WRAPROWS, WRAPCOLS, TOCOL, TOROW, CHOOSECOLS, CHOOSEROWS, HSTACK, VSTACK, TAKE, DROP, EXPAND. These are all #NAME? in HF, so not needed for drop-in compat but useful for future Excel parity.

---

## Key Tasks

- [ ] SORTBY — sort by separate key array
- [ ] WRAPROWS/WRAPCOLS — reshape flat array to 2D
- [ ] TOCOL/TOROW — flatten 2D to 1D
- [ ] CHOOSECOLS/CHOOSEROWS — select specific cols/rows
- [ ] HSTACK/VSTACK — combine arrays horizontally/vertically
- [ ] TAKE/DROP — first/last N rows/cols
- [ ] EXPAND — pad array to specified dimensions
- [ ] Requires full spill support (backlog #5) for most of these to be useful
