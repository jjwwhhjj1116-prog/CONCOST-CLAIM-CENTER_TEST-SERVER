import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fitImageDimensions } from '../apps/web/src/documents/structured-document-layout';

test('CF100 independent image axes retain explicit sizes within printable bounds', () => {
  assert.deepEqual(fitImageDimensions(420, 180, 676), { width: 420, height: 180 });
  assert.deepEqual(fitImageDimensions(360, 260, 676), { width: 360, height: 260 });
  assert.deepEqual(fitImageDimensions(1000, 900, 676), { width: 676, height: 680 });
  assert.deepEqual(fitImageDimensions(0, -10, 676), { width: 80, height: 40 });
  assert.deepEqual(fitImageDimensions(100, 100, 60), { width: 60, height: 100 });
});
test('CF100 optional ratio fits both width and height bounds', () => {
  assert.deepEqual(fitImageDimensions(420, 180, 676, 2), { width: 420, height: 210 });
  assert.deepEqual(fitImageDimensions(800, 180, 676, 2), { width: 676, height: 338 });
  assert.deepEqual(fitImageDimensions(360, 180, 676, .25), { width: 170, height: 680 });
  assert.deepEqual(fitImageDimensions(10, 10, 676, 4), { width: 160, height: 40 });
});
test('CF100 shared image path includes eight handles, dimensions, undo sync and F4', () => {
  const editor = readFileSync('apps/web/src/documents/StructuredDocumentEditor.tsx', 'utf8');
  const resize = readFileSync('apps/web/src/documents/document-resize-scale.ts', 'utf8');
  const report = readFileSync('apps/web/src/routes/PreviewReportStudio.tsx', 'utf8');
  assert.match(editor, /directions: \['top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right'\]/);
  assert.match(editor, /alwaysPreserveAspectRatio: false/);
  assert.match(editor, /aria-label="이미지 가로 px"/);
  assert.match(editor, /aria-label="이미지 세로 px"/);
  assert.match(editor, /transaction.getMeta\('document-image-resize'\)/);
  assert.match(resize, /view.onUpdate =/);
  assert.match(resize, /closeHistory\(props.editor.state.tr\)/);
  assert.match(report, /DOMPurify.sanitize\(normalizeStructuredDocumentHtml/);
});
test('CF100 reviewed repeated images are not removed by template asset deduplication', () => {
  const proposal = readFileSync('apps/web/src/proposals/ProposalView.tsx', 'utf8');
  assert.match(proposal, /hydrateCompanyAssets\?deduplicateProposalImages\(source\):source/);
  assert.doesNotMatch(proposal, /deduplicateProposalImages\(structuredHtml\)/);
  assert.match(proposal, /editorJson=\{item\.editorJson\} hydrateCompanyAssets=\{false\}/);
});
