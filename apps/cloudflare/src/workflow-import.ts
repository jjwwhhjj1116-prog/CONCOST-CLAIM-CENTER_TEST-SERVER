import { extractEvidenceText, extractIntakeSource, IntakeSourceError } from './intake-source';
import { minutesFieldDefaults, normalizeMinutesFields, type MinutesFields } from './company-minutes';

export type WorkflowImportKind = 'KICKOFF' | 'SITE_SURVEY';
export type WorkflowImportDataClass = 'GENERAL' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
export interface WorkflowAiImportResult {
  meetingAt: string | null;
  surveyDate: string | null;
  location: string;
  agenda: string;
  participants: string[];
  leadUnit: string;
  sourceNotes: string;
  meetingContent?: string;
  summary: string;
  timeline: Array<{ order: number; title: string; detail: string }>;
  missingFields: string[];
  minutesFields: MinutesFields;
}

const sourceLimit = 50_000;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const bounded = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit && !value.includes('\0');
const list = (value: unknown, count: number, width: number): value is string[] => Array.isArray(value) && value.length <= count && value.every(item => bounded(item, width) && item.trim());
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const unreadable = /^(?:unreadable|cannot read|추출 실패|판독 불가|읽을 수 없(?:음|습니다)|내용 없음)[.!]?$/iu;

/** Reject incomplete/oversized provider output; never silently truncate evidence. */
export function parseWorkflowAiImport(content: string, kind: WorkflowImportKind): WorkflowAiImportResult | null {
  try {
    if (content.length > 250_000) return null;
    const value: unknown = JSON.parse(content.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, ''));
    if (!record(value) || value.readable === false || value.status === 'UNREADABLE') return null;
    for (const [key, limit] of Object.entries({ location: 300, agenda: 12_000, leadUnit: 120, sourceNotes: sourceLimit, summary: 30_000 })) {
      if (!bounded(value[key], limit)) return null;
    }
    if (!String(value.sourceNotes).trim() || !String(value.summary).trim() || unreadable.test(String(value.sourceNotes).trim()) || unreadable.test(String(value.summary).trim())) return null;
    if (value.meetingContent !== undefined && !bounded(value.meetingContent, sourceLimit)) return null;
    if (value.meetingAt !== null && (!bounded(value.meetingAt, 40) || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/u.test(value.meetingAt) || !validDate(value.meetingAt.slice(0, 10)) || Number.isNaN(Date.parse(value.meetingAt)))) return null;
    if (value.surveyDate !== null && (!bounded(value.surveyDate, 10) || !validDate(value.surveyDate))) return null;
    if (!list(value.participants, 30, 120) || !list(value.missingFields, 20, 120) || !Array.isArray(value.timeline) || value.timeline.length < 1 || value.timeline.length > 20) return null;
    const timeline: WorkflowAiImportResult['timeline'] = [];
    for (const item of value.timeline) {
      if (!record(item) || !bounded(item.title, 160) || !item.title.trim() || !bounded(item.detail, 1200) || !item.detail.trim()) return null;
      timeline.push({ order: timeline.length + 1, title: item.title.trim(), detail: item.detail.trim() });
    }
    const minutesFields = normalizeMinutesFields(value.minutesFields);
    if (!minutesFields) return null;
    const missingFields = value.missingFields.map(item => item.trim());
    if (!String(value.agenda).trim()) {
      const label = kind === 'KICKOFF' ? '회의 안건' : '조사 범위';
      if (!missingFields.includes(label)) missingFields.push(label);
    }
    if (missingFields.length > 20) return null;
    return {
      meetingAt: value.meetingAt === null ? null : new Date(String(value.meetingAt)).toISOString(), surveyDate: value.surveyDate as string | null,
      location: String(value.location).trim(), agenda: String(value.agenda).trim(), leadUnit: String(value.leadUnit).trim(),
      participants: value.participants.map(item => item.trim()), sourceNotes: String(value.sourceNotes).trim(), summary: String(value.summary).trim(),
      ...(value.meetingContent !== undefined ? { meetingContent: String(value.meetingContent).trim() } : {}), timeline, missingFields, minutesFields
    };
  } catch { return null; }
}

export interface WorkflowImportSource {
  text: string | null;
  mimeType: string;
  kind: 'TEXT' | 'DOCUMENT' | 'IMAGE' | 'AUDIO' | 'PDF';
}

/** Bytes must first pass validateEvidenceFile; only native Gemini media stay binary. */
export async function extractWorkflowImportSource(fileName: string, suppliedMimeType: string, bytes: Uint8Array): Promise<WorkflowImportSource> {
  const extension = fileName.trim().toLowerCase().split('.').pop() ?? '';
  const mimeType = suppliedMimeType.toLowerCase().split(';')[0].trim();
  if (['txt', 'csv', 'xlsx', 'docx', 'hwpx'].includes(extension)) {
    const text = await extractEvidenceText(fileName, mimeType, bytes);
    if (!text.trim()) throw new IntakeSourceError('EMPTY_WORKFLOW_IMPORT', '문서에서 읽을 수 있는 원문이 없습니다. 스캔 문서는 PDF 또는 이미지로 다시 올려 주세요.');
    if (text.length > sourceLimit) throw new IntakeSourceError('WORKFLOW_IMPORT_TOO_LARGE', '원문이 50,000자를 넘습니다. 내용이 잘리지 않도록 문서를 나누어 올려 주세요.');
    return { text, mimeType: 'text/plain', kind: ['txt', 'csv'].includes(extension) ? 'TEXT' : 'DOCUMENT' };
  }
  if (['hwp', 'doc', 'xls'].includes(extension)) throw new IntakeSourceError('WORKFLOW_CONVERSION_REQUIRED', `${extension.toUpperCase()} 원본은 자료실에 보존할 수 있습니다. 자동정리에는 HWPX·DOCX·XLSX 또는 PDF로 변환한 파일을 올려 주세요.`);
  if (extension === 'pdf' && mimeType === 'application/pdf') return { text: null, mimeType, kind: 'PDF' };
  const imageMimes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
  if (imageMimes[extension] === mimeType) return { text: null, mimeType, kind: 'IMAGE' };
  if (['mp3', 'm4a', 'wav', 'ogg', 'webm'].includes(extension)) {
    const audio = await extractIntakeSource(fileName, mimeType, bytes);
    return { text: null, mimeType: audio.mimeType === 'audio/x-wav' ? 'audio/wav' : audio.mimeType, kind: 'AUDIO' };
  }
  throw new IntakeSourceError('UNSUPPORTED_WORKFLOW_IMPORT', '지원되지 않는 자동정리 형식입니다. 문서는 PDF·DOCX·HWPX·XLSX·TXT·CSV, 이미지는 PNG·JPG·WEBP, 녹음은 MP3·M4A·WAV·OGG·WEBM을 사용해 주세요.');
}

const normalizeLabel = (value: string) => value.replace(/[\s·:：]/gu, '').replaceAll('콘코스트', '컨코스트');
const labels: Record<string, keyof MinutesFields | 'date' | 'location' | 'leadUnit'> = {
  작성자: 'author', 성명: 'author', 작성자성명: 'author', 소속: 'authorDepartment', 작성자소속: 'authorDepartment', 직급: 'authorPosition', 작성자직급: 'authorPosition',
  거래처명: 'clientName', 보고부서: 'reportingDepartment', 참조부서: 'referenceDepartments', '참석자(컨코스트)': 'participants', 참석자: 'participants', '참석자(거래처)': 'clientParticipants',
  회의명: 'meetingTitle', 회의안건: 'meetingTitle', 조사범위: 'meetingTitle', 첨부파일: 'attachmentName', 첨부파일명: 'attachmentName',
  회의일시: 'date', 회의일자: 'date', 조사일자: 'date', 회의장소: 'location', 현장위치: 'location', 장소: 'location', 조사책임팀: 'leadUnit',
  시간: 'meetingStartTime', 시작시간: 'meetingStartTime', 종료시간: 'meetingEndTime'
};
const bodyHeading = (value: string) => ['회의내용및지시사항', '회의내용', '현장조사내용', '조사내용및지시사항'].includes(normalizeLabel(value));
const present = (value: string) => !['', '—', '-', '미입력'].includes(value.trim());

function formRows(source: string): string[][] {
  const rows: Array<{ cells: Array<{ column: number; text: string }> }> = [];
  let previousRow = '', sheet = 0;
  for (const line of source.split('\n')) {
    if (/^\[[^\]]+\]$/u.test(line.trim())) { sheet++; previousRow = ''; continue; }
    const cell = /^([A-Z]{1,4})(\d+):\s*(.*)$/u.exec(line);
    if (!cell) {
      // The extractor preserves newlines inside a cell, including company-form labels.
      if (previousRow) { const cells = rows[rows.length - 1].cells; cells[cells.length - 1].text += `\n${line}`; }
      else rows.push({ cells: [{ column: 0, text: line }] });
      continue;
    }
    const row = `${sheet}:${cell[2]}`;
    if (row !== previousRow) rows.push({ cells: [] });
    rows[rows.length - 1].cells.push({ column: [...cell[1]].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0), text: cell[3] });
    previousRow = row;
  }
  return rows.map(row => row.cells.sort((a, b) => a.column - b.column).map(cell => cell.text));
}

function formDate(value = ''): string | null {
  // Bare Excel serials have no date-system metadata here (1900 versus 1904).
  // Leave the date missing instead of guessing a date four years away.
  const match = /^(\d{4})\s*[년.\/-]\s*(\d{1,2})\s*[월.\/-]\s*(\d{1,2})(?:\s*일|\.)?(?:\s|$)/u.exec(value);
  if (!match) return null;
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return validDate(date) ? date : null;
}

function formTime(value = ''): string {
  if (/^0(?:\.\d+)?$/u.test(value)) {
    const minutes = Math.round(Number(value) * 1440);
    if (minutes < 1440) return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const match = /^(?:(오전|오후)\s*)?(\d{1,2})(?::|시\s*)(\d{1,2})(?:분)?$/u.exec(value);
  // Handle HHMM separately so the AM/PM groups remain unambiguous.
  const compact = /^(\d{2})(\d{2})$/u.exec(value);
  let hour = compact ? Number(compact[1]) : match ? Number(match[2]) : -1;
  const minute = compact ? Number(compact[2]) : match ? Number(match[3]) : -1;
  if (!compact && match?.[1]) { if (hour < 1 || hour > 12) return ''; hour = hour % 12 + (match[1] === '오후' ? 12 : 0); }
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : '';
}

/** Label extraction is not AI summarization. Keep all source text for comparison. */
export function localWorkflowAiImport(fileName: string, kind: WorkflowImportKind, sourceText: string): WorkflowAiImportResult {
  if (!bounded(sourceText, sourceLimit)) throw new IntakeSourceError('WORKFLOW_IMPORT_TOO_LARGE', '원문이 50,000자를 넘거나 올바른 텍스트가 아닙니다. 문서를 나누어 올려 주세요.');
  const sourceNotes = sourceText.replace(/\r\n?/gu, '\n').trim();
  if (!sourceNotes) throw new IntakeSourceError('EMPTY_WORKFLOW_IMPORT', '가져올 원문이 없습니다.');
  const rows = formRows(sourceNotes), values: Record<string, string> = {}, body: string[] = [];
  let inBody = false, foundBody = false;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    for (let index = 0; index < row.length; index++) {
      const text = row[index].trim();
      if (/^※.*거래처.*명함/u.test(text)) { inBody = false; continue; }
      if (inBody) { body.push(row[index]); continue; }
      const pair = /^([^:：]+)[:：]\s*(.*)$/u.exec(text);
      const label = pair ? pair[1] : text;
      if (bodyHeading(label)) { inBody = true; foundBody = true; if (pair?.[2]) body.push(pair[2]); continue; }
      const key = labels[normalizeLabel(label)];
      if (!key || values[key]) continue;
      const candidate = pair?.[2] || row[index + 1] || (row.length === 1 && rows[rowIndex + 1]?.length === 1 ? rows[rowIndex + 1][0] : '');
      if (!present(candidate) || labels[normalizeLabel(candidate)] || bodyHeading(candidate)) continue;
      values[key] = candidate.trim();
      if (key === 'meetingStartTime' && row[index + 2]?.trim() === '~' && present(row[index + 3] ?? '')) values.meetingEndTime = row[index + 3].trim();
    }
  }
  const date = formDate(values.date);
  const start = formTime(values.meetingStartTime), end = formTime(values.meetingEndTime);
  const fields = Object.fromEntries(Object.keys(minutesFieldDefaults).filter(key => values[key] !== undefined).map(key => [key, values[key]]));
  fields.meetingStartTime = start; fields.meetingEndTime = end; fields.attachmentName ||= fileName;
  const minutesFields = normalizeMinutesFields(fields);
  if (!minutesFields) throw new IntakeSourceError('WORKFLOW_FORM_FIELD_TOO_LARGE', '회의록 양식 항목이 너무 길거나 올바르지 않습니다. 원문을 확인해 주세요.');
  const participants = (values.participants ?? '').split(/[,;\n]/u).map(value => value.trim()).filter(Boolean);
  if (!list(participants, 30, 120) || !bounded(values.location ?? '', 300) || !bounded(values.leadUnit ?? '', 120)) throw new IntakeSourceError('WORKFLOW_FORM_FIELD_TOO_LARGE', '참석자·장소·담당팀이 저장 한계를 넘습니다. 원문을 확인해 주세요.');
  const agenda = values.meetingTitle ?? '';
  const missingFields = ['AI 정리 미실행'];
  if (!date) missingFields.push(kind === 'KICKOFF' ? '회의 일자' : '조사 일자');
  if (kind === 'KICKOFF' && !start) missingFields.push('회의 시간');
  if (!values.location) missingFields.push(kind === 'KICKOFF' ? '회의 장소' : '현장 위치');
  if (!agenda) missingFields.push(kind === 'KICKOFF' ? '회의 안건' : '조사 범위');
  if (kind === 'KICKOFF' && !participants.length) missingFields.push('참석자');
  if (kind === 'SITE_SURVEY' && !values.leadUnit) missingFields.push('조사 책임팀');
  return {
    meetingAt: date && start ? new Date(`${date}T${start}:00+09:00`).toISOString() : null, surveyDate: date,
    location: values.location ?? '', agenda, participants, leadUnit: values.leadUnit ?? '', sourceNotes,
    ...(foundBody ? { meetingContent: body.join('\n').trim() } : {}), summary: '', timeline: [], missingFields, minutesFields
  };
}
