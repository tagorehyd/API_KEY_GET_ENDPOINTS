CREATE TABLE IF NOT EXISTS api_keys (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  key_name TEXT NOT NULL,
  requester_ip TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_status_expires_at
  ON approval_requests (status, expires_at);
