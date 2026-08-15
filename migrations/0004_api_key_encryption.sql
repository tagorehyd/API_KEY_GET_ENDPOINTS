ALTER TABLE api_keys ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN masked_value TEXT;

UPDATE api_keys
SET masked_value = substr(value, 1, 2) || '…' || substr(value, -4)
WHERE masked_value IS NULL AND COALESCE(encrypted, 0) = 0;
