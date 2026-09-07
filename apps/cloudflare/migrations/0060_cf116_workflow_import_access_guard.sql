-- Match accessiblePreviewCase: active admin OR explicit project assignment.
-- Preserve every business/audit row and the external-AI consent requirement.
DROP TRIGGER IF EXISTS preview_workflow_ai_import_insert_guard;
CREATE TRIGGER preview_workflow_ai_import_insert_guard
BEFORE INSERT ON preview_workflow_ai_imports
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c
  JOIN preview_users u ON u.id=NEW.created_by AND u.is_active=1
  WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id
    AND c.deleted_at IS NULL
    AND (
      EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE r.value='admin')
      OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=c.id AND a.user_id=u.id)
    )
)
OR (
  NEW.status<>'BLOCKED_BY_POLICY'
  AND NOT COALESCE((NEW.model_code='local-structured-v1' AND NEW.error_code='LOCAL_STRUCTURED_FALLBACK' AND NEW.status='SUCCEEDED'),0)
  AND NEW.data_class IN ('INTERNAL','CONFIDENTIAL','RESTRICTED')
  AND NOT EXISTS (
    SELECT 1 FROM preview_ai_data_governance g
    WHERE g.organization_id=NEW.organization_id
      AND g.confidential_external_ai_enabled=1
      AND g.provider_service_tier IN ('PAID_NO_PRODUCT_IMPROVEMENT','VERTEX_AI_ENTERPRISE')
  )
)
BEGIN SELECT RAISE(ABORT,'workflow AI import access or external data policy is invalid'); END;
