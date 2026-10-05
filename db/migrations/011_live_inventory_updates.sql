BEGIN;
ALTER TABLE ci_sync_cursor ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0;
ALTER TABLE ci_sync_cursor ADD COLUMN IF NOT EXISTS retry_after timestamptz;
CREATE OR REPLACE FUNCTION ci_notify_inventory_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tenant text;
BEGIN
 tenant := CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
 PERFORM pg_notify('ci_inventory_changes',tenant);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
DO $$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['ci_inventory_event','ci_inventory_balance','ci_unified_order','ci_order_timeline','ci_return_case','ci_order_alert','ci_sync_attempt','ci_channel_account','ci_channel_mapping','ci_channel_stock'] LOOP
  IF to_regclass('public.'||table_name) IS NOT NULL THEN
   EXECUTE format('DROP TRIGGER IF EXISTS ci_live_change ON %I',table_name);
   EXECUTE format('CREATE TRIGGER ci_live_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ci_notify_inventory_change()',table_name);
  END IF;
 END LOOP;
END $$;
COMMIT;
