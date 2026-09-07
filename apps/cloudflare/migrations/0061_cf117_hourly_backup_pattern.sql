-- D1 limits each LIKE/GLOB pattern to 50 bytes. The original 53-byte CHECK
-- aborts report saves even though it passes in default local SQLite.
-- SQLite cannot ALTER a CHECK. Copy every value before replacing the old
-- structure, inside the migration runner's transaction. Signed exports retain
-- the pre-migration schema. No foreign keys reference this backup table.
-- Do not retain the invalid CHECK in an archive: it breaks integrity_check too.

CREATE TABLE preview_report_hourly_backups_cf117_repaired (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  case_id TEXT NOT NULL,
  report_version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  editor_json TEXT,
  content_sha256 TEXT NOT NULL,
  backup_hour TEXT NOT NULL,
  saved_by TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (report_version >= 1),
  CHECK (length(title) BETWEEN 1 AND 300),
  CHECK (length(content) <= 500000),
  CHECK (editor_json IS NULL OR json_valid(editor_json)),
  CHECK (length(content_sha256) = 64),
  CHECK (length(backup_hour) = 13
    AND substr(backup_hour, 1, 10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND substr(backup_hour, 11, 3) GLOB 'T[0-9][0-9]'),
  UNIQUE (case_id, backup_hour),
  FOREIGN KEY (case_id) REFERENCES preview_report_drafts(case_id),
  FOREIGN KEY (saved_by) REFERENCES preview_users(id)
);

INSERT INTO preview_report_hourly_backups_cf117_repaired
  (id, organization_id, case_id, report_version, title, content, editor_json,
   content_sha256, backup_hour, saved_by, saved_at)
SELECT id, organization_id, case_id, report_version, title, content, editor_json,
  content_sha256, backup_hour, saved_by, saved_at
FROM preview_report_hourly_backups;

DROP TABLE preview_report_hourly_backups;
ALTER TABLE preview_report_hourly_backups_cf117_repaired RENAME TO preview_report_hourly_backups;

CREATE INDEX idx_preview_report_hourly_backups_case
  ON preview_report_hourly_backups(case_id, saved_at DESC);

CREATE TRIGGER preview_report_hourly_backup_update_guard
BEFORE UPDATE ON preview_report_hourly_backups
BEGIN SELECT RAISE(ABORT, 'hourly report backups are immutable'); END;

CREATE TRIGGER preview_report_hourly_backup_delete_guard
BEFORE DELETE ON preview_report_hourly_backups
BEGIN SELECT RAISE(ABORT, 'hourly report backups are immutable'); END;
