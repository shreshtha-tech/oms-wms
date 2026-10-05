BEGIN;
CREATE TABLE IF NOT EXISTS ci_order_line_state (
  tenant_id text NOT NULL,
  source text NOT NULL,
  external_order_id text NOT NULL,
  external_line_id text NOT NULL,
  terminal_status text NOT NULL CHECK (terminal_status IN ('canceled','shipped')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,source,external_order_id,external_line_id)
);
COMMIT;
