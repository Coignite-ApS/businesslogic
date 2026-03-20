# Implementation Roadmap

## Phase 1: Core Pipeline (Weeks 1–4)

**Goal:** Get the Calculator Builder agent working reliably from the command line. No infrastructure, no UI, no database — just the hardest problem first.

### Week 1: Prompt Engineering

- Write the Calculator Builder system prompt with your complete API JSON schema, HyperFormula function reference, and 5 seed examples.
- Create a TypeScript script that takes a parsed Excel JSON file as input, calls Claude API with the system prompt, and writes the output API JSON to a file.
- Test against 5–10 known calculators from your existing library. Compare output against the manually-built versions.
- Iterate on the prompt until 3 out of 5 simple calculators produce correct output on the first attempt.

**Deliverable:** A working `calc-builder.ts` script and a validated system prompt.

**Success criteria:** 60%+ first-attempt accuracy on Tier 1 calculators.

### Week 2: Two-Phase Protocol & Clarifying Questions

- Implement the analysis phase: the script first asks Claude to produce a structured analysis, then generates the final output.
- Add clarifying question support: when the analysis includes questions, pause and prompt the user in the terminal for answers.
- Test with medium-complexity (Tier 2) calculators. These should trigger clarifying questions.
- Add complexity scoring to the Excel parser if not already present. Test model routing based on score.

**Deliverable:** Two-phase Calculator Builder with interactive Q&A and model routing.

**Success criteria:** 70%+ accuracy on Tier 1, 50%+ on Tier 2 with clarifying questions.

### Week 3: Display, MCP, and Skill Agents

- Write system prompts for the Display Agent, MCP Doc Agent, and Skill Agent.
- Create a pipeline script that runs all four agents in sequence: Calculator Builder → Display → MCP → Skill.
- All downstream agents use Haiku 4.5.
- Validate outputs against your existing calculator definitions for format correctness.

**Deliverable:** Complete pipeline producing all four outputs from a single input.

**Success criteria:** All outputs are schema-valid for 80%+ of test cases.

### Week 4: Research Agent & Template Matching

- Write the Research Agent system prompt with web search enabled.
- Implement template matching: query your existing calculator database for similar templates by domain and complexity.
- Test the full pipeline with the "no Excel" scenario: user provides only a prompt, Research Agent gathers context, Calculator Builder generates from scratch.
- Build a small eval suite: 10 test cases (5 with Excel, 5 prompt-only) with expected outputs.

**Deliverable:** Complete agent pipeline with research and template matching.

**Success criteria:** Eval suite passes at 60%+ overall accuracy.

---

## Phase 2: Infrastructure (Weeks 5–8)

**Goal:** Wrap the validated pipeline in production infrastructure with async job processing, cost tracking, and user interaction.

### Week 5: Job API & BullMQ Worker

- Set up the standalone TypeScript service with Express (or Fastify) for the Job API.
- Implement BullMQ job queue with Redis. Each job step is a separate BullMQ job for granular retry.
- Implement the cost tracking system: `calculateCost()` function, `job_steps` logging, Redis cost counters.
- Implement budget enforcement: per-job and daily spending limits with pre-call checks.
- Add prompt caching: place `cache_control` on system prompts, verify cache hits in API response usage.

**Deliverable:** Async job processing with cost tracking and budget enforcement.

### Week 6: Database Schema & Directus Integration

- Create the PostgreSQL schema (jobs, job_steps, job_questions, job_feedback, job_outputs tables).
- Register tables as Directus collections for admin UI access.
- Implement the WebSocket event system: worker publishes events, Directus frontend consumes them.
- Build a basic Directus custom module for the calculator builder interface (job submission form, progress view).

**Deliverable:** Full data persistence with Directus admin integration.

### Week 7: Feedback & Retry System

- Implement structured feedback UI in Directus: thumbs up/down, failure category selection, correction editor.
- Implement the retry escalation chain: enriched prompt → clarify → next model → Opus → manual.
- Add the clarifying questions UX: conversational Q&A interface in the Directus module.
- Test the full feedback loop: submit job → review → reject with feedback → retry → approve.

**Deliverable:** Complete human-in-the-loop workflow with retry logic.

### Week 8: Testing & Hardening

- Run the eval suite through the full infrastructure stack (not just scripts).
- Load test: submit 20 jobs simultaneously, verify queue processing and cost tracking.
- Error handling: test API failures, timeout handling, malformed Excel input, budget exceeded scenarios.
- Set up monitoring: application logs, BullMQ dashboard, Redis memory usage, PostgreSQL query performance.
- Deploy to Hetzner with systemd services (or Docker Compose).

**Deliverable:** Production-ready system deployed on Hetzner.

---

## Phase 3: Optimization (Weeks 9–12)

**Goal:** Improve quality, reduce costs, and begin building the training data corpus.

### Weeks 9–10: Prompt Refinement

- Analyze the first batch of real user jobs. Identify common failure patterns.
- Refine system prompts based on failure analysis. A/B test prompt variations.
- Optimize `max_tokens` settings per agent based on observed output sizes.
- Tune the complexity scoring weights based on actual model performance per tier.

### Weeks 11–12: Template Library & Eval Suite

- Build the template matching system: attribute-based similarity search on approved calculators.
- Expand the eval suite to 30+ test cases, stratified by complexity tier and domain.
- Implement the Batch API eval runner: re-run all test cases against prompt changes, diff outputs.
- Build the Directus Insights dashboard for operational metrics.

**Deliverable:** Self-improving system with growing template library and automated quality tracking.

---

## Phase 4: Fine-Tuning Preparation (Months 4–6)

### Training Data Pipeline

- Build the export script that extracts training pairs from PostgreSQL (filtered by `is_approved` AND `usage_count > 0`).
- Implement automated validation: check that all exported training outputs are schema-valid and HyperFormula-executable.
- Analyze data distribution: ensure coverage across complexity tiers, domain tags, and formula types.
- Target: 200+ validated training pairs before first fine-tuning attempt.

### Evaluation Framework

- Define formal evaluation metrics: schema accuracy, formula correctness, input/output completeness.
- Build automated evaluation scripts that score model outputs against approved references.
- Establish baselines: Claude Haiku, Sonnet, and Opus scores on the held-out test set.

---

## Phase 5: Fine-Tuning & Hybrid Deployment (Months 6–12)

- Fine-tune Display Agent first (easiest, most constrained transformation).
- Benchmark against Claude Haiku. Deploy if within 90% accuracy.
- Fine-tune Calculator Builder for Tier 1 only.
- Implement Claude QA overseer: Haiku validates fine-tuned model outputs.
- Deploy hybrid: fine-tuned for Tier 1 Display/MCP, Claude for everything else.
- Continue data collection. Iterate on fine-tuning with growing corpus.

---

## Technical Dependencies

| Component | Dependencies | Notes |
|---|---|---|
| Job API | Node.js 20+, Express/Fastify, TypeScript | Separate from Directus runtime |
| Worker | BullMQ, @anthropic-ai/sdk, TypeScript | Runs as standalone process |
| Database | PostgreSQL 16+, Directus SDK | Tables registered as Directus collections |
| Queue | Redis 7+, BullMQ | Also used for cost counters |
| Directus Module | Vue 3, Directus Extensions SDK | Custom module for builder UI |
| Eval Suite | Vitest or Jest, test fixtures | Batch API for cost-efficient runs |
| Fine-tuning (future) | GPU provider, training framework | On-demand, not dedicated hardware |

---

## Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Prompt brittleness across model versions | High | High | Pin model versions. Run eval suite after any model or prompt change. Version all prompts in git. |
| Low first-attempt accuracy | Medium | Medium | Two-phase protocol catches errors early. Clarifying questions reduce ambiguity. Retry escalation recovers from failures. |
| Cost overruns | Low | Medium | Multi-layer budget enforcement. Model routing minimizes Opus usage. Prompt caching cuts input costs 90%. |
| Training data quality issues | Medium | High | Human approval gate. Usage count filter. Automated schema validation. Manual review for edge cases. |
| API rate limits | Low | Low | BullMQ rate limiting. Sequential processing. Upgrade Anthropic usage tier if needed. |
| Excel complexity exceeds model capability | Medium | Medium | Opus handles complex cases. Manual fallback for edge cases. Complexity ceiling communicated to users. |
| Fine-tuned model underperformance | Medium | Low | Claude QA overseer catches failures. Hybrid deployment means Claude is always available as fallback. |

---

## Key Architecture Decisions

| Decision | Rationale | Alternatives Considered |
|---|---|---|
| TypeScript/Node.js (not Python) | Matches existing Directus stack. Team expertise. Shared types with frontend. | Python: better ML ecosystem but adds operational complexity. Go: over-engineered for I/O-bound workload. |
| Claude API (not local models) | Reasoning quality required for Excel interpretation. No training data yet for fine-tuning. Frontier models outperform on structured output. | Local LLMs: insufficient reasoning depth for Tier 2/3. Cheaper per-call but lower quality and higher infrastructure cost. |
| Separate worker process (not Directus extension) | Long-running agent pipelines don't belong in Directus's request lifecycle. Independent scaling. Clean failure isolation. | Directus hooks: simpler but couples agent execution to CMS lifecycle. Risk of timeout and resource contention. |
| BullMQ (not bare Redis pub/sub) | Built-in retry logic, dead letter queues, rate limiting, job progress tracking. Production-proven at scale. | Raw Redis: more flexible but requires building all queue semantics from scratch. RabbitMQ: heavier, separate service. |
| Async job API (not sync REST) | Agent pipeline takes 30–60s. HTTP timeouts and blocked connections make sync impractical. | Sync with long polling: simpler client but wastes connections. GraphQL subscriptions: adds GraphQL dependency. |
| 5 specialized agents (not 1 monolithic) | Each agent has a clear contract. Independent iteration and model selection per stage. Better error isolation. | Single prompt: fewer API calls but harder to debug, no per-stage model routing, all-or-nothing failures. |
| Anthropic SDK (not OpenAI compat) | Required for prompt caching and web search. These features are only available on the native /v1/messages endpoint. | OpenAI SDK: broader ecosystem but no access to caching (biggest cost lever) or built-in web search. |
| Attribute matching for templates (not vector search) | Structured metadata available. Interpretable results. No embedding infrastructure needed. Good enough for <200 templates. | Vector search: better semantic matching but requires embedding model, vector DB, and more infrastructure. Graduate to this at 200+ templates. |

---

## Document Set Index

This roadmap is part of a six-document architecture set:

0. **Strategy** — Vision, goals, approach, technology decisions, and success criteria.
1. **System Architecture** — Components, data flow, event system, deployment topology.
2. **Agent Design & Prompt Engineering** — Agent specifications, prompt structures, two-phase protocol, template matching.
3. **Cost Control & API Integration** — Claude API configuration, caching strategy, budget management, cost forecasting.
4. **Data Schema & Self-Improvement** — PostgreSQL schema, feedback system, training data pipeline, fine-tuning roadmap, analytics.
5. **Implementation Roadmap** (this document) — Phased build plan, milestones, dependencies, risk matrix, and architecture decision log.
