# 11. Template Gallery & Showcase

**Status:** planned
**Phase:** 2 — Go-to-Market Foundation
**New project** — identified from competitive analysis (March 2026)

---

## Goal

Create a public-facing gallery of live, interactive calculator templates that simultaneously serves as:
1. **Marketing** — demonstrates platform capabilities to prospects
2. **Onboarding** — new users start from a working template instead of blank
3. **SEO** — each template is a landing page targeting industry-specific keywords
4. **Social proof** — shows the range of use cases the platform handles

Outgrow has 1,000+ templates. We have zero visible ones. This is the fastest way to make the platform tangible.

---

## Why This Matters

- **"Show, don't tell"** — a live ROI calculator is worth more than any feature list
- Every template is a **long-tail SEO landing page** ("B2B SaaS ROI calculator", "construction cost estimator", "employee turnover cost calculator")
- Templates reduce **time-to-value from hours to minutes** — pick template, customize, publish
- The `/create-calculator-template` Claude skill can generate templates rapidly — we can scale content production with AI

---

## Current State

- `calculator_templates` collection exists with full schema (sheets, formulas, input, output)
- `/create-calculator-template` Claude skill generates validated template JSON
- Several templates already created (e.g., `roi-tilbudsberegning.json`)
- No public-facing gallery or showcase
- Templates are only accessible after login inside Directus

---

## Architecture

```
Public Gallery (static site or Directus-served page)
  ├── Grid of template cards (icon, name, industry, description)
  ├── Filter by industry (finance, construction, HR, manufacturing, etc.)
  ├── Click → full-page interactive demo
  │     ├── Live calculator widget (#07) with pre-filled defaults
  │     ├── "Try it" — change inputs, see results animate
  │     ├── "Use this template" → registration / login
  │     └── SEO-optimized meta tags, schema.org markup
  └── "Request custom calculator" CTA

Backend
  ├── calculator_templates collection (existing, add gallery fields)
  ├── Public API: GET /public/templates — list published templates
  ├── Public API: GET /public/templates/:slug — template detail + widget config
  └── Public API: POST /public/templates/:slug/demo — execute template with inputs (rate-limited)
```

### Template Demo Execution

Templates need to be executable without a user account. Options:

**Option A: Shared demo account** — a system-level account with deployed demo calculators. Each published template has a corresponding live calculator deployed to the Formula API under this account. The public demo widget uses this calculator's token.

**Option B: Client-side calculation** — for simple templates, execute formulas client-side using a lightweight Excel engine (e.g., HyperFormula, ~40KB). No API call needed for demos. Only works for templates without complex Excel features.

**Recommendation: Option A** — simpler, reuses existing infrastructure, handles all formula complexity. Deploy demo calculators automatically when a template is published to gallery.

---

## Template Production Plan

Use the `/create-calculator-template` skill to generate templates across industries. Target: **30 templates at launch** across 8 industries.

### Industry Coverage

| Industry | Template Examples | Count |
|----------|-----------------|-------|
| **Finance** | ROI calculator, loan amortization, investment return, break-even analysis, currency converter | 5 |
| **SaaS / Tech** | SaaS metrics (MRR/ARR/churn), pricing page calculator, TCO comparison, cloud cost estimator | 4 |
| **Construction** | Material cost estimator, project budget calculator, labor cost calculator | 3 |
| **HR** | Employee cost calculator, turnover cost, salary benchmarking, hiring ROI | 4 |
| **Manufacturing** | Production cost calculator, waste reduction ROI, capacity planner | 3 |
| **Marketing** | Ad spend ROI, content marketing ROI, lead gen cost calculator | 3 |
| **Energy** | Solar panel savings, energy efficiency ROI, carbon footprint calculator | 3 |
| **Real Estate** | Mortgage calculator, rental yield, property investment ROI, renovation budget | 4 |
| **General** | Unit converter, percentage calculator | 1 |

### Template Quality Bar

Each template must:
- Produce meaningful results with default values (zero-click value)
- Have 4-7 inputs with helpful descriptions and realistic min/max bounds
- Have 3-6 outputs including a verbal assessment ("Vurdering")
- Include a `widget_layout` (once #07 ships) for the gallery demo
- Have SEO-ready title and description

---

## Key Tasks

### Schema Changes
- Add to `calculator_templates`:
  - `gallery_published` (boolean) — visible in public gallery
  - `slug` (string, unique) — URL-friendly identifier
  - `seo_title` (string) — meta title for gallery page
  - `seo_description` (string) — meta description
  - `preview_image` (file) — screenshot/thumbnail for gallery card
  - `demo_calculator_id` (string) — deployed demo calculator ID
  - `category_tags` (JSON array) — e.g., ["roi", "finance", "saas"]

### Demo Infrastructure
- System account for demo calculators (internal, exempt from subscription)
- Auto-deploy: when `gallery_published` is set to true, deploy template as a calculator under the system account
- Auto-undeploy: when unpublished, remove from Formula API
- Demo token per template (read-only, rate-limited)

### Public API (calculator-api extension)
- `GET /public/templates` — list gallery-published templates (paginated, filterable by industry)
- `GET /public/templates/:slug` — template detail with widget config for demo
- Rate limiting: 60 req/min per IP for listing, 30 req/min for demo execution

### Gallery Frontend
Two options:

**Option A: Standalone static site** (Next.js/Astro) deployed separately
- Best SEO, fastest page loads, full control over design
- Separate codebase from Directus
- Calls public API for template data

**Option B: Directus-served pages** via a public hook extension
- Single deployment, no separate site
- Renders HTML server-side from template data
- Less SEO flexibility but simpler infrastructure

**Recommendation: Option A** for launch — SEO is critical for this to work as a growth channel. The gallery IS the marketing site. But start with a simple static page generator that builds from template data, not a full framework.

### Template Production
- Batch-generate templates using `/create-calculator-template` skill
- Validate each with the existing validation script
- Review and refine for quality (realistic defaults, helpful descriptions)
- Deploy to demo account
- Take screenshots for preview images
- Write SEO titles/descriptions per template

---

## Acceptance Criteria

- [ ] Public gallery page shows all published templates with industry filter
- [ ] Each template has a live, interactive demo using the widget (#07)
- [ ] Demo calculators execute without requiring user login
- [ ] "Use this template" button leads to registration/login
- [ ] At least 20 templates published across 6+ industries at launch
- [ ] Each gallery page has proper meta tags for SEO
- [ ] Demo execution is rate-limited
- [ ] Templates auto-deploy when published, auto-undeploy when removed

---

## Dependencies

- **#07a (Core Widget)** — gallery demos use the embeddable widget
- **#04 (Formula API Security)** — demo execution goes through secured Formula API
- `/create-calculator-template` skill (exists)
- `calculator_templates` collection (exists, needs gallery fields)

## SEO Strategy

Each template page targets a long-tail keyword:
- `/templates/saas-roi-calculator` → "SaaS ROI calculator online"
- `/templates/construction-cost-estimator` → "construction cost estimator tool"
- `/templates/employee-turnover-cost` → "employee turnover cost calculator"

Schema.org `SoftwareApplication` markup on each page. Calculator results are indexable text (not behind JavaScript). Internal linking between related templates.

## Estimated Scope

- Schema changes: ~50 lines (migration)
- Demo infrastructure: ~200-300 lines (auto-deploy/undeploy hooks)
- Public API: ~150-200 lines (template listing, detail endpoints)
- Gallery frontend: ~500-800 lines (template grid, detail page, SEO)
- Template production: ~2-3 days with Claude skill (30 templates)
- SEO setup: ~1 day (meta tags, schema markup, sitemap)
