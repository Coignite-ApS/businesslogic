# UX Testing Framework

## Overview

Persona-based UX testing for BusinessLogic. Simulates real users discovering and using the platform through Chrome DevTools.

## Structure

```
docs/ux-testing/
├── README.md                    # This file — framework & rubrics
├── personas/                    # User personas (profiles, goals, style)
│   ├── sarah.md                 # SaaS founder, default persona
│   ├── marcus.md                # Enterprise finance analyst
│   ├── anna.md                  # Freelance consultant
│   └── raj.md                   # Tech startup CTO
├── flows/                       # Test flows (phase sequences)
│   ├── first-login.md           # Initial login + orientation
│   ├── calculator-builder.md    # Build and test a calculator
│   ├── formula-testing.md       # Write and execute formulas
│   ├── ai-assistant.md          # AI chat interaction
│   ├── knowledge-base.md        # KB upload, search, ask
│   ├── api-integration.md       # API keys, code snippets, widget
│   └── admin-dashboard.md       # Admin analytics overview
├── credentials/users/           # Saved test credentials per persona
└── experience/users/            # Session history notes per persona
```

## Scoring Rubric

### 1-5 Scale

| Score | Meaning | User Reaction |
|-------|---------|---------------|
| 1 | Broken / Unusable | "This doesn't work" — leaves immediately |
| 2 | Frustrating | "This is painful" — unlikely to return |
| 3 | Functional | "It works but..." — might tolerate if no alternative |
| 4 | Good | "This is nice" — would recommend with caveats |
| 5 | Excellent | "Love this" — would recommend enthusiastically |

### UI/UX Categories

| Category | 1 | 3 | 5 |
|----------|---|---|---|
| First Impression | Confusing, no guidance | Clear but generic | Immediately understand value prop |
| Authentication | Errors, slow, confusing | Works, minor friction | Seamless, fast, helpful errors |
| Navigation | Can't find things | Find with effort | Intuitive, discoverable |
| Visual Design | Inconsistent, cluttered | Clean but generic | Polished, cohesive, professional |
| Data Entry | Forms break, no validation | Works, basic validation | Inline help, smart defaults, undo |
| Mobile | Broken layout | Usable but cramped | Full mobile experience |
| Error Handling | Crashes, no feedback | Generic error messages | Helpful, actionable error guidance |
| Performance | Slow (>3s), janky | Acceptable (<2s) | Instant (<500ms), smooth |

### Platform Intelligence Criteria

| ID | Criterion | 1 | 3 | 5 |
|----|-----------|---|---|---|
| A | Calculator UX | Can't figure out how | Build with effort | Intuitive builder, instant preview |
| B | Formula Clarity | Cryptic errors | Results shown, basic errors | Clear results, helpful error suggestions |
| C | AI Assistant | Irrelevant, generic | Somewhat helpful | Context-aware, actionable, remembers history |
| D | Knowledge Base | Can't upload or search | Upload works, search basic | Easy ingest, smart search, cite sources |
| E | Flow Builder | Impossible without docs | Can build simple flows | Visual, intuitive, auto-suggestions |
| F | API Integration | Snippets broken | Snippets work, need editing | Copy-paste-run, all languages, tested |
| G | Admin Insights | No useful data | Basic stats | Actionable metrics, trends, alerts |
| H | Cross-Feature Coherence | Feels like separate tools | Some integration | Seamless platform experience |
| I | Error Recovery | Stuck, must reload | Can recover with effort | Graceful, guided recovery |

## Screenshot Conventions

- Save to `docs/reports/screenshots/ux-test-[DATE]/`
- Naming: `[flow]-[phase]-[description].png`
- Examples: `first-login-dashboard-overview.png`, `calculator-builder-formula-error.png`
- Take before AND after for significant interactions

## Running Tests

```bash
# Via skill invocation
/ux-tester                              # Default: sarah + first-login
/ux-tester sarah calculator-builder     # Specific persona + flow
/ux-tester marcus first-login+ai-assistant  # Chained flows

# The skill spawns an independent Opus sub-agent
# Report saved to docs/reports/ux-test-YYYY-MM-DD.md
```
