BEGIN;
CREATE TABLE IF NOT EXISTS ci_unified_order (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL,
 account_id uuid NOT NULL, platform text NOT NULL, external_order_id text NOT NULL,
 provider_status text NOT NULL, work_status text NOT NULL DEFAULT 'new'
   CHECK(work_status IN ('new','accepted','packed','dispatched','cancelled','returned')),
 ordered_at timestamptz, dispatch_by timestamptz, city text, pincode text,
 amount numeric(14,2), currency text, payment_mode text,
 first_seen_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,account_id,external_order_id),
 FOREIGN KEY(tenant_id,account_id) REFERENCES ci_channel_account(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS ci_unified_order_list ON ci_unified_order(tenant_id,first_seen_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS ci_unified_order_line (
 tenant_id text NOT NULL, order_id uuid NOT NULL REFERENCES ci_unified_order(id),
 external_line_id text NOT NULL, seller_sku text NOT NULL, master_sku_id uuid,
 quantity integer NOT NULL CHECK(quantity>0), title text,
 PRIMARY KEY(tenant_id,order_id,external_line_id),
 FOREIGN KEY(tenant_id,master_sku_id) REFERENCES ci_master_sku(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS ci_order_timeline (
 id bigserial PRIMARY KEY, tenant_id text NOT NULL, order_id uuid NOT NULL REFERENCES ci_unified_order(id),
 event_key text NOT NULL, event_type text NOT NULL, detail jsonb NOT NULL DEFAULT '{}',
 occurred_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,event_key)
);
CREATE TABLE IF NOT EXISTS ci_alert_recipient (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL,
 name text NOT NULL, role text NOT NULL CHECK(role IN ('packer','dispatcher','manager','returns')),
 mobile_e164 text NOT NULL, platforms text[] NOT NULL DEFAULT '{}',
 event_types text[] NOT NULL DEFAULT '{new_order}', active boolean NOT NULL DEFAULT true,
 muted boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,mobile_e164)
);
CREATE TABLE IF NOT EXISTS ci_order_alert (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL,
 order_id uuid NOT NULL REFERENCES ci_unified_order(id), recipient_id uuid NOT NULL REFERENCES ci_alert_recipient(id),
 event_type text NOT NULL, channel text NOT NULL DEFAULT 'in_app',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','failed','cancelled')),
 attempt_count integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 last_error text, delivered_at timestamptz,
 UNIQUE(tenant_id,order_id,recipient_id,event_type,channel)
);
CREATE INDEX IF NOT EXISTS ci_order_alert_queue ON ci_order_alert(available_at) WHERE status='pending';
CREATE TABLE IF NOT EXISTS ci_return_case (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL,
 account_id uuid NOT NULL, platform text NOT NULL, external_return_id text NOT NULL,
 external_order_id text, provider_status text NOT NULL, reason text,
 qc_status text NOT NULL DEFAULT 'awaiting_receipt'
   CHECK(qc_status IN ('awaiting_receipt','received','approved','rejected')),
 restocked_at timestamptz, first_seen_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,account_id,external_return_id)
);
COMMIT;
