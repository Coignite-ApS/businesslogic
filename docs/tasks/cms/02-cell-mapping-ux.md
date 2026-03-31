# 02. Cell Mapping UX

**Status:** planned
**Phase:** 1 — Calculator Core
**Replaces:** old #4

---

## Goal

Make mapping Excel cells to calculator input/output parameters visual and interactive instead of requiring manual cell reference typing.

---

## Current State

- Configure tab shows Excel sheet data in a grid and parameter list side by side
- Users manually type cell references (e.g., `B2`) into parameter mapping fields
- No visual feedback showing which cells are mapped
- Easy to make mistakes — wrong cell, wrong sheet, no validation feedback

---

## Architecture

This is a pure UI improvement in the `project-extension-calculators` module. No API changes needed — the existing `calculator_configs` data model stores cell mappings in the input/output JSON schema.

```
Sheet Grid (left)              Parameter List (right)
┌─────────────────┐           ┌──────────────────────┐
│  A  │  B  │  C  │           │ loan_amount     [B2] │ ← click B2 highlights
│─────│─────│─────│           │ interest_rate   [B3] │
│  1  │ 100 │     │           │ monthly_payment [C5] │
│  2  │ 200 │     │           └──────────────────────┘
└─────────────────┘
  ↑ click cell → fills active parameter's mapping
```

---

## Key Tasks

### Click-to-Map Interactions
- **Click parameter, then click cell**: Activates a parameter field, then clicking a cell in the sheet grid fills the cell reference
- **Click cell, then see parameter**: Clicking a mapped cell highlights which parameter it belongs to
- Keyboard shortcut: `Escape` to deselect active parameter

### Visual Feedback
- Mapped cells highlighted with a colored background in the sheet grid
- Color-coded: inputs (blue), outputs (green) — matches existing parameter type colors
- Active/selected parameter's cell gets a prominent border
- Unmapped parameters shown with a warning indicator

### Mapping Overview
- Summary badge on each parameter showing sheet name + cell (e.g., `Sheet1!B2`)
- "Show all mappings" toggle that highlights all mapped cells simultaneously
- Validation: warn if same cell is mapped to multiple parameters

### Sheet Navigation
- When clicking a parameter that maps to a different sheet, auto-switch to that sheet tab

---

## Acceptance Criteria

- [ ] Click a parameter field, then click a cell → cell reference auto-fills
- [x] Mapped cells are visually highlighted in the sheet grid
- [ ] Clicking a mapped cell highlights its associated parameter
- [x] Input and output mappings use distinct colors (blue=input, green=output)
- [x] Duplicate cell mapping shows a warning
- [ ] Sheet auto-switches when selecting a parameter mapped to a different sheet

---

## Dependencies

- Existing sheet grid component in calculators configure tab
- Existing parameter list component
- No API or schema changes

## Estimated Scope

- UI only: ~200-300 lines of changes to existing configure components
- Interaction state management in the configure view
