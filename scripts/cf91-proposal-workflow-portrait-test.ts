import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string): string => readFileSync(path, 'utf8');

test('CF91 links intake client data and keeps reviewer navigation resumable', () => {
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  assert.match(proposal, /const linkedClientName=caseRow\?\.clientName\?\.trim\(\)\?\?''/u);
  assert.match(proposal, /setClientName\(linkedClientName\|\|String\(parsed\.clientName\?\?''\)\)/u);
  assert.match(proposal, /당 현장의 핵심 쟁점 분석/u);
  assert.match(proposal, /업무 수행 내용/u);
  assert.match(proposal, /target>=3&&\(!firstThreeComplete\|\|\(dirty&&!currentVersion\)\)/u);
  assert.match(proposal, /firstThreeComplete&&\(!dirty\|\|Boolean\(currentVersion\)\)/u);
});

test('CF91 exposes editable cover and TOC in reviewer step and fixes proposal output to portrait', () => {
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const theme = read('apps/web/src/theme-system.css');
  const exporter = read('apps/web/src/documents/final-document-export.ts');
  const serverExport = read('apps/cloudflare/src/proposal-docx.ts');
  assert.match(proposal, /reviewSurface.*'cover'.*'toc'.*'chapter'/u);
  assert.match(proposal, /ProposalCoverPage/u);
  assert.match(proposal, /ProposalTableOfContentsPage/u);
  assert.match(proposal, /갑지 제목과 제출 정보를 확인하세요/u);
  assert.match(proposal, /목차 제목을 최종 확인·편집하세요/u);
  assert.match(proposal, /orientation:'portrait'/u);
  assert.match(theme, /\.proposal-final-document \{[^}]*width:min\(794px,100%\)/u);
  assert.match(theme, /\.proposal-final-cover,.proposal-final-toc,.proposal-final-chapter \{[^}]*min-height:1123px/u);
  assert.match(exporter, /FinalDocumentOrientation = 'landscape' \| 'portrait'/u);
  assert.match(exporter, /widthHwp: 59_520, heightHwp: 84_180/u);
  assert.match(serverExport, /<w:pgSz w:w="11906" w:h="16838"\/>/u);
  assert.match(serverExport, /\/MediaBox \[0 0 595 842\]/u);
  assert.doesNotMatch(serverExport, /<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"\/>/u);
});

test('CF91 table editor supports vertical alignment and numeric row-column dimensions', () => {
  const editor = read('apps/web/src/documents/StructuredDocumentEditor.tsx');
  const css = read('apps/web/src/documents/StructuredDocumentEditor.css');
  assert.match(editor, /selectedRect/u);
  assert.match(editor, /verticalAlignment/u);
  assert.match(editor, /data-cell-vertical-align/u);
  assert.match(editor, /rowHeightMm/u);
  assert.match(editor, /data-row-height-mm/u);
  assert.match(editor, /선택 열 너비 밀리미터/u);
  assert.match(editor, /선택 행 높이 밀리미터/u);
  assert.match(editor, /치수 적용/u);
  assert.match(editor, /editingMeasurements/u);
  assert.match(editor, /closest\('\.structured-editor__table-measurements'\)/u);
  assert.match(editor, /setColumnWidthMm\(event\.target\.value\)/u);
  assert.match(editor, /setRowHeightMm\(event\.target\.value\)/u);
  assert.match(css, /data-cell-vertical-align="middle"/u);
  assert.match(css, /structured-editor__table-measurements/u);
});
