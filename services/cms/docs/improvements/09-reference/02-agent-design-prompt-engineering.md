# Agent Design & Prompt Engineering

## 1. Agent Overview

The system comprises five specialized agents, each with a single responsibility, a dedicated system prompt, and a well-defined input/output contract. Agents are not autonomous — they are orchestrated by the worker process in a deterministic pipeline. Each agent is a Claude API call with a specific system prompt configuration.

All agents share a common prompt architecture: a static system prompt (cached) containing schema definitions and reference material, followed by dynamic user content (not cached) containing the specific job data. This split maximizes prompt cache hit rates and minimizes per-call costs.

---

## 2. Research Agent

### 2.1 Purpose

Gathers domain context and best practices before the Calculator Builder begins work. This agent bridges the gap between the user's intent and the Calculator Builder's ability to produce correct domain logic.

### 2.2 When It Runs

| Scenario | Trigger | max_uses (web search) |
|---|---|---|
| No Excel provided | Always | 8 |
| Excel provided, unfamiliar domain | Domain flags in complexity analysis | 5 |
| Excel provided, common domain | Skip research, template lookup only | 0 |

### 2.3 Model Selection

Always Sonnet 4.6. Research requires good reasoning for synthesizing search results but does not require Opus-level depth. Web search is enabled via the tool definition.

### 2.4 System Prompt Structure

The Research Agent system prompt has three sections:

- **Role definition:** You are a research specialist for calculator design. Your job is to produce a structured research brief that a Calculator Builder agent will use to create a JSON-based calculator API.
- **Output schema:** The exact JSON structure the research brief must follow — `standard_inputs[]`, `standard_outputs[]`, `formulas[]`, `edge_cases[]`, `ux_conventions[]`.
- **Research guidelines:** Prioritize authoritative sources (government calculators, financial institution documentation, academic references). Avoid generic blog posts. Focus on calculation methodology, not UI design.

### 2.5 Output Format

```json
{
  "research_brief": {
    "domain": "mortgage_amortization",
    "standard_inputs": [
      {
        "name": "principal",
        "type": "number",
        "typical_range": [10000, 5000000],
        "description": "Loan amount in currency units"
      }
    ],
    "standard_outputs": [
      {
        "name": "monthly_payment",
        "formula_reference": "PMT function",
        "description": "Fixed monthly payment amount"
      }
    ],
    "formulas": [
      {
        "name": "PMT",
        "expression": "P * r(1+r)^n / ((1+r)^n - 1)",
        "variables": { "P": "principal", "r": "monthly_rate", "n": "total_periods" }
      }
    ],
    "edge_cases": ["ARM vs fixed rate", "PMI threshold at 80% LTV"],
    "ux_conventions": ["Slider for loan term", "Currency formatting"],
    "sources": [{ "url": "...", "title": "...", "relevance": "..." }]
  }
}
```

---

## 3. Calculator Builder Agent

### 3.1 Purpose

The core agent. Transforms Excel JSON (or user prompt + research brief) into the complete API JSON definition: input schemas, output schemas, and HyperFormula definitions. This is the hardest agent task and the one most likely to require Opus.

### 3.2 Two-Phase Execution

This agent always runs in two phases to catch misunderstandings before they propagate.

#### Phase 1: Analysis

The agent examines the input and produces a structured understanding of the calculator — not the final output. It identifies inputs, outputs, formulas, dependencies, and ambiguities. For each element, it provides a confidence score (0–1.0). Any element below 0.7 confidence generates a clarifying question.

**Analysis output includes:** `identified_inputs[]`, `identified_outputs[]`, `formula_mappings[]`, `dependencies[]`, `ambiguities[]`, `clarifying_questions[]`, `overall_confidence`.

#### Phase 2: Generation

Only after the user confirms the analysis (or answers questions) does the agent produce the actual API JSON. The generation prompt includes the confirmed analysis and any user answers, providing strong guardrails for correct output.

### 3.3 Model Selection

Model is selected based on the complexity score from the Architecture document. Tier 1 uses Haiku 4.5, Tier 2 uses Sonnet 4.6, Tier 3 uses Opus 4.6. Escalation follows the chain described in the Architecture document.

### 3.4 System Prompt Structure (Cached)

The static system prompt for this agent is the largest and most critical. It contains four mandatory sections, all marked with `cache_control` for prompt caching:

1. **Role and task definition (~500 tokens):** Defines the agent as a calculator architect that transforms Excel structures into HyperFormula-compatible JSON APIs. Specifies the two-phase protocol.

2. **Complete API JSON schema (~2,000–4,000 tokens):** The exact JSON schema for input definitions, output definitions, and HyperFormula formula mappings. This is your canonical schema — the single source of truth.

3. **HyperFormula function reference (~3,000–5,000 tokens):** The subset of HyperFormula functions your system supports, with syntax, parameters, and Excel equivalents. The agent must only use functions from this list.

4. **Few-shot examples (~3,000–8,000 tokens):** 3–5 gold-standard examples of input Excel JSON → output API JSON transformations. These examples should span your complexity tiers and cover common patterns (basic arithmetic, lookups, conditionals). Examples are dynamically selected from the approved template library based on similarity to the current job.

### 3.5 Dynamic Prompt Content (Not Cached)

The user message contains the job-specific data:

- The parsed Excel JSON (cell values, formulas, named ranges, sheet structure).
- Research brief from the Research Agent (if available).
- Template examples selected from the approved library (2–3 most similar).
- User's original prompt or description (if provided alongside Excel).
- For Phase 2: the confirmed analysis and clarifying question answers.
- For retries: previous attempt output, user feedback, and failure category.

### 3.6 Clarifying Questions Design

Questions must be specific, actionable, and reference the exact Excel context. The system prompt includes explicit instructions on question quality:

**Bad question:** "Can you tell me more about this calculator?"

**Good question:** "Cell B15 uses VLOOKUP against the table in Sheet2!A1:D20. The lookup values appear to be product category codes (e.g., 'CAT-A', 'CAT-B'). Should these categories be presented as a dropdown input for the end user, or are they fixed internal reference values?"

Each question includes: the specific cell/range in question, what the agent thinks it means (its interpretation), what alternatives exist, and how the answer will affect the output.

---

## 4. Display Agent

### 4.1 Purpose

Transforms the validated API JSON into a Display JSON that specifies how the calculator will be rendered as an online calculator. This includes layout, input field types, grouping, labels, formatting rules, and responsive behavior.

### 4.2 Model Selection

Always Haiku 4.5 regardless of calculator complexity. This agent performs a well-constrained transformation from structured JSON to structured JSON. The mapping from "these are the inputs and outputs" to "here's how to lay them out" is mechanical enough for the smallest model.

### 4.3 System Prompt Structure

The system prompt contains: the Display JSON schema definition, 3–5 examples of API JSON → Display JSON transformations, and layout heuristics (e.g., group related inputs, place primary output prominently, use appropriate input controls based on data type).

### 4.4 Input

The complete API JSON produced by the Calculator Builder. No Excel data is passed to this agent — it works entirely from the structured API definition.

---

## 5. MCP Documentation Agent

### 5.1 Purpose

Generates MCP (Model Context Protocol) server tool definitions for the calculator. These definitions allow Claude and other LLM agents to discover and invoke the calculator API as a tool.

### 5.2 Model Selection

Always Haiku 4.5. The transformation is schema-to-schema: API JSON input/output schemas map directly to MCP tool parameter definitions.

### 5.3 System Prompt Structure

The system prompt contains: MCP tool definition schema, your MCP server conventions (naming patterns, description standards, parameter documentation requirements), and 3–5 examples of API JSON → MCP tool definition transformations.

### 5.4 Output

A complete MCP tool definition including: tool name (derived from calculator name), description (human-readable explanation of what the calculator does), input_schema (JSON Schema for all calculator inputs), output description (what the tool returns), and example invocations.

---

## 6. Skill Agent

### 6.1 Purpose

Creates a Claude skill definition that encapsulates the calculator's API, common use cases, and execution instructions. This allows users to create highly specific Claude skills for their calculators.

### 6.2 Model Selection

Always Haiku 4.5. The skill definition follows a fixed template structure with well-defined sections.

### 6.3 System Prompt

Contains: your skill definition format/template, the MCP tool definition (from the MCP Doc Agent), API JSON for context, and 3–5 example skills. The skill must include: name, description, when to trigger, API endpoint details, input preparation instructions, output interpretation, and example dialogues.

---

## 7. Template Library & Few-Shot Selection

### 7.1 Template Sources

The few-shot examples injected into agent prompts come from two sources:

- **Seed examples:** Manually curated gold-standard calculator builds that ship with the system. These cover common calculator types (financial, unit conversion, health/fitness, business) and complexity tiers. Start with 5–10 seed examples.
- **Approved builds:** Every calculator that passes human review and enters production use becomes a candidate template. Only calculators with `is_approved = true` AND `usage_count > 0` are eligible — unused calculators may have been approved but not validated by real use.

### 7.2 Similarity Matching

Template selection does not require vector embeddings initially. Simple attribute matching on structured metadata is sufficient and more interpretable:

- **Domain tag overlap:** Calculators tagged with the same domain (e.g., "finance", "real_estate", "health") score highest.
- **Complexity tier proximity:** Same-tier templates are preferred over cross-tier ones.
- **Formula function overlap:** Templates using similar Excel functions (e.g., both use PMT, VLOOKUP) are more relevant.
- **Input/output count similarity:** A 3-input/2-output calculator is better referenced by a 4-input/3-output template than a 15-input/10-output one.

Compute a weighted similarity score, select the top 2–3 templates, and inject their complete input→output pairs into the Calculator Builder's system prompt as few-shot examples.

### 7.3 Graduating to Embeddings

Once the template library exceeds ~200 approved calculators, attribute matching may miss semantic similarities (e.g., a "BMI calculator" and an "obesity risk assessment" have different names but similar logic). At this point, embed calculator descriptions and use cosine similarity for initial retrieval, then re-rank with attribute matching. Use a lightweight embedding model (not Claude) for this — OpenAI's text-embedding-3-small or a locally-hosted model like BGE-M3.

---

## 8. Prompt Versioning & Management

Every system prompt is versioned. The prompt version (a git commit hash or semantic version) is stored on every `job_steps` record. This is critical for:

- **Reproducibility:** Understanding which prompt version produced a given output.
- **A/B testing:** Running two prompt versions side by side and comparing quality metrics.
- **Regression detection:** When a prompt change causes quality to drop, you can identify and revert it.
- **Training data quality:** Filtering training data by prompt version to ensure consistency.

Store prompts in a dedicated directory in your repository, with each agent's system prompt as a separate file. Use git history for versioning. The worker loads prompts at startup and caches the current version hash. When a prompt file changes, restart the worker to pick up the new version. Do not hot-reload prompts — the prompt cache in Claude's API is invalidated on content change anyway.
