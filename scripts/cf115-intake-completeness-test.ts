import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { extractIntakeSource, extractEvidenceText, IntakeSourceError } from '../apps/cloudflare/src/intake-source';

const { zipSync, strToU8 } = createRequire(resolve('apps/web/package.json'))('fflate');
const zip = (parts: Record<string, string>): Uint8Array => zipSync(Object.fromEntries(Object.entries(parts).map(([name, text]) => [name, strToU8(text)])));
const cell = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
const workbook = (sheets: string[], extra: Record<string, string> = {}) => zip({ '[Content_Types].xml': '<Types/>', ...Object.fromEntries(sheets.map((body, i) => [`xl/worksheets/sheet${i + 1}.xml`, `<worksheet><sheetData>${body}</sheetData></worksheet>`])), ...extra });
const xlsx = async (bytes: Uint8Array) => (await extractIntakeSource('회의록.xlsx', 'application/octet-stream', bytes)).extractedText!;
const rejectsCode = (code: string, message?: RegExp) => (error: unknown) => error instanceof IntakeSourceError && error.code === code && (!message || message.test(error.message));

test('CF115 XLSX keeps the last supported sheet and rejects sheet 21 instead of silently discarding it', async () => {
  const sheets = Array.from({ length: 20 }, (_, i) => cell('A1', `회의 ${i + 1} - 끝까지 보존`));
  assert.ok((await xlsx(workbook(sheets))).endsWith('A1: 회의 20 - 끝까지 보존'));
  await assert.rejects(xlsx(workbook([...sheets, cell('A1', '21번째 담당자·기한')])), rejectsCode('INTAKE_SOURCE_TOO_LARGE', /20/u));
  const namedSheet = zip({ '[Content_Types].xml': '<Types/>', 'xl/worksheets/meeting-notes.xml': `<worksheet>${cell('A1', '이름이 다른 시트 원문')}</worksheet>` });
  assert.equal(await xlsx(namedSheet), '[meeting-notes]\nA1: 이름이 다른 시트 원문');
});

test('CF115 empty formatted XLSX is rejected and broken shared-string references cannot drop source text', async () => {
  for (const content of ['', '<c r="A1" s="1"/>', cell('A1', ' \n\t ')]) {
    await assert.rejects(xlsx(workbook([content])), rejectsCode('EMPTY_INTAKE_XLSX'));
  }
  await assert.rejects(xlsx(workbook([cell('A1', '일부 내용') + '<c r="A2" t="s"><v>7</v></c>'], { 'xl/sharedStrings.xml': '<sst><si><t>원문</t></si></sst>' })), rejectsCode('INVALID_INTAKE_XLSX'));
});

test('CF115 XLSX preserves speaker line breaks, empty lines, rich text, tabs and original numeric values', async () => {
  const source = '김PM: 도면 확인\n\n발주처: 금액 미확정\n담당 미정\t기한 없음 😀';
  const inline = '<c r="A1" t="inlineStr"><is><r><t>김PM: 도면 확인&#13;&#10;&#13;&#10;발주처: 금액 미확정&#10;</t></r><r><t>담당 미정&#9;기한 없음 😀</t></r></is></c>';
  const bytes = workbook([inline + '<c r="B1" s="1"><v>46272</v></c><c r="C1"><v>125000</v></c>'], { 'xl/styles.xml': '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>' });
  assert.equal(await xlsx(bytes), `[sheet1]\nA1: ${source}\nB1: 46272\nC1: 125000`, 'numeric cells remain original serial/amount values; no date guessing');
});

test('CF115 XLSX enforces the 20000-cell limit without returning a partial source', async () => {
  const blanks = Array.from({ length: 19_999 }, (_, i) => `<c r="A${i + 1}" s="1"/>`).join('');
  assert.equal(await xlsx(workbook([blanks + cell('A20000', '최종 결정') ])), '[sheet1]\nA20000: 최종 결정');
  await assert.rejects(xlsx(workbook([blanks + cell('A20000', '최종 결정') + cell('A20001', '추가 담당자')])), rejectsCode('INTAKE_SOURCE_TOO_LARGE', /20,000/u));
});

test('CF115 the 100000-character XLSX limit includes source labels and separators', async () => {
  // Four ordinary cells remain under Excel's per-cell character limit.
  const values = Array.from({ length: 4 }, () => '가'.repeat(24_990));
  const expected = () => `[sheet1]\n${values.map((value, i) => `A${i + 1}: ${value}`).join('\n')}`;
  values[3] += '끝'.repeat(100_000 - expected().length);
  const make = () => workbook([values.map((value, i) => cell(`A${i + 1}`, value)).join('')]);
  assert.equal(expected().length, 100_000); assert.equal(await xlsx(make()), expected());
  values[3] += '초';
  await assert.rejects(xlsx(make()), rejectsCode('INTAKE_SOURCE_TOO_LARGE', /100,000/u));
});

test('CF115 TXT and CSV preserve full source at the limit and reject excess', async () => {
  for (const extension of ['txt', 'csv']) {
    const source = '원'.repeat(99_990) + '\n최종 담당·기한끝';
    assert.equal(source.length, 100_000);
    assert.equal((await extractIntakeSource(`회의.${extension}`, 'application/octet-stream', new TextEncoder().encode(source))).extractedText, source);
    await assert.rejects(extractIntakeSource(`회의.${extension}`, 'application/octet-stream', new TextEncoder().encode(source + '초')), rejectsCode('INTAKE_SOURCE_TOO_LARGE'));
  }
});

test('CF115 DOCX/HWPX limits include part separators and never silently truncate the final text', async () => {
  for (const extension of ['docx', 'hwpx']) {
    const names = extension === 'docx' ? ['word/document.xml', 'word/footer1.xml'] : ['Contents/section0.xml', 'Contents/section1.xml'];
    const first = '가'.repeat(49_999); const last = '나'.repeat(49_990) + ' 최종 담당 기한끝';
    assert.equal(first.length + last.length + 1, 100_000);
    const parts = { [names[0]]: `<p><t>${first}</t></p>`, [names[1]]: `<p><t>${last}</t></p>` };
    assert.equal(await extractEvidenceText(`회의.${extension}`, 'application/octet-stream', zip(parts)), `${first}\n${last}`);
    parts[names[1]] = `<p><t>${last}초</t></p>`;
    await assert.rejects(extractEvidenceText(`회의.${extension}`, 'application/octet-stream', zip(parts)), rejectsCode('INTAKE_SOURCE_TOO_LARGE', /100,000/u));
    await assert.rejects(extractEvidenceText(`빈양식.${extension}`, 'application/octet-stream', zip({ [names[0]]: '<p><t> </t></p>' })), rejectsCode('EMPTY_EVIDENCE_DOCUMENT'));
  }
});

test('CF115 Office part-count overflow is an explicit limit error', async () => {
  const parts = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`Contents/section${i}.xml`, `<hp:p><hp:t>기록 ${i}</hp:t></hp:p>`]));
  await assert.rejects(extractEvidenceText('긴회의.hwpx', 'application/octet-stream', zip(parts)), rejectsCode('INTAKE_SOURCE_TOO_LARGE', /100/u));
});
