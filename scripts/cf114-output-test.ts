import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync, strFromU8, zipSync, strToU8 } from '../apps/web/node_modules/fflate';
import { reportStudioWorkbook, readReportStudioWorkbook } from '../apps/web/src/proposals/proposal-excel';

const workbook = (body: string) => reportStudioWorkbook({reportTitle:'CF114 합성 검수',reportContent:body},'합성 프로젝트','합성 템플릿');
const file = (bytes: Uint8Array) => new File([bytes as BlobPart], 'cf114.xlsx');

test('CF114 long reports stay inside Excel cell limits and round-trip without text loss', async () => {
  const body = '원문 시작\n'+('보고서 😀 판례 및 공사비 근거\n'.repeat(4500))+'\n원문 끝';
  const bytes = workbook(body);
  const xml = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
  for (const match of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)) {
    assert.ok(match[1].length <= 32767, `Excel text cell exceeds 32767 characters: ${match[1].length}`);
    assert.ok((match[1].match(/\n/g) ?? []).length <= 253, 'Excel text cell exceeds 253 line feeds');
    assert.doesNotMatch(match[1], /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u, 'part splits a surrogate pair');
  }
  assert.deepEqual(await readReportStudioWorkbook(file(bytes)), {reportTitle:'CF114 합성 검수',reportContent:body});
});

test('CF114 short legacy-format report workbook remains readable', async () => {
  const body='첫 줄\n\n두 번째 줄';
  assert.deepEqual(await readReportStudioWorkbook(file(workbook(body))),{reportTitle:'CF114 합성 검수',reportContent:body});
});

test('CF114 missing or duplicate report chunks fail without returning a partial document', async () => {
  const original=workbook('줄바꿈 원문\n'.repeat(500));
  const edit=(change:(sheet:string)=>string)=>{const files=unzipSync(original);files['xl/worksheets/sheet1.xml']=strToU8(change(strFromU8(files['xl/worksheets/sheet1.xml'])));return file(zipSync(files,{level:0}));};
  const rows=strFromU8(unzipSync(original)['xl/worksheets/sheet1.xml']).match(/<row\b[^>]*>[\s\S]*?<\/row>/gu)!;
  const finalPart=rows.filter(row=>/reportContent:\d+<\/t>/u.test(row)).at(-1)!;
  assert.ok(finalPart);
  await assert.rejects(()=>readReportStudioWorkbook(edit(sheet=>sheet.replace(finalPart,''))),/누락/u);
  await assert.rejects(()=>readReportStudioWorkbook(edit(sheet=>sheet.replace(finalPart,finalPart+finalPart))),/중복/u);
});
