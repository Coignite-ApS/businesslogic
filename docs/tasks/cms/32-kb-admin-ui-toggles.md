# cms/19 — KB Admin UI — Per-KB Feature Toggles

**Status:** completed
**Priority:** low
**Service:** cms

## Description

Expose contextual retrieval and parent-doc toggles in CMS knowledge extension.

## Key Tasks

- [x] Add Settings tab to kb-detail.vue
- [x] Toggle switches for contextual_retrieval_enabled and parent_doc_enabled
- [x] PATCH save via Directus knowledge_bases collection
- [x] Feature badges (CR, PD) on KB list navigation
- [x] Update KnowledgeBase interface
- [x] Update knowledge-api proxy PATCH handler

## Implementation

- `services/cms/extensions/local/project-extension-knowledge/src/components/kb-detail.vue` — new Settings tab
- `services/cms/extensions/local/project-extension-knowledge/src/components/navigation.vue` — feature badges
- `services/cms/extensions/local/project-extension-knowledge/src/composables/use-knowledge-bases.ts` — interface update
- `services/cms/extensions/local/project-extension-knowledge-api/src/index.ts` — PATCH accepts new fields
