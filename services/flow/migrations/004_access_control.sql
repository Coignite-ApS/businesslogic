-- Access control layer for flow engine
-- Adds audit columns, node permission metadata, and per-role node permissions.

-- Audit columns on bl_flows
ALTER TABLE bl_flows ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE bl_flows ADD COLUMN IF NOT EXISTS updated_by UUID;

-- Node permission metadata in registry
ALTER TABLE bl_node_types ADD COLUMN IF NOT EXISTS required_role TEXT NOT NULL DEFAULT 'any'
    CHECK (required_role IN ('any', 'admin'));
UPDATE bl_node_types SET required_role = 'admin' WHERE id IN ('core:database', 'core:redis');

-- Node permissions per Directus role (consumed by editor to show/hide nodes)
CREATE TABLE IF NOT EXISTS bl_node_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID NOT NULL,          -- FK to directus_roles (not enforced — cross-system)
    node_type_id TEXT NOT NULL,     -- FK to bl_node_types(id)
    allowed BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bl_node_perms_role_node
    ON bl_node_permissions (role_id, node_type_id);
