BEGIN;
CREATE TABLE IF NOT EXISTS ci_catalog_source_row (
  tenant_id text NOT NULL,
  file_sha256 text NOT NULL,
  file_name text NOT NULL,
  sheet_name text NOT NULL,
  row_number integer NOT NULL,
  sku text NOT NULL,
  product_name text,
  listed_stock bigint CHECK(listed_stock>=0),
  pack_size integer CHECK(pack_size>0),
  listing_status text,
  channel_hint text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,file_sha256,sheet_name,row_number),
  FOREIGN KEY(tenant_id,sku) REFERENCES ci_master_sku(tenant_id,sku)
);
CREATE INDEX IF NOT EXISTS ci_catalog_source_sku ON ci_catalog_source_row(tenant_id,sku);
COMMIT;
