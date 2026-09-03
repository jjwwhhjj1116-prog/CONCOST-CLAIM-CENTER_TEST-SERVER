import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { meetingMinutesWorkbook } from '../apps/web/src/proposals/proposal-excel';
import { minutesContent, normalizeMinutesFields } from '../apps/cloudflare/src/company-minutes';

test('CF103 meeting XLSX is a populated ZIP with valid print order and all company fields', () => {
  const fields = normalizeMinutesFields({ author:'검수 담당자', authorDepartment:'기술팀', authorPosition:'과장', clientName:'검수 조합', reportingDepartment:'사업팀', referenceDepartments:'', clientParticipants:'발주처 담당자', meetingEndTime:'11:30' })!;
  const bytes = meetingMinutesWorkbook({ ...fields, meetingDate:'2026. 09. 03', meetingTime:'10:00', location:'본사 회의실', participants:'김담당, 이담당', meetingTitle:'착수회의', attachmentName:'자료.pdf', summary:'원문 메모\n현장 확인 후 다음 주 보고합니다.\u000b', followUps:'김담당: 9월 10일까지 자료 확인' });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map<string,string>();
  for(let offset=0; view.getUint32(offset,true)===0x04034b50;) {
    const length=view.getUint32(offset+18,true), nameLength=view.getUint16(offset+26,true), extraLength=view.getUint16(offset+28,true);
    const contentOffset=offset+30+nameLength+extraLength;
    entries.set(new TextDecoder().decode(bytes.slice(offset+30,offset+30+nameLength)),new TextDecoder().decode(bytes.slice(contentOffset,contentOffset+length)));
    offset=contentOffset+length;
  }
  const sheet=entries.get('xl/worksheets/sheet1.xml')!;
  assert.ok(sheet.indexOf('<pageMargins ') < sheet.indexOf('<pageSetup '), 'Excel removes the sheet when pageMargins follows pageSetup');
  assert.match(sheet,/orientation="portrait"/);
  assert.doesNotMatch(sheet,/\u000b/);
  for(const value of ['검수 담당자','기술팀','과장','검수 조합','사업팀','모든 부서','발주처 담당자','11:30','원문 메모','김담당: 9월 10일까지 자료 확인']) assert.ok(sheet.includes(value),value);
  const merges=[...sheet.matchAll(/<mergeCell ref="([^"]+)"/g)];
  assert.equal(Number(/<mergeCells count="(\d+)"/.exec(sheet)![1]),merges.length);
  assert.equal(new Set(merges.map(m=>m[1])).size,merges.length);
  if(process.env.CF103_EXPORT_DIR){mkdirSync(process.env.CF103_EXPORT_DIR,{recursive:true});writeFileSync(`${process.env.CF103_EXPORT_DIR}/meeting-minutes.xlsx`,bytes);}
});

test('CF103 raw notes stay literal; editing invalidates a previous AI summary', () => {
  assert.equal(minutesContent('회의 메모','회의 메모',''),'회의 메모');
  assert.equal(minutesContent('수정 메모','회의 메모','이전 요약'),'수정 메모');
  assert.equal(minutesContent('회의 메모','회의 메모','검수 요약'),'검수 요약');
  assert.equal(normalizeMinutesFields({referenceDepartments:'  '})?.referenceDepartments,'모든 부서');
  assert.equal(normalizeMinutesFields({meetingEndTime:'25:00'}),null);
  assert.equal(normalizeMinutesFields({unknown:'x'}),null);
  assert.equal(normalizeMinutesFields({author:'x'.repeat(2001)}),null);
  const source=readFileSync('apps/web/src/workflow/WorkflowOperations.tsx','utf8');
  assert.doesNotMatch(source,/저장된 (회의|현장조사) 원문 미리보기/);
  assert.match(source,/disabled=\{disabled \|\| unsaved\}/);
});
