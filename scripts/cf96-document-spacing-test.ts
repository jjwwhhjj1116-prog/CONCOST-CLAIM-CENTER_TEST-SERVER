import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeSpacerHeight, spacerMarker, expandDocumentSpacingMarkers } from '../apps/web/src/documents/document-spacing';

test('CF96 clamps explicit blank spacing and rejects missing/non-numeric input',()=>{
  for(const [input,expected] of [[24,24],['48',48],[0,1],[-8,1],[1000,240],[24.6,25],[undefined,16],[null,16],['',16],['bad',16],[Infinity,16]] as const) assert.equal(normalizeSpacerHeight(input),expected);
});
test('CF96 expands only explicit spacing markers in stable order',()=>{
  const source=`앞\n\n${spacerMarker(24)}\n\n${spacerMarker(48)}\n\n<!-- DOCUMENT-PAGE-BREAK -->\n\n뒤`;
  const html=expandDocumentSpacingMarkers(source);
  assert.match(html,/data-document-spacer="24"[^>]+height:24px/u);
  assert.match(html,/data-document-spacer="48"[^>]+height:48px/u);
  assert.ok(html.indexOf('spacer="24"')<html.indexOf('spacer="48"'));
  assert.equal((html.match(/data-document-page-break/gu)??[]).length,1);
  assert.equal(expandDocumentSpacingMarkers('앞\n\n\n\n\n뒤'),'앞\n\n\n\n\n뒤');
  assert.equal(expandDocumentSpacingMarkers(html),html);
});
test('CF96 reviewer and preview share output renderer without scaling editable hit testing',()=>{
  const read=(p:string)=>readFileSync(p,'utf8');
  const proposal=read('apps/web/src/proposals/ProposalView.tsx');
  const report=read('apps/web/src/routes/PreviewReportStudio.tsx');
  const editor=read('apps/web/src/documents/StructuredDocumentEditor.tsx');
  const pane=read('apps/web/src/documents/DocumentPreviewPane.tsx');
  assert.match(proposal,/<details className="proposal-module-controls">/u);
  assert.match(proposal,/<DocumentPreviewPane[^>]+>[\s\S]*?<ProposalFinalChapterPages/u);
  assert.doesNotMatch(proposal,/<section className="proposal-review-page-parity"/u);
  assert.equal((report.match(/<DocumentPreviewPane width=\{1123\}/gu)??[]).length,2);
  assert.match(report,/JSON\.stringify\(editorJsonRef\.current\) !== JSON\.stringify\(requestEditorJson\)/u);
  assert.match(report,/marked\.parse\(expandDocumentSpacingMarkers\(content\)/u);
  assert.match(editor,/blankReplacement:[\s\S]*?data-document-spacer/u);
  assert.match(editor,/addRule\('emptyParagraph'/u);
  assert.match(editor,/selection instanceof NodeSelection \? selection\.to/u);
  assert.doesNotMatch(editor,/runLength >= 3/u);
  assert.doesNotMatch(pane,/contentEditable|StructuredDocumentEditor/u);
  assert.match(pane,/transform: `scale/u);
});
