BEGIN;
CREATE TABLE IF NOT EXISTS ci_auth_session (
 token_hash text PRIMARY KEY,
 username text NOT NULL,
 credential_fingerprint text,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ci_auth_session ADD COLUMN IF NOT EXISTS credential_fingerprint text;
CREATE INDEX IF NOT EXISTS ci_auth_session_expiry ON ci_auth_session(expires_at);
COMMIT;
