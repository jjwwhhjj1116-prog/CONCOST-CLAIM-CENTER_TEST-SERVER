import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

test('CF86 uses one bounded Gemini runtime and provider-specific reasoning controls', () => {
  const source = read('apps/cloudflare/src/index.ts');
  assert.equal((source.match(/generativelanguage\.googleapis\.com\/v1beta\/models/g) ?? []).length, 1);
  assert.doesNotMatch(source, /v1beta\/interactions/u);
  assert.match(source, /thinkingConfig: \{ thinkingLevel: request\.reasoningEffort \}/u);
  assert.match(source, /const retryableStatuses = new Set\(\[429, 500, 502, 503, 504\]\)/u);
  assert.match(source, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/u);
  assert.match(source, /normalizedOpenAiReasoningEffort\(route\.reasoningEffort\)/u);
  assert.match(source, /const isConnectionCheck = maxOutputTokens <= 128/u);
  assert.match(source, /body\.thinking = isConnectionCheck \? \{ type: 'disabled' \} : \{ type: 'adaptive' \}/u);
  assert.match(source, /if \(!isConnectionCheck\) body\.output_config = \{ effort: normalizedAnthropicReasoningEffort\(route\.reasoningEffort\) \}/u);
  assert.match(source, /value === 'max' \|\| value === 'xhigh' \|\| value === 'high' \|\| value === 'low'/u);
  assert.match(source, /ANTHROPIC_BILLING_REQUIRED/u);
  assert.match(source, /ANTHROPIC_REASONING_CONFIG_REJECTED/u);
  assert.match(source, /ANTHROPIC_WORKSPACE_ID_REQUIRED/u);
  assert.match(source, /headers\['anthropic-workspace-id'\] = credential\.workspaceId/u);
  assert.match(source, /normalizedAnthropicReasoningEffort\(route\.reasoningEffort\) === 'high'/u);
  assert.match(source, /delete defaultHighBody\.thinking/u);
  assert.match(source, /delete defaultHighBody\.output_config/u);
  assert.match(source, /function safeProviderDiagnostic/u);
  assert.match(source, /const probeReasoningEffort = provider === 'ANTHROPIC' \? 'high' : 'low'/u);
  assert.match(source, /const probeOutputTokens = provider === 'ANTHROPIC' \? 1024 : 64/u);
  assert.match(source, /credential, 30_000, probeOutputTokens, true\)/u);
  assert.match(source, /const combinedRoute=\{\.\.\.route,reasoningEffort:'medium'\}/u);
});

test('CF86 persists verified connection health instead of equating a stored key with a working provider', () => {
  const migration = read('apps/cloudflare/migrations/0056_cf86_ai_runtime_reliability.sql');
  const source = read('apps/cloudflare/src/index.ts');
  const settings = read('apps/web/src/routes/PreviewSettings.tsx');
  assert.match(migration, /CREATE TABLE preview_ai_provider_health/u);
  assert.match(source, /status:'HEALTHY'/u);
  assert.match(source, /status:'FAILED'/u);
  assert.match(settings, /연결 정상/u);
  assert.match(settings, /연결 오류/u);
  assert.match(settings, /확인 필요/u);
  assert.match(settings, /Anthropic Workspace ID/u);
  assert.match(settings, /Workspace ID 저장/u);
  const workspaceMigration = read('apps/cloudflare/migrations/0057_cf87_anthropic_workspace.sql');
  assert.match(workspaceMigration, /provider_workspace_id/u);
});

test('CF86 progress UI reports observed state and aligned client timeouts', () => {
  const progress = read('apps/web/src/components/AiGenerationProgressModal.tsx');
  const caseManagement = read('apps/web/src/case-management/CaseManagement.tsx');
  const cards = read('apps/web/src/routes/BusinessCardContacts.tsx');
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const report = read('apps/web/src/routes/PreviewReportStudio.tsx');
  assert.doesNotMatch(progress, /setProgress|stageIndex|예상 진행률/u);
  assert.match(progress, /아직 완료된 단계는 없습니다/u);
  assert.match(progress, /AI 공급자 응답 대기/u);
  assert.match(caseManagement, /timeoutMs:55_000/u);
  assert.match(cards, /timeoutMs:55_000/u);
  assert.match(proposal, /timeoutMs:generationMode==='AI'\?105_000:30_000/u);
  assert.match(report, /timeoutMs: 105_000/u);
});
