-- CF121: separate, encrypted law API credential. Existing AI/Google settings are untouched.
CREATE TABLE IF NOT EXISTS preview_law_api_settings (
  organization_id TEXT PRIMARY KEY CHECK (organization_id = 'concost'),
  ciphertext_hex TEXT NOT NULL CHECK (length(ciphertext_hex) >= 32 AND ciphertext_hex NOT GLOB '*[^0-9a-f]*'),
  iv_hex TEXT NOT NULL CHECK (length(iv_hex) = 24 AND iv_hex NOT GLOB '*[^0-9a-f]*'),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_by TEXT NOT NULL REFERENCES preview_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS preview_law_api_settings_insert_guard
BEFORE INSERT ON preview_law_api_settings
WHEN NOT EXISTS (SELECT 1 FROM preview_users u, json_each(u.roles_json) r WHERE u.id=NEW.updated_by AND u.is_active=1 AND r.value='admin')
BEGIN SELECT RAISE(ABORT,'law API settings require active Admin'); END;
CREATE TRIGGER IF NOT EXISTS preview_law_api_settings_update_guard
BEFORE UPDATE ON preview_law_api_settings
WHEN NEW.organization_id<>OLD.organization_id OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT EXISTS (SELECT 1 FROM preview_users u, json_each(u.roles_json) r WHERE u.id=NEW.updated_by AND u.is_active=1 AND r.value='admin')
BEGIN SELECT RAISE(ABORT,'law API settings require Admin and optimistic version'); END;
CREATE TRIGGER IF NOT EXISTS preview_law_api_settings_delete_guard
BEFORE DELETE ON preview_law_api_settings
BEGIN SELECT RAISE(ABORT,'law API settings cannot be deleted directly'); END;
