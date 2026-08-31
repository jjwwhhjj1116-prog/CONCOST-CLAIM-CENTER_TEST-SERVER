PRAGMA foreign_keys = ON;

-- CF79: official case-law grounding, member login alerts, and hourly report
-- backup snapshots. Operational report revisions remain append-only for
-- optimistic concurrency and approvals; this table is the user-facing backup
-- layer and therefore stores at most one automatic snapshot per hour.

CREATE TABLE IF NOT EXISTS preview_report_hourly_backups (
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
  CHECK (backup_hour GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]'),
  UNIQUE (case_id, backup_hour),
  FOREIGN KEY (case_id) REFERENCES preview_report_drafts(case_id),
  FOREIGN KEY (saved_by) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_report_hourly_backups_case
  ON preview_report_hourly_backups(case_id, saved_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_report_hourly_backup_update_guard
BEFORE UPDATE ON preview_report_hourly_backups
BEGIN SELECT RAISE(ABORT, 'hourly report backups are immutable'); END;

CREATE TRIGGER IF NOT EXISTS preview_report_hourly_backup_delete_guard
BEFORE DELETE ON preview_report_hourly_backups
BEGIN SELECT RAISE(ABORT, 'hourly report backups are immutable'); END;

CREATE TABLE IF NOT EXISTS preview_report_case_law_sources (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  case_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  chapter_code TEXT NOT NULL,
  prec_id TEXT NOT NULL,
  court_name TEXT NOT NULL,
  case_number TEXT NOT NULL,
  decision_date TEXT NOT NULL,
  case_name TEXT NOT NULL,
  holding_text TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  official_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  selection_status TEXT NOT NULL DEFAULT 'ACTIVE',
  selected_by TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  excluded_by TEXT,
  excluded_at TEXT,
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (length(chapter_id) BETWEEN 8 AND 100),
  CHECK (length(chapter_code) BETWEEN 2 AND 40),
  CHECK (length(prec_id) BETWEEN 1 AND 120),
  CHECK (length(case_number) BETWEEN 1 AND 200),
  CHECK (length(case_name) BETWEEN 1 AND 500),
  CHECK (length(snapshot_json) <= 3000000 AND json_valid(snapshot_json)),
  CHECK (length(source_sha256) = 64),
  CHECK (official_url LIKE 'https://www.law.go.kr/%'),
  CHECK (selection_status IN ('ACTIVE','EXCLUDED')),
  CHECK ((selection_status='ACTIVE' AND excluded_by IS NULL AND excluded_at IS NULL)
    OR (selection_status='EXCLUDED' AND excluded_by IS NOT NULL AND excluded_at IS NOT NULL)),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (selected_by) REFERENCES preview_users(id),
  FOREIGN KEY (excluded_by) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_case_law_chapter
  ON preview_report_case_law_sources(case_id, chapter_id, selection_status, selected_at DESC);

CREATE TABLE IF NOT EXISTS preview_report_case_law_citations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  case_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  citation_text TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  validation_note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (validation_status IN ('VERIFIED','INSUFFICIENT','MISMATCH','REVIEW_REQUIRED')),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (source_id) REFERENCES preview_report_case_law_sources(id),
  FOREIGN KEY (generation_id) REFERENCES preview_report_ai_generations(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_case_law_citations_chapter
  ON preview_report_case_law_citations(case_id, chapter_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_case_law_source_delete_guard
BEFORE DELETE ON preview_report_case_law_sources
BEGIN SELECT RAISE(ABORT, 'case-law source snapshots cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS preview_case_law_source_update_guard
BEFORE UPDATE ON preview_report_case_law_sources
WHEN NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.case_id<>OLD.case_id
  OR NEW.chapter_id<>OLD.chapter_id OR NEW.chapter_code<>OLD.chapter_code OR NEW.prec_id<>OLD.prec_id
  OR NEW.court_name<>OLD.court_name OR NEW.case_number<>OLD.case_number OR NEW.decision_date<>OLD.decision_date
  OR NEW.case_name<>OLD.case_name OR NEW.holding_text<>OLD.holding_text OR NEW.summary_text<>OLD.summary_text
  OR NEW.snapshot_json<>OLD.snapshot_json OR NEW.source_sha256<>OLD.source_sha256 OR NEW.official_url<>OLD.official_url
  OR NEW.fetched_at<>OLD.fetched_at OR NEW.selected_by<>OLD.selected_by OR NEW.selected_at<>OLD.selected_at
  OR OLD.selection_status<>'ACTIVE' OR NEW.selection_status<>'EXCLUDED'
BEGIN SELECT RAISE(ABORT, 'case-law snapshot identity is immutable'); END;

CREATE TRIGGER IF NOT EXISTS preview_case_law_citation_update_guard
BEFORE UPDATE ON preview_report_case_law_citations
BEGIN SELECT RAISE(ABORT, 'case-law citations are immutable'); END;

CREATE TRIGGER IF NOT EXISTS preview_case_law_citation_delete_guard
BEFORE DELETE ON preview_report_case_law_citations
BEGIN SELECT RAISE(ABORT, 'case-law citations are immutable'); END;

CREATE TABLE IF NOT EXISTS preview_member_alert_reads (
  organization_id TEXT NOT NULL DEFAULT 'concost',
  user_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, event_key),
  CHECK (organization_id = 'concost'),
  CHECK (length(event_key) BETWEEN 8 AND 200),
  FOREIGN KEY (user_id) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_member_alert_reads_user
  ON preview_member_alert_reads(user_id, read_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_member_alert_reads_update_guard
BEFORE UPDATE ON preview_member_alert_reads
BEGIN SELECT RAISE(ABORT, 'member alert reads are immutable'); END;

CREATE TRIGGER IF NOT EXISTS preview_member_alert_reads_delete_guard
BEFORE DELETE ON preview_member_alert_reads
BEGIN SELECT RAISE(ABORT, 'member alert reads cannot be deleted'); END;
