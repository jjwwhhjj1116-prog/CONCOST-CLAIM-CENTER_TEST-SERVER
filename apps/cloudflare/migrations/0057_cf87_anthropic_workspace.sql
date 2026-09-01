-- CF87: Anthropic identity-linked API keys require an explicit workspace ID.
-- Workspace IDs are routing identifiers, not API secrets; API keys remain
-- AES-256-GCM encrypted in the existing credential columns.

ALTER TABLE preview_ai_credentials ADD COLUMN provider_workspace_id TEXT;
ALTER TABLE preview_ai_credential_history ADD COLUMN provider_workspace_id TEXT;
