import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { joinReportPresentation, splitReportPresentation } from '../packages/document-engine/src/report-presentation';
import { reportJson } from './fixtures/cf108-report';

test('CF110 old reports keep their automatic header and null Markdown body', () => {
  assert.deepEqual(splitReportPresentation(null), { body:null, header:{ enabled:true, text:null } });
  assert.equal(joinReportPresentation(null, { enabled:true, text:null }), null);
  assert.deepEqual(splitReportPresentation(reportJson).body, reportJson);
});

test('CF110 custom header survives serialization without changing any body nodes', () => {
  const original = JSON.stringify(reportJson);
  const header = { enabled:false, text:'검토 보고서 <문자 그대로>\n프로젝트 정보 & 검수본' };
  const stored = JSON.parse(JSON.stringify(joinReportPresentation(reportJson, header)));
  assert.deepEqual(splitReportPresentation(stored), { body:reportJson, header });
  assert.equal(JSON.stringify(reportJson), original);
  assert.equal(splitReportPresentation(joinReportPresentation(null, header)).body, null);
  assert.deepEqual(splitReportPresentation(joinReportPresentation(null, header)).header, header);
});

test('CF110 blank custom header is distinct from default, bounded, and repeatable', () => {
  assert.equal(splitReportPresentation(joinReportPresentation(null, {enabled:true,text:''})).header.text, '');
  assert.equal(splitReportPresentation(joinReportPresentation(null, {enabled:true,text:'가'.repeat(2000)})).header.text?.length, 1000);
  const body = { type:'doc', attrs:{ otherSetting:'preserved' }, content:reportJson.content };
  const result=splitReportPresentation(joinReportPresentation(body,{enabled:false,text:null}));
  assert.deepEqual(result.body, body);
  assert.deepEqual(splitReportPresentation(joinReportPresentation(result.body,result.header)),result);
});

test('CF110 editor, save, backup and three previews share versioned header settings', () => {
  const source=readFileSync('apps/web/src/routes/PreviewReportStudio.tsx','utf8');
  assert.equal((source.match(/editorJson=\{joinReportPresentation\(editorJson, reportHeader\)\}/g)??[]).length,3);
  assert.match(source,/requestEditorJson = joinReportPresentation\(editorJsonRef.current, reportHeaderRef.current\)/);
  assert.match(source,/splitReportPresentation\(result.draft\?\.editorJson\)/);
  assert.match(source,/splitReportPresentation\(revision.editorJson\)/);
  assert.match(source,/reportPreviewHtml\(content, presentation.body\)/);
  assert.match(source,/presentation.header.enabled && <header>/);
  for(const line of source.split('\n').filter(line=>line.includes('report-header-controls__toggle')||line.includes('htmlFor={`report-header-text-'))) {
    assert.match(line,/!editable \|\| saving \|\| savingOutline \|\| generating \|\| Boolean\(chapterBusy\)/);
  }
  assert.doesNotMatch(source,/report-quantity-attachment|CURRENT CHAPTER AGENT|selectedChapterSources/);
  assert.match(source,/report-draft-context[\s\S]*report-draft-chapter[\s\S]*판례 근거 추가/);
});

test('CF110 list deletion requires admin, confirmation and excludes pending double requests', () => {
  const source=readFileSync('apps/web/src/routes/BusinessCardContacts.tsx','utf8');
  assert.match(source,/if\(!isAdmin\|\|busy\)return/);
  assert.match(source,/isAdmin&&<button[\s\S]*setDeleteTarget\(card\)/);
  assert.match(source,/<Dialog isOpen=\{Boolean\(deleteTarget\)\}/);
  assert.match(source,/목록에서 삭제/);
  assert.match(source,/Drive 원본과 감사이력은 보존/);
  assert.match(source,/current.filter\(item=>item.id!==card.id\)/);
  assert.match(source,/action:archive\?'ARCHIVE':'RESTORE',expectedVersion:card.version/);
  assert.doesNotMatch(source,/method:'DELETE'/);
});
