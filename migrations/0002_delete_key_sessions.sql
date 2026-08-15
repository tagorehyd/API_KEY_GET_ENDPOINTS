CREATE TABLE IF NOT EXISTS delete_key_sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS delete_key_session_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  key_name TEXT NOT NULL,
  selected INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES delete_key_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_delete_key_sessions_expires_at
  ON delete_key_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_delete_key_session_items_session_id
  ON delete_key_session_items (session_id);
