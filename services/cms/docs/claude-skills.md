# Claude Code Skills & Commands

Custom skills and commands for this project, usable from Claude Code CLI.

## Directory Structure

```
.claude/
├── commands/              # Slash commands (prompt templates)
│   └── test-onboarding.md
├── skills/                # Skills (autonomous tools with validation)
│   └── create-calculator-template/
│       └── SKILL.md
└── settings.local.json
```

**Commands** (`.claude/commands/`) — prompt templates invoked with `/command-name`. Claude follows the instructions but has no special tool restrictions.

**Skills** (`.claude/skills/<name>/SKILL.md`) — autonomous tools with YAML frontmatter controlling allowed tools, execution mode, etc. Invoked with `/skill-name <arguments>`.

## Available Skills

### `/create-calculator-template`

Generate a validated calculator template JSON for import into the `calculator_templates` Directus collection.

**Usage:**
```
/create-calculator-template a staffing cost calculator for recruitment agencies
/create-calculator-template SaaS churn impact calculator with MRR and customer count
/create-calculator-template warehouse storage cost estimator with pallets and square footage
```

**What it does:**
1. Takes a natural-language description of the desired calculator
2. Generates a JSON file at `extensions/local/project-extension-calculators/scripts/templates/<slug>.json`
3. Validates the file using `validate-template.ts` (same rules as the UI)
4. Reports validation results; fixes and re-validates if needed

**Template structure:**
- 3 sheets: Parameters (inputs), Calculations (formulas), Data (reference)
- 4-7 input params with sensible defaults
- 3-5 output params mapped to formula cells
- Excel-style formulas with division guards

**Import the result:**
- **UI:** Content → calculator_templates → "+" → paste JSON fields
- **API:** `curl -X POST http://localhost:8056/items/calculator_templates -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d @templates/<slug>.json`
- **SQL:** Use `generate-templates.ts` pattern to wrap in INSERT

**Validation script** (`scripts/validate-template.ts`):
```bash
cd extensions/local/project-extension-calculators/scripts
npx tsx validate-template.ts templates/<slug>.json
```

Checks:
- Required top-level fields (name, description, icon, industry, featured, sort)
- 3 required sheets with header + data rows
- Formula cell refs exist in sheets, start with `=`
- Input mappings → Parameters sheet, output mappings → Calculations sheet
- No duplicate mappings
- Valid types, percentage rules, range constraints
- Array output sub-item completeness
- Cross-validation of formula rows vs sheet size

## Available Commands

### `/test-onboarding`

Chrome DevTools MCP test script for the calculator onboarding flow. Walks through creating a calculator, filling fields, uploading Excel, and verifying UI states.

## Creating New Skills

1. Create `.claude/skills/<skill-name>/SKILL.md`
2. Add YAML frontmatter:

```yaml
---
name: skill-name
description: What it does (used for auto-invocation matching)
allowed-tools: Read, Write, Bash, Glob, Grep
---
```

3. Write the prompt body. Use `$ARGUMENTS` for user input.
4. Document it in this file.

### Frontmatter Options

| Field | Purpose |
|-------|---------|
| `name` | Skill identifier, matches `/name` invocation |
| `description` | Natural language — Claude auto-invokes when it matches user intent |
| `allowed-tools` | Comma-separated tool list to reduce permission prompts |
| `disable-model-invocation` | `true` = manual `/name` only, no auto-trigger |
| `user-invocable` | `false` = background context only, not callable |
| `context` | `fork` = run in isolated subagent (prevents context bloat) |
| `agent` | `Explore` = read-only subagent for research tasks |

### Creating New Commands

1. Create `.claude/commands/<command-name>.md`
2. Write plain markdown instructions (no frontmatter needed)
3. Invoke with `/command-name`
