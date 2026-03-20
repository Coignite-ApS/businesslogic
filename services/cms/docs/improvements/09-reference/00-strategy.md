# Calculator Builder Platform — Strategy Document

## What We Are Building

We are building an AI-powered platform that transforms Excel spreadsheets into fully operational online calculators. The platform takes an Excel file (or a natural language description) and produces four outputs: a JSON API definition with HyperFormula execution logic, a display configuration for the online calculator UI, MCP server tool definitions so LLM agents can use the calculator, and a Claude skill definition for user-specific calculator execution.

Today, building a calculator from Excel is a manual, skilled process. It requires understanding the spreadsheet's business logic, mapping it to our JSON schema and HyperFormula syntax, designing the online calculator layout, writing MCP documentation, and creating skills. This platform automates the entire process while building the foundation to get better over time — and eventually run on our own fine-tuned models.

## Why We Need This

Our core business involves calculators. We already have a well-defined pipeline: JSON schema-controlled input/output definitions, HyperFormula for formula execution (our API), display JSON for styling online calculators, MCP server definitions, and Claude skills. The bottleneck is building calculators — it requires domain knowledge, familiarity with our schemas, and careful translation from Excel logic. An AI agent that can do this reliably unlocks scale.

## The Problem in Detail

Building a calculator from Excel involves several distinct challenges:

**Understanding the Excel.** An Excel spreadsheet encodes business logic implicitly — through cell references, formulas, named ranges, conditional branches, and cross-sheet dependencies. A human expert reads the spreadsheet and infers what the inputs are (cells the user should control), what the outputs are (cells that display results), and what the calculation logic is (the chain of formulas connecting inputs to outputs). This inference step is the hardest part and the one most likely to go wrong.

**Translating to our format.** Once the logic is understood, it must be expressed in our specific JSON schema with HyperFormula-compatible formula definitions. This is a structured transformation but requires exact syntax and adherence to our schema. Small errors (wrong function name, missing parameter, incorrect cell reference mapping) break the calculator.

**Handling the "no Excel" case.** Sometimes users don't have an Excel file — they have a description like "build me a mortgage calculator." The system must research best practices for that calculator type, determine standard inputs/outputs, find the correct formulas, and build the entire definition from domain knowledge.

**Producing downstream artifacts.** After the core API JSON is correct, the display configuration, MCP definitions, and skill definitions all derive from it. These are more mechanical transformations but still need to be correct and follow our conventions.

## Our Approach: Multi-Agent Pipeline with Self-Improvement

We solve this with a pipeline of five specialized AI agents, each handling one transformation. The agents are not autonomous — they are orchestrated by a deterministic worker process that manages state, cost, and human review checkpoints.

### The Five Agents

1. **Research Agent** — Gathers domain context via web search when the calculator type is unfamiliar or when no Excel is provided. Produces a structured research brief with standard inputs, outputs, formulas, and edge cases for the domain.

2. **Calculator Builder Agent** — The core agent. Takes the parsed Excel JSON (or user prompt + research brief) and produces the API JSON definition with input schemas, output schemas, and HyperFormula formula mappings. This is the hardest task. It runs in two phases: first an analysis phase (where the agent shows its understanding and asks clarifying questions), then a generation phase (where it produces the final output after human confirmation).

3. **Display Agent** — Takes the validated API JSON and produces the display configuration for the online calculator UI. This is a constrained JSON-to-JSON transformation.

4. **MCP Documentation Agent** — Takes the API JSON and produces MCP server tool definitions so other LLM agents can discover and invoke the calculator.

5. **Skill Agent** — Takes the API JSON and MCP definitions and produces a Claude skill definition for user-specific calculator execution.

### Why Separate Agents (Not One Big Prompt)

Each agent has a single, well-defined responsibility. This gives us:

- **Independent model selection** — The Calculator Builder may need Opus for complex spreadsheets while the Display Agent always runs fine on Haiku. We don't pay Opus prices for mechanical transformations.
- **Granular debugging** — When something fails, we know exactly which step failed and why.
- **Independent iteration** — We can improve the Calculator Builder prompt without touching the Display Agent.
- **Per-stage cost tracking** — We know exactly what each transformation costs.
- **Staged human review** — Users can validate the core API JSON before downstream agents run, catching errors early.

### The Two-Phase Protocol

The Calculator Builder doesn't generate output immediately. It first produces an analysis: "Here's what I think the inputs are, here's what I think the outputs are, here's how I interpret the formulas, and here are things I'm uncertain about." For anything below a confidence threshold, it generates specific, contextual clarifying questions.

The user reviews the analysis and answers questions. Only then does the agent generate the final API JSON. This catches misunderstandings before they propagate through four agent steps and produce polished but incorrect outputs.

### Clarifying Questions — Why They Matter

The quality of clarifying questions directly determines the quality of the final output. Bad questions waste the user's time. Good questions resolve genuine ambiguities. The system is designed to produce questions that reference specific cells and formulas, state the agent's interpretation, present alternatives, and explain how the answer will affect the output.

Every question-answer pair is stored as training data. Over time, this builds a dataset of "what's ambiguous in Excel-to-calculator translation" that becomes invaluable for fine-tuning.

## Technology Decisions

### Claude API, Not Local Models

The core task — reading an Excel spreadsheet, inferring business logic, and producing correct structured JSON — requires strong reasoning. Local models (even 70B parameter) don't reliably handle the chain of inference required for medium-to-complex spreadsheets. We start with Claude and build toward fine-tuned models as we collect training data.

### TypeScript/Node.js, Not Python

Our existing stack is Directus (Node.js), PostgreSQL, and Redis on Hetzner. Adding Python introduces a second runtime, separate dependency management, and operational overhead. The Anthropic TypeScript SDK is fully capable. TypeScript's type system lets us define our calculator schemas as types and get compile-time validation across the pipeline. We stay in our ecosystem.

### Anthropic Messages API (Native, Not OpenAI Compatibility)

We must use the native Anthropic `/v1/messages` endpoint because prompt caching and web search — our two biggest cost and capability levers — are only available through the native API. The OpenAI compatibility layer doesn't support either.

### Async Job Processing, Not Synchronous REST

A full calculator build (five sequential agent calls, possibly with retries and clarifying questions) takes 30–120 seconds. Synchronous HTTP doesn't work. We use BullMQ (Redis-backed job queue) for async processing with WebSocket events for real-time progress updates in the Directus admin UI.

### Separate Worker Process, Not Directus Extension

Long-running agent pipelines don't belong inside Directus's request lifecycle. The worker runs as a standalone Node.js process, sharing TypeScript type definitions with Directus but independently deployed and scaled.

## Cost Control Strategy

AI costs must be predictable and controlled. We implement five layers:

1. **Model routing by complexity** — The Excel parser computes a complexity score. Simple calculators use Haiku ($1/$5 per MTok), medium use Sonnet ($3/$15), complex use Opus ($5/$25). Downstream agents always use Haiku regardless of calculator complexity.

2. **Prompt caching** — System prompts (schema definitions, HyperFormula reference, examples) are large and identical across calls. Caching reduces input token costs by 90% after the first call.

3. **Budget enforcement** — Per-call max_tokens limits, per-job cost ceilings (by tier), daily spending caps in Redis, and monthly limits at the Anthropic platform level.

4. **Retry escalation with cost awareness** — When a user rejects output, the system doesn't blindly retry with a more expensive model. It first enriches the prompt with failure context, then asks clarifying questions, then escalates models. Each step checks the job budget before proceeding.

5. **Web search cost caps** — The Research Agent's web searches are limited via max_uses (3–8 per request) and tracked separately from token costs.

## The Self-Improvement Loop

This is the strategic differentiator. The system is designed to get better over time through three mechanisms:

### 1. Growing Template Library

Every approved, human-reviewed calculator that enters production use becomes a template. When a new job arrives, the system finds the most similar approved calculators and injects them as few-shot examples into the agent prompts. More approved calculators → better examples → higher first-attempt accuracy → more approved calculators. This is a virtuous cycle.

Templates are matched by domain tags, complexity tier, formula function overlap, and input/output similarity. Simple attribute matching is sufficient until the library exceeds ~200 entries, at which point we graduate to embedding-based semantic search.

### 2. Structured Feedback Data

User feedback isn't just thumbs up/down. It includes a failure category (schema wrong, formula wrong, logic wrong, completely off, minor fix), optional comments, and — critically — the user's manual corrections as a JSON diff. This labeled data tells us exactly what the model gets wrong and how humans fix it. It drives both prompt improvement and future fine-tuning.

### 3. Path to Fine-Tuned Models

All data is collected with fine-tuning in mind from day one. The database schema captures every input, every output, every model used, every prompt version, every feedback signal. The plan:

- **Months 0–3:** Collect data. Run everything through Claude. Target 200+ approved builds.
- **Months 3–6:** Analyze failure patterns. Identify which complexity profiles and formula types cause the most errors. Build evaluation framework.
- **Months 6–9:** Fine-tune the easiest agents first (Display, MCP Doc). These are constrained JSON-to-JSON transformations. Benchmark against Claude Haiku. Deploy if within 90% accuracy.
- **Months 9–12:** Fine-tune the Calculator Builder for Tier 1 (simple) calculators. Use Claude as QA overseer — a cheaper verification call that catches fine-tuned model errors.
- **Ongoing:** Claude remains available as the QA layer and as the fallback for complex calculators. The hybrid architecture (fine-tuned for simple, Claude for complex) is the long-term steady state.

## Integration with Existing Architecture

The platform integrates with our existing stack, not replaces it:

- **Directus** remains the admin UI and content management layer. Calculator builder UI is a custom Directus module. All tables are registered as Directus collections. Directus WebSockets deliver real-time job progress events.
- **PostgreSQL** stores all job data, agent outputs, feedback, and training records alongside existing calculator definitions.
- **Redis** backs the BullMQ job queue and real-time cost counters.
- **Hetzner** hosts everything. The system is I/O-bound (waiting on API responses), not CPU-bound, so modest compute is sufficient.

## What Success Looks Like

**Short term (3 months):** The system reliably produces correct API JSON for simple calculators (Tier 1) on the first attempt at least 70% of the time. Medium calculators (Tier 2) achieve 50%+ with clarifying questions. All downstream agents (Display, MCP, Skill) produce schema-valid output 80%+ of the time. Cost per calculator build is under $0.50 for Tier 1.

**Medium term (6 months):** Template library exceeds 100 approved calculators. First-attempt accuracy improves across all tiers as better examples accumulate. Evaluation framework is in place. First fine-tuning experiments begin on Display/MCP agents.

**Long term (12 months):** Hybrid architecture: fine-tuned models handle Tier 1 builds end-to-end with Claude QA, Claude handles Tier 2/3. Self-improvement loop is demonstrably working — approval rates trend upward as template library grows. Cost per Tier 1 build approaches near-zero (locally-hosted fine-tuned model).

## Document Set

This strategy document is accompanied by four detailed technical documents:

1. **System Architecture** — Components, data flow, event system, deployment topology.
2. **Agent Design & Prompt Engineering** — Agent specifications, prompt structures, two-phase protocol, template matching.
3. **Cost Control & API Integration** — Claude API configuration, caching strategy, budget management, cost forecasting.
4. **Data Schema & Self-Improvement** — PostgreSQL schema, feedback system, training data pipeline, fine-tuning roadmap, analytics.
5. **Implementation Roadmap** — Week-by-week build plan, milestones, dependencies, risks, and architecture decision log.
