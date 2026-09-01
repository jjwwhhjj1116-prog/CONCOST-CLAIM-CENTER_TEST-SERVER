-- CF85: Studio-authenticated department access for the Claim Center Drive.
-- Existing approved members belong to the Claim Center for continuity. New
-- accounts remain unassigned until an Admin explicitly selects a department.

ALTER TABLE preview_users ADD COLUMN department_code TEXT NOT NULL DEFAULT 'UNASSIGNED'
  CHECK (department_code IN ('MANAGEMENT_SUPPORT','TECHNICAL_HQ','CLAIM_CENTER','DEVELOPMENT','UNASSIGNED'));

UPDATE preview_users
SET department_code='CLAIM_CENTER', version=version+1
WHERE is_active=1;

-- Extend the append-only account audit vocabulary for department changes.
DROP TRIGGER IF EXISTS preview_user_admin_events_update_guard;
DROP TRIGGER IF EXISTS preview_user_admin_events_delete_guard;

ALTER TABLE preview_user_admin_events RENAME TO preview_user_admin_events_cf38;

CREATE TABLE preview_user_admin_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('ACCOUNT_CREATED','ACCOUNT_ACTIVATED','ACCOUNT_DEACTIVATED','PASSWORD_RESET','DEPARTMENT_CHANGED')),
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (json_valid(detail_json)),
  FOREIGN KEY (actor_id) REFERENCES preview_users(id),
  FOREIGN KEY (target_user_id) REFERENCES preview_users(id)
);

INSERT INTO preview_user_admin_events(id,actor_id,target_user_id,action,detail_json,created_at)
SELECT id,actor_id,target_user_id,action,detail_json,created_at
FROM preview_user_admin_events_cf38;

DROP TABLE preview_user_admin_events_cf38;

CREATE TRIGGER preview_user_admin_events_update_guard
BEFORE UPDATE ON preview_user_admin_events
BEGIN
  SELECT RAISE(ABORT, 'user account audit is append-only');
END;

CREATE TRIGGER preview_user_admin_events_delete_guard
BEFORE DELETE ON preview_user_admin_events
BEGIN
  SELECT RAISE(ABORT, 'user account audit is append-only');
END;

CREATE INDEX IF NOT EXISTS idx_preview_users_department_active
  ON preview_users(department_code,is_active);
