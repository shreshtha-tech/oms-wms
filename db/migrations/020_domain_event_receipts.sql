BEGIN;
CREATE TABLE IF NOT EXISTS ci_event_receipt (
 tenant_id text NOT NULL, consumer text NOT NULL, event_id uuid NOT NULL,
 digest text NOT NULL, aggregate_key text NOT NULL, sequence bigint NOT NULL CHECK(sequence>0),
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,consumer,event_id), UNIQUE(tenant_id,consumer,aggregate_key,sequence)
);
CREATE TABLE IF NOT EXISTS ci_event_checkpoint (
 tenant_id text NOT NULL, consumer text NOT NULL, aggregate_key text NOT NULL,
 sequence bigint NOT NULL DEFAULT 0, PRIMARY KEY(tenant_id,consumer,aggregate_key)
);
CREATE TABLE IF NOT EXISTS ci_domain_outbox (
 event_id uuid PRIMARY KEY, tenant_id text NOT NULL, envelope jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ci_receipt_authorization (
 tenant_id text NOT NULL, po_no text NOT NULL, digest text NOT NULL,
 limits jsonb NOT NULL, PRIMARY KEY(tenant_id,po_no)
);
COMMIT;
