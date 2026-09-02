import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string): string => readFileSync(path, 'utf8');

test('CF93 uses one A4 portrait geometry for proposal review, preview and every export', () => {
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const editorCss = read('apps/web/src/documents/StructuredDocumentEditor.css');
  assert.match(proposal, /pageMode="a4-portrait"/u);
  assert.match(proposal, /downloadFinalDocument/u);
  assert.doesNotMatch(proposal, /apiDownloadPost/u);
  assert.match(editorCss, /is-a4-portrait[^}]*width:794px[^}]*min-height:1123px[^}]*padding:68px 58px 72px/u);
});

test('CF93 normalizes resized table columns and applies readable automatic table defaults', () => {
  const editor = read('apps/web/src/documents/StructuredDocumentEditor.tsx');
  const editorCss = read('apps/web/src/documents/StructuredDocumentEditor.css');
  const theme = read('apps/web/src/theme-system.css');
  assert.match(editor, /normalizeStructuredDocumentHtml/u);
  assert.match(editor, /proportional.*100/u);
  assert.match(editor, /data-cell-horizontal-align/u);
  assert.match(editor, /행높이 자동/u);
  assert.match(editorCss, /font-size:12px/u);
  assert.match(editorCss, /table-layout:fixed/u);
  assert.match(theme, /proposal-rich-content th,.proposal-rich-content td[^}]*font-size:12px/u);
});

test('CF93 preserves fixed image JSON edits, exposes normal editing actions and applies HWP page shape', () => {
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const editor = read('apps/web/src/documents/StructuredDocumentEditor.tsx');
  const rhwp = read('apps/web/src/documents/RhwpEditorDialog.tsx');
  assert.match(proposal, /nextEditorJson\.content\.push/u);
  assert.doesNotMatch(proposal, /saved Tiptap JSON predates it[\s\S]{0,220}editorJson:null/u);
  assert.match(editor, /↶ 실행취소/u);
  assert.match(editor, /행 \+/u);
  assert.match(editor, /열 \+/u);
  assert.match(editor, /expectedText/u);
  assert.match(rhwp, /onApplyPages/u);
  assert.match(proposal, /hwpSvgPageForUpload/u);
  assert.match(proposal, /HWP .*페이지 모양/u);
});
