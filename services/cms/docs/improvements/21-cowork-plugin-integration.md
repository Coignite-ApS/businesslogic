# #21 — Cowork Plugin Integration Research

**Status:** planned
**Phase:** 1 — Security & Widget Foundation
**Priority:** TBD

## Goal

Determine the best way to integrate Businesslogic calculators with the Cowork plugin. Research whether MCP is required or if direct API usage is sufficient, and what configuration/endpoints are needed for optimal experience.

## Research Questions

- [ ] **MCP vs Direct API**: Is MCP the best integration path, or can Cowork consume our REST API directly? What are the trade-offs (latency, auth, capabilities)?
- [ ] **Endpoint format**: Does Cowork need a specialized endpoint that returns calculator info in a specific format (e.g. structured tool descriptions, parameter schemas, result formatting)?
- [ ] **Configuration fields**: What additional fields should calculators have to support Cowork? (e.g. AI-friendly descriptions, example prompts, output format hints, system instructions)
- [ ] **MCP dependency UX**: If MCP is required, how do we communicate to end users that the Cowork integration won't work until MCP is configured? (disabled state, setup wizard, inline warning)
- [ ] **Auth flow**: How does Cowork authenticate — per-account MCP URL, API key, or something else?
- [ ] **Override response template**: Does it make sense to let users customize how calculator results are formatted/presented in Cowork? If so, how — Handlebars/Mustache template on the calculator config? Or is Cowork's native formatting sufficient?

## Scope

- Research Cowork plugin architecture and integration patterns
- Evaluate MCP vs direct API for this use case
- Propose additional calculator config fields if needed (e.g. `ai_description`, `example_prompts`, `cowork_enabled`)
- Propose specialized endpoint if needed (e.g. `/calc/cowork/describe/:calcId`)
- Design UX for unconfigured/unavailable state in Integration tab

## Key Tasks

- [ ] Study Cowork plugin docs and integration API
- [ ] Prototype both MCP and direct API approaches
- [ ] Define additional config fields needed on calculator model
- [ ] Design endpoint response format if direct API is better
- [ ] Define UX for "MCP not configured" state (if MCP path chosen)
- [ ] Document recommendation with trade-off analysis

## Acceptance Criteria

- [ ] Clear recommendation: MCP, direct API, or hybrid
- [ ] Defined schema changes (new fields/endpoints) if any
- [ ] UX design for unavailable/unconfigured state
- [ ] Implementation plan ready for development

## Setup Guide UX

- Cowork plugin setup must be doable entirely through the interface — no external docs needed
- Show step-by-step inline instructions for connecting calculator to Cowork
- Copy-pasteable config snippets, URLs, API keys
- If MCP is required: guide user through MCP setup within the tab
- Goal: minimize friction — user should go from "I want Cowork" to working integration with minimal steps

## Notes

- This is a research-first improvement — implementation follows after recommendation is accepted
- Relates to #18 (Integration Tabs), #06 (Account-Level MCP), #22 (Skill Tab), #23 (Response Template)
- Consider that some users may not have MCP set up at all — the integration should degrade gracefully
- Principle: make it as easy as possible — if it can't be done in the UI, it's too hard
