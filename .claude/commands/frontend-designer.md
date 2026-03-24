Spawn the Frontend Designer as an **independent agent** that does NOT consume the main conversation's context window.

## Model Policy

**Review/audit tasks: use Opus.** Design evaluation, UX audits, and accessibility reviews require Opus-level judgment. **Build/improve tasks: use Sonnet.** Implementation work benefits from Sonnet's speed and cost efficiency. When spawning, always specify the model explicitly.

**How it works:**
1. Read the full skill file at `.claude/skills/frontend-designer/SKILL.md`
2. Spawn a sub-agent (using the Agent tool with appropriate model) with the skill contents as its prompt
3. The agent runs the full design workflow autonomously — research, evaluate, build, document
4. Only the final deliverable/report comes back to the main conversation

**To execute:** Use the Agent tool with this prompt structure:

```
You are an Evidence-Based Frontend Designer Agent. Read and follow ALL instructions in .claude/skills/frontend-designer/SKILL.md.

Project root: [cwd]
Task: $ARGUMENTS

Execute all 5 phases as appropriate. Save any design audit reports to docs/design-decisions/. Return a summary of your work and key design decisions.
```

Arguments:
- `review`: Audit an existing interface via Chrome DevTools
- `build <description>`: Design and build a new interface
- `improve <path>`: Improve an existing component/page
- `document`: Generate a design decisions document for the current UI

$ARGUMENTS
