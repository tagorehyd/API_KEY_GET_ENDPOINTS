CREATE TABLE IF NOT EXISTS set_key_sessions (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL UNIQUE,
  step TEXT NOT NULL,
  key_name TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_set_key_sessions_expires_at
  ON set_key_sessions (expires_at);
