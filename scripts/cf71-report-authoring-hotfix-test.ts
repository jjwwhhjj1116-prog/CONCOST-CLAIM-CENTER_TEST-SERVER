import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readSpreadsheetExcerpt, reportStudioWorkbook } from '../apps/web/src/proposals/proposal-excel';

async function main(): Promise<void> {
  const reportSource = await readFile(path.resolve('apps/web/src/routes/PreviewReportStudio.tsx'), 'utf8');
  const reportCss = await readFile(path.resolve('apps/web/src/routes/PreviewReportStudio.css'), 'utf8');
  const workerSource = await readFile(path.resolve('apps/cloudflare/src/index.ts'), 'utf8');

const workbook = reportStudioWorkbook(
  { reportTitle: '산출내역 첨부 검증', reportContent: '공종별 수량과 내역을 검토합니다.' },
  'CC-TEST-71 · 첨부 검증',
  '보고서 첨부 검증',
);
  const payload = new Uint8Array(workbook.byteLength);
  payload.set(workbook);
  const file = new File([payload.buffer], 'quantity-sample.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const excerpt = await readSpreadsheetExcerpt(file, 'B3:D5');
assert.equal(excerpt.range, 'B3:D5');
assert.match(excerpt.markdown, /작성 항목/u);
assert.match(excerpt.markdown, /산출내역 첨부 검증/u);

assert.match(reportSource, /HWP 전체 문서를 보고서에 적용/u);
assert.match(reportSource, /DOCX 전체 문서 적용/u);
assert.match(reportSource, /AI 없이 담당자 검수로 이동/u);
assert.match(reportSource, /시간별 백업 불러오기/u);
assert.match(reportSource, /event\.key\.toLowerCase\(\) !== 's'/u);
// CF110 removes the redundant upload panel, not the shared spreadsheet parser.
assert.doesNotMatch(reportSource, /report-quantity-attachment|CURRENT CHAPTER AGENT/u);
assert.doesNotMatch(reportSource, /ref=\{reportBodyRef\} compact documentKey=\{`report-step3/u);
assert.match(reportCss, /report-step-card--3 \.form-stack \{ width: 100%; max-width: none/u);
assert.match(reportCss, /min-height: 720px/u);
assert.match(workerSource, /r\.content, .*r\.editor_json/u);
assert.match(workerSource, /preview_google_case_evidence/u);

  console.log('CF71 report authoring hotfix checks passed (12/12)');
}

void main();
