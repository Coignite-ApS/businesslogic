-- Rollback: 001_kb_node_types
-- Removes KB pipeline node types from bl_node_types

DELETE FROM bl_node_types WHERE id IN (
    'ai:parse_document',
    'ai:chunk_text',
    'ai:filter_unchanged',
    'ai:store_vectors',
    'ai:update_status',
    'ai:text_search',
    'ai:merge_rrf'
);
