import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';
import { extractIntakeSource, IntakeSourceError } from '../apps/cloudflare/src/intake-source.js';
import { encryptSecret } from '../apps/cloudflare/src/google-drive.js';

const CASE_ID = '40000000-0000-4000-8000-000000000010';
const PM_ID = '00000000-0000-4000-8000-000000000002';
const SESSION_TOKEN = 'cf47-pm-session-token';
const MASTER_KEY = 'a7'.repeat(32);
const INTAKE_TEXT = '2026-08-01 발주처가 추가 공사를 지시했고 클라이언트는 공사비 검토를 요청했습니다.';
const migrations = ['0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql','0004_cf05_google_drive.sql','0005_cf06_case_operations.sql','0006_cf07_report_studio_drafts.sql','0007_cf08_report_review_approval.sql','0008_cf09_final_output.sql','0009_cf09_output_actor_scope.sql','0010_cf10_product_experience.sql','0011_cf11_project_workflow.sql','0012_cf12_report_ai_prompts.sql','0013_cf13_litigation_records.sql','0014_cf14_proposal_award_workflow.sql','0015_cf15_case_evidence_library.sql','0016_cf18_report_outline_evidence.sql','0017_cf19_multi_provider_ai.sql','0018_cf26_ai_credentials.sql','0019_cf27_proposal_authoring.sql','0020_cf28_workspace_settings.sql','0021_cf29_report_memory_learning.sql','0022_cf30_settings_template_preview.sql','0023_cf31_google_oauth_app_settings.sql','0024_cf32_source_template_library.sql','0025_cf33_type_authoring_guidelines.sql','0026_cf34_hermes_memory_architecture.sql','0027_cf35_guided_workspace.sql','0028_cf36_workflow_integrity_tutorial_approval_intake.sql','0037_cf47_intake_source.sql'];

class SqlStatement {
  private values: unknown[] = [];
  constructor(private readonly database: Database, private readonly sql: string) {}
  bind(...values: unknown[]): SqlStatement { this.values = values; return this; }
  async first<T>(): Promise<T | null> { const statement = this.database.prepare(this.sql); try { statement.bind(this.values as any[]); return statement.step() ? statement.getAsObject() as T : null; } finally { statement.free(); } }
  async all<T>(): Promise<{ results: T[] }> { const statement = this.database.prepare(this.sql); const results: T[] = []; try { statement.bind(this.values as any[]); while (statement.step()) results.push(statement.getAsObject() as T); return { results }; } finally { statement.free(); } }
  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> { this.database.run(this.sql, this.values as any[]); return { success: true, meta: { changes: this.database.getRowsModified(), last_row_id: 0 } }; }
}
class SqlD1 {
  constructor(private readonly database: Database) {}
  prepare(sql: string): SqlStatement { return new SqlStatement(this.database, sql); }
  async batch(statements: SqlStatement[]): Promise<unknown[]> { this.database.run('BEGIN IMMEDIATE'); try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.run('COMMIT'); return results; } catch (error) { this.database.run('ROLLBACK'); throw error; } }
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map((entry) => entry.toString(16).padStart(2, '0')).join('');
}

async function integrationSetup(): Promise<{ sql: Database; env: CloudflareEnv }> {
  const SQL = await initSqlJs();
  const sql = new SQL.Database();
  sql.run('PRAGMA foreign_keys=ON');
  for (const name of migrations) {
    sql.exec(readFileSync(join(process.cwd(), 'apps', 'cloudflare', 'migrations', name), 'utf8'));
    if (name === '0009_cf09_output_actor_scope.sql') sql.run('INSERT INTO preview_users (id,login_id,password_salt,password_hash,password_iterations,display_name,email,roles_json,is_active,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)', [PM_ID, 'cf47-pm', '1'.repeat(32), '2'.repeat(64), 100000, 'CF47 프로젝트 PM', 'cf47-pm@example.invalid', '["pm"]', '2026-08-24T00:00:00.000Z']);
  }
  const currentCase = sql.exec('SELECT version,updated_at FROM preview_cases WHERE id=?', [CASE_ID])[0].values[0];
  const updatedAt = new Date(Math.max(Date.now(), Date.parse(String(currentCase[1])) + 1)).toISOString();
  sql.run("UPDATE preview_cases SET client_legal_position='VICTIM',client_position_detail='원고 조합',description='초기 메모',version=?,updated_at=? WHERE id=?", [Number(currentCase[0]) + 1, updatedAt, CASE_ID]);
  sql.run('INSERT INTO preview_sessions VALUES (?,?,?,?)', [await digest(SESSION_TOKEN), PM_ID, '2026-08-24T00:00:00.000Z', '2099-01-01T00:00:00.000Z']);
  const encrypted = await encryptSecret('cf47-refresh-token', MASTER_KEY, 'concost:google-refresh');
  sql.run('INSERT INTO preview_google_credentials (organization_id,encrypted_refresh_token,iv,scope,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', ['concost', encrypted.ciphertextHex, encrypted.ivHex, 'https://www.googleapis.com/auth/drive.file', PM_ID, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z']);
  let folderSequence = 0;
  const googleFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'cf47-access-token', token_type: 'Bearer' });
    if (url.includes('/drive/v3/files') && init?.method !== 'POST') return Response.json({ files: [] });
    if (url.includes('/drive/v3/files') && init?.method === 'POST' && !url.includes('/upload/')) {
      const metadata = JSON.parse(String(init.body)) as Record<string, unknown>;
      folderSequence += 1;
      return Response.json({ id: `cf47FolderId${folderSequence}00`, ...metadata, trashed: false });
    }
    if (url.includes('/upload/drive/v3/files')) return Response.json({ id: 'cf47UploadedFile001', name: '의뢰정리.txt', mimeType: 'text/plain', size: String(new TextEncoder().encode(INTAKE_TEXT).length), webViewLink: 'https://drive.google.test/file' });
    return new Response('unexpected Google request', { status: 500 });
  };
  const geminiFetch: typeof fetch = async (input, init) => {
    assert.match(String(input), /gemini-3\.7-flash/u, 'intake automation must use the current approved Gemini model');
    assert.doesNotMatch(String(input), /gemini-3\.6-flash/u, 'intake automation must not fall back to a retired model');
    const body = JSON.parse(String(init?.body)) as any;
    assert.equal('temperature' in body.generationConfig, false, 'Gemini document calls must omit deprecated sampling controls');
    assert.match(body.contents[0].parts[1].text, /발주처가 추가 공사를 지시/u);
    if (body.contents[0].parts[0].text.includes('JSON 객체 하나만 반환')) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title:'추가공사비 검토 의뢰', claimType:'TYPE-01', clientLegalPosition:'VICTIM', clientPositionDetail:'원고 조합', description:'2026-08-01 발주처의 추가 공사 지시에 대해 클라이언트가 공사비 검토를 요청했습니다.', reviewChecklist:['추가 공사 지시일 대조','클라이언트 법적 지위 확인'] }) }] } }] });
    return Response.json({ candidates: [{ content: { parts: [{ text: '1) 시간순 타임라인\n- 2026-08-01 발주처 추가 공사 지시\n2) 의뢰 배경\n추가 공사비 검토 요청' }] } }] });
  };
  return { sql, env: { DB: new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']>, GEMINI_API_KEY: 'AQ.CF47_SYNTHETIC_GEMINI_KEY', GEMINI_TEST_FETCH: geminiFetch, GOOGLE_CLIENT_ID: '123456789012-cf47.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'cf47-client-secret-value', GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY: MASTER_KEY, GOOGLE_OAUTH_REDIRECT_ORIGIN: 'https://preview.example', GOOGLE_ALLOWED_DOMAIN: 'con-cost.com', ALLOW_TEST_GOOGLE_MODES: 'true', GOOGLE_TEST_FETCH: googleFetch } };
}

function write16(target: Buffer, offset: number, value: number): void { target.writeUInt16LE(value, offset); }
function write32(target: Buffer, offset: number, value: number): void { target.writeUInt32LE(value >>> 0, offset); }

function xlsxZip(entries: Array<{ name: string; text: string }>): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const source = Buffer.from(entry.text, 'utf8');
    const compressed = deflateRawSync(source);
    const local = Buffer.alloc(30 + name.length);
    write32(local, 0, 0x04034b50); write16(local, 4, 20); write16(local, 6, 0); write16(local, 8, 8);
    write32(local, 18, compressed.length); write32(local, 22, source.length); write16(local, 26, name.length);
    name.copy(local, 30);
    localParts.push(local, compressed);
    const central = Buffer.alloc(46 + name.length);
    write32(central, 0, 0x02014b50); write16(central, 4, 20); write16(central, 6, 20); write16(central, 8, 0); write16(central, 10, 8);
    write32(central, 20, compressed.length); write32(central, 24, source.length); write16(central, 28, name.length); write32(central, 42, localOffset);
    name.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length + compressed.length;
  }
  const centralSize = centralParts.reduce((sum, entry) => sum + entry.length, 0);
  const eocd = Buffer.alloc(22);
  write32(eocd, 0, 0x06054b50); write16(eocd, 8, entries.length); write16(eocd, 10, entries.length); write32(eocd, 12, centralSize); write32(eocd, 16, localOffset);
  return new Uint8Array(Buffer.concat([...localParts, ...centralParts, eocd]));
}

test('CF47 accepts UTF-8 text and CSV as Gemini intake sources', async () => {
  const text = await extractIntakeSource('의뢰내용.txt', 'text/plain', new TextEncoder().encode('발주처가 2026년 8월 1일 추가 공사를 지시했습니다.'));
  assert.equal(text.kind, 'TEXT');
  assert.match(text.extractedText ?? '', /추가 공사/u);
  const csv = await extractIntakeSource('쟁점목록.csv', 'text/csv', new TextEncoder().encode('일자,쟁점\n2026-08-01,물가변동 기준일'));
  assert.equal(csv.kind, 'SPREADSHEET');
  assert.match(csv.extractedText ?? '', /물가변동 기준일/u);
});

test('CF47 extracts shared-string and numeric cells from lowercase HWP/Excel-produced XLSX parts', async () => {
  const bytes = xlsxZip([
    { name: '[content_types].xml', text: '<?xml version="1.0"?><Types><Override PartName="/xl/worksheets/sheet1.xml"/></Types>' },
    { name: 'xl/sharedstrings.xml', text: '<?xml version="1.0"?><sst><si><t>의뢰 배경</t></si><si><t>추가 공사비 검토 요청</t></si></sst>' },
    { name: 'xl/worksheets/sheet1.xml', text: '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="Z0" s="1"/><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><v>125000</v></c></row></sheetData></worksheet>' }
  ]);
  const result = await extractIntakeSource('사건정리.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes);
  assert.equal(result.kind, 'SPREADSHEET');
  assert.match(result.extractedText ?? '', /A1: 의뢰 배경/u);
  assert.match(result.extractedText ?? '', /B1: 추가 공사비 검토 요청/u);
  assert.match(result.extractedText ?? '', /C1: 125000/u);
});

test('CF74 extracts namespace-prefixed cells from Excel meeting-minute workbooks', async () => {
  const bytes = xlsxZip([
    { name: '[Content_Types].xml', text: '<?xml version="1.0"?><x:Types xmlns:x="urn:types"><x:Override PartName="/xl/worksheets/sheet1.xml"/></x:Types>' },
    { name: 'xl/sharedStrings.xml', text: '<?xml version="1.0"?><x:sst xmlns:x="urn:sheet"><x:si><x:t>회의 안건</x:t></x:si><x:si><x:t>공사비 검토 일정 확정</x:t></x:si></x:sst>' },
    { name: 'xl/worksheets/sheet1.xml', text: '<?xml version="1.0"?><x:worksheet xmlns:x="urn:sheet"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c></x:row></x:sheetData></x:worksheet>' }
  ]);
  const result = await extractIntakeSource('회의록_AI자동작성_테스트.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes);
  assert.equal(result.kind, 'SPREADSHEET');
  assert.match(result.extractedText ?? '', /A1: 회의 안건/u);
  assert.match(result.extractedText ?? '', /B1: 공사비 검토 일정 확정/u);
});

test('CF47 rejects legacy, disguised, binary, and empty source files before Gemini', async () => {
  await assert.rejects(() => extractIntakeSource('구형자료.xls', 'application/vnd.ms-excel', Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0])), (error: unknown) => error instanceof IntakeSourceError && error.code === 'UNSUPPORTED_INTAKE_SOURCE');
  await assert.rejects(() => extractIntakeSource('가짜.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', new TextEncoder().encode('not a zip')), (error: unknown) => error instanceof IntakeSourceError && error.code === 'INVALID_INTAKE_XLSX');
  await assert.rejects(() => extractIntakeSource('바이너리.txt', 'text/plain', Uint8Array.from([0, 1, 2, 3])), (error: unknown) => error instanceof IntakeSourceError && error.code === 'INVALID_INTAKE_TEXT');
});

test('CF47 intake-source endpoint atomically stores Drive metadata, Gemini summary, audit activity, and the organized case description', async () => {
  const { sql, env } = await integrationSetup();
  const form = new FormData();
  form.set('file', new File([new TextEncoder().encode(INTAKE_TEXT)], '의뢰정리.txt', { type: 'text/plain' }));
  const response = await worker.fetch(new Request(`https://preview.example/api/cases/${CASE_ID}/intake-source`, { method: 'POST', headers: { 'X-Session-Token': SESSION_TOKEN, 'Idempotency-Key': 'cf47-intake-text-0001' }, body: form }), env);
  assert.equal(response.status, 201, await response.clone().text());
  const body = await response.json() as any;
  assert.equal(body.phase, 'CF47_CLIENT_INTAKE_SOURCE');
  assert.equal(body.summary.sourceKind, 'TEXT');
  assert.match(body.summary.folderPath, /프로젝트 의뢰 원본/u);
  const caseRow = sql.exec('SELECT description FROM preview_cases WHERE id=?', [CASE_ID])[0].values[0][0];
  assert.match(String(caseRow), /추가 공사비 검토 요청/u);
  const evidence = sql.exec('SELECT original_name,mime_type,google_file_id FROM preview_intake_audio_evidence WHERE case_id=?', [CASE_ID])[0].values[0];
  assert.deepEqual(evidence, ['의뢰정리.txt', 'text/plain', 'cf47UploadedFile001']);
  assert.equal(sql.exec("SELECT COUNT(*) FROM preview_case_activities WHERE case_id=? AND event_type='INTAKE_SOURCE_SUMMARIZED'", [CASE_ID])[0].values[0][0], 1);
  sql.close();
});

test('CF48 intake assistant drafts all case fields from TXT before case creation and requires human review', async () => {
  const { sql, env } = await integrationSetup();
  const form = new FormData();
  form.set('file', new File([new TextEncoder().encode(INTAKE_TEXT)], '의뢰정리.txt', { type:'text/plain' }));
  form.set('title',''); form.set('claimType','TYPE-01'); form.set('clientLegalPosition','VICTIM'); form.set('clientPositionDetail',''); form.set('description','');
  const response = await worker.fetch(new Request('https://preview.example/api/cases/intake-source/draft', { method:'POST', headers:{'X-Session-Token':SESSION_TOKEN}, body:form }), env);
  assert.equal(response.status,200,await response.clone().text());
  const body=await response.json() as any;
  assert.equal(body.phase,'CF48_INTAKE_AI_DRAFT');
  assert.equal(body.requiresHumanReview,true);
  assert.equal(body.draft.title,'추가공사비 검토 의뢰');
  assert.equal(body.draft.clientLegalPosition,'VICTIM');
  assert.match(body.draft.description,/추가 공사 지시/u);
  assert.deepEqual(body.draft.reviewChecklist,['추가 공사 지시일 대조','클라이언트 법적 지위 확인']);
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_intake_audio_evidence')[0].values[0][0],0,'draft preview must not persist or upload before review');
  sql.close();
});

test('CF48 final upload preserves the human-reviewed case description instead of overwriting it with a second AI response', async () => {
  const { sql, env } = await integrationSetup();
  const reviewed='초기 메모';
  const form=new FormData(); form.set('file',new File([new TextEncoder().encode(INTAKE_TEXT)],'의뢰정리.txt',{type:'text/plain'})); form.set('useReviewedCaseDescription','true');
  const response=await worker.fetch(new Request(`https://preview.example/api/cases/${CASE_ID}/intake-source`,{method:'POST',headers:{'X-Session-Token':SESSION_TOKEN,'Idempotency-Key':'cf48-reviewed-source-0001'},body:form}),env);
  assert.equal(response.status,201,await response.clone().text());
  const body=await response.json() as any; assert.equal(body.caseDescription,reviewed); assert.match(body.summary.modelCode,/human-reviewed/u);
  assert.equal(sql.exec('SELECT description FROM preview_cases WHERE id=?',[CASE_ID])[0].values[0][0],reviewed);
  sql.close();
});

test('CF63 expired Google refresh token does not block intake save or proposal handoff', async () => {
  const { sql, env } = await integrationSetup();
  env.GOOGLE_TEST_FETCH = async (input) => String(input).includes('oauth2.googleapis.com/token')
    ? Response.json({ error:'invalid_grant' }, { status:400 })
    : new Response('unexpected Google request', { status:500 });
  const form=new FormData(); form.set('file',new File([new TextEncoder().encode(INTAKE_TEXT)],'의뢰정리.txt',{type:'text/plain'})); form.set('useReviewedCaseDescription','true');
  const response=await worker.fetch(new Request(`https://preview.example/api/cases/${CASE_ID}/intake-source`,{method:'POST',headers:{'X-Session-Token':SESSION_TOKEN,'Idempotency-Key':'cf63-expired-google-0001'},body:form}),env);
  assert.equal(response.status,202,await response.clone().text());
  const body=await response.json() as any;
  assert.equal(body.phase,'CF63_INTAKE_SAVED_DRIVE_PENDING');
  assert.equal(body.storage.status,'RECONNECT_REQUIRED');
  assert.equal(body.storage.code,'GOOGLE_RECONSENT_REQUIRED');
  assert.equal(body.caseDescription,'초기 메모');
  assert.equal(sql.exec("SELECT status,error_code FROM preview_intake_audio_operations WHERE idempotency_key='cf63-expired-google-0001'")[0].values[0][0],'FAILED');
  assert.equal(sql.exec("SELECT COUNT(*) FROM preview_case_activities WHERE case_id=? AND event_type='INTAKE_SOURCE_ARCHIVE_PENDING'",[CASE_ID])[0].values[0][0],1);
  sql.close();
});

test('CF47 UI and Worker connect the generic source route to Drive, D1, Gemini, and case description', () => {
  const worker = readFileSync('apps/cloudflare/src/index.ts', 'utf8');
  const ui = readFileSync('apps/web/src/case-management/CaseManagement.tsx', 'utf8');
  for (const marker of ['intake-source|intake-audio', 'extractIntakeSource', 'INTAKE_SOURCE_SUMMARIZED', '프로젝트 의뢰 원본', "SET description=?", 'latestIntakeSourceSummary']) assert.match(worker, new RegExp(marker));
  for (const marker of ['/intake-source/draft', '.txt,.csv,.xlsx', '분석할 의뢰 자료 · 회의록 / 녹음 / TXT / CSV / Excel', 'AI 자동 작성', '3단계 · 자동작성 결과 검수', '확인 항목 전체 체크 · 검수 완료', 'useReviewedCaseDescription', 'timeoutMs:55_000', 'timeoutHintSeconds={45}', 'intakeStorage=pending']) assert.ok(ui.includes(marker), `missing UI marker: ${marker}`);
  const api = readFileSync('apps/web/src/api.ts','utf8'); assert.match(api,/!\(init\.body instanceof FormData\)/u);
});
