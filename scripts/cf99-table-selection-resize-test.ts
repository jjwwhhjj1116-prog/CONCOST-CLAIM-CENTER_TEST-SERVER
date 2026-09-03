import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeColumnWidths } from '../apps/web/src/documents/structured-document-layout';

test('CF99 current complete column widths preserve intentional narrow proportions',()=>{
  for(const widths of [[24,652],[30,646],[48,628],[24,24,628],[10,30],[19,19,19,19,19,19,19,19,19,19,19,19]]){
    const total=widths.reduce((a,b)=>a+b);
    const result=normalizeColumnWidths(widths,total,[],false);
    assert.equal(result.repaired,false);
    result.widths.forEach((width,index)=>assert.ok(Math.abs(width-widths[index])<.001));
  }
});
test('CF99 invalid legacy widths still repair without corrupting total',()=>{
  for(const widths of [[0,652],[NaN,30],[-10,Infinity],[0,0,0]]){
    const result=normalizeColumnWidths(widths,676,[],false);
    assert.equal(result.repaired,true);
    assert.ok(result.widths.every(width=>Number.isFinite(width)&&width>0));
    assert.ok(Math.abs(result.widths.reduce((a,b)=>a+b)-676)<.001);
  }
});
test('CF99 range selection is cell-bounded and mouse dimensions are undo transactions',()=>{
  const resize=readFileSync('apps/web/src/documents/document-resize-scale.ts','utf8');
  const editor=readFileSync('apps/web/src/documents/StructuredDocumentEditor.tsx','utf8');
  const css=readFileSync('apps/web/src/documents/StructuredDocumentEditor.css','utf8');
  assert.match(resize,/writeTableColumnWidths/);
  assert.match(resize,/closeHistory\(view.state.tr\)/);
  assert.match(resize,/Math.min\(24, widths\[column\], widths\[column \+ 1\]\)/);
  assert.match(editor,/allowTableNodeSelection: false/);
  assert.match(editor,/'표 전체 선택'/);
  assert.match(editor,/label="선택 행 높이 적용"/);
  assert.match(css,/\.structured-editor \.tiptap th,\.structured-editor \.tiptap td\{position:relative\}/);
  assert.match(css,/\.structured-editor \.tiptap :is\(th,td\) p/);
});
