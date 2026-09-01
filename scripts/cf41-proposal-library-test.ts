import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ROUTES, canAccessRoute } from '../apps/web/src/routes/Router.js';
import { sentProposalArchiveWorkbook } from '../apps/web/src/proposals/proposal-excel.js';

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

test('CF41 proposal sidebar separates authoring, sent projects and admin database ledger', () => {
  const shell = read('apps/web/src/layout/AppShell.tsx');
  const router = read('apps/web/src/routes/Router.tsx');
  assert.match(shell, /label: '프로젝트 접수'/u);
  assert.match(shell, /routeIds: \['CASE-02', 'CASE-07', 'CASE-08', 'PROP-02', 'PROP-03', 'PROP-04', 'WF-02'\]/u);
  assert.match(shell, /routeIds: \['CASE-06', 'CASE-09'\]/u);
  assert.match(shell, /\{ label: '프로젝트 제안서', eyebrow: '제안서 관리', routeIds: \['PROP-02', 'PROP-03', 'PROP-04'\] \}/u);
  assert.match(router, /PROP-02'.*'제안서 작성'/u);
  assert.match(router, /PROP-03'.*'프로젝트별 제안서 목록'/u);
  assert.match(router, /PROP-04'.*'제안서 DB관리'.*ADMIN_ONLY/u);
  assert.equal(canAccessRoute(ROUTES.find((route) => route.id === 'PROP-03')!, ['staff']), true);
  assert.equal(canAccessRoute(ROUTES.find((route) => route.id === 'PROP-04')!, ['staff']), false);
  assert.equal(canAccessRoute(ROUTES.find((route) => route.id === 'PROP-04')!, ['admin']), true);
});

test('CF41 sent project view and immutable DB ledger use the scoped proposal workflow API', () => {
  const view = read('apps/web/src/proposals/ProposalLibraryView.tsx');
  const migration = read('apps/cloudflare/migrations/0014_cf14_proposal_award_workflow.sql');
  assert.match(view, /\/api\/proposal-catalog/u);
  assert.match(view, /프로젝트별 제안서 목록/u);
  assert.match(view, /제안서 DB관리/u);
  assert.match(view, /proposal\.caseId/u);
  assert.match(view, /documentSha256/u);
  assert.match(view, /right\.sentAt\.localeCompare\(left\.sentAt\)/u);
  assert.match(migration, /preview_proposal_link_identity_guard/u);
  assert.match(migration, /proposal link snapshot is immutable/u);
  assert.match(migration, /preview_proposal_link_delete_guard/u);
});

test('CF41 authoring has XLSX import and all sent proposal records export as a real workbook', () => {
  const author = read('apps/web/src/proposals/ProposalView.tsx');
  assert.match(author, /입력 양식 내보내기/u);
  assert.match(author, /작성 Excel 가져오기/u);
  assert.match(author, /readProposalWorkbook/u);
  const bytes = sentProposalArchiveWorkbook([{
    caseNumber: 'CC-2026-041', caseTitle: '발송 제안서 프로젝트', proposalNumber: 'PROP-041', proposalTitle: '클레임 기술제안서', revisionLabel: 'V2', clientName: '발주처', sentAt: '2026-08-21T09:00:00.000Z', responseDueOn: '2026-08-28', proposedAmountKrw: 10_000_000, verificationStatus: 'VERIFIED', awardStatus: 'PENDING', documentUrl: 'https://drive.google.com/file/d/synthetic', documentSha256: 'a'.repeat(64), createdByName: '제안 담당자', createdAt: '2026-08-21T09:01:00.000Z'
  }]);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const payload = new TextDecoder().decode(bytes);
  assert.match(payload, /연동 제안서 DB 원장/u);
  assert.match(payload, /PROP-041/u);
});
