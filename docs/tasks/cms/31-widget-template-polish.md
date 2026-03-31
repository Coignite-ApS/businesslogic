# 31. Widget Template Polish — Improve Widgets & Dialog UX

**Status:** planned
**Depends on:** ai-api/11 (Contextual Widgets — completed), cross-cutting/08 (Unified Widget Foundation — completed)

---

## Goal

Review and improve the ChatKit widget templates and dialog interactions rendered by the AI assistant. Current widgets work end-to-end but need design review, better data presentation, and richer interaction patterns.

## Areas to Review

### Widget Templates
- Review all 6 built-in templates (execute-calculator, list-calculators, describe-calculator, search-knowledge, ask-knowledge, list-knowledge-bases)
- Improve data mapping — show the most useful fields, better formatting (currency, percentages, dates)
- Add missing templates for new tools as they're added
- Consider resource-specific template overrides (per-calculator custom layouts)

### Visual Quality
- Card layouts, spacing, typography within ChatKit widgets
- Responsive behavior in the chat panel (narrow width)
- Dark mode support (Directus admin can be dark)
- Loading/skeleton states while widget resolves

### Dialog & Interaction
- Click actions on widgets (e.g., click calculator result to re-run with different inputs)
- Expandable/collapsible sections for large result sets
- Pagination UX for list widgets (currently flat list)
- Copy-to-clipboard for key values
- "Run again" / "Try with different inputs" quick actions

### bl-widget Components
- Audit which components are actually used in templates vs available
- Identify missing components needed for richer widgets (progress bars, sparklines, comparison tables)
- Improve existing components based on real usage patterns

## Key Tasks

- [ ] Design review of all current widget renders in browser (screenshot audit)
- [ ] Improve execute-calculator template — better result presentation
- [ ] Improve list templates — pagination, filtering, search
- [ ] Add interactive actions (click to execute, copy value, expand/collapse)
- [ ] Dark mode pass for all ChatKit components
- [ ] Add new templates as tools evolve
