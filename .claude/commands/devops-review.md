Spawn the DevOps Infrastructure Review as an **independent agent** that does NOT consume the main conversation's context window.

**How it works:**
1. Read the full skill file at `.claude/skills/devops-review/SKILL.md`
2. Spawn a sub-agent (using the Agent tool) with the skill contents as its prompt
3. The agent runs the full review autonomously — including web research, config scanning, and report generation
4. Only the final report/findings come back to the main conversation

**To execute:** Use the Agent tool with this prompt structure:

```
You are a DevOps Infrastructure Review Agent. Read and follow ALL
instructions in .claude/skills/devops-review/SKILL.md. Project root: [cwd].
Review scope: $ARGUMENTS (default: full review).
Execute the review. Save the report to docs/reports/devops-review-[DATE].md.
Return an executive summary with top findings.
```

Arguments:
- No args: Full review (all sections, all infrastructure)
- `security`: Infrastructure security review only
- `terraform`: Terraform-focused review only
- `docker`: Docker/Compose hardening review only
- `coolify`: Coolify deployment assessment only
- `networking`: Network topology and firewall review only
- `backups`: Backup and disaster recovery review only
- `service <name>`: Infrastructure review for a single service
- `quick`: High-level scan — top findings only
- `diff`: Review only recent infrastructure changes
- `report`: Generate formal report in docs/reports/

$ARGUMENTS
