BEGIN;
CREATE TABLE IF NOT EXISTS ci_return_receipt (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL,
 return_id uuid NOT NULL REFERENCES ci_return_case(id), request_id uuid NOT NULL,
 master_sku_id uuid NOT NULL, location_id uuid NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>0), event_id uuid NOT NULL REFERENCES ci_inventory_event(id),
 approved_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,request_id)
);
CREATE INDEX IF NOT EXISTS ci_return_receipt_case ON ci_return_receipt(tenant_id,return_id);
COMMIT;
