-- Rollback: 004_permissions_v3
-- Reverts v3 null semantics back to v2 empty-array semantics
-- Adds back empty resources/actions arrays where they were removed

UPDATE api_keys
SET permissions = jsonb_build_object(
    'services',
    (
        SELECT jsonb_object_agg(
            svc_key,
            svc_val
              || CASE WHEN NOT (svc_val ? 'resources') THEN '{"resources":[]}'::jsonb ELSE '{}'::jsonb END
              || CASE WHEN NOT (svc_val ? 'actions') THEN '{"actions":[]}'::jsonb ELSE '{}'::jsonb END
        )
        FROM jsonb_each(permissions->'services') AS t(svc_key, svc_val)
    )
)
WHERE permissions IS NOT NULL
  AND permissions ? 'services';

COMMENT ON COLUMN api_keys.permissions IS 'v2 resource-level permissions: {"services":{"calc":{"enabled":true,"resources":["uuid"],"actions":["execute"]}}}';
