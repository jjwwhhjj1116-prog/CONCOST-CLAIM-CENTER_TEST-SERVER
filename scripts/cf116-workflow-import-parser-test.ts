import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { minutesFieldDefaults } from '../apps/cloudflare/src/company-minutes';
import { extractWorkflowImportSource, localWorkflowAiImport, parseWorkflowAiImport, type WorkflowImportKind } from '../apps/cloudflare/src/workflow-import';

const { zipSync, strToU8 } = createRequire(resolve('apps/web/package.json'))('fflate');
const valid = {
  meetingAt: null, surveyDate: null, location: '', agenda: '원도면 검토', participants: [], leadUnit: '',
  sourceNotes: '김 담당: 원도면을 대조하겠습니다.\n발주처: 금액과 담당 기한은 아직 확정하지 않았습니다.',
  meetingContent: '원도면을 대조한다. 금액과 담당 기한은 미확정이다.', summary: '원도면 대조 필요. 금액·담당 기한 미확정.',
  timeline: [{ title: '근거 대조', detail: '원도면을 확인한다.' }], missingFields: ['담당 기한'], minutesFields: { ...minutesFieldDefaults }
};
const parse = (value: unknown, kind: WorkflowImportKind = 'KICKOFF', source?: string | null) => parseWorkflowAiImport(JSON.stringify(value), kind, source);

test('CF116 unsupported immediate deadlines become review-needed without changing original speech or unrelated task text', () => {
  for (const deadline of ['즉시','즉각','당일','오늘','내일','금일','익일','이번 주']) {
    const detail = `자료를 송부한다. 담당자: 조합, 기한: ${deadline}`;
    const result = parse({ ...valid, summary: `필요자료. 기한: ${deadline}`, timeline: [{ title:'자료 송부', detail }] }, 'KICKOFF', valid.sourceNotes)!;
    assert.ok(result); assert.equal(result.timeline[0].detail,'자료를 송부한다. 담당자: 조합, 기한: 확인 필요');
    assert.equal(result.summary,'필요자료. 기한: 확인 필요'); assert.ok(result.missingFields.includes('후속 업무 기한'));
    assert.equal(result.sourceNotes,valid.sourceNotes); assert.equal(result.meetingContent,valid.meetingContent);
    assert.equal(parse({ ...valid,timeline:[{title:'자료 송부',detail}] },'KICKOFF',`자료를 ${deadline} 송부해 주세요.`)!.timeline[0].detail,detail);
  }
  for (const deadline of ['내일까지', '이번 주 금요일', '이번 주 금요일까지']) {
    const result = parse({ ...valid, timeline:[{title:'자료 송부',detail:`기한: ${deadline}`}] }, 'KICKOFF', valid.sourceNotes)!;
    assert.equal(result.timeline[0].detail, '기한: 확인 필요');
  }
  const extendedDetail = '기한: 내일 오후 3시';
  assert.equal(parse({ ...valid,timeline:[{title:'자료 송부',detail:extendedDetail}] },'KICKOFF',valid.sourceNotes)!.timeline[0].detail,extendedDetail, 'Do not partially rewrite unsupported compound deadlines');
});

test('CF116 no ordered events is valid for both workflows without fabricating a timeline', () => {
  for (const kind of ['KICKOFF', 'SITE_SURVEY'] as const) {
    const result = parse({ ...valid, timeline: [] }, kind)!;
    assert.ok(result); assert.deepEqual(result.timeline, []); assert.deepEqual(result.missingFields, valid.missingFields);
    assert.equal(result.meetingAt, null); assert.equal(result.surveyDate, null);
    for (const timeline of [undefined, null, {}, Array(21).fill(valid.timeline[0])]) assert.equal(parse({ ...valid, timeline }, kind), null);
    assert.equal(parse({ ...valid, timeline: Array(20).fill(valid.timeline[0]) }, kind)!.timeline.at(-1)!.order, 20);
  }
});

test('CF116 valid second-precision times normalize to the minute-based form without rounding or accepting invalid clocks', () => {
  for (const [input, expected] of [['00:00:00', '00:00'], ['14:00:00', '14:00'], ['23:59:59', '23:59'], [' 10:30:05 ', '10:30'], ['09:15', '09:15'], ['', '']]) {
    const result = parse({ ...valid, minutesFields: { ...valid.minutesFields, meetingStartTime: input, meetingEndTime: input } })!;
    assert.ok(result, input); assert.equal(result.minutesFields.meetingStartTime, expected); assert.equal(result.minutesFields.meetingEndTime, expected);
    assert.equal(result.sourceNotes, valid.sourceNotes, 'original transcript is not shortened to minute precision');
  }
  for (const input of ['24:00:00', '23:60:00', '23:59:60', '10:00:00Z', '10:00:00.123', '0:00:00', '00:00:-1', ' '.repeat(2001), null, 100000]) {
    assert.equal(parse({ ...valid, minutesFields: { ...valid.minutesFields, meetingStartTime: input } }), null, String(input));
  }
});

test('CF116 entirely unreadable transcripts fail while partially unclear speech remains intact', () => {
  for (const placeholder of ['[청취 불가]', '(판독 불가)', '[INAUDIBLE]', '읽을 수 없습니다.', '[00:00] [청취 불가]\n\n00:15:00 - (전사 불가)']) {
    assert.equal(parse({ ...valid, sourceNotes: placeholder }), null, placeholder);
    assert.equal(parse({ ...valid, meetingContent: placeholder }), null, placeholder);
    assert.equal(parse({ ...valid, summary: placeholder }), null, placeholder);
  }
  const partial = '[00:00] [청취 불가]\n김 담당: 도면 검토는 진행하고 기한은 미정입니다.\n[청취 불가]';
  assert.equal(parse({ ...valid, sourceNotes: partial, meetingContent: partial })!.meetingContent, partial);
  assert.equal(parse({ ...valid, sourceNotes: '녹음 중 “청취 불가” 표기는 사람이 확인해야 한다.' })!.sourceNotes, '녹음 중 “청취 불가” 표기는 사람이 확인해야 한다.');
});

test('CF116 empty or omitted media body recovers the full transcript and does not use an invented summary', () => {
  for (const meetingContent of ['', ' \n ', undefined]) {
    const result = parse({ ...valid, meetingContent }, 'SITE_SURVEY')!;
    assert.ok(result); assert.equal(result.meetingContent, valid.sourceNotes); assert.equal(result.sourceNotes, valid.sourceNotes);
    assert.notEqual(result.meetingContent, valid.summary);
  }
  assert.equal(parse({ ...valid, meetingContent: null }), null);
  assert.equal(parse(valid)!.meetingContent, valid.meetingContent, 'nonblank provider body stays unchanged');
});

test('CF116 exact XLSX body and weekday date survive extraction, even when AI omits or miscopies its body', async () => {
  const cells = [
    ['B5', '회의일시'], ['C5', '2026. 08. 21.(금)'], ['E5', '시간'], ['F5', '14:00'], ['G5', '~'], ['H5', '15:30'],
    ['B16', '회의내용 및 지시사항'], ['B17', '김 담당: 원도면을 먼저 대조한다.\n금액은 미확정이다.'], ['B18', '발주처: 추가 자료 제공 후 기한을 협의한다.'],
    ['B44', '※거래처 명함은 PDF파일로 업로드']
  ];
  const xml = `<worksheet><sheetData>${cells.map(([ref, text]) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`).join('')}</sheetData></worksheet>`;
  const bytes = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'xl/worksheets/sheet1.xml': strToU8(xml) });
  const source = await extractWorkflowImportSource('회의록_AI자동작성_테스트.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes);
  const expected = '김 담당: 원도면을 먼저 대조한다.\n금액은 미확정이다.\n발주처: 추가 자료 제공 후 기한을 협의한다.';
  for (const kind of ['KICKOFF', 'SITE_SURVEY'] as const) {
    const local = localWorkflowAiImport('회의록_AI자동작성_테스트.xlsx', kind, source.text!);
    assert.equal(local.surveyDate, '2026-08-21'); assert.equal(local.meetingAt, '2026-08-21T05:00:00.000Z');
    assert.equal(local.minutesFields.meetingStartTime, '14:00'); assert.equal(local.minutesFields.meetingEndTime, '15:30');
    assert.equal(local.meetingContent, expected); assert.equal(local.sourceNotes, source.text);
    const result = parse({ ...valid, meetingContent: '', sourceNotes: 'AI가 재작성한 축약 원문' }, kind, source.text)!;
    assert.ok(result); assert.equal(result.meetingContent, expected); assert.doesNotMatch(result.meetingContent!, /B\d+:|회의일시|명함/u);
    assert.equal(parse({ ...valid, meetingContent: undefined, sourceNotes: source.text }, kind)!.meetingContent, expected);
  }
});

test('CF116 body recovery never falls back to worksheet addresses, an empty form, or truncated source', () => {
  for (const source of ['[sheet1]\nA1: 수량\nA2: 300', '[sheet1]\nB16: 회의내용 및 지시사항\nB44: ※거래처 명함은 PDF파일로 업로드', '회의내용 및 지시사항:\n', '[청취 불가]']) {
    assert.equal(parse({ ...valid, meetingContent: '' }, 'KICKOFF', source), null, source);
  }
  assert.equal(parse({ ...valid, meetingContent: '' }, 'KICKOFF', '원'.repeat(50_001)), null);
  assert.equal(parse({ ...valid, meetingContent: '' }, 'KICKOFF', '원'.repeat(50_000))!.meetingContent!.length, 50_000);
});

test('CF116 date weekday suffixes do not relax calendar validity or guess Excel serial dates', () => {
  for (const date of ['2026. 08. 21.(금)', '2026.08.21 (금요일)', '2026년 8월 21일(금)', '2026-08-21', '2026/08/21(금)']) {
    const result = localWorkflowAiImport('날짜.txt', 'KICKOFF', `회의일시: ${date}\n시작시간: 14:00:05\n종료시간: 15:30:59\n회의내용: 원도면 검토`);
    assert.equal(result.surveyDate, '2026-08-21', date); assert.equal(result.meetingAt, '2026-08-21T05:00:00.000Z');
    assert.equal(result.minutesFields.meetingEndTime, '15:30'); assert.ok(result.sourceNotes.includes('15:30:59'));
  }
  for (const date of ['2026.02.30.(월)', '2026.13.21.(금)', '2026.08.00.(금)', '2026.08.21.(foo)', '46255']) {
    const result = localWorkflowAiImport('날짜.txt', 'KICKOFF', `회의일시: ${date}\n시작시간: 14:00\n회의내용: 원도면 검토`);
    assert.equal(result.surveyDate, null, date); assert.equal(result.meetingAt, null); assert.ok(result.missingFields.includes('회의 일자'));
  }
});

test('CF116 recognized company form preserves explicit blank fields, separate attendees and only the actual meeting body', () => {
  const source = '[sheet1]\nB4: 작성자\nC4: 소속\nE4: 직급\nG4: 성명\nB8: 보고부서\nB9: 참조부서\nB10: 참석자(컨코스트)\nC10: 실무총괄 1명, 담당 1명\nB11: 참석자(거래처)\nC11: 조합장, 총무이사, 조합 직원 1명\nB16: 회의내용 및 지시사항\nB17: 원도면을 대조하고 필요 자료를 받은 후 제안서를 제출한다.\nB18: 다음 일정은 자료 수령 후 협의한다.\nB44: ※거래처 명함은 PDF파일로 업로드';
  for (const kind of ['KICKOFF', 'SITE_SURVEY'] as const) {
    const result = localWorkflowAiImport('회사양식.xlsx', kind, source);
    for (const key of ['author', 'authorDepartment', 'authorPosition', 'reportingDepartment'] as const) assert.equal(result.minutesFields[key], '', key);
    assert.equal(result.minutesFields.referenceDepartments, '모든 부서', 'the explicitly requested reference-department default remains unchanged');
    assert.equal(result.minutesFields.participants, '실무총괄 1명, 담당 1명');
    assert.deepEqual(result.participants, ['실무총괄 1명', '담당 1명']);
    assert.equal(result.minutesFields.clientParticipants, '조합장, 총무이사, 조합 직원 1명');
    assert.equal(result.meetingContent, '원도면을 대조하고 필요 자료를 받은 후 제안서를 제출한다.\n다음 일정은 자료 수령 후 협의한다.');
    assert.doesNotMatch(result.meetingContent!, /명함|PDF|업로드/u); assert.equal(result.sourceNotes, source);
    const freeform = localWorkflowAiImport('메모.txt', kind, '원도면을 대조하고 필요 자료를 받은 후 제안서를 제출한다.');
    assert.equal(freeform.minutesFields.authorDepartment, minutesFieldDefaults.authorDepartment);
    assert.equal(freeform.minutesFields.reportingDepartment, minutesFieldDefaults.reportingDepartment);
  }
});
