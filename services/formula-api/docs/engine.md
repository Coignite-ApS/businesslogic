# Engine Compatibility Layer

HyperFormula limitations handled transparently in `src/services/engine-worker.js`.

## Formula rewrites

- **`preserveStrings(grid)`** — Prefix string cells with `'` so HF treats them as text. Without this, "0201" → 201, "true" → boolean.
- **`inlineExpressions(formula, re, exprMap)`** — Replace named expression names with cell/range refs. HF can't reference scoped expressions cross-sheet.
- **`rewriteFormulas(formula)`** — Rewrite `MATCH(TRUE, range > value, 0)` → `(MATCH(value, range, 1)+1)`. HF doesn't support array comparisons in MATCH.
- **`shrinkSelfRefs(formula, row, col)`** — Contract range boundaries to exclude cell's own position. Fixes false-positive CYCLE detection (boundary cells only).

## Cycle resolution

- **`detectCycles(hf, formulaCells)`** — Scan formula cells for #CYCLE! values
- **`resolveCycles(hf, cycles)`** — Gauss-Seidel iterative solver: seed 0, evaluate each formula, set value, repeat until convergence (max 100 iter, tolerance 0.0001)
- Runs on engine build and every calculator execution (cycle formulas restored before each run)

## Function controls (`src/blocked.js`)

**Only standard Excel functions supported.** Never expose HyperFormula name in responses.

### Blocked functions
Return `NAME` error: `VERSION`, `ISBINARY`, `MAXPOOL`, `MEDIANPOOL`, `COUNTUNIQUE`, `ARRAY_CONSTRAIN`, `ARRAYFORMULA`, `INTERVAL`, `SPLIT`.

### Volatile functions (non-cacheable)
Bypass cache: `RAND`, `RANDBETWEEN`, `NOW`, `TODAY`.

### Error type remapping
`CYCLE` → `REF`, `SPILL` → `REF`, `LIC` → `NAME`.

### Cell-reference-only functions
- `ISBLANK` — only true for empty cells, `ISBLANK("")` → false
- `ISFORMULA`, `OFFSET`, `FORMULATEXT` — require cell references

## Named expressions

`expressions` field: `[{name, expression, scope?}]` — extracted from xlsx named ranges, inlined into formulas at build time.

Supported in: `/parse/xlsx` (output), `/execute/*`, calculators, `/generate/xlsx`.
