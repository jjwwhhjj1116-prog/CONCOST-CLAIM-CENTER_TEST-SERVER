import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeGeneratedChapter } from '../apps/web/src/reports/report-generated-chapter';
import { reportJson } from './fixtures/cf108-report';
const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('CF112 generated chapter changes only its marked nodes, keeping other tables, images, header and document attributes',()=>{
  const original={...reportJson,attrs:{reportHeader:{enabled:false,text:'보존'}}};
  const before=JSON.stringify(original);
  const generated={type:'doc',content:[{type:'aiChapterMarker',attrs:{marker:'AI-CHAPTER:CH-02:START'}},{type:'paragraph',content:[{type:'text',text:'새 초안'}]},{type:'aiChapterMarker',attrs:{marker:'AI-CHAPTER:CH-02:END'}}]};
  const result=mergeGeneratedChapter(original,'CH-02',generated);
  assert.deepEqual(result.content?.slice(0,6),original.content?.slice(0,6));
  assert.deepEqual(result.attrs,original.attrs); assert.equal(JSON.stringify(original),before);
  assert.equal(JSON.stringify(result).split('새 초안').length,2);
  const third=JSON.parse(JSON.stringify(generated).replaceAll('CH-02','CH-03'));
  assert.deepEqual(mergeGeneratedChapter(original,'CH-03',third).content?.slice(0,original.content?.length),original.content);
  assert.throws(()=>mergeGeneratedChapter(original,'CH-03',generated));
  assert.throws(()=>mergeGeneratedChapter(original,'CH-02',{...generated,content:[generated.content[0],{type:'blockquote',content:[generated.content[0]]},generated.content[2]]}));
});
test('CF112 invalid chapter markers cannot delete another chapter',()=>{
  const marker=(value:string)=>({type:'aiChapterMarker',attrs:{marker:value}});
  for(const content of [
    [marker('AI-CHAPTER:CH-01:START'),marker('AI-CHAPTER:CH-02:START'),marker('AI-CHAPTER:CH-01:END')],
    [marker('AI-CHAPTER:CH-01:START')], [marker('AI-CHAPTER:CH-01:END')],
    [marker('AI-CHAPTER:CH-01:START'),marker('AI-CHAPTER:CH-01:START'),marker('AI-CHAPTER:CH-01:END')]
  ]) assert.throws(()=>mergeGeneratedChapter({type:'doc',content},'CH-01',{type:'doc',content:[marker('AI-CHAPTER:CH-01:START'),marker('AI-CHAPTER:CH-01:END')]}));
});
test('CF112 whole generation saves every chapter before next request and keeps failure explanations next to actions',()=>{
  const source=read('apps/web/src/routes/PreviewReportStudio.tsx');
  assert.match(source,/전체 한 번에 작성/);assert.match(source,/챕터별 자동작성\(권장\)/);
  assert.match(source,/for \(const chapter of chapters\)/);assert.match(source,/expectedDraftVersion: versionRef.current/);
  assert.match(source,/if \(!await saveNow\('MANUAL', false, true\)\)/);
  assert.match(source,/!authoredChapterCodes.has\(ch.chapterCode\)/);
  assert.match(source,/generationInFlight.current && !force/);assert.match(source,/if \(!renderedHtml.trim\(\)\) throw/);
  assert.match(source,/readOnly=\{generating \|\| savingOutline\}/);assert.match(source,/generationBlockedReason \|\| \(dirty/);
  assert.match(source,/\/api\/report-authoring\/case-law\?caseId=\$\{encodeURIComponent\(requestCaseId\)\}&chapterId=\$\{encodeURIComponent\(chapter.id\)\}/);
});
test('CF111 actual landscape sheets are shared by preview and export; capture re-queries after refit',()=>{
  const component=read('apps/web/src/documents/ReportBodyPages.tsx');
  const output=read('apps/web/src/documents/final-document-export.ts');
  const css=read('apps/web/src/documents/DocumentReviewWorkspace.css');
  assert.match(component,/data-export-page-policy="fit"/);assert.match(component,/source.clientHeight/);
  assert.match(css,/width:1123px;height:794px;min-height:794px/);assert.match(css,/연속 편집/);
  assert.ok(output.indexOf("const elements = [...root.querySelectorAll")>output.indexOf("window.dispatchEvent(new Event('final-document:refit'))"));
  assert.match(output,/element.dataset.pageFitOverflow === 'true' \|\|/);
  const pagination=read('apps/web/src/documents/report-pagination.ts');
  assert.match(pagination,/document.createRange/);assert.match(pagination,/table.rows/);assert.match(pagination,/cell.rowSpan/);assert.match(pagination,/listStyleType = 'none'/);
});
