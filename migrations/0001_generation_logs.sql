-- LOG1 additive schema. Run against production only after separate approval.
-- Existing app_state / preferences / Last.fm catalogs are untouched.
CREATE TABLE IF NOT EXISTS generation_logs (
  record_order INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (account_id, generation_id)
);
CREATE INDEX IF NOT EXISTS generation_logs_retention
  ON generation_logs (account_id, record_order DESC);
