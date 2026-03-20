-- Add KB pipeline node types to bl_node_types for the visual editor.
-- These nodes are registered in the flow engine code but also need DB rows
-- so the Directus visual editor can discover them.

INSERT INTO bl_node_types (id, name, description, category, tier, inputs, outputs, config_schema, estimated_cost_usd, required_role)
VALUES
  ('ai:parse_document', 'Parse Document', 'Fetch and parse a KB document''s content from the database.', 'ai', 'Core',
   '[{"name":"input","data_type":"any","required":true}]',
   '[{"name":"output","data_type":"object","required":true}]',
   '{"type":"object","properties":{"document_id":{"type":"string"},"knowledge_base_id":{"type":"string"}},"required":["document_id","knowledge_base_id"]}',
   0.0, 'Any'),

  ('ai:chunk_text', 'Chunk Text', 'Section-aware variable-size document chunking with overlap.', 'ai', 'Core',
   '[{"name":"input","data_type":"any","required":true}]',
   '[{"name":"output","data_type":"object","required":true}]',
   '{"type":"object","properties":{"content":{},"source_file":{"type":"string"},"target_size":{"type":"integer","default":512},"min_size":{"type":"integer","default":128},"max_size":{"type":"integer","default":768},"overlap_ratio":{"type":"number","default":0.1}},"required":["content"]}',
   0.0, 'Any'),

  ('ai:filter_unchanged', 'Filter Unchanged', 'Content-hash diff: skip chunks that have not changed.', 'ai', 'Core',
   '[{"name":"input","data_type":"any","required":true}]',
   '[{"name":"output","data_type":"object","required":true}]',
   '{"type":"object","properties":{"document_id":{"type":"string"},"chunks":{}},"required":["document_id","chunks"]}',
   0.0, 'Any'),

  ('ai:store_vectors', 'Store Vectors', 'Insert embedded chunks into PostgreSQL with pgvector HNSW index.', 'ai', 'Core',
   '[{"name":"input","data_type":"any","required":true}]',
   '[{"name":"output","data_type":"object","required":true}]',
   '{"type":"object","properties":{"document_id":{"type":"string"},"knowledge_base_id":{"type":"string"},"to_embed":{},"embeddings":{},"to_reuse":{},"to_delete_ids":{}},"required":["document_id","knowledge_base_id","to_embed","embeddings"]}',
   0.0, 'Admin'),

  ('ai:update_status', 'Update Status', 'Update KB document indexing status after ingestion.', 'ai', 'Core',
   '[{"name":"input","data_type":"any","required":true}]',
   '[{"name":"output","data_type":"object","required":true}]',
   '{"type":"object","properties":{"document_id":{"type":"string"},"status":{"type":"string","enum":["processing","indexed","error"]},"chunk_count":{},"token_count":{}},"required":["document_id","status"]}',
   0.0, 'Admin'),

  ('ai:text_search', 'Text Search', 'PostgreSQL full-text search on KB chunks using tsvector.', 'ai', 'Core',
   '[{"name":"input","data_type":"any","required":true}]',
   '[{"name":"output","data_type":"object","required":true}]',
   '{"type":"object","properties":{"query":{"type":"string"},"knowledge_base_id":{"type":"string"},"limit":{"type":"integer","default":15},"ts_config":{"type":"string","default":"simple"}},"required":["query"]}',
   0.0, 'Any'),

  ('ai:merge_rrf', 'Merge RRF', 'Reciprocal Rank Fusion: merge vector + text search results.', 'ai', 'Core',
   '[{"name":"vector_results","data_type":"array","required":true},{"name":"text_results","data_type":"array","required":false}]',
   '[{"name":"output","data_type":"object","required":true}]',
   '{"type":"object","properties":{"vector_results":{},"text_results":{},"k":{"type":"integer","default":60},"top_k":{"type":"integer","default":5},"min_similarity":{"type":"number","default":0.2}},"required":["vector_results"]}',
   0.0, 'Any')

ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  config_schema = EXCLUDED.config_schema;
