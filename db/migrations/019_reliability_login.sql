BEGIN;
CREATE TABLE IF NOT EXISTS ci_login_rate_limit (
  key text PRIMARY KEY,
  window_started timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0)
);
CREATE INDEX IF NOT EXISTS ci_login_rate_limit_cleanup ON ci_login_rate_limit(window_started);
COMMIT;
