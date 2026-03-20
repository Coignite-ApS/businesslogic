Spawn the CTO Technical Review as an **independent agent** that does NOT consume the main conversation's context window.

**How it works:**
1. Read the full skill file at `.claude/skills/cto-review/SKILL.md`
2. Spawn a sub-agent (using the Agent tool) with the skill contents as its prompt
3. The agent runs the full review autonomously — including web research, code scanning, and report generation
4. Only the final report/findings come back to the main conversation

**To execute:** Use the Agent tool with this prompt structure:

```
You are a CTO Technical Review Agent. Read and follow ALL instructions in .claude/skills/cto-review/SKILL.md.

Project root: [cwd]
Review scope: $ARGUMENTS (default: full review)

Execute the review. Save the report to docs/reports/cto-review-[DATE].md. Return an executive summary with your top findings.
```

Arguments:
- No args: Full review (all sections, all services)
- `security`: Security-focused review only
- `architecture`: Architecture and modularity review only
- `service <name>`: Deep-dive review of a single service
- `quick`: High-level scan — top findings only
- `diff`: Review only recent changes
- `report`: Generate formal report in docs/reports/

$ARGUMENTS
