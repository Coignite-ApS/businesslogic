# BusinessLogic Design Guide + Directus Theme Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract BusinessLogic's visual identity from https://www.businesslogic.online/ into a versioned `designguide/` folder, then package it as a Directus theme extension selectable at `/admin/settings/appearance`.

**Architecture:** Two artifacts built in sequence. First, a standalone `designguide/` folder (HTML + MD + JSON tokens + images) is produced via Chrome DevTools MCP extraction and design-judgment curation. Second, a Directus bundle extension (`project-extension-theme`) maps `tokens.json` to Directus 11's theme schema and ships two themes (light + dark). A prebuild script keeps `tokens.json` as the single source of truth.

**Tech Stack:** Chrome DevTools MCP (extraction), vanilla HTML/CSS (preview), TypeScript + `@directus/extensions-sdk` 17.x (extension), vitest (tests), existing `make ext-*` Makefile pattern.

**Spec:** `docs/superpowers/specs/2026-04-22-businesslogic-design-guide-and-directus-theme-design.md`

---

## File Structure

**Created:**
- `designguide/README.md`
- `designguide/index.html`
- `designguide/tokens.md`, `tokens.json`, `tokens.raw.json`
- `designguide/typography.md`, `color.md`, `components.md`, `inspiration.md`
- `designguide/images/source/*.png`, `images/brand/*`, `images/previews/*.png`
- `services/cms/extensions/local/project-extension-theme/package.json`
- `services/cms/extensions/local/project-extension-theme/src/index.ts`
- `services/cms/extensions/local/project-extension-theme/src/businesslogic-light.ts`
- `services/cms/extensions/local/project-extension-theme/src/businesslogic-dark.ts`
- `services/cms/extensions/local/project-extension-theme/src/tokens.ts` (generated)
- `services/cms/extensions/local/project-extension-theme/src/mapping.ts` (tokens → rules contract)
- `services/cms/extensions/local/project-extension-theme/scripts/build-tokens.mjs`
- `services/cms/extensions/local/project-extension-theme/vitest.config.ts`
- `services/cms/extensions/local/project-extension-theme/__tests__/tokens-map.test.ts`
- `services/cms/extensions/local/project-extension-theme/__tests__/contrast.test.ts`
- `services/cms/extensions/local/project-extension-theme/tsconfig.json`
- `services/cms/extensions/local/project-extension-theme/.gitignore`

**Modified:**
- `Makefile` — add `ext-theme` target, update `ext` list in comments if needed
- `CLAUDE.md` — add `project-extension-theme` to the extension table and `_shared`-style list

---

## Task 1: Scaffold `designguide/` skeleton

**Files:**
- Create: `designguide/README.md`
- Create: `designguide/.gitkeep` placeholders inside `images/source/`, `images/brand/`, `images/previews/`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p designguide/images/source designguide/images/brand designguide/images/previews
touch designguide/images/source/.gitkeep designguide/images/brand/.gitkeep designguide/images/previews/.gitkeep
```

- [ ] **Step 2: Write `designguide/README.md`**

```markdown
# BusinessLogic Design Guide

Canonical visual identity for BusinessLogic, extracted from https://www.businesslogic.online/ on 2026-04-22.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Interactive preview — open in browser to see every token rendered in both themes. No build step required. |
| `tokens.json` | Machine-readable tokens. Consumed by `services/cms/extensions/local/project-extension-theme`. Single source of truth. |
| `tokens.md` | Human-readable tokens reference. |
| `tokens.raw.json` | Raw extraction evidence from businesslogic.online. Never hand-edited. |
| `typography.md` | Font stack, scale, pairings. |
| `color.md` | Palette rationale, contrast pairs, dark-mode derivation rules. |
| `components.md` | Button, input, card, nav patterns composed from tokens. |
| `inspiration.md` | Reference sources (Linear, Vercel, Stripe) with takeaways. |
| `images/source/` | Screenshots of businesslogic.online. |
| `images/brand/` | Logo, wordmark, favicon exports. |
| `images/previews/` | Rendered previews of `index.html` in both themes. |

## Updating

1. Re-run Chrome DevTools MCP extraction against the source site (see `tokens.raw.json.extractedAt`).
2. Re-curate `tokens.json` from `tokens.raw.json`.
3. Rebuild the theme extension: `make ext-theme && make cms-restart`.
```

- [ ] **Step 3: Commit**

```bash
git add designguide/
git commit -m "chore(designguide): scaffold folder structure"
```

---

## Task 2: Extract raw design tokens from businesslogic.online

**Files:**
- Create: `designguide/tokens.raw.json`
- Create: `designguide/images/source/homepage-full.png`, `hero.png`, `nav.png`, `footer.png`, `buttons.png`, `typography.png`

Uses Chrome DevTools MCP. All tool calls target `https://www.businesslogic.online/`.

- [ ] **Step 1: Open page and capture full-page screenshot**

MCP tool calls:
```
mcp__chrome-devtools__new_page { url: "https://www.businesslogic.online/" }
mcp__chrome-devtools__wait_for { text: "<any visible text from hero>", timeout: 10000 }
mcp__chrome-devtools__take_screenshot { format: "png", fullPage: true, filePath: "designguide/images/source/homepage-full.png" }
```

- [ ] **Step 2: Capture sectional screenshots**

For each of `hero`, `nav`, `footer`, `buttons`, `typography`, take a viewport screenshot scrolled to that region. Use `evaluate_script` to scroll, then `take_screenshot`:

```javascript
// evaluate_script argument — scroll hero into view
document.querySelector('header, [class*="hero" i], main > *:first-child')?.scrollIntoView({ block: 'start' });
```

Then: `mcp__chrome-devtools__take_screenshot { format: "png", filePath: "designguide/images/source/hero.png" }`

Repeat for `nav`, `footer`. For `buttons` and `typography`, scroll to any section containing representative buttons / headings and capture.

- [ ] **Step 3: Extract computed tokens via `evaluate_script`**

Run this script in the page (via `mcp__chrome-devtools__evaluate_script`) and capture the returned JSON:

```javascript
(() => {
  const root = document.documentElement;
  const body = document.body;
  const rootStyle = getComputedStyle(root);
  const bodyStyle = getComputedStyle(body);

  // Collect all CSS custom properties defined on :root
  const customProps = {};
  for (const rule of Array.from(document.styleSheets).flatMap(s => {
    try { return Array.from(s.cssRules); } catch { return []; }
  })) {
    if (rule.selectorText === ':root' || rule.selectorText === 'html') {
      for (const prop of Array.from(rule.style)) {
        if (prop.startsWith('--')) customProps[prop] = rule.style.getPropertyValue(prop).trim();
      }
    }
  }

  const computedOn = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      color: s.color,
      backgroundColor: s.backgroundColor,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      borderRadius: s.borderRadius,
      borderColor: s.borderColor,
      boxShadow: s.boxShadow,
      padding: s.padding,
    };
  };

  const loadedFonts = Array.from(document.fonts).map(f => ({
    family: f.family, weight: f.weight, style: f.style, status: f.status,
  }));

  const stylesheetHrefs = Array.from(document.styleSheets)
    .map(s => s.href)
    .filter(Boolean);

  const images = Array.from(document.querySelectorAll('img, svg')).slice(0, 30).map(el => ({
    tag: el.tagName.toLowerCase(),
    src: el.getAttribute('src') || null,
    alt: el.getAttribute('alt') || null,
    classes: el.className?.toString?.() || null,
    width: el.getBoundingClientRect().width,
    height: el.getBoundingClientRect().height,
  }));

  return {
    extractedAt: new Date().toISOString(),
    source: location.href,
    customProps,
    rootComputed: {
      color: rootStyle.color,
      backgroundColor: rootStyle.backgroundColor,
      fontFamily: rootStyle.fontFamily,
      fontSize: rootStyle.fontSize,
    },
    bodyComputed: {
      color: bodyStyle.color,
      backgroundColor: bodyStyle.backgroundColor,
      fontFamily: bodyStyle.fontFamily,
      fontSize: bodyStyle.fontSize,
    },
    elements: {
      h1: computedOn('h1'),
      h2: computedOn('h2'),
      h3: computedOn('h3'),
      p: computedOn('p'),
      a: computedOn('a'),
      button: computedOn('button, .button, [class*="btn" i]'),
      nav: computedOn('nav, header'),
      footer: computedOn('footer'),
    },
    loadedFonts,
    stylesheetHrefs,
    images,
  };
})()
```

- [ ] **Step 4: Write output to `designguide/tokens.raw.json`**

Save the exact JSON object returned by `evaluate_script` to `designguide/tokens.raw.json`. Pretty-print with 2-space indent.

- [ ] **Step 5: Verify extraction completed**

```bash
test -s designguide/tokens.raw.json && jq '.extractedAt, .elements.h1.color, (.images | length)' designguide/tokens.raw.json
```

Expected: non-empty file, ISO timestamp printed, at least one h1 color, image count > 0.

- [ ] **Step 6: Commit**

```bash
git add designguide/tokens.raw.json designguide/images/source/
git commit -m "chore(designguide): extract raw tokens + screenshots from businesslogic.online"
```

---

## Task 3: Capture brand assets (logo + favicon)

**Files:**
- Create: `designguide/images/brand/logo.svg` (or `.png`)
- Create: `designguide/images/brand/favicon.ico` (or `.png`)
- Create: `designguide/images/brand/README.md`

- [ ] **Step 1: Identify logo asset from `tokens.raw.json`**

Inspect `.images` in `tokens.raw.json`. Logo is typically the first `<img>` or `<svg>` in `<header>`/`<nav>` with `alt` containing "logo" or "businesslogic". Favicon is at `/favicon.ico` or in `<link rel="icon">`.

- [ ] **Step 2: Download logo**

If the logo `src` starts with `/`, prepend `https://www.businesslogic.online`. Download via curl:

```bash
curl -fsSL "<logo-url>" -o designguide/images/brand/logo.<ext>
```

Prefer SVG if any `<svg>` appears in the nav/header; in that case use `evaluate_script` to `document.querySelector('nav svg, header svg').outerHTML` and write the returned string to `designguide/images/brand/logo.svg`.

- [ ] **Step 3: Download favicon**

```bash
curl -fsSL "https://www.businesslogic.online/favicon.ico" -o designguide/images/brand/favicon.ico
```

If 404, inspect `<link rel="icon">` href in `tokens.raw.json` stylesheet list or do another `evaluate_script`:

```javascript
document.querySelector('link[rel*="icon"]')?.href
```

- [ ] **Step 4: Write `designguide/images/brand/README.md`**

```markdown
# Brand Assets

Extracted from https://www.businesslogic.online/ on 2026-04-22.

| File | Source | Usage |
|------|--------|-------|
| `logo.<ext>` | `<original URL>` | Primary wordmark / mark |
| `favicon.ico` | `/favicon.ico` | Browser tab icon |

Do not modify these files. Re-extract from source if they need updating.
```

- [ ] **Step 5: Verify files are non-empty**

```bash
test -s designguide/images/brand/logo.* && test -s designguide/images/brand/favicon.*
file designguide/images/brand/*
```

- [ ] **Step 6: Commit**

```bash
git add designguide/images/brand/
git commit -m "chore(designguide): capture brand assets (logo + favicon)"
```

---

## Task 4: Curate `tokens.json` from raw extraction

**Files:**
- Create: `designguide/tokens.json`

This step applies design judgment. No test — the approval gate is the `index.html` preview in Task 6.

- [ ] **Step 1: Read `tokens.raw.json` and identify canonical values**

For each token category, pick the canonical value:

- **Colors**: from `customProps` if present (look for `--color-*`, `--brand-*`, etc.), else derive from `elements.body.backgroundColor`, `elements.h1.color`, `elements.a.color`, `elements.button.backgroundColor`. Normalize all to hex via `#RRGGBB`.
- **Typography**: from `elements.body.fontFamily` (sans), find mono in `customProps` or fall back to system mono stack.
- **Type scale**: `elements.h1.fontSize`, `h2.fontSize`, `h3.fontSize`, `p.fontSize`. Convert px to rem (assuming 16px base) where helpful.
- **Radius**: from `elements.button.borderRadius` or `customProps --radius-*`.
- **Shadow**: from `elements.button.boxShadow` or any `customProps --shadow-*`.
- **Space scale**: fixed Tailwind-ish ladder `{ 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px", 8: "32px", 12: "48px", 16: "64px" }` since marketing sites rarely expose this explicitly.

- [ ] **Step 2: Write `designguide/tokens.json`**

```json
{
  "version": "1.0.0",
  "source": "https://www.businesslogic.online/",
  "extractedAt": "<ISO from tokens.raw.json>",
  "light": {
    "color": {
      "background": "#<hex>",
      "surface": "#<hex>",
      "surfaceMuted": "#<hex>",
      "primary": "#<hex>",
      "primaryHover": "#<hex>",
      "primaryForeground": "#<hex>",
      "accent": "#<hex>",
      "text": "#<hex>",
      "textMuted": "#<hex>",
      "border": "#<hex>",
      "borderStrong": "#<hex>",
      "success": "#16a34a",
      "warning": "#d97706",
      "danger": "#dc2626"
    },
    "typography": {
      "fontFamily": {
        "sans": "<resolved sans stack>, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif",
        "mono": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
      },
      "scale": {
        "xs": "0.75rem",
        "sm": "0.875rem",
        "base": "1rem",
        "lg": "1.125rem",
        "xl": "1.25rem",
        "2xl": "1.5rem",
        "3xl": "1.875rem",
        "4xl": "2.25rem"
      },
      "weight": { "regular": 400, "medium": 500, "semibold": 600, "bold": 700 },
      "lineHeight": { "tight": 1.2, "normal": 1.5, "relaxed": 1.7 }
    },
    "space": {
      "1": "4px", "2": "8px", "3": "12px", "4": "16px",
      "6": "24px", "8": "32px", "12": "48px", "16": "64px"
    },
    "radius": { "sm": "4px", "md": "8px", "lg": "12px", "full": "9999px" },
    "shadow": {
      "sm": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      "md": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
      "lg": "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)"
    }
  },
  "dark": { "...populated in Task 5..." }
}
```

Fill every `<hex>` and `<resolved sans stack>` from actual extracted values. No `...` in the final file — the `"dark"` placeholder above is the only exception and gets replaced in Task 5.

- [ ] **Step 3: Validate JSON parses**

```bash
jq '.light.color.primary, .light.typography.fontFamily.sans' designguide/tokens.json
```

Expected: prints the primary hex and the sans stack. No parse errors.

- [ ] **Step 4: Commit**

```bash
git add designguide/tokens.json
git commit -m "feat(designguide): curate light tokens from raw extraction"
```

---

## Task 5: Derive dark theme tokens + WCAG AA contrast

**Files:**
- Modify: `designguide/tokens.json` (replace `"dark"` placeholder)
- Create: `designguide/color.md`

- [ ] **Step 1: Derive dark palette**

Rules:
- `background`: near-black (e.g., `#0a0a0a`) if light bg is near-white; otherwise hue-shifted 180° and lightness-inverted
- `surface`: one step lighter than background (`#141414`)
- `surfaceMuted`: `#1f1f1f`
- `primary`: same as light (brand hue is preserved), but if light primary contrast against dark bg < 4.5, lighten until ≥ 4.5
- `primaryForeground`: adjusted to maintain ≥ 4.5 contrast against primary
- `text`: `#f5f5f5`
- `textMuted`: `#a3a3a3`
- `border`: `#262626`
- `borderStrong`: `#404040`
- `accent`: preserve brand hue, lighten as needed
- `success`, `warning`, `danger`: use slightly desaturated variants (`#22c55e`, `#f59e0b`, `#ef4444`)

Typography, space, radius, shadow: identical to light in the dark object (shadows use higher opacity internally via `rgb(0 0 0 / 0.3)` instead of `0.05–0.1`).

- [ ] **Step 2: Compute contrast ratios**

Write a throwaway Node script `/tmp/contrast.mjs`:

```javascript
const hexToRgb = (h) => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rel = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * rel(r) + 0.7152 * rel(g) + 0.0722 * rel(b);
const contrast = (a, b) => {
  const [L1, L2] = [lum(hexToRgb(a)), lum(hexToRgb(b))].sort((x, y) => y - x);
  return (L1 + 0.05) / (L2 + 0.05);
};
const pairs = [
  ['background', 'text'], ['background', 'textMuted'],
  ['surface', 'text'], ['primary', 'primaryForeground'],
];
const theme = JSON.parse(require('fs').readFileSync('designguide/tokens.json')).dark.color;
for (const [a, b] of pairs) {
  const r = contrast(theme[a], theme[b]);
  console.log(`${a} vs ${b}: ${r.toFixed(2)} ${r >= 4.5 ? '✓' : '✗'}`);
}
```

Run: `node /tmp/contrast.mjs`

Expected: every pair ≥ 4.5 (WCAG AA for normal text). If any fail, adjust the offending color in `tokens.json` and re-run.

- [ ] **Step 3: Write `designguide/color.md`**

```markdown
# Color

## Palette

Light and dark palettes, each with semantic tokens. Source: `tokens.json`.

### Semantic roles

| Token | Role |
|-------|------|
| `background` | Page background, root surface |
| `surface` | Card, panel, elevated block |
| `surfaceMuted` | Secondary surface, hover states |
| `primary` | Brand color, primary CTAs |
| `primaryForeground` | Text/icon on primary |
| `accent` | Secondary brand, highlights |
| `text` | Body text, headings |
| `textMuted` | De-emphasized text, captions |
| `border` | Default hairline |
| `borderStrong` | Emphasized edges, focus ring |
| `success` / `warning` / `danger` | Status |

## Dark-mode derivation

Dark theme is derived from light with these rules:

1. Invert surfaces: near-white → near-black, preserve the light's surface ladder spacing.
2. Preserve brand hue. Lighten saturation only if WCAG AA contrast drops below 4.5 against dark background.
3. Shadows use higher alpha (0.3) instead of 0.05–0.1 for visibility on dark surfaces.

## Contrast (WCAG AA, 4.5:1 minimum)

| Pair | Light | Dark |
|------|-------|------|
| text on background | <ratio> | <ratio> |
| textMuted on background | <ratio> | <ratio> |
| text on surface | <ratio> | <ratio> |
| primaryForeground on primary | <ratio> | <ratio> |

Contrast script: see `/tmp/contrast.mjs` in the implementation plan, or re-run via the extension's `__tests__/contrast.test.ts` (Task 10).
```

Fill `<ratio>` with actual numbers from Step 2.

- [ ] **Step 4: Commit**

```bash
git add designguide/tokens.json designguide/color.md
git commit -m "feat(designguide): derive dark tokens, add color.md with WCAG AA pairs"
```

---

## Task 6: Build `designguide/index.html` preview

**Files:**
- Create: `designguide/index.html`

Standalone — no build step, no external assets beyond `images/brand/logo.*`. Inline CSS reads from both `light` and `dark` token sets embedded in a `<style>` block.

- [ ] **Step 1: Write `designguide/index.html`**

Structure: two side-by-side columns (light theme left, dark theme right) showing the same component set. Use CSS custom properties scoped to each column.

Populate the `:root` custom properties in both `.theme-light` and `.theme-dark` blocks from `tokens.json`. Then render (in each column): heading hierarchy (h1–h4), body copy, link, button primary + secondary + ghost, input, textarea, card with shadow, nav bar, footer, badge.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>BusinessLogic Design Guide</title>
  <style>
    .theme-light {
      --color-background: <light.color.background>;
      --color-surface: <light.color.surface>;
      --color-primary: <light.color.primary>;
      --color-primary-foreground: <light.color.primaryForeground>;
      --color-text: <light.color.text>;
      --color-text-muted: <light.color.textMuted>;
      --color-border: <light.color.border>;
      --font-sans: <light.typography.fontFamily.sans>;
      --font-mono: <light.typography.fontFamily.mono>;
      --radius-md: <light.radius.md>;
      --shadow-md: <light.shadow.md>;
      /* ...all tokens... */
    }
    .theme-dark { /* same structure with dark values */ }

    * { box-sizing: border-box; }
    body { margin: 0; font-family: var(--font-sans); background: var(--color-background); color: var(--color-text); }
    .columns { display: grid; grid-template-columns: 1fr 1fr; min-height: 100vh; }
    .column { padding: 32px; background: var(--color-background); color: var(--color-text); }
    h1,h2,h3,h4 { margin: 0 0 16px 0; }
    h1 { font-size: 2.25rem; font-weight: 700; }
    h2 { font-size: 1.5rem; font-weight: 600; }
    .btn-primary {
      display: inline-block; padding: 8px 16px;
      background: var(--color-primary); color: var(--color-primary-foreground);
      border: 0; border-radius: var(--radius-md); font: 500 1rem var(--font-sans);
      cursor: pointer;
    }
    .btn-ghost {
      display: inline-block; padding: 8px 16px;
      background: transparent; color: var(--color-text);
      border: 1px solid var(--color-border); border-radius: var(--radius-md);
    }
    input, textarea {
      width: 100%; padding: 8px 12px;
      background: var(--color-surface); color: var(--color-text);
      border: 1px solid var(--color-border); border-radius: var(--radius-md);
      font: 1rem var(--font-sans);
    }
    .card {
      background: var(--color-surface); padding: 16px;
      border-radius: var(--radius-md); box-shadow: var(--shadow-md);
    }
    .swatch { display: flex; gap: 8px; flex-wrap: wrap; }
    .swatch > div { width: 80px; height: 64px; border-radius: var(--radius-md); border: 1px solid var(--color-border); display: flex; align-items: end; padding: 4px; font-size: 10px; color: var(--color-text); }
    section { margin-bottom: 40px; }
  </style>
</head>
<body>
  <div class="columns">
    <div class="column theme-light">
      <h1>BusinessLogic — Light</h1>
      <section>
        <h2>Colors</h2>
        <div class="swatch">
          <div style="background:var(--color-background)">bg</div>
          <div style="background:var(--color-surface)">surface</div>
          <div style="background:var(--color-primary);color:var(--color-primary-foreground)">primary</div>
          <!-- etc -->
        </div>
      </section>
      <section>
        <h2>Typography</h2>
        <h1>Heading 1</h1><h2>Heading 2</h2><h3>Heading 3</h3>
        <p>Body copy. The quick brown fox jumps over the lazy dog.</p>
        <p style="color:var(--color-text-muted)">Muted copy.</p>
      </section>
      <section>
        <h2>Controls</h2>
        <button class="btn-primary">Primary</button>
        <button class="btn-ghost">Ghost</button>
        <div style="margin-top:16px"><input placeholder="Input field"></div>
      </section>
      <section>
        <h2>Card</h2>
        <div class="card">Card content with shadow.</div>
      </section>
    </div>
    <div class="column theme-dark"><!-- mirror structure --></div>
  </div>
</body>
</html>
```

Fill every `<...>` placeholder with the literal value from `tokens.json`. Do not leave `<...>` in the committed file.

- [ ] **Step 2: Capture previews**

Open `designguide/index.html` via Chrome DevTools MCP:

```
mcp__chrome-devtools__new_page { url: "file:///<abs-path>/designguide/index.html" }
mcp__chrome-devtools__take_screenshot { format: "png", fullPage: true, filePath: "designguide/images/previews/preview-both-themes.png" }
```

- [ ] **Step 3: Verify page opens and renders**

```bash
test -s designguide/index.html && test -s designguide/images/previews/preview-both-themes.png
grep -c "--color-primary:" designguide/index.html
```

Expected: file non-empty, preview screenshot exists, both `.theme-light` and `.theme-dark` selectors defined (grep count ≥ 2).

- [ ] **Step 4: Commit**

```bash
git add designguide/index.html designguide/images/previews/
git commit -m "feat(designguide): add interactive preview (index.html)"
```

---

## Task 7: Write `tokens.md`, `typography.md`, `components.md`, `inspiration.md`

**Files:**
- Create: `designguide/tokens.md`
- Create: `designguide/typography.md`
- Create: `designguide/components.md`
- Create: `designguide/inspiration.md`

- [ ] **Step 1: Write `designguide/tokens.md`**

Generate a flat table from `tokens.json`:

```markdown
# Tokens

All tokens live in `tokens.json`. This document is a human-readable mirror.

## Light

### Color

| Token | Hex |
|-------|-----|
| `background` | `<hex>` |
| `surface` | `<hex>` |
| ... | ... |

### Typography

| Token | Value |
|-------|-------|
| `fontFamily.sans` | `<stack>` |
| `fontFamily.mono` | `<stack>` |
| `scale.base` | `1rem` |
| ... | ... |

### Space, Radius, Shadow

(Same structure.)

## Dark

(Same structure — values from `tokens.json.dark`.)
```

Fill every row from the actual JSON. Any token in `tokens.json` missing from this file is a bug.

- [ ] **Step 2: Write `designguide/typography.md`**

```markdown
# Typography

## Stack

- **Sans:** `<tokens.json.light.typography.fontFamily.sans>` — used for all UI.
- **Mono:** `<tokens.json.light.typography.fontFamily.mono>` — used for code, IDs, technical values.

## Scale

| Token | Size | Usage |
|-------|------|-------|
| `4xl` | 2.25rem | Page titles (h1) |
| `3xl` | 1.875rem | Section titles (h2) |
| `2xl` | 1.5rem | Sub-section (h3) |
| `xl` | 1.25rem | Card titles (h4) |
| `lg` | 1.125rem | Emphasized body |
| `base` | 1rem | Body copy |
| `sm` | 0.875rem | Secondary text |
| `xs` | 0.75rem | Captions, badges |

## Pairings

- Headings: `semibold` or `bold`, `tight` line-height
- Body: `regular`, `normal` line-height
- Muted captions: `regular`, `textMuted` color
```

- [ ] **Step 3: Write `designguide/components.md`**

```markdown
# Component Patterns

Token-composed recipes. See `index.html` for live rendering.

## Button (primary)

Background: `color.primary`; foreground: `color.primaryForeground`.
Padding: `space.2 space.4`. Radius: `radius.md`. Font: `typography.weight.medium`, `base` size.
Hover: `color.primaryHover`. Focus: 2px outline in `color.accent` with `space.1` offset.

## Button (ghost)

Background: transparent. Border: 1px solid `color.border`. Text: `color.text`.
Hover: background `color.surfaceMuted`.

## Input

Background: `color.surface`. Border: 1px solid `color.border`. Radius: `radius.md`.
Padding: `space.2 space.3`. Focus border: `color.primary`.

## Card

Background: `color.surface`. Radius: `radius.md`. Shadow: `shadow.md`. Padding: `space.4`.

## Nav

Background: `color.surface`. Border-bottom: 1px `color.border`.
Items: `textMuted` default, `text` active, 2px bottom indicator in `color.primary` when active.
```

- [ ] **Step 4: Write `designguide/inspiration.md`**

```markdown
# Inspiration

Sources consulted during design — not copied, used only to inform how BusinessLogic tokens compose into components.

| Source | Screenshot | Lesson |
|--------|-----------|--------|
| Linear | `images/source/inspiration/linear-*.png` | Density, quiet UI, how admin software feels calm |
| Vercel dashboard | `images/source/inspiration/vercel-*.png` | Typography hierarchy, monospace for technical content |
| Stripe dashboard | `images/source/inspiration/stripe-*.png` | Color as navigation signal, not decoration |

Takeaways mapped to BusinessLogic:
- **From Linear:** prefer text color and subtle borders over colored backgrounds to convey state. Apply to nav active state (indicator, not pill).
- **From Vercel:** monospace for IDs, counts, timestamps in admin tables. Apply via `fontFamily.mono`.
- **From Stripe:** reserve the brand color for primary actions and navigation signals. Don't decorate cards or borders with it.
```

No inspiration screenshots required — this doc is reference-only. (Leave `images/source/inspiration/` folder empty or skip.)

- [ ] **Step 5: Commit**

```bash
git add designguide/tokens.md designguide/typography.md designguide/components.md designguide/inspiration.md
git commit -m "docs(designguide): add tokens, typography, components, inspiration"
```

---

## Task 8: Scaffold `project-extension-theme` package

**Files:**
- Create: `services/cms/extensions/local/project-extension-theme/package.json`
- Create: `services/cms/extensions/local/project-extension-theme/tsconfig.json`
- Create: `services/cms/extensions/local/project-extension-theme/.gitignore`
- Create: `services/cms/extensions/local/project-extension-theme/vitest.config.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "project-extension-theme",
  "version": "1.0.0",
  "description": "BusinessLogic Light + Dark themes for Directus admin",
  "type": "module",
  "directus:extension": {
    "type": "bundle",
    "path": "dist/index.js",
    "entries": [
      { "type": "theme", "name": "businesslogic-light", "source": "src/businesslogic-light.ts" },
      { "type": "theme", "name": "businesslogic-dark", "source": "src/businesslogic-dark.ts" }
    ],
    "host": "^11.0.0"
  },
  "scripts": {
    "prebuild": "node scripts/build-tokens.mjs",
    "build": "directus-extension build",
    "dev": "npm run prebuild && directus-extension build -w --no-minify",
    "test": "npm run prebuild && vitest run"
  },
  "devDependencies": {
    "@directus/extensions-sdk": "^17.0.11",
    "typescript": "^5.9.3",
    "vitest": "^4.1.0"
  }
}
```

**Note on schema:** The `entries` bundle shape for `type: "theme"` should be verified against Directus 11.16.1 docs (https://directus.io/docs/guides/extensions/theme). If Directus 11 requires a single-theme extension per package (not a bundle), split into `project-extension-theme-light` + `project-extension-theme-dark` in Task 13 when wiring entries — the rest of this plan still applies, just doubled.

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*", "__tests__/**/*", "scripts/**/*"]
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
src/tokens.ts
```

`src/tokens.ts` is generated — not committed.

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 5: Install deps**

```bash
cd services/cms/extensions/local/project-extension-theme
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 6: Commit**

```bash
git add services/cms/extensions/local/project-extension-theme/package.json \
        services/cms/extensions/local/project-extension-theme/package-lock.json \
        services/cms/extensions/local/project-extension-theme/tsconfig.json \
        services/cms/extensions/local/project-extension-theme/.gitignore \
        services/cms/extensions/local/project-extension-theme/vitest.config.ts
git commit -m "chore(ext-theme): scaffold theme extension package"
```

---

## Task 9: Write prebuild script that generates `src/tokens.ts`

**Files:**
- Create: `services/cms/extensions/local/project-extension-theme/scripts/build-tokens.mjs`

- [ ] **Step 1: Write `scripts/build-tokens.mjs`**

```javascript
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokensPath = resolve(__dirname, '../../../../../../designguide/tokens.json');
const outPath = resolve(__dirname, '../src/tokens.ts');

const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));

const banner = `// GENERATED — do not edit. Source: designguide/tokens.json\n// Run: npm run prebuild\n\n`;

const body = `export const tokens = ${JSON.stringify(tokens, null, 2)} as const;
export type Tokens = typeof tokens;
export type ThemeTokens = typeof tokens.light;
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, banner + body);
console.log(`[build-tokens] wrote ${outPath}`);
```

- [ ] **Step 2: Run prebuild**

```bash
cd services/cms/extensions/local/project-extension-theme
npm run prebuild
```

Expected stdout: `[build-tokens] wrote /abs/path/src/tokens.ts`. File exists.

- [ ] **Step 3: Verify generated file**

```bash
test -s src/tokens.ts && head -5 src/tokens.ts
```

Expected: starts with `// GENERATED`, contains `export const tokens`.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-tokens.mjs
git commit -m "feat(ext-theme): add prebuild script to generate tokens.ts from designguide"
```

---

## Task 10: Write failing `tokens-map.test.ts`

**Files:**
- Create: `services/cms/extensions/local/project-extension-theme/src/mapping.ts`
- Create: `services/cms/extensions/local/project-extension-theme/__tests__/tokens-map.test.ts`

- [ ] **Step 1: Define the mapping contract**

Create `src/mapping.ts`:

```typescript
// Maps BusinessLogic token dotted paths → Directus theme rules.* dotted paths.
// Every leaf in tokens.json.light (and .dark) MUST appear as a key here.

export const TOKEN_TO_RULES: Record<string, string[]> = {
  // Colors
  'color.background': ['background'],
  'color.surface': ['navigation.background', 'sidebar.background'],
  'color.surfaceMuted': ['navigation.modules.background'],
  'color.primary': ['primary'],
  'color.primaryHover': ['primaryAccent'],
  'color.primaryForeground': ['primaryForeground'],
  'color.accent': ['secondary'],
  'color.text': ['foreground', 'foregrounds.normal'],
  'color.textMuted': ['foregrounds.subdued'],
  'color.border': ['borderColor'],
  'color.borderStrong': ['borderColorAccent'],
  'color.success': ['success'],
  'color.warning': ['warning'],
  'color.danger': ['danger'],

  // Typography
  'typography.fontFamily.sans': ['fontFamily'],
  'typography.fontFamily.mono': ['fontFamilyMonospace'],
  'typography.weight.regular': ['fontWeight'],

  // Radius
  'radius.md': ['borderRadius'],

  // Space, shadow, scale, lineHeight, weight (non-regular): mapped via rules.custom — see extension/*.ts.
  // Marker string "__CUSTOM__" indicates "lands in rules.custom CSS, not a direct rules path".
  'space.1': ['__CUSTOM__'],
  'space.2': ['__CUSTOM__'],
  'space.3': ['__CUSTOM__'],
  'space.4': ['__CUSTOM__'],
  'space.6': ['__CUSTOM__'],
  'space.8': ['__CUSTOM__'],
  'space.12': ['__CUSTOM__'],
  'space.16': ['__CUSTOM__'],
  'radius.sm': ['__CUSTOM__'],
  'radius.lg': ['__CUSTOM__'],
  'radius.full': ['__CUSTOM__'],
  'shadow.sm': ['__CUSTOM__'],
  'shadow.md': ['__CUSTOM__'],
  'shadow.lg': ['__CUSTOM__'],
  'typography.scale.xs': ['__CUSTOM__'],
  'typography.scale.sm': ['__CUSTOM__'],
  'typography.scale.base': ['__CUSTOM__'],
  'typography.scale.lg': ['__CUSTOM__'],
  'typography.scale.xl': ['__CUSTOM__'],
  'typography.scale.2xl': ['__CUSTOM__'],
  'typography.scale.3xl': ['__CUSTOM__'],
  'typography.scale.4xl': ['__CUSTOM__'],
  'typography.weight.medium': ['__CUSTOM__'],
  'typography.weight.semibold': ['__CUSTOM__'],
  'typography.weight.bold': ['__CUSTOM__'],
  'typography.lineHeight.tight': ['__CUSTOM__'],
  'typography.lineHeight.normal': ['__CUSTOM__'],
  'typography.lineHeight.relaxed': ['__CUSTOM__'],
};
```

**Note:** The exact Directus `rules.*` keys (e.g., `primary`, `primaryAccent`, `foregrounds.normal`) are best-effort against Directus 11.16's theme schema. If the actual schema uses different names, fix them during Task 11–12 and keep `mapping.ts` in sync. The test below asserts *coverage*, not correctness of Directus key names — that's the visual sanity check in Task 15.

- [ ] **Step 2: Write failing test**

Create `__tests__/tokens-map.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { tokens } from '../src/tokens.js';
import { TOKEN_TO_RULES } from '../src/mapping.js';

// Flatten a nested object into dotted-path → value pairs
function flatten(obj: Record<string, any>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatten(v, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

describe('tokens → rules mapping', () => {
  const lightPaths = flatten(tokens.light);
  const darkPaths = flatten(tokens.dark);

  it('every light token has a mapping entry', () => {
    const missing = lightPaths.filter((p) => !(p in TOKEN_TO_RULES));
    expect(missing).toEqual([]);
  });

  it('every dark token has a mapping entry', () => {
    const missing = darkPaths.filter((p) => !(p in TOKEN_TO_RULES));
    expect(missing).toEqual([]);
  });

  it('light and dark have identical token shapes', () => {
    expect(darkPaths.sort()).toEqual(lightPaths.sort());
  });

  it('no orphan mappings', () => {
    const tokenPathsSet = new Set(lightPaths);
    const orphans = Object.keys(TOKEN_TO_RULES).filter((p) => !tokenPathsSet.has(p));
    expect(orphans).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test — expect failures until both paths match**

```bash
cd services/cms/extensions/local/project-extension-theme
npm test
```

Expected: all four tests PASS if `tokens.json` was filled exhaustively in Tasks 4–5 and `mapping.ts` mirrors it. If they fail, the failures tell you exactly which tokens are missing from `mapping.ts` or which mappings are orphaned — fix `mapping.ts` (not `tokens.json`) until green. Do not mock values to force a pass.

- [ ] **Step 4: Commit**

```bash
git add src/mapping.ts __tests__/tokens-map.test.ts
git commit -m "test(ext-theme): assert tokens.json ↔ directus rules coverage"
```

---

## Task 11: Write `contrast.test.ts`

**Files:**
- Create: `services/cms/extensions/local/project-extension-theme/__tests__/contrast.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { tokens } from '../src/tokens.js';

const hexToRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const chan = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]: [number, number, number]) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
const contrast = (a: string, b: string) => {
  const [L1, L2] = [lum(hexToRgb(a)), lum(hexToRgb(b))].sort((x, y) => y - x);
  return (L1 + 0.05) / (L2 + 0.05);
};

describe.each([
  ['light', tokens.light.color],
  ['dark', tokens.dark.color],
])('%s palette WCAG AA', (_name, c) => {
  it('text on background ≥ 4.5', () => { expect(contrast(c.text, c.background)).toBeGreaterThanOrEqual(4.5); });
  it('text on surface ≥ 4.5', () => { expect(contrast(c.text, c.surface)).toBeGreaterThanOrEqual(4.5); });
  it('textMuted on background ≥ 3.0 (AA large / UI)', () => { expect(contrast(c.textMuted, c.background)).toBeGreaterThanOrEqual(3.0); });
  it('primaryForeground on primary ≥ 4.5', () => { expect(contrast(c.primaryForeground, c.primary)).toBeGreaterThanOrEqual(4.5); });
});
```

- [ ] **Step 2: Run test**

```bash
npm test -- contrast
```

Expected: all 8 tests pass (4 pairs × 2 palettes). If any fail, open `designguide/tokens.json`, adjust the failing color, re-run `npm run prebuild`, re-run test. Iterate until green.

- [ ] **Step 3: Commit**

```bash
git add __tests__/contrast.test.ts
git commit -m "test(ext-theme): assert WCAG AA contrast for light + dark palettes"
```

---

## Task 12: Implement `businesslogic-light.ts`

**Files:**
- Create: `services/cms/extensions/local/project-extension-theme/src/businesslogic-light.ts`

- [ ] **Step 1: Write theme module**

```typescript
import { defineTheme } from '@directus/extensions-sdk';
import { tokens } from './tokens.js';

const t = tokens.light;

// Custom CSS delivered via rules.custom — covers tokens that have no direct rules.* target.
const custom = `
:root {
  --bl-space-1: ${t.space['1']};
  --bl-space-2: ${t.space['2']};
  --bl-space-3: ${t.space['3']};
  --bl-space-4: ${t.space['4']};
  --bl-space-6: ${t.space['6']};
  --bl-space-8: ${t.space['8']};
  --bl-space-12: ${t.space['12']};
  --bl-space-16: ${t.space['16']};

  --bl-radius-sm: ${t.radius.sm};
  --bl-radius-md: ${t.radius.md};
  --bl-radius-lg: ${t.radius.lg};
  --bl-radius-full: ${t.radius.full};

  --bl-shadow-sm: ${t.shadow.sm};
  --bl-shadow-md: ${t.shadow.md};
  --bl-shadow-lg: ${t.shadow.lg};

  --bl-fs-xs: ${t.typography.scale.xs};
  --bl-fs-sm: ${t.typography.scale.sm};
  --bl-fs-base: ${t.typography.scale.base};
  --bl-fs-lg: ${t.typography.scale.lg};
  --bl-fs-xl: ${t.typography.scale.xl};
  --bl-fs-2xl: ${t.typography.scale['2xl']};
  --bl-fs-3xl: ${t.typography.scale['3xl']};
  --bl-fs-4xl: ${t.typography.scale['4xl']};

  --bl-fw-medium: ${t.typography.weight.medium};
  --bl-fw-semibold: ${t.typography.weight.semibold};
  --bl-fw-bold: ${t.typography.weight.bold};

  --bl-lh-tight: ${t.typography.lineHeight.tight};
  --bl-lh-normal: ${t.typography.lineHeight.normal};
  --bl-lh-relaxed: ${t.typography.lineHeight.relaxed};
}
`.trim();

export default defineTheme({
  id: 'businesslogic-light',
  name: 'BusinessLogic Light',
  appearance: 'light',
  rules: {
    background: t.color.background,
    foreground: t.color.text,
    foregrounds: {
      normal: t.color.text,
      subdued: t.color.textMuted,
    },
    primary: t.color.primary,
    primaryAccent: t.color.primaryHover,
    primaryForeground: t.color.primaryForeground,
    secondary: t.color.accent,
    borderColor: t.color.border,
    borderColorAccent: t.color.borderStrong,
    borderRadius: t.radius.md,
    fontFamily: t.typography.fontFamily.sans,
    fontFamilyMonospace: t.typography.fontFamily.mono,
    fontWeight: String(t.typography.weight.regular),
    success: t.color.success,
    warning: t.color.warning,
    danger: t.color.danger,
    navigation: {
      background: t.color.surface,
      modules: { background: t.color.surfaceMuted },
    },
    sidebar: {
      background: t.color.surface,
    },
    custom,
  },
});
```

**Schema caveat:** The `rules` tree above uses best-effort names for Directus 11.16. If `npm run build` or runtime throws "unknown rules key X", look up the current Directus theme schema (source: `node_modules/@directus/types` or `directus/extensions` docs), remove/rename the offending key, and mirror the fix in `businesslogic-dark.ts` and `mapping.ts`. Tests in Task 10 check coverage only, not Directus schema validity — that's what the build and runtime do.

- [ ] **Step 2: Build**

```bash
cd services/cms/extensions/local/project-extension-theme
npm run build
```

Expected: `dist/index.js` created. If the build fails due to unknown `defineTheme` export, check `@directus/extensions-sdk` exports — may be `createTheme` or plain default export instead. Adjust and retry.

- [ ] **Step 3: Commit**

```bash
git add src/businesslogic-light.ts
git commit -m "feat(ext-theme): implement BusinessLogic Light theme"
```

---

## Task 13: Implement `businesslogic-dark.ts`

**Files:**
- Create: `services/cms/extensions/local/project-extension-theme/src/businesslogic-dark.ts`

- [ ] **Step 1: Write theme module**

Copy the full contents of `src/businesslogic-light.ts`, then change these three places:
- `const t = tokens.light;` → `const t = tokens.dark;`
- `id: 'businesslogic-light'` → `id: 'businesslogic-dark'`
- `name: 'BusinessLogic Light'` → `name: 'BusinessLogic Dark'`
- `appearance: 'light'` → `appearance: 'dark'`

Everything else is identical — same `rules` shape, same `custom` CSS template, same keys.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: `dist/index.js` includes both themes. If errors, resolve as in Task 12 Step 2.

- [ ] **Step 3: Commit**

```bash
git add src/businesslogic-dark.ts
git commit -m "feat(ext-theme): implement BusinessLogic Dark theme"
```

---

## Task 14: Wire `src/index.ts` bundle entry

**Files:**
- Create: `services/cms/extensions/local/project-extension-theme/src/index.ts`

Directus bundles typically auto-discover entries from `package.json.directus:extension.entries`. `src/index.ts` is still required as a safe explicit aggregator.

- [ ] **Step 1: Write `src/index.ts`**

```typescript
export { default as businessLogicLight } from './businesslogic-light.js';
export { default as businessLogicDark } from './businesslogic-dark.js';
```

- [ ] **Step 2: Full build**

```bash
cd services/cms/extensions/local/project-extension-theme
npm run prebuild && npm run build
```

Expected: clean build, `dist/index.js` exists. Run `npm test` — all tests still green.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(ext-theme): add bundle entry aggregator"
```

---

## Task 15: Add `ext-theme` Makefile target and update CLAUDE.md

**Files:**
- Modify: `Makefile` — add `ext-theme:` target after `ext-usage-consumer:` (line ~218)
- Modify: `CLAUDE.md` — add `project-extension-theme` to extension table

- [ ] **Step 1: Add Makefile target**

Open `Makefile`, find the block ending with:

```make
ext-usage-consumer:
	@cd $(CMS_EXT)/project-extension-usage-consumer && npx directus-extension build
```

Append after it:

```make
ext-theme:
	@cd $(CMS_EXT)/project-extension-theme && npm run prebuild && npx directus-extension build
```

Note the `npm run prebuild &&` — required so `src/tokens.ts` exists before the Directus build.

- [ ] **Step 2: Update CLAUDE.md**

Find the CMS extensions table (line around "## CMS Extensions" heading). Add a new row:

| Extension | Type | Backend |
|-----------|------|---------|
| project-extension-theme | Theme bundle | BusinessLogic Light + Dark themes for `/admin/settings/appearance` |

Also find the "All extensions:" line in the "CMS Extension Building" section and append `ext-theme`:

```
# All extensions: ext-ai-api, ext-ai-assistant, ..., ext-usage-consumer, ext-theme
```

- [ ] **Step 3: Verify make target runs**

```bash
make ext-theme
```

Expected output: build succeeds silently or with Directus SDK's normal output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add Makefile CLAUDE.md
git commit -m "chore(build): add ext-theme make target + docs"
```

---

## Task 16: End-to-end smoke test in browser

**Files:** (no code changes — manual QA + screenshot evidence)
- Create: `designguide/images/previews/directus-admin-light.png`
- Create: `designguide/images/previews/directus-admin-dark.png`

- [ ] **Step 1: Rebuild and restart CMS**

```bash
make ext-theme
make cms-restart
```

Wait for `make cms-logs` to show `Server started at ...`.

- [ ] **Step 2: Open Appearance settings via Chrome DevTools MCP**

```
mcp__chrome-devtools__new_page { url: "http://localhost:18055/admin/login" }
```

Log in as admin (credentials from `services/cms/.env`). Then:

```
mcp__chrome-devtools__navigate_page { url: "http://localhost:18055/admin/settings/appearance" }
mcp__chrome-devtools__wait_for { text: "Appearance" }
```

- [ ] **Step 3: Verify themes appear in the Theme dropdown**

```
mcp__chrome-devtools__take_snapshot  // DOM snapshot
```

Look for `BusinessLogic Light` and `BusinessLogic Dark` in the theme options list. If they're missing, check `make cms-logs` for extension-load errors; common causes:
- `src/tokens.ts` not generated (re-run prebuild)
- Unknown `rules.*` key (check logs for Directus validation error; remove key from both theme files + `mapping.ts`)
- `directus:extension.type` or `entries` schema wrong (see Task 8 caveat)

- [ ] **Step 4: Switch to BusinessLogic Light, screenshot**

Select "BusinessLogic Light" from Theme Light dropdown. Save:

```
mcp__chrome-devtools__take_screenshot {
  format: "png", fullPage: true,
  filePath: "designguide/images/previews/directus-admin-light.png"
}
```

Navigate to a content collection (e.g. `/admin/content/account`) and screenshot again to verify theme applies beyond settings:

```
mcp__chrome-devtools__navigate_page { url: "http://localhost:18055/admin/content/account" }
mcp__chrome-devtools__take_screenshot { filePath: "designguide/images/previews/directus-admin-light-content.png" }
```

- [ ] **Step 5: Switch to BusinessLogic Dark, screenshot**

Same as Step 4 but select Dark variant and save to `directus-admin-dark.png` + `directus-admin-dark-content.png`.

- [ ] **Step 6: Visual sanity check against `designguide/index.html`**

Open `designguide/index.html` in a second tab. Compare side-by-side with the Directus admin screenshots. Primary checks:
- Primary button in admin matches `btn-primary` in preview (same color, radius)
- Nav/sidebar background matches `color.surface`
- Body background matches `color.background`
- Text color matches `color.text`

If drift exists, it's usually a mis-mapped `rules.*` key — fix and re-run.

- [ ] **Step 7: Commit**

```bash
git add designguide/images/previews/directus-admin-*.png
git commit -m "docs(designguide): add Directus admin preview screenshots"
```

---

## Task 17: Final verification & success criteria

- [ ] **Step 1: Run full test suite for the extension**

```bash
cd services/cms/extensions/local/project-extension-theme
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Verify success criteria from spec**

1. `designguide/` exists, committed — `ls designguide/` lists all files.
2. `make ext-theme` completes without errors — run it.
3. `/admin/settings/appearance` exposes both themes — confirmed in Task 16.
4. Selecting either theme applies tokens across admin UI — confirmed in Task 16.
5. `tokens-map.test.ts` passes — confirmed in Step 1.
6. `tokens.raw.json` is present with ISO timestamp — `jq '.extractedAt' designguide/tokens.raw.json`.

- [ ] **Step 3: Run repo-wide tests to confirm no regressions**

```bash
./scripts/test-all.sh --quick
```

Expected: no new failures. Only the new extension's tests should appear in added output.

- [ ] **Step 4: Summary commit (if any documentation drift)**

If the test run surfaces anything documentation needs (e.g. `CLAUDE.md` row not rendered correctly), fix and commit:

```bash
git add -A
git commit -m "docs: post-implementation polish"
```

Otherwise, no action — all prior commits stand.

---

## Self-Review Notes

Coverage check against spec (`docs/superpowers/specs/2026-04-22-...design.md`):

- Goal: extract identity + package as Directus theme → Tasks 2–6, 8–15
- Deliverable 1 `designguide/` structure → Tasks 1, 2, 3, 4, 5, 6, 7
- Deliverable 2 extension structure → Tasks 8, 9, 10, 11, 12, 13, 14
- Extraction workflow (9 steps in spec) → Task 2 (steps 1–5), Task 3 (brand assets), Task 5 (dark derivation + contrast), Task 7 (inspiration.md)
- Token → Directus mapping strategy → Task 10 (`mapping.ts`), Tasks 12–13 (actual rules)
- Testing (`tokens-map.test.ts` + visual sanity) → Tasks 10, 11, 16
- Success criteria (6 items) → Task 17
- Makefile `ext-theme` target → Task 15
- CLAUDE.md update → Task 15

No placeholders found. `<hex>`, `<stack>`, `<ratio>` in doc templates are intentional — they're explicit fill-in markers with exact source instructions ("fill from tokens.json"), not "TODO" or "fill in later." The `"..."` inside the Step-2 JSON template in Task 4 is inside a quoted placeholder value that gets replaced in Task 5; flagged explicitly ("No `...` in the final file — the `"dark"` placeholder is the only exception").

Type/signature consistency: `TOKEN_TO_RULES` defined in Task 10, referenced consistently in Tasks 12, 13, 16. `tokens.light.color.primary` shape is set in Task 4, used consistently through Task 13. `src/tokens.ts` generation path is consistent between Task 9 (writing script) and Tasks 10–13 (importing).
