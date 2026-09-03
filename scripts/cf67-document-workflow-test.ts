import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { readReportStudioWorkbook, reportStudioWorkbook, type ReportStudioExcelValues } from '../apps/web/src/proposals/proposal-excel.js';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

test('CF67 required fields, dirty navigation, and authoring step gates are explicit', () => {
  const input = read('packages/ui/src/components/Input.tsx');
  const select = read('packages/ui/src/components/Select.tsx');
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const report = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const app = read('apps/web/src/App.tsx');
  const theme = read('apps/web/src/theme-system.css');
  assert.match(input, /ui-field--required/u);
  assert.match(input, /aria-required/u);
  assert.match(select, /ui-field--required/u);
  assert.match(theme, /#fff7cf/u);
  assert.match(proposal, /goToProposalStep/u);
  assert.match(proposal, /1단계 필수 입력을 완료하세요/u);
  assert.match(proposal, /registerNavigationBlocker/u);
  assert.match(proposal, /if\(dirty\)event\.preventDefault/u);
  assert.match(report, /<Input required label="보고서 제목"/u);
  assert.match(report, /<Select\b[^>]*\brequired label="작성할 프로젝트"/u);
  assert.match(proposal, /proposal-step1-textarea/u);
  assert.match(proposal, /workflow-next-action/u);
  assert.match(report, /report-current-project--persistent/u);
  assert.match(report, /DocumentToolMenus/u);
  assert.match(theme, /\.workflow-next-action/u);
  assert.match(theme, /background:linear-gradient\(135deg,#c2410c,#9a3412\)!important;color:#fff!important/u);
  assert.match(report, /if \(dirty \|\| outlineDirty \|\| workspaceDirty\) event\.preventDefault/u);
  assert.doesNotMatch(report, /dirty \|\| outlineDirty \|\| saving/u);
  assert.match(app, /popstate/u);
  assert.match(app, /requestNavigation/u);
});

test('CF67 report Excel template round-trips title and body through FIELD_CODE mapping', async () => {
  const source: ReportStudioExcelValues = {
    reportTitle: '공사비 검증 중간보고서',
    reportContent: '계약서·내역서·현장조사 근거를 대조하여 쟁점을 정리했습니다.\n다음 단계에서 담당자가 검수합니다.',
  };
  const bytes = reportStudioWorkbook(source, 'CC-2026-00011 · 테스트 프로젝트', 'TYPE-03 보고서');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const imported = await readReportStudioWorkbook(new File([buffer], 'report-studio.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  assert.deepEqual(imported, source);
});

test('CF67 document tools are grouped by branded Excel, DOCX, and HWP menus beside stage titles', () => {
  const menu = read('apps/web/src/documents/DocumentToolMenus.tsx');
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const report = read('apps/web/src/routes/PreviewReportStudio.tsx');
  assert.match(menu, /'excel' \| 'docx' \| 'hwp'/u);
  assert.match(menu, /<details/u);
  assert.match(menu, /document-tool-icon/u);
  assert.match(proposal, /workflow-stage-title/u);
  assert.doesNotMatch(proposal, /proposal-compact-tools/u);
  assert.match(report, /report-stage-header__actions/u);
  assert.doesNotMatch(report, /className="report-hwp-tools"/u);
});

test('CF67 document-form library exposes working proposal and meeting templates', () => {
  const router = read('apps/web/src/routes/Router.tsx');
  const shell = read('apps/web/src/layout/AppShell.tsx');
  const library = read('apps/web/src/routes/PreviewDocumentTemplates.tsx');
  assert.match(router, /CASE-09'.*\/cases\/files\/templates.*문서 양식/u);
  assert.match(shell, /routeIds: \['CASE-06', 'CASE-09'\]/u);
  assert.match(library, /proposalStudioWorkbook/u);
  assert.match(library, /CONCOST_회의록_양식\.xlsx/u);
  assert.match(library, /작성 Excel 가져오기/u);
  assert.equal(router.includes('<small>({currentRoute.id})</small>'), false);
});
