# Data Schema & Self-Improvement

## 1. PostgreSQL Schema

The database schema serves dual purposes: operational state management for the running system, and structured training data collection for future model fine-tuning. Every field is chosen deliberately to support both goals. All tables use Directus-managed UUIDs as primary keys for consistency with the existing Directus data layer.

### 1.1 `jobs` Table

The core record for each calculator build request.

| Column | Type | Nullable | Purpose |
|---|---|---|---|
| id | UUID | NOT NULL, PK | Primary key |
| created_at | TIMESTAMPTZ | NOT NULL | Job creation time |
| updated_at | TIMESTAMPTZ | NOT NULL | Last status change |
| status | VARCHAR(20) | NOT NULL | pending\|analyzing\|waiting\|generating\|enriching\|review\|approved\|failed |
| input_type | VARCHAR(10) | NOT NULL | 'excel' or 'prompt' |
| input_data | JSONB | NOT NULL | Parsed Excel JSON or raw user prompt |
| user_prompt | TEXT | NULL | User's original description (even if Excel provided) |
| complexity | JSONB | NULL | Complexity score breakdown (all factors + total) |
| complexity_tier | SMALLINT | NULL | 1, 2, or 3 — derived from complexity score |
| initial_model | VARCHAR(50) | NULL | First model assigned based on tier |
| research_brief | JSONB | NULL | Research Agent output (if run) |
| template_refs | UUID[] | NULL | IDs of template calculators used as few-shot examples |
| total_cost_usd | DECIMAL(10,6) | NOT NULL DEFAULT 0 | Cumulative cost of all API calls for this job |
| total_attempts | SMALLINT | NOT NULL DEFAULT 1 | Total attempts including retries |
| created_by | UUID | NOT NULL, FK | Directus user who submitted the job |

### 1.2 `job_steps` Table

Every individual Claude API call. This is the most important table for training data and cost analysis.

| Column | Type | Nullable | Purpose |
|---|---|---|---|
| id | UUID | NOT NULL, PK | Primary key |
| job_id | UUID | NOT NULL, FK | Parent job |
| step_order | SMALLINT | NOT NULL | Execution order within the job |
| agent | VARCHAR(30) | NOT NULL | research\|calculator_builder\|display\|mcp\|skill |
| phase | VARCHAR(20) | NOT NULL | analysis\|generation\|single (for non-two-phase agents) |
| model_used | VARCHAR(60) | NOT NULL | Exact model version string |
| prompt_version | VARCHAR(40) | NOT NULL | Git hash or semver of the system prompt used |
| input_context | JSONB | NOT NULL | Complete dynamic content sent to the model |
| output | JSONB | NOT NULL | Model's full structured response |
| tokens_in | INTEGER | NOT NULL | Input tokens (non-cached) |
| tokens_out | INTEGER | NOT NULL | Output tokens |
| cache_read_tokens | INTEGER | NOT NULL DEFAULT 0 | Tokens read from cache |
| cache_write_tokens | INTEGER | NOT NULL DEFAULT 0 | Tokens written to cache |
| web_searches | SMALLINT | NOT NULL DEFAULT 0 | Number of web searches performed |
| cost_usd | DECIMAL(10,6) | NOT NULL | Computed cost of this step |
| duration_ms | INTEGER | NOT NULL | Wall clock time for this API call |
| attempt_number | SMALLINT | NOT NULL DEFAULT 1 | Which attempt this is (1 = first try) |
| created_at | TIMESTAMPTZ | NOT NULL | When this step executed |

### 1.3 `job_questions` Table

Clarifying questions asked by the Calculator Builder and user responses. This is high-value training data — it captures what the model found ambiguous and how humans resolved it.

| Column | Type | Nullable | Purpose |
|---|---|---|---|
| id | UUID | NOT NULL, PK | Primary key |
| job_id | UUID | NOT NULL, FK | Parent job |
| step_id | UUID | NOT NULL, FK | The analysis step that generated this question |
| question_order | SMALLINT | NOT NULL | Display order |
| question_text | TEXT | NOT NULL | The question asked |
| context | JSONB | NOT NULL | Relevant Excel snippet (cell range, formula) |
| suggested_options | TEXT[] | NULL | Pre-defined answer options if applicable |
| user_answer | TEXT | NULL | User's response (NULL until answered) |
| answered_at | TIMESTAMPTZ | NULL | When the user responded |

### 1.4 `job_feedback` Table

Structured feedback from users on agent outputs. This drives retry logic and provides labeled training data.

| Column | Type | Nullable | Purpose |
|---|---|---|---|
| id | UUID | NOT NULL, PK | Primary key |
| job_id | UUID | NOT NULL, FK | Parent job |
| step_id | UUID | NULL, FK | Specific step (NULL = whole job feedback) |
| rating | VARCHAR(10) | NOT NULL | 'thumbs_up' or 'thumbs_down' |
| failure_category | VARCHAR(30) | NULL | schema_wrong\|formula_wrong\|logic_wrong\|completely_off\|minor_fix |
| user_comment | TEXT | NULL | Free-text explanation of what's wrong |
| corrections | JSONB | NULL | JSON diff of user's manual corrections |
| created_at | TIMESTAMPTZ | NOT NULL | When feedback was submitted |

### 1.5 `job_outputs` Table

Final approved outputs. These are the production calculator definitions and the primary source for training data and template matching.

| Column | Type | Nullable | Purpose |
|---|---|---|---|
| id | UUID | NOT NULL, PK | Primary key |
| job_id | UUID | NOT NULL, FK, UNIQUE | One output set per job |
| api_json | JSONB | NOT NULL | Input/output schemas + HyperFormula definitions |
| display_json | JSONB | NOT NULL | Online calculator display/styling config |
| mcp_json | JSONB | NOT NULL | MCP server tool definitions |
| skill_json | JSONB | NOT NULL | Claude skill definition |
| is_approved | BOOLEAN | NOT NULL DEFAULT FALSE | Human approval flag |
| approved_by | UUID | NULL, FK | Directus user who approved |
| approved_at | TIMESTAMPTZ | NULL | Approval timestamp |
| domain_tags | TEXT[] | NULL | Domain classification tags for template matching |
| usage_count | INTEGER | NOT NULL DEFAULT 0 | How many times this calculator has been used |

---

## 2. Feedback & Self-Improvement Loop

### 2.1 Feedback Categories and Retry Strategies

| Category | Meaning | Retry Strategy |
|---|---|---|
| schema_wrong | Inputs/outputs incorrectly identified from Excel | Re-run analysis with explicit prompt to re-examine input/output cells |
| formula_wrong | HyperFormula definitions don't calculate correctly | Re-run generation with failing formula highlighted |
| logic_wrong | Structure is right but business logic is misinterpreted | Ask clarifying questions before retrying |
| completely_off | Fundamental misunderstanding of the calculator | Escalate to next model tier with full context |
| minor_fix | Close but needs small adjustments | Show editable JSON to user, store their diff as correction |

### 2.2 The Training Data Pipeline

Every approved calculator build produces a complete training record. The pipeline has four stages:

1. **Collection:** All data is captured automatically through the schema above. No additional instrumentation needed beyond what the worker already does for operational purposes.

2. **Filtering:** Only jobs where `is_approved = TRUE` and `usage_count > 0` are eligible for training. Jobs with excessive retries (>3 attempts) are reviewed manually before inclusion — they may contain edge cases that are valuable, or they may represent prompt failures.

3. **Formatting:** Training pairs are extracted as (input, output) tuples. For the Calculator Builder: input = (Excel JSON + research brief + template examples), output = (approved API JSON). For the Display Agent: input = (API JSON), output = (approved Display JSON). Each pair includes the complexity score as metadata for stratified sampling.

4. **Quality gate:** Before including any record in the training set, verify that the output JSON is schema-valid and that the HyperFormula definitions can be executed without errors. Automated validation catches data quality issues before they corrupt training.

### 2.3 Few-Shot Example Selection Loop

The self-improvement loop for prompt quality works as follows:

1. New job arrives. Worker queries `job_outputs` for approved calculators matching domain tags, complexity tier, and formula function overlap. Top 2–3 matches are selected.

2. Selected templates are injected into the Calculator Builder's system prompt as few-shot examples, replacing or augmenting the seed examples.

3. The `template_refs` field on the job record tracks which templates were used, enabling analysis of which examples lead to better outcomes.

4. Over time, the system learns which examples are most effective — track the correlation between `template_refs` and first-attempt approval rate. Promote effective examples, demote ineffective ones.

**Critically:** Only approved, human-reviewed builds with real usage enter the example pool. Bad examples poison future outputs. This gate is non-negotiable.

---

## 3. Path to Fine-Tuned Models

### 3.1 Phase 1: Data Collection (Months 0–3)

Run everything through Claude. Focus on building the approved calculator library to 200+ entries across complexity tiers. Track all metrics: first-attempt approval rate, retry rate by failure category, cost per job by tier, which template examples correlate with success.

**Target metrics:** 200+ approved builds, 150+ with `usage_count > 0`, coverage across 5+ domain tags.

### 3.2 Phase 2: Analysis (Months 3–6)

Analyze collected data to understand failure patterns:

- Which complexity profiles fail most? These are the areas where your prompts need improvement or where fine-tuning will add most value.
- Which formula types cause errors? Build targeted test cases for these.
- Which clarifying questions come up repeatedly? These represent systematic ambiguities in your Excel-to-JSON mapping that should be resolved in the schema or documentation.
- Do template examples actually help? Compare first-attempt success rates for jobs with 0, 1, 2, 3 template examples.

### 3.3 Phase 3: First Fine-Tune (Months 6–9)

Start with the most constrained agent — the Display Agent or MCP Doc Agent. These transform well-structured JSON input to well-structured JSON output with minimal reasoning required.

- Extract training pairs: (API JSON) → (Display JSON) from all approved builds.
- Fine-tune a 7B–70B parameter model (Llama, Mistral, or whatever is current).
- Benchmark against Claude Haiku on a held-out test set of 50 calculators.
- If accuracy is within 90% of Haiku, deploy for Display/MCP agents. Keep Claude as QA.

**Cost impact:** Display and MCP agents on Haiku cost ~$0.01–$0.02 per job. A locally-hosted model costs $0/call but requires a GPU server (~$150–$400/month on Hetzner GX). Break-even at ~15,000–40,000 jobs/month. Fine-tune for quality, not cost, at this stage.

### 3.4 Phase 4: Calculator Builder Fine-Tune (Months 9–12)

This is the hard one. The Calculator Builder requires genuine reasoning about Excel structures and business logic. Fine-tuning approaches:

- Start with Tier 1 only. Simple calculators have the most training data and the most predictable input→output mapping. Get this working before attempting Tier 2.
- Use a larger base model (70B+). The reasoning requirements are significant.
- Include the clarifying Q&A data in training. Train the model to recognize when it's uncertain and generate appropriate questions, not just final outputs.
- Hybrid deployment: Fine-tuned model handles Tier 1, Sonnet handles Tier 2, Opus handles Tier 3.

### 3.5 Claude as QA Overseer (Ongoing)

Even after fine-tuning, Claude serves as a quality assurance layer. The QA prompt is much cheaper than generation:

```
System: You are a QA reviewer for calculator definitions.
Given an Excel structure and a proposed API JSON,
verify: 1) All inputs correctly identified
        2) All outputs correctly identified
        3) Formula mappings are correct
        4) HyperFormula syntax is valid
Respond with: { valid: boolean, errors: string[] }
```

This is a verification task (much easier than generation), so Haiku handles it well. Track the QA rejection rate per model and per complexity tier. When the rejection rate drops below 5% for a given tier, you can consider removing the QA step for that tier to reduce latency and cost.

---

## 4. Analytics & Monitoring

### 4.1 Key Metrics to Track

| Metric | Source | Target |
|---|---|---|
| First-attempt approval rate | `job_feedback` WHERE attempt=1 AND rating='thumbs_up' | >70% within 3 months |
| Average cost per approved calculator | SUM(cost_usd) from `job_steps` grouped by job | <$0.50 for Tier 1/2 |
| Retry rate by failure category | `job_feedback` grouped by failure_category | Declining trend |
| Clarifying question rate | COUNT(job_questions) / COUNT(jobs) | <0.5 questions/job average |
| Template effectiveness | Approval rate correlated with template_refs | Identify top-performing templates |
| Cache hit rate | cache_read_tokens / (cache_read + cache_write + input) | >80% |
| QA rejection rate (future) | Claude QA fails / total fine-tuned model outputs | <5% per tier to remove QA |

### 4.2 Directus Dashboard

Build a custom Directus Insights dashboard that visualizes these metrics. Directus Insights supports custom SQL queries, so you can build panels for: daily job volume and cost, approval rate over time, cost breakdown by model and agent, failure category distribution, and template usage heatmap.

This dashboard serves double duty — it's your operational monitoring AND your training data quality view. When you see approval rates drop, investigate whether a prompt change or new calculator type is the cause.
