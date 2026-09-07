-- Navigation is not a new report revision. Content and presentation remain versioned.
DROP TRIGGER IF EXISTS preview_report_draft_version_guard;
CREATE TRIGGER preview_report_draft_version_guard
BEFORE UPDATE ON preview_report_drafts
WHEN NOT (
  (NEW.version = OLD.version + 1 AND NEW.updated_at > OLD.updated_at)
  OR (
    NEW.version = OLD.version
    AND NEW.title IS OLD.title
    AND NEW.content IS OLD.content
    AND NEW.editor_json IS OLD.editor_json
    AND NEW.updated_by IS OLD.updated_by
    AND NEW.updated_at IS OLD.updated_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'preview report draft optimistic version is invalid');
END;
