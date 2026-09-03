import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(path:string)=>readFileSync(path,'utf8');
const proposal=read('apps/web/src/proposals/ProposalView.tsx');
const editor=read('apps/web/src/documents/StructuredDocumentEditor.tsx');
const css=read('apps/web/src/documents/DocumentReviewWorkspace.css');

test('CF98 manual authoring shares the structured document, never exposes storage HTML',()=>{
  const manual=proposal.slice(proposal.indexOf('export function ProposalManualDraft'),proposal.indexOf('export const ProposalView'));
  assert.match(manual,/StructuredDocumentEditor/u);
  assert.match(manual,/editorJson=\{item\.editorJson\}/u);
  assert.match(manual,/onChange=\{\(body,json\)=>onChange\(item.number,body,json\)\}/u);
  assert.doesNotMatch(manual,/<textarea/u);
  assert.match(proposal,/const firstThreeComplete=chapters.slice\(0,3\).every\(proposalChapterHasContent\)/u);
  assert.match(proposal,/if\(chapter.editorJson\)return chapter/u);
  assert.match(proposal,/const submittedChapters=generationMode==='AI'\?preparedChapters\(\):chapters/u);
  assert.match(editor,/parsePastedMarkup = false/u);
  assert.match(editor,/getData\('text\/html'\)\) return false/u);
  assert.match(editor,/ProseMirrorDOMParser.fromSchema/u);
});

test('CF98 selection tools escape the zoom and clipping context using public positioning hooks',()=>{
  assert.match(editor,/appendTo=\{\(\) => document.body\}/u);
  assert.match(editor,/strategy: 'fixed'/u);
  assert.match(editor,/scrollTarget: editor.view.dom.closest/u);
  for(const label of ['선택 영역 글꼴','선택 영역 글자 크기','선택 영역 글자 색상'])assert.ok(editor.includes(label));
  assert.match(editor,/requestAnimationFrame\(\(\) => repeatAction\(\)\)/u);
});

test('CF98 improves toolbar labels and headings without changing paper dimensions',()=>{
  for(const tone of ['table','image','ai'])assert.ok(editor.includes(`tone="${tone}"`));
  assert.match(editor,/<span>기본 글꼴<\/span>/u);
  assert.match(editor,/\$\{inheritedFontSize\}px \(기본\)/u);
  assert.match(css,/heading>strong\{[^}]*font-size:19.5px/u);
  assert.match(css,/heading>strong\{[^}]*justify-self:center/u);
  assert.match(css,/label:nth-of-type\(2\) select\{width:124px;max-width:none\}/u);
  assert.doesNotMatch(read('apps/web/src/theme-system.css'),/text-controls label > span \{ position: absolute/u);
  assert.match(css,/zoom:var\(--review-scale\)/u);
});
