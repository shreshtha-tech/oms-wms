BEGIN;
CREATE TABLE IF NOT EXISTS ci_sales_program (
 tenant_id text NOT NULL, account_id uuid NOT NULL, program_key text NOT NULL,
 stock_mode text NOT NULL DEFAULT 'unverified' CHECK(stock_mode IN ('unverified','shared','dedicated','custody')),
 reference text NOT NULL DEFAULT '', last_report_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,account_id,program_key),
 FOREIGN KEY(tenant_id,account_id) REFERENCES ci_channel_account(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ci_unified_order_account_identity ON ci_unified_order(tenant_id,account_id,id);
CREATE TABLE IF NOT EXISTS ci_program_order (
 tenant_id text NOT NULL, account_id uuid NOT NULL, program_key text NOT NULL, order_id uuid NOT NULL,
 reference text NOT NULL, observed_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,order_id),
 FOREIGN KEY(tenant_id,account_id,program_key) REFERENCES ci_sales_program(tenant_id,account_id,program_key),
 FOREIGN KEY(tenant_id,account_id,order_id) REFERENCES ci_unified_order(tenant_id,account_id,id)
);
CREATE TABLE IF NOT EXISTS ci_program_stock (
 tenant_id text NOT NULL, account_id uuid NOT NULL, program_key text NOT NULL,
 external_sku text NOT NULL, external_location_id text NOT NULL, master_sku_id uuid NOT NULL,
 observed_quantity bigint NOT NULL CHECK(observed_quantity>=0), observed_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,account_id,program_key,external_sku,external_location_id),
 FOREIGN KEY(tenant_id,account_id,program_key) REFERENCES ci_sales_program(tenant_id,account_id,program_key),
 FOREIGN KEY(tenant_id,master_sku_id) REFERENCES ci_master_sku(tenant_id,id)
);
DO $$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['ci_sales_program','ci_program_order','ci_program_stock'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS ci_live_change ON %I',table_name);
  EXECUTE format('CREATE TRIGGER ci_live_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ci_notify_inventory_change()',table_name);
 END LOOP;
END $$;
COMMIT;
