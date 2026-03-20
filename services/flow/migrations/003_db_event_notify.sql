-- Migration 003: DB event notification function for flow triggers.
--
-- This creates the PG function that sends NOTIFY on bl_flow_events channel.
-- To enable DB event triggers for a collection, attach this function as a trigger:
--
--   CREATE TRIGGER bl_flow_notify_items
--     AFTER INSERT OR UPDATE OR DELETE ON items
--     FOR EACH ROW EXECUTE FUNCTION bl_notify_flow_event();

CREATE OR REPLACE FUNCTION bl_notify_flow_event() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('bl_flow_events', json_build_object(
    'collection', TG_TABLE_NAME,
    'event', TG_OP,
    'keys', CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD.id) ELSE to_jsonb(NEW.id) END
  )::text);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
