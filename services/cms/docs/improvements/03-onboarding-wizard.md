# 03. Calculator Onboarding Wizard

**Status:** planned
**Phase:** 1 — Calculator Core
**Replaces:** old #6 (Onboarding) + internal parts of old #1 (Excel Widget)

---

## Goal

Reduce friction when creating new calculators for authenticated users inside the Directus module. A guided wizard that handles the initial setup so users don't need to understand the full configure flow upfront.

---

## Current State

- Creating a calculator requires: create record → upload Excel → manually configure sheets/formulas → map input cells → map output cells → deploy
- No guidance on which steps to do in which order
- No templates to start from
- `calculator_templates` collection exists but is unused

---

## Architecture

A new wizard component in the `project-extension-calculators` module that guides users through creation. Three entry points converge on the same configure flow.

```
Wizard Entry Points:
  1. Upload Excel → parse → auto-detect parameters → pre-fill configure
  2. Choose Template → load pre-built config → customize
  3. Blank Calculator → manual setup (current flow, but guided)

All paths end at:
  → Configure tab (pre-populated where possible)
  → Test tab (immediate testing)
```

This is entirely a UI/UX improvement in the calculators module. The API already supports everything needed:
- `POST /parse/xlsx` — Excel parsing
- `POST /items/calculators` — create calculator
- `POST /items/calculator_configs` — create config
- `POST /calc/deploy/:calcId` — deploy

---

## Key Tasks

### Wizard Flow
- New "Create Calculator" button opens a modal/page with 3 entry options
- **Upload Excel path:**
  1. Drag-and-drop Excel upload (reuse existing upload component)
  2. Auto-parse sheets and formulas (reuse existing parse)
  3. Present detected input/output candidates with checkboxes
  4. User confirms → calculator + config created with mappings pre-filled
  5. Redirects to configure tab for refinement
- **Template path:**
  1. Show grid of available templates from `calculator_templates` collection
  2. User selects one → calculator created from template config
  3. Redirects to configure tab
- **Blank path:**
  1. Enter calculator name/ID
  2. Redirects to configure tab (current behavior, slightly streamlined)

### Template System
- `calculator_templates` schema already defined with: name, description, icon, industry, featured, sort, sheets, formulas, input, output
- **Extend schema** to include optional `widget_layout` field (JSON) — so templates can ship with a pre-designed widget layout using `widget_components` slugs. This field is empty until #07 ships the widget collections; populated retroactively.
- The `/create-calculator-template` Claude skill already generates validated template JSON files — extend it to also generate the `widget_layout` when #07 is available
- Use the skill to create starter templates across industries (finance, construction, HR, marketing, etc.)
- Templates stored as JSON in Directus — importable via API or Directus UI
- Template selector in wizard shows: icon, name, description, industry badge, widget preview thumbnail
- When creating a calculator from a template: if `widget_layout` exists, auto-create a `calculator_layouts` record so the widget is immediately embeddable with the designed layout

### Auto-Detection (Excel path)
- After parsing, suggest parameters based on:
  - Named ranges → likely parameters
  - Cells with labels in adjacent cells → input candidates
  - Cells with formulas referencing inputs → output candidates
- Present as a checklist, not auto-committed — user confirms

---

## Acceptance Criteria

- [ ] New "Create Calculator" opens a wizard with 3 entry options
- [ ] Excel upload path auto-detects input/output candidates and pre-fills config
- [ ] Template path creates a calculator from a pre-built config
- [ ] Blank path creates an empty calculator and redirects to configure
- [ ] At least 3 templates available out of the box
- [ ] After wizard, user lands on the configure tab with pre-populated data
- [ ] User can test the calculator immediately after wizard completes

---

## Dependencies

- Existing Excel parse API (`POST /parse/xlsx`)
- Existing calculator CRUD
- `calculator_templates` collection (needs schema finalization)

## Estimated Scope

- UI: ~500-700 lines (wizard component, template selector, auto-detect UI)
- Templates: 3-5 JSON files
- No API changes
