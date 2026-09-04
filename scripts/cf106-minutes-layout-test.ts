import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { meetingMinutesWorkbook, type MeetingMinutesExcelValues } from '../apps/web/src/proposals/proposal-excel';

const values: MeetingMinutesExcelValues = {
  author: '검수 담당자', authorDepartment: '기술팀', authorPosition: '과장',
  meetingDate: '2026. 09. 03', meetingTime: '10:00', meetingEndTime: '11:30',
  location: '본사 회의실', clientName: '검수 조합', reportingDepartment: '사업팀',
  participants: '김담당, 이담당', clientParticipants: '발주처 담당자',
  meetingTitle: '착수회의', attachmentName: '자료.pdf',
  summary: '원문 메모\n현장 확인 후 다음 주 보고합니다.', followUps: ''
};

function parts(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map<string, string>();
  for (let offset = 0; view.getUint32(offset, true) === 0x04034b50;) {
    const size = view.getUint32(offset + 18, true), nameSize = view.getUint16(offset + 26, true);
    const start = offset + 30 + nameSize + view.getUint16(offset + 28, true);
    entries.set(new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameSize)), new TextDecoder().decode(bytes.slice(start, start + size)));
    offset = start + size;
  }
  return entries;
}

function assertBorders(entries: Map<string, string>) {
  const sheet = entries.get('xl/worksheets/sheet1.xml')!;
  const styles = entries.get('xl/styles.xml')!;
  const cells = new Map([...sheet.matchAll(/<c r="([^"]+)"[^>]* s="(\d+)"[^>]*>/g)].map(match => [match[1], Number(match[2])]));
  const formats = [.../<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)![1].matchAll(/<xf\b[^>]*borderId="(\d+)"[^>]*>/g)].map(match => Number(match[1]));
  const borders = [.../<borders[^>]*>([\s\S]*?)<\/borders>/.exec(styles)![1].matchAll(/<border\b[^>]*\/>|<border\b[^>]*>[\s\S]*?<\/border>/g)].map(match => match[0]);
  const lastRow = [...sheet.matchAll(/<row r="(\d+)"/g)].at(-1)![1];
  assert.match(borders[formats[cells.get('A1')!]], /<top style="thin"/);
  assert.match(borders[formats[cells.get(`A${lastRow}`)!]], /<bottom style="thin"/);
  for (const merge of sheet.matchAll(/<mergeCell ref="([A-H])(\d+):([A-H])(\d+)"/g)) {
    assert.equal(merge[2], merge[4], 'Horizontal merges must stay within a printable row');
    for (let column = merge[1].charCodeAt(0); column <= merge[3].charCodeAt(0); column++) {
      const reference = `${String.fromCharCode(column)}${merge[2]}`;
      assert.ok(cells.has(reference), `${reference}: missing styled cell in merged range`);
      const border = borders[formats[cells.get(reference)!]];
      assert.ok(border, `${reference}: invalid border reference`);
      if (column === merge[1].charCodeAt(0)) assert.match(border, /<left style="thin"/);
      else assert.doesNotMatch(border, /<left style=/, `${reference}: internal vertical border`);
      if (column === merge[3].charCodeAt(0)) assert.match(border, /<right style="thin"/);
      else assert.doesNotMatch(border, /<right style=/, `${reference}: internal vertical border`);
      const anchor = borders[formats[cells.get(`${merge[1]}${merge[2]}`)!]];
      for (const edge of ['top', 'bottom']) assert.equal(border.includes(`<${edge} style=`), anchor.includes(`<${edge} style=`), `${reference}: broken ${edge} border`);
    }
  }
  return sheet;
}

test('CF106 every merged cell has continuous outside borders, without internal lines', () => {
  // Allows the exact pre-fix generated file to prove this check catches the bug.
  const bytes = process.env.CF106_BASELINE ? readFileSync(process.env.CF106_BASELINE) : meetingMinutesWorkbook(values);
  assertBorders(parts(bytes));
});

test('CF106 short minutes match the form, omit empty follow-up box, and define the A4 print area', () => {
  const entries = parts(meetingMinutesWorkbook(values));
  const sheet = assertBorders(entries);
  assert.match(sheet, /width="12"/);
  assert.equal([...sheet.matchAll(/<row /g)].length, 14);
  assert.match(sheet, /모든 부서/);
  assert.match(sheet, /※ 거래처 명함은 PDF 파일로 업로드/);
  assert.doesNotMatch(sheet, /결정사항 · 후속업무/);
  assert.match(sheet, /paperSize="9" fitToWidth="1" fitToHeight="0"/);
  assert.match(entries.get('xl/workbook.xml')!, /'회의록'!\$A\$1:\$H\$14/);
  assert.ok(sheet.indexOf('<pageMargins ') < sheet.indexOf('<pageSetup '));
});

test('CF106 long Korean minutes and metadata continue without clipping or losing text', () => {
  const longValues = { ...values, participants: '담당자 한글 이름 '.repeat(160), summary: Array.from({ length: 90 }, (_, i) => `${i + 1}. 현장 확인사항과 지시 내용을 담당자가 검토하여 제출합니다.`).join('\n'), followUps: '최종 담당자: 김담당\n제출 기한: 2026-10-01' };
  const bytes = meetingMinutesWorkbook(longValues);
  const sheet = assertBorders(parts(bytes));
  const cellText = [...sheet.matchAll(/<t xml:space="preserve">([\s\S]*?)<\/t>/g)].map(match => match[1]).join('');
  assert.ok(cellText.includes(longValues.summary), 'Every character of long notes must survive');
  assert.ok(cellText.includes(longValues.participants.trim()), 'Long metadata must survive');
  assert.ok(cellText.includes(longValues.followUps));
  for (const row of sheet.matchAll(/<row r="\d+" ht="([^"]+)"/g)) assert.ok(Number(row[1]) <= 409, 'Excel row height limit');
  assert.ok([...sheet.matchAll(/<row /g)].length > 14);
  if (process.env.CF106_EXPORT_DIR) {
    mkdirSync(process.env.CF106_EXPORT_DIR, { recursive: true });
    writeFileSync(`${process.env.CF106_EXPORT_DIR}/long-minutes.xlsx`, bytes);
    writeFileSync(`${process.env.CF106_EXPORT_DIR}/short-minutes.xlsx`, meetingMinutesWorkbook(values));
  }
});

test('CF106 wide ASCII letters are not counted as narrow characters', () => {
  const summary = 'W'.repeat(1104) + '\n' + 'O'.repeat(1104) + '\nEND OF WIDE TEXT';
  const bytes = meetingMinutesWorkbook({ ...values, summary });
  const sheet = assertBorders(parts(bytes));
  assert.ok([...sheet.matchAll(/<row /g)].length >= 16, 'Wide letters need multiple content rows');
  const text = [...sheet.matchAll(/<t xml:space="preserve">([\s\S]*?)<\/t>/g)].map(match => match[1]).join('');
  assert.ok(text.includes(summary));
  if (process.env.CF106_EXPORT_DIR) writeFileSync(`${process.env.CF106_EXPORT_DIR}/wide-minutes.xlsx`, bytes);
});
