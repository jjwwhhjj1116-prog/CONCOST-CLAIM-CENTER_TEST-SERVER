import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string): string => readFileSync(path, 'utf8');

const shell = read('apps/web/src/layout/AppShell.tsx');
const help = read('apps/web/src/layout/workspace-help-content.ts');
const router = read('apps/web/src/routes/Router.tsx');
const settings = read('apps/web/src/routes/PreviewSettings.tsx');
const drive = read('apps/web/src/routes/PreviewEvidenceHub.tsx');

const ordinaryMemberSources = [
  shell,
  router,
  read('apps/web/src/case-management/CaseManagement.tsx'),
  read('apps/web/src/proposals/ProposalView.tsx'),
  read('apps/web/src/routes/BusinessCardContacts.tsx'),
  read('apps/web/src/routes/PreviewApprovalInbox.tsx'),
  read('apps/web/src/routes/PreviewCloudDraft.tsx'),
  read('apps/web/src/routes/PreviewLitigationCenter.tsx'),
  read('apps/web/src/routes/PreviewReportStudio.tsx'),
  read('apps/web/src/routes/PreviewWorkspace.tsx'),
  read('apps/web/src/workflow/ProjectSchedulePrint.tsx'),
  read('apps/web/src/workflow/ProjectWorkflowSchedule.tsx'),
  read('apps/web/src/workflow/ProposalAwardWorkflow.tsx'),
  read('apps/web/src/workflow/WorkflowOperations.tsx')
].join('\n');

test('CF82 sidebar and contextual help use the member-facing category names', () => {
  for (const label of ['프로젝트 접수', '드라이브', '검토·납품 관리']) {
    assert.match(shell, new RegExp(`label: '${label}'`, 'u'));
    assert.match(help, new RegExp(`title: '${label}'`, 'u'));
  }
  assert.doesNotMatch(shell, /프로젝트 제안 및 수주|클레임센터 자료실|검토·납품·품질관리/u);
  assert.match(router, /CASE-06'.*name: '드라이브'/u);
  assert.match(shell, /routeIds: \['CASE-02', 'CASE-07', 'CASE-08', 'PROP-02', 'PROP-03', 'PROP-04', 'WF-02'\]/u);
});

test('CF82 ordinary member surfaces describe outcomes instead of storage implementation', () => {
  assert.doesNotMatch(ordinaryMemberSources, /D1 LIVE|D1에 |D1 자동|D1 보고서|D1 임시보관|Cloudflare D1|R2 미사용|마이그레이션/u);
  assert.match(shell, /업무공간 · 자동저장/u);
  assert.match(router, /업무 기록 자동 저장/u);
  assert.match(ordinaryMemberSources, /자동 저장|안전하게 저장|임시 보관/u);
  assert.doesNotMatch(settings.slice(settings.indexOf("{section === 'PERSONAL'"), settings.indexOf("{section === 'ADMIN'")), /D1|Cloudflare|PBKDF2|PRIVATE_SERVER_BRIDGE|localhost/u);
});

test('CF82 administrator-only technical controls and route guards remain intact', () => {
  assert.match(settings, /D1 문서 원본 저장/u);
  assert.match(settings, /개발자 인수 기준/u);
  assert.match(drive, /AES-256-GCM으로 암호화해 D1에 저장/u);
  for (const id of ['CASE-08', 'CONTACT-03', 'PROP-04', 'WF-07', 'REPO-04', 'INTEG-01', 'TPL-01', 'AI-01', 'USER-01', 'AUD-01']) {
    assert.match(router, new RegExp(`${id}'.*allowedRoles: ADMIN_ONLY`, 'u'));
  }
});
