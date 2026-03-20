# 18. Calculator Integration Tabs — Claude Skill & Cowork Plugin

**Status:** planned
**Phase:** 1 — builds on existing MCP UI
**Depends on:** Formula API skill/plugin endpoints (already shipped)

---

## Goal

Add two new tabs to the calculator integration page: **Claude Skill** and **Cowork Plugin**. Both generate downloadable integration packages from existing MCP config.

---

## Current State

- `integration.vue` has `API | MCP` tabs via `integrationTab` ref
- MCP config stored in `calculator_configs.mcp` (enable, toolName, toolDescription, responseTemplate)
- Formula API now has:
  - `GET /calculator/:id/skill` — returns `{skillMd, installInstructions}`
  - `GET /calculator/:id/plugin` — returns `{pluginName, files, installInstructions}`
  - Both require MCP enabled + `integration.skill` / `integration.plugin` flags
  - `integration` object on POST/PATCH: `{skill: bool, plugin: bool}`

---

## Changes

### 1. Extend tab type in `integration.vue`

```ts
// Before
const integrationTab = ref<'api' | 'mcp'>('api');
// After
const integrationTab = ref<'api' | 'mcp' | 'skill' | 'plugin'>('api');
```

Add tab buttons for "Claude Skill" and "Cowork Plugin".

### 2. Add `integration` field to calculator config

- Store `integration: {skill: bool, plugin: bool}` alongside `mcp` in `calculator_configs`
- Send on PATCH to Formula API when toggled
- Show enable toggle on each new tab (same pattern as MCP enable)

### 3. New component: `skill-tab.vue`

- Shows "Enable MCP first" message if MCP disabled
- Enable toggle → PATCHes `integration.skill` to Formula API
- When enabled, fetches `GET /calculator/:id/skill`
- Renders SKILL.md preview in a code block
- Copy button for SKILL.md content
- Download button → zips `SKILL.md` into `{toolName}-skill.zip` (JSZip client-side)
- Shows install instructions from API response

### 4. New component: `plugin-tab.vue`

- Shows "Enable MCP first" message if MCP disabled
- Enable toggle → PATCHes `integration.plugin` to Formula API
- When enabled, fetches `GET /calculator/:id/plugin`
- Renders file previews: `plugin.json` and `.mcp.json` in code blocks
- Copy buttons per file
- Download button → zips all files into `{pluginName}-plugin.zip` (JSZip, preserving directory structure)
- Shows install instructions from API response

### 5. JSZip dependency

```bash
cd extensions/local/project-extension-calculators
npm install jszip
```

Shared helper:

```ts
// utils/download-zip.ts
import JSZip from 'jszip';

export async function downloadZip(filename: string, files: Record<string, string | object>) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

---

## Files to create/modify

| File | Action |
|---|---|
| `src/routes/integration.vue` | MODIFY — add tab buttons, conditional rendering |
| `src/components/skill-tab.vue` | CREATE — skill preview + download |
| `src/components/plugin-tab.vue` | CREATE — plugin preview + download |
| `src/utils/download-zip.ts` | CREATE — shared JSZip download helper |
| `src/types.ts` | MODIFY — add `integration` to config type |

---

## UI Layout

```
[ API ] [ MCP ] [ Claude Skill ] [ Cowork Plugin ]

┌──────────────────────────────────────────┐
│ ☐ Enable Claude Skill integration        │
│                                          │
│ ┌── SKILL.md preview ─────────────────┐  │
│ │ ---                                 │  │
│ │ name: price_calculator              │  │
│ │ description: Calculate total...     │  │
│ │ ---                                 │  │
│ │ ...                                 │  │
│ └─────────────────────────────────────┘  │
│                                          │
│ [Copy SKILL.md]  [Download .zip]         │
│                                          │
│ Installation:                            │
│   mkdir -p .claude/skills/price_calc...  │
└──────────────────────────────────────────┘
```

---

## Acceptance Criteria

- [ ] Tab bar shows all 4 tabs: API, MCP, Claude Skill, Cowork Plugin
- [ ] Skill/Plugin tabs show "Enable MCP first" when MCP disabled
- [ ] Enable toggle PATCHes `integration.skill` / `integration.plugin`
- [ ] Generated content fetched from Formula API and displayed
- [ ] Copy + Download buttons work
- [ ] Download produces valid zip with correct file structure
- [ ] Works in both test and live environments
