# System Architecture

## 1. Executive Summary

This document defines the architecture for an AI-powered calculator builder platform. The system uses a multi-agent pipeline powered by Claude API to transform Excel spreadsheets (or natural language prompts) into fully operational online calculators, complete with API schemas, display configurations, MCP server definitions, and Claude skills.

The platform integrates with the existing Directus/PostgreSQL/Redis backend hosted on Hetzner, and is designed to collect structured training data from day one, enabling a transition to fine-tuned models over time while retaining Claude as a quality assurance overseer.

---

## 2. System Overview

### 2.1 Core Pipeline

The system processes calculator build requests through a sequential agent pipeline. Each agent specializes in a single transformation, producing one well-defined output artifact. The pipeline is orchestrated by a job-based async worker that manages state, cost tracking, and human review checkpoints.

### 2.2 Input/Output Flow

| Stage | Input | Output | Model |
|---|---|---|---|
| Research Agent | User prompt or Excel metadata | Structured research brief | Sonnet 4.6 + Web Search |
| Calculator Builder | Excel JSON + research brief + templates | API JSON (schemas + HyperFormula) | Haiku/Sonnet/Opus (by complexity) |
| Display Agent | API JSON | Display JSON (styling/layout) | Haiku 4.5 |
| MCP Doc Agent | API JSON | MCP server tool definitions | Haiku 4.5 |
| Skill Agent | API JSON + MCP defs | Claude skill definition | Haiku 4.5 |

---

## 3. Architecture Components

### 3.1 Directus Admin Interface

The existing Directus instance serves as the primary admin UI. A custom module provides the calculator builder interface where users submit jobs, monitor progress via WebSocket events, answer clarifying questions, and review/approve outputs. Directus handles authentication, role-based access, and serves as the content management layer for all calculator definitions.

### 3.2 Job API Service

A standalone TypeScript/Node.js service exposes the job management API. This is NOT a Directus extension — it runs as a separate process to avoid coupling long-running agent workflows to Directus's lifecycle. It shares TypeScript type definitions with Directus for schema consistency.

**Endpoints:**

- `POST /jobs` — Create a new calculator build job. Accepts Excel JSON or natural language prompt. Returns jobId immediately.
- `GET /jobs/:id` — Poll job status, partial results, cost breakdown, and current step.
- `POST /jobs/:id/feedback` — Submit structured feedback (rating, category, corrections).
- `POST /jobs/:id/answers` — Submit answers to clarifying questions.
- `WebSocket /jobs/:id/stream` — Real-time event stream for progress, questions, and agent status.

### 3.3 Worker Process (BullMQ)

The worker process consumes jobs from a Redis-backed BullMQ queue. It executes the agent pipeline step by step, with each step as a separate BullMQ job for granular retry and monitoring. The worker runs as a standalone Node.js process (systemd service or Docker container) on the same Hetzner machine.

**Key responsibilities:**

- Model selection based on complexity score.
- Cost tracking and budget enforcement per job and per day.
- Prompt caching management (cache_control placement).
- Retry escalation logic (same model enriched → clarify → next model → Opus).
- WebSocket event emission to Directus for real-time UI updates.
- Storage of all intermediate and final outputs in PostgreSQL.

### 3.4 Claude Messages API Integration

All agent calls use the Anthropic Messages API at `/v1/messages` via the official `@anthropic-ai/sdk` TypeScript SDK. This is mandatory (not the OpenAI compatibility layer) because prompt caching and web search are only available through the native Anthropic format.

### 3.5 PostgreSQL Data Layer

PostgreSQL stores all job data, agent outputs, feedback, and training records. The schema is designed to serve dual purposes: operational state management for the current system, and structured training data collection for future model fine-tuning. Detailed schema is provided in the Database Schema document.

### 3.6 Redis

Redis serves three functions: BullMQ job queue backend, daily/per-job cost counters with TTL-based expiry, and prompt cache warming status tracking. No business data is persisted solely in Redis — all critical state flows through PostgreSQL.

---

## 4. Complete Data Flow

### 4.1 Job Lifecycle

| Phase | Action | Data Stored | User Sees |
|---|---|---|---|
| Submit | User uploads Excel or enters prompt | Job record created, input_data stored | Job ID, progress spinner |
| Analyze | Complexity scored, model selected | Complexity JSONB, model assignment | Complexity tier, selected model |
| Research | Web search (if needed), template lookup | Research brief, template refs | Research status, sources found |
| Analysis | Calculator Builder analysis phase | Analysis output, confidence scores | Agent understanding, clarifying Qs |
| Clarify | User answers questions (if any) | Q&A pairs stored | Interactive Q&A interface |
| Generate | Calculator Builder generation phase | API JSON output | Generation progress |
| Enrich | Display, MCP, Skill agents run | Display/MCP/Skill JSON outputs | Per-agent progress |
| Review | Human reviews all outputs | Review status | Full output preview, edit controls |
| Feedback | User approves or provides corrections | Rating, category, corrections JSONB | Confirmation or retry |
| Approve | Outputs finalized and deployed | is_approved flag, approved_at | Calculator live confirmation |

---

## 5. WebSocket Event System

Directus's built-in WebSocket support is used to push real-time events from the worker to the admin UI. The worker publishes events to a Directus-managed WebSocket channel via the Directus SDK. Each event carries a structured payload that the frontend renders as a step-by-step progress view.

### 5.1 Event Taxonomy

| Event | Payload | UI Behavior |
|---|---|---|
| `job.created` | jobId, complexity, selectedModel | Show job card with model badge |
| `job.research.started` | jobId, searchQueries[] | Show research spinner with queries |
| `job.research.complete` | jobId, brief summary, sourceCount | Show research complete checkmark |
| `job.analysis.complete` | jobId, analysis, confidence, questions[] | Show analysis, render Q&A if needed |
| `job.analysis.waiting` | jobId, questions[] | Block pipeline, show question UI |
| `job.user.response` | jobId, answers[] | Resume pipeline, show answers |
| `job.generation.started` | jobId, agent, model | Show agent working indicator |
| `job.generation.complete` | jobId, agent, outputPreview, tokenUsage | Show checkmark, cost counter update |
| `job.review.ready` | jobId, totalCost, totalTokens | Enable review panel with all outputs |
| `job.feedback` | jobId, rating, category, corrections | Store feedback, trigger retry if needed |
| `job.retry` | jobId, reason, newModel, attempt | Show retry indicator, updated model |
| `job.approved` | jobId, deployedUrl | Show success, link to live calculator |
| `job.failed` | jobId, error, attempts, totalCost | Show error details, manual review link |

### 5.2 Clarifying Questions UX Flow

When the Calculator Builder analysis phase produces clarifying questions, the pipeline pauses and emits a `job.analysis.waiting` event. The UI renders questions one at a time in a conversational interface, with the relevant Excel snippet shown alongside each question for context.

Questions are structured with: question text, context (the relevant cell range or formula), suggested answer options (when applicable), and a free-text input for complex responses. Each answer is stored individually in the `job_questions` table and injected into the generation phase prompt.

The pipeline does not resume automatically — the user must explicitly confirm all answers are complete. This prevents partial context from producing incorrect outputs.

---

## 6. Model Routing Strategy

### 6.1 Complexity Scoring

The Excel parser computes a deterministic complexity score from the parsed spreadsheet structure. This score drives model selection, cost budgeting, and later serves as a training data feature.

| Factor | Weight | Example |
|---|---|---|
| sheet_count | 1.0x per sheet | 3 sheets = 3 points |
| formula_count | 0.1x per formula | 50 formulas = 5 points |
| max_formula_depth | 2.0x per nesting level | Depth 4 = 8 points |
| unique_function_count | 0.5x per function type | 12 types = 6 points |
| cross_sheet_references | 1.5x per reference | 8 refs = 12 points |
| named_ranges | 0.3x per range | 5 ranges = 1.5 points |
| conditional_branches | 1.0x per IF/IFS/SWITCH | 10 = 10 points |
| lookup_operations | 1.5x per VLOOKUP/INDEX-MATCH | 4 = 6 points |

### 6.2 Tier Assignment

| Tier | Score Range | Model | max_tokens | Job Budget | Typical Cost |
|---|---|---|---|---|---|
| 1 (Simple) | 0–15 | Haiku 4.5 | 1,200 | $0.50 | $0.05–$0.10 |
| 2 (Medium) | 16–40 | Sonnet 4.6 | 2,500 | $2.00 | $0.10–$0.30 |
| 3 (Complex) | 41+ | Opus 4.6 | 4,000 | $5.00 | $0.30–$0.80 |

### 6.3 Escalation Chain

When a user provides negative feedback, the system follows a structured escalation path before moving to a more expensive model. Each step adds context from the failure, not just more compute power.

1. **Retry 1:** Same model, enriched prompt. Add failure context (what was wrong, the user's feedback category) to the prompt. Cost: same as original.
2. **Retry 2:** Same model with clarifying question answers. If the failure was a logic interpretation problem, surface targeted questions before retrying.
3. **Retry 3:** Next tier model with all accumulated context. Escalate Haiku → Sonnet or Sonnet → Opus, including all prior attempts and feedback.
4. **Retry 4:** Opus with maximum context. Include best-matching template examples from the approved library. This is the final automated attempt.
5. **Manual:** Flag for human expert review. The accumulated context from all attempts is invaluable for diagnosing systematic prompt issues.

---

## 7. Deployment Architecture on Hetzner

### 7.1 Service Topology

All services run on a single Hetzner VPS (recommended CX41 or higher) during the initial phase. The system is I/O-bound (waiting on Claude API responses), not CPU-bound, so moderate compute is sufficient.

| Service | Runtime | Port | Managed By |
|---|---|---|---|
| Directus | Node.js | 8055 | Docker / PM2 |
| Job API | Node.js (TypeScript) | 3100 | systemd / Docker |
| Worker | Node.js (TypeScript) | N/A (no HTTP) | systemd / Docker |
| PostgreSQL | PostgreSQL 16 | 5432 | systemd |
| Redis | Redis 7 | 6379 | systemd |
| Nginx | Reverse proxy | 443 | systemd |

### 7.2 Scaling Considerations

The worker process is the primary scaling target. If job volume exceeds what one worker can handle, add additional worker instances on separate VPS nodes. BullMQ handles job distribution automatically. The Job API and Directus remain on the primary node.

For the fine-tuning phase (months 6–12), GPU compute should be sourced from on-demand providers (Lambda Labs, RunPod) rather than a dedicated Hetzner GPU server. Training runs are infrequent and bursty — dedicated GPU hardware is not cost-efficient. Inference on a fine-tuned model can run on a Hetzner GPU instance (GX series) once the model is validated.
