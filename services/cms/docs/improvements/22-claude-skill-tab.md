# #22 — Claude Skill Tab Improvements

**Status:** planned
**Phase:** 1 — Security & Widget Foundation
**Priority:** TBD

## Goal

Research Claude Skill best practices and redesign the Skill tab UX — tabs should be integrated with the top header (like the Configuration Excel cell picker), and response template must be part of this tab.

## Research Questions

- [ ] What are best practices for structuring Claude Skills? (descriptions, parameter hints, system prompts, few-shot examples)
- [ ] What skill configuration fields produce the best AI responses?
- [ ] How should response templates work within skills — override default LLM formatting, or guide it?

## Scope

- Research Claude Skill authoring best practices
- Redesign Skill tab: sub-tabs integrated into the top header bar (same pattern as Configuration tab's Excel cell picker tabs)
- Add response template configuration to the Skill tab
- Improve skill metadata fields based on research findings

## Key Tasks

- [ ] Research Claude Skill best practices (docs, examples, prompt engineering patterns)
- [ ] Redesign Skill tab with top-integrated sub-tabs (match Configuration tab pattern)
- [ ] Add response template section to Skill tab
- [ ] Review and improve skill config fields (description, instructions, examples, constraints)
- [ ] Ensure consistent tab UX between Configuration and Skill tabs

## Acceptance Criteria

- [ ] Skill tab sub-tabs match Configuration tab's integrated header style
- [ ] Response template is configurable within the Skill tab
- [ ] Skill fields reflect researched best practices
- [ ] Consistent UX pattern across Configuration and Skill tabs

## Setup Guide UX

- After downloading the skill ZIP, show step-by-step instructions for installing in Claude Desktop
- Guide must be inline in the tab (not a separate doc) — copy-pasteable paths, commands
- Goal: user goes from "Download ZIP" to working skill in under 2 minutes
- Consider a "Copy config snippet" button for `claude_desktop_config.json`

## Notes

- Research-first: findings may add/remove config fields
- Relates to #18 (Integration Tabs), #21 (Cowork Plugin), #23 (Response Template)
- Tab integration pattern reference: Configuration tab's Excel sheet picker renders tabs flush with the top header — Skill tab should follow same pattern
- Principle: make it as easy as possible — minimize manual steps, maximize copy-paste
