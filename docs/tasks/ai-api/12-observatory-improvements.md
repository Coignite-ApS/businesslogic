# 12. Observatory Improvements & Controls

**Status:** planned
**Phase:** Post-monetization
**Depends on:** ai-api/10 (observatory panels), cms/08 (pricing & billing)

---

## Goal

Deferred actionable controls and enhancements for the AI Observatory. These items were identified during Phase 1B+ and Phase 2 implementation but require monetization design decisions before building.

---

## Deferred from Phase 1B+

### Panel 1: Cost & Budget Controls
- [ ] Per-account budget override (editable field in account collection)
- [ ] Admin alert: configurable threshold notification (email/webhook when account hits X% budget)

### Panel 2: Conversation Quality Controls
- [ ] Extend feedback mechanism to all conversations (not just KB)
- [ ] Drill-down: click metric → see underlying conversations

### Panel 4: Retrieval Controls
- [ ] Per-KB similarity threshold control (editable in Directus, not env var)
- [ ] Feedback correlation: join retrieval quality with kb_answer_feedback for satisfaction-by-similarity analysis

---

## Future Enhancements

### Performance Optimization
- [ ] Migrate observatory endpoints from raw queries to `ai_metrics_daily` aggregated table (currently queries on-demand)
- [ ] Add materialized views for heavy percentile calculations at scale
- [ ] Tool analytics: move JSONB processing to SQL aggregation (currently materializes all tool_calls in memory)

### Data Quality
- [ ] Backfill `outcome` field on historical conversations (currently only new ones get tagged)
- [ ] Backfill `response_time_ms` on historical token usage rows
- [ ] Validate `tool_calls` JSONB schema consistency across all rows

### UX
- [ ] Export dashboard data as CSV/PDF
- [ ] Scheduled email reports (weekly observatory digest)
- [ ] Comparison mode: compare two date ranges side-by-side
- [ ] Custom date range picker (beyond 7/30/90 presets)

---

## Key Tasks

- [ ] Design monetization-aware budget controls (after cms/08)
- [ ] Implement per-account budget override UI
- [ ] Build admin alert notification system
- [ ] Add conversation drill-down navigation
- [ ] Extend feedback to all conversation types
- [ ] Per-KB similarity threshold editor
- [ ] Performance optimization pass (aggregated queries)
