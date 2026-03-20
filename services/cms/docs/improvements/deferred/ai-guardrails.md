# Dropped: AI Guardrails (Standalone)

**Status:** dropped — absorbed into #13 (Knowledge Retrieval)
**Was:** old #9 (Guardrails for System Responses)

---

## Why Absorbed

Guardrails are now built into #13 (Knowledge Retrieval) as core features:
- **Confidence threshold**: queries below similarity 0.75 return "not found"
- **Citation validation**: post-generation check that all claims cite sources
- **"I don't know" capability**: system prompt enforces refusal when sources don't support answer
- **Uncited claim flagging**: answers with unsupported claims are flagged
- **Answer caching**: deterministic answers for repeated queries

No standalone guardrails project needed — they're integral to the retrieval pipeline.

## Concept (for future reference)

When we have AI-generated content:
- Input validation: sanitize user prompts (injection prevention)
- Output validation: check LLM responses against policy rules
- Content filtering: block PII, harmful content, off-topic responses
- Confidence scoring: flag low-confidence responses for human review
- Audit logging: store all AI inputs/outputs for review

Consider: Anthropic's constitutional AI patterns, Guardrails AI library, or simple rule-based filters depending on the use case.
