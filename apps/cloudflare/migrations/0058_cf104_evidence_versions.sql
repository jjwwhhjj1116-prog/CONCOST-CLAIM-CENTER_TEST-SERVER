-- CF104: preserve immutable files; store version decisions separately.
CREATE TABLE IF NOT EXISTS preview_evidence_versions (
  evidence_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  category TEXT NOT NULL,
  group_id TEXT NOT NULL,
  version_num INTEGER NOT NULL CHECK(version_num >= 1),
  is_latest INTEGER NOT NULL DEFAULT 1 CHECK(is_latest IN (0,1)),
  supersedes_id TEXT UNIQUE,
  change_summary_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(change_summary_json)),
  model_code TEXT NOT NULL DEFAULT '',
  UNIQUE(group_id,version_num),
  FOREIGN KEY(case_id) REFERENCES preview_cases(id),
  FOREIGN KEY(supersedes_id) REFERENCES preview_evidence_versions(evidence_id)
);
CREATE INDEX IF NOT EXISTS idx_evidence_versions_scope ON preview_evidence_versions(organization_id,case_id,category,is_latest);
CREATE TRIGGER IF NOT EXISTS preview_evidence_version_parent_guard BEFORE INSERT ON preview_evidence_versions
WHEN NEW.supersedes_id IS NOT NULL BEGIN
  SELECT RAISE(ABORT,'evidence version conflict') WHERE NOT EXISTS (
    SELECT 1 FROM preview_evidence_versions p WHERE p.evidence_id=NEW.supersedes_id
    AND p.organization_id=NEW.organization_id AND p.case_id=NEW.case_id AND p.category=NEW.category
    AND p.group_id=NEW.group_id AND p.is_latest=1 AND NEW.version_num=p.version_num+1
  );
END;
CREATE TRIGGER IF NOT EXISTS preview_evidence_version_archive AFTER INSERT ON preview_evidence_versions
WHEN NEW.supersedes_id IS NOT NULL BEGIN
  UPDATE preview_evidence_versions SET is_latest=0 WHERE evidence_id=NEW.supersedes_id;
END;
CREATE TRIGGER IF NOT EXISTS preview_evidence_version_update_guard BEFORE UPDATE ON preview_evidence_versions BEGIN
  SELECT RAISE(ABORT,'version identity is immutable') WHERE NEW.evidence_id<>OLD.evidence_id OR NEW.organization_id<>OLD.organization_id
    OR NEW.case_id<>OLD.case_id OR NEW.category<>OLD.category OR NEW.group_id<>OLD.group_id OR NEW.version_num<>OLD.version_num
    OR NEW.supersedes_id IS NOT OLD.supersedes_id OR NEW.change_summary_json<>OLD.change_summary_json OR NEW.model_code<>OLD.model_code
    OR OLD.is_latest<>1 OR NEW.is_latest<>0;
END;
CREATE TRIGGER IF NOT EXISTS preview_evidence_version_delete_guard BEFORE DELETE ON preview_evidence_versions BEGIN SELECT RAISE(ABORT,'versions are retained'); END;

CREATE TABLE IF NOT EXISTS preview_evidence_upload_reviews (
  id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, case_id TEXT NOT NULL,
  category TEXT NOT NULL, user_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
  base_id TEXT NOT NULL, snapshot_hash TEXT NOT NULL, analysis_json TEXT NOT NULL CHECK(json_valid(analysis_json)),
  model_code TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT,
  FOREIGN KEY(case_id) REFERENCES preview_cases(id), FOREIGN KEY(user_id) REFERENCES preview_users(id)
);
CREATE TABLE IF NOT EXISTS preview_evidence_upload_locks (
  organization_id TEXT NOT NULL, case_id TEXT NOT NULL, category TEXT NOT NULL,
  id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(organization_id,case_id,category),
  FOREIGN KEY(case_id) REFERENCES preview_cases(id), FOREIGN KEY(user_id) REFERENCES preview_users(id)
);

-- The application and database must enforce the same department OR assignment policy.
DROP TRIGGER IF EXISTS preview_case_evidence_insert_guard;
CREATE TRIGGER preview_case_evidence_insert_guard BEFORE INSERT ON preview_case_evidence BEGIN
  SELECT RAISE(ABORT,'case evidence scope or actor is invalid') WHERE NOT EXISTS (
    SELECT 1 FROM preview_cases c JOIN preview_users u ON u.id=NEW.uploaded_by_id
    WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id AND c.deleted_at IS NULL
    AND u.is_active=1 AND u.display_name=NEW.uploaded_by_name
    AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value IN ('admin','ceo','director','pm','staff','reviewer'))
    AND (u.department_code IN ('CLAIM_CENTER','MANAGEMENT_SUPPORT') OR EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value='admin')
      OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=NEW.case_id AND a.user_id=u.id))
  );
END;
DROP TRIGGER IF EXISTS preview_google_case_operation_insert_guard;
CREATE TRIGGER preview_google_case_operation_insert_guard BEFORE INSERT ON preview_google_case_operations BEGIN
  SELECT RAISE(ABORT,'Google case operation scope or actor is invalid') WHERE NOT EXISTS (
    SELECT 1 FROM preview_cases c JOIN preview_users u ON u.id=NEW.created_by
    WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id AND c.deleted_at IS NULL AND u.is_active=1
    AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value IN ('admin','ceo','director','pm','staff','reviewer'))
    AND (u.department_code IN ('CLAIM_CENTER','MANAGEMENT_SUPPORT') OR EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value='admin')
      OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=NEW.case_id AND a.user_id=u.id))
  );
END;
DROP TRIGGER IF EXISTS preview_google_case_evidence_insert_guard;
CREATE TRIGGER preview_google_case_evidence_insert_guard BEFORE INSERT ON preview_google_case_evidence BEGIN
  SELECT RAISE(ABORT,'Google case evidence requires its pending reserved operation') WHERE NOT EXISTS (
    SELECT 1 FROM preview_google_case_operations o WHERE o.id=NEW.operation_id AND o.organization_id=NEW.organization_id AND o.case_id=NEW.case_id
    AND o.category=NEW.category AND o.idempotency_key=NEW.idempotency_key AND o.request_fingerprint=NEW.request_fingerprint AND o.status='PENDING' AND o.created_by=NEW.uploaded_by_id
  );
  SELECT RAISE(ABORT,'Google case evidence actor is invalid') WHERE NOT EXISTS (
    SELECT 1 FROM preview_users u WHERE u.id=NEW.uploaded_by_id AND u.is_active=1 AND u.display_name=NEW.uploaded_by_name
    AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value IN ('admin','ceo','director','pm','staff','reviewer'))
    AND (u.department_code IN ('CLAIM_CENTER','MANAGEMENT_SUPPORT') OR EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value='admin')
      OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=NEW.case_id AND a.user_id=u.id))
  );
END;
