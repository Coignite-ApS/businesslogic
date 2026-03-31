-- Migration: permissions v3 — null=allow, []=deny
-- Under v2 (deny-by-default), empty arrays meant no access.
-- No production key intentionally restricted all resources/actions, so convert
-- any [] resources or [] actions → remove the key (=null=full access) to match v3 semantics.

-- Convert empty resources/actions arrays → absent key (null semantics) within each service entry.
-- The permissions column has format: {"services": {"calc": {"enabled": true, "resources": [], "actions": []}}}
UPDATE api_keys
SET permissions = jsonb_build_object(
    'services',
    (
        SELECT jsonb_object_agg(
            svc_key,
            svc_val
              -- remove 'resources' key if it's an empty array
              - CASE WHEN (svc_val->'resources') = '[]'::jsonb THEN 'resources' ELSE '' END
              -- remove 'actions' key if it's an empty array
              - CASE WHEN (svc_val->'actions') = '[]'::jsonb THEN 'actions' ELSE '' END
        )
        FROM jsonb_each(permissions->'services') AS t(svc_key, svc_val)
    )
)
WHERE permissions IS NOT NULL
  AND permissions ? 'services'
  AND EXISTS (
    SELECT 1
    FROM jsonb_each(permissions->'services') AS t(svc_key, svc_val)
    WHERE (svc_val->'resources') = '[]'::jsonb
       OR (svc_val->'actions') = '[]'::jsonb
  );

-- Update comment to reflect v3 semantics
COMMENT ON COLUMN api_keys.permissions IS 'v3 permissions: null=full access, {"services":{"calc":{"enabled":true,"resources":null,"actions":null}}}. resources/actions: null=all, []=none, ["*"]=all, explicit list=match.';
