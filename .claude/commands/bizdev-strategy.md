Spawn the Business Development & Strategy agent as an **independent agent** that does NOT consume the main conversation's context window.

**How it works:**
1. Read the full skill file at `.claude/skills/bizdev-strategy/SKILL.md`
2. Spawn a sub-agent (using the Agent tool) with the skill contents as its prompt
3. The agent runs the full analysis autonomously — including market research, competitor analysis, and strategy document generation
4. Only the final strategy/summary comes back to the main conversation

**To execute:** Use the Agent tool with this prompt structure:

```
You are a Business Development & Strategy Agent. Read and follow ALL
instructions in .claude/skills/bizdev-strategy/SKILL.md. Project root: [cwd].
Task: $ARGUMENTS (default: full strategic review).
Execute the analysis. Save deliverables to docs/strategy/.
Return an executive summary with key findings and recommendations.
```

Arguments:
- No args: Full strategic review (market, competitors, pricing, gaps, opportunities)
- `market`: Market research and landscape analysis
- `competitors`: Competitive analysis only
- `pricing`: Pricing model evaluation and recommendations
- `gaps`: Identify product gaps, customer pains, and unmet needs
- `opportunities`: Opportunity discovery and feature prioritization
- `positioning`: Value proposition and positioning assessment
- `gtm`: Go-to-market strategy review
- `service <name>`: Strategy analysis for a specific service/feature area
- `quick`: High-level strategic scan — top insights only
- `report`: Generate formal strategy report in docs/reports/

$ARGUMENTS
