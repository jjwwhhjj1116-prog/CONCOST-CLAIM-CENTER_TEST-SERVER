import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const OUTSIDER_ID = '00000000-0000-4000-8000-000000000002';
const ADMIN_TOKEN = 'cf11-admin-session-token';
const OUTSIDER_TOKEN = 'cf11-outsider-session-token';
const CASE_ID = '40000000-0000-4000-8000-000000000010';

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class SqlStatement {
  private values: unknown[] = [];
  constructor(private readonly database: Database, private readonly sql: string) {}
  bind(...values: unknown[]): SqlStatement { this.values = values; return this; }
  async first<T>(): Promise<T | null> {
    const statement = this.database.prepare(this.sql);
    try { statement.bind(this.values as any[]); return statement.step() ? statement.getAsObject() as T : null; }
    finally { statement.free(); }
  }
  async all<T>(): Promise<{ results: T[] }> {
    const statement = this.database.prepare(this.sql);
    const results: T[] = [];
    try { statement.bind(this.values as any[]); while (statement.step()) results.push(statement.getAsObject() as T); return { results }; }
    finally { statement.free(); }
  }
  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> {
    this.database.run(this.sql, this.values as any[]);
    const row = this.database.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0];
    return { success: true, meta: { changes: this.database.getRowsModified(), last_row_id: Number(row ?? 0) } };
  }
}

class SqlD1 {
  constructor(readonly database: Database) {}
  prepare(sql: string): SqlStatement { return new SqlStatement(this.database, sql); }
  async batch(statements: SqlStatement[]): Promise<unknown[]> {
    this.database.run('BEGIN IMMEDIATE');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.run('COMMIT'); return results; }
    catch (error) { this.database.run('ROLLBACK'); throw error; }
  }
}

function migration(name: string): string {
  return readFileSync(join(process.cwd(), 'apps', 'cloudflare', 'migrations', name), 'utf8');
}

async function setup(): Promise<{ sql: Database; env: CloudflareEnv }> {
  const SQL = await initSqlJs();
  const sql = new SQL.Database();
  sql.run('PRAGMA foreign_keys = ON');
  for (const name of ['0001_cf_foundation.sql', '0001_cf02_preview_drafts.sql', '0002_cf03_preview_evidence.sql', '0003_cf04_preview_auth.sql', '0004_cf05_google_drive.sql', '0005_cf06_case_operations.sql']) sql.exec(migration(name));
  const now = new Date().toISOString();
  const insertUser = (id: string, login: string, roles: string) => sql.run('INSERT INTO preview_users VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)', [id, login, '1'.repeat(32), '2'.repeat(64), 100000, login, `${login}@example.invalid`, roles, now]);
  insertUser(ADMIN_ID, 'admin', '["admin"]');
  sql.exec(migration('0010_cf10_product_experience.sql'));
  insertUser(OUTSIDER_ID, 'outsider', '["staff"]');
  sql.exec(migration('0011_cf11_project_workflow.sql'));
  sql.exec(migration('0048_cf73_workflow_minutes_parity.sql'));
  sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(ADMIN_TOKEN), ADMIN_ID, now, new Date(Date.now() + 3_600_000).toISOString()]);
  sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(OUTSIDER_TOKEN), OUTSIDER_ID, now, new Date(Date.now() + 3_600_000).toISOString()]);
  return { sql, env: { DB: new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']> } };
}

function request(path: string, token = ADMIN_TOKEN, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('X-Session-Token', token);
  if (init.body) headers.set('Content-Type', 'application/json');
  return new Request(`https://preview.example${path}`, { ...init, headers });
}

test('CF103 company fields survive save/reopen, legacy clients, long event feeds, and survey dates', async () => {
  const { sql, env } = await setup();
  const base = `/api/cases/${CASE_ID}/workflow`;
  const get = async () => { const res=await worker.fetch(request(base),env); assert.equal(res.status,200); return res.json() as Promise<any>; };
  const save = async (path:string, body:unknown, status=200) => { const res=await worker.fetch(request(base+path,ADMIN_TOKEN,{method:'PUT',body:JSON.stringify(body)}),env); assert.equal(res.status,status,await res.clone().text()); return res.json() as Promise<any>; };
  const initial=await get();
  assert.equal(initial.kickoff.minutesFields.referenceDepartments,'모든 부서');
  const input={meetingAt:'2030-09-03T01:00:00.000Z',location:'회의실',agenda:'착수회의',participantUnits:['내부 담당자'],rawNotes:'원문은 그대로 보존',status:'DRAFTED',expectedVersion:initial.kickoff.version,minutesFields:{author:'작성자',clientName:'거래처',referenceDepartments:'',meetingEndTime:'11:30',clientParticipants:'외부 담당자'}};
  const saved=await save('/kickoff',input);
  assert.equal(saved.kickoff.minutesFields.clientName,'거래처');
  assert.equal(saved.kickoff.minutesFields.referenceDepartments,'모든 부서');
  assert.equal(saved.kickoff.rawNotes,input.rawNotes);
  const count=()=>Number(sql.exec('SELECT COUNT(*) FROM preview_workflow_events')[0].values[0][0]);
  const before=count(); await save('/kickoff',input,409); assert.equal(count(),before);
  for(let i=0;i<105;i++)sql.run('INSERT INTO preview_workflow_events (id,case_id,actor_id,event_type,entity_id,detail_json,created_at) VALUES (?,?,?,?,?,?,?)',[crypto.randomUUID(),CASE_ID,ADMIN_ID,'KICKOFF_SAVED',CASE_ID,'{}','2099-01-01T00:00:00.000Z']);
  assert.equal((await get()).kickoff.minutesFields.clientName,'거래처');
  const {minutesFields,...legacy}=input;
  const legacySaved=await save('/kickoff',{...legacy,expectedVersion:saved.kickoff.version});
  assert.equal(legacySaved.kickoff.minutesFields.clientName,'거래처');
  const cleared=await save('/kickoff',{...input,expectedVersion:legacySaved.kickoff.version,minutesFields:{clientName:'',referenceDepartments:''}});
  assert.equal(cleared.kickoff.minutesFields.clientName,'');
  assert.equal(cleared.kickoff.minutesFields.referenceDepartments,'모든 부서');
  await save('/kickoff',{...input,expectedVersion:cleared.kickoff.version,minutesFields:{meetingEndTime:'99:99'}},400);
  for(const [date,clientName] of [['2030-09-03','첫날 거래처'],['2030-09-04','둘째날 거래처']]){
    await save('/site-survey',{surveyDate:date,location:'현장',scopeText:'조사 범위',leadUnit:'조사팀',rawNotes:'관찰 메모',status:'PLANNED',expectedVersion:0,outputExpectedVersion:0,minutesFields:{clientName,referenceDepartments:'',author:'담당자'}});
  }
  const reopened=await get();
  assert.equal(reopened.siteSurveys.find((r:any)=>r.surveyDate==='2030-09-03').minutesFields.clientName,'첫날 거래처');
  assert.equal(reopened.siteSurveys.find((r:any)=>r.surveyDate==='2030-09-04').minutesFields.clientName,'둘째날 거래처');
  sql.close();
});

test('CF11 preserves reviewed imports without configured AI, site-survey folder plans, and team allocations', async () => {
  const { sql, env } = await setup();
  const initial = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow`), env);
  assert.equal(initial.status, 200);
  const initialBody = await initial.json() as { kickoff: { version: number }; googleDrive: { deferredByUser: boolean } };
  assert.equal(initialBody.kickoff.version, 1);
  assert.equal(initialBody.googleDrive.deferredByUser, true);

  const kickoffPayload = {
    meetingAt: '2030-08-13T01:00:00.000Z', location: '본사 회의실', agenda: '현장조사 범위와 산출 기준 확정',
    participantUnits: ['프로젝트 책임자', 'Finish Internal 1'], rawNotes: '외벽 균열 조사를 8월 14일 진행한다. 마감팀은 20일까지 물량을 산출한다. 보고서 목차는 TYPE-01 기준으로 검토한다.',
    status: 'COMPLETED', expectedVersion: 1
  };
  const saved = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/kickoff`, ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify(kickoffPayload) }), env);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json() as { kickoff: { version: number } }).kickoff.version, 2);

  const generated = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/kickoff-summary`, ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ expectedVersion: 2 }) }), env);
  assert.equal(generated.status, 423);
  assert.equal((await generated.json() as any).code, 'PAID_NO_TRAINING_REQUIRED');
  // No configured AI must not claim that a summary was generated. A reviewed import is saved atomically instead.
  const imported = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/kickoff`, ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ ...kickoffPayload, expectedVersion: 2, summaryText: '검수한 회의록 요약', timeline: [{ title: '후속 업무', detail: '마감팀이 20일까지 물량을 산출한다.' }] }) }), env);
  assert.equal(imported.status, 200, await imported.text());

  const siteSurvey = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/site-survey`, ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ surveyDate: '2030-08-14', location: '101동 외벽', scopeText: '외벽 균열 및 누수 전수 확인', leadUnit: '현장조사팀', rawNotes: '101동 동측 균열을 확인했고 누수 흔적은 추가 확인이 필요하다.', status: 'PLANNED', expectedVersion: 0, outputExpectedVersion: 0 }) }), env);
  assert.equal(siteSurvey.status, 200);
  const surveyBody = await siteSurvey.json() as { siteSurveys: Array<{ version: number; outputVersion: number; rawNotes: string; folderPath: string }> };
  assert.equal(surveyBody.siteSurveys[0].version, 1);
  assert.equal(surveyBody.siteSurveys[0].outputVersion, 1);
  assert.match(surveyBody.siteSurveys[0].rawNotes, /동측 균열/u);
  assert.match(surveyBody.siteSurveys[0].folderPath, /04_현장조사\/30\.08\.14/u);

  const surveyDraft = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/site-survey-summary`, ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ surveyDate: '2030-08-14', expectedVersion: 1 }) }), env);
  assert.equal(surveyDraft.status, 423);
  const importedSurvey = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/site-survey`, ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ surveyDate: '2030-08-14', location: '101동 외벽', scopeText: '외벽 균열 및 누수 전수 확인', leadUnit: '현장조사팀', rawNotes: '101동 동측 균열을 확인했고 누수 흔적은 추가 확인이 필요하다.', status: 'PLANNED', expectedVersion: 1, outputExpectedVersion: 1, summaryText: '현장조사: 균열 확인, 누수는 미확인.', timeline: [{ title: '추가 확인', detail: '누수 흔적 추가 확인 필요.' }] }) }), env);
  assert.equal(importedSurvey.status, 200, await importedSurvey.text());

  const surveyConfirmed = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/site-survey-confirm`, ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ surveyDate: '2030-08-14', expectedVersion: 2 }) }), env);
  assert.equal(surveyConfirmed.status, 200);
  assert.equal((await surveyConfirmed.json() as { siteSurveys: Array<{ outputVersion: number; outputStatus: string }> }).siteSurveys[0].outputStatus, 'CONFIRMED');

  const allocationPayload = { unitKey: 'vietqs-02', unitLabel: 'Finish Internal 1', office: 'VIETQS', schedulingMode: 'TEAM', discipline: 'FINISH', scopeText: '외벽 마감 물량 산출', basisText: '설계도서·현장실측', startDate: '2030-08-15', endDate: '2030-08-20' };
  const allocation = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/allocations`, ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf11-allocation-0001' }, body: JSON.stringify(allocationPayload) }), env);
  assert.equal(allocation.status, 200);
  assert.equal((await allocation.json() as { allocations: unknown[] }).allocations.length, 1);
  const replay = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/allocations`, ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf11-allocation-0001' }, body: JSON.stringify(allocationPayload) }), env);
  assert.equal(replay.status, 200);
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_workforce_allocations')[0].values[0][0], 1);

  const exported = sql.export();
  const SQL = await initSqlJs();
  const restarted = new SQL.Database(exported);
  assert.deepEqual(restarted.exec('SELECT status, version FROM preview_workflow_kickoffs')[0].values[0], ['DRAFTED', 3]);
  assert.equal(restarted.exec('SELECT COUNT(*) FROM preview_workflow_events')[0].values[0][0], 6);
  restarted.close();
  sql.close();
});

test('CF115 reviewed summary, timeline, raw source and form fields save atomically; invalid or stale writes change nothing', async () => {
  const { sql, env } = await setup();
  const base = `/api/cases/${CASE_ID}/workflow`;
  const get = async () => { const response = await worker.fetch(request(base), env); assert.equal(response.status, 200); return response.json() as Promise<any>; };
  const put = async (action: string, body: unknown, status = 200) => {
    const response = await worker.fetch(request(base + action, ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify(body) }), env);
    assert.equal(response.status, status, await response.clone().text()); return response.json() as Promise<any>;
  };
  const snapshot = () => JSON.stringify(['preview_workflow_kickoffs', 'preview_site_surveys', 'preview_site_survey_outputs', 'preview_workflow_events'].map(table => sql.exec(`SELECT * FROM ${table} ORDER BY rowid`)));
  const rawNotes = '김검수: 당장 확정하지 않습니다.\n\n박실무: 담당자와 기한은 확인 필요합니다.\n원문 끝 🚧';
  const summary = { summaryText: '검수 결과: 계약금액과 후속 담당자·기한은 미확정.', timeline: [{ title: '미확정 사항', detail: '담당자·기한 확인 필요, 임의 확정 금지.' }] };
  const minutesFields = { author: '검수 담당자', authorDepartment: '기술부', authorPosition: '팀장', clientName: '합성 거래처', reportingDepartment: '클레임센터', referenceDepartments: '모든 부서', clientParticipants: '합성 발주처 담당자', attachmentName: '도면.pdf', meetingStartTime: '10:00', meetingEndTime: '11:20', participants: '김검수, 박실무', meetingTitle: '원문 근거 검토' };
  const initial = await get();
  const kickoff = { meetingAt: '2030-09-07T01:00:00.000Z', location: '회의실', agenda: '검토 안건', participantUnits: ['김검수', '박실무'], rawNotes, minutesFields, status: 'COMPLETED', expectedVersion: initial.kickoff.version, ...summary };
  const saved = await put('/kickoff', kickoff);
  const survey = { surveyDate: '2030-09-07', location: '조사 현장', scopeText: '조사 범위', leadUnit: '조사팀', rawNotes, minutesFields, status: 'PLANNED', expectedVersion: 0, outputExpectedVersion: 0, ...summary };
  const savedSurvey = await put('/site-survey', survey);
  const row = savedSurvey.siteSurveys.find((entry: any) => entry.surveyDate === survey.surveyDate);
  const currentInputs = [
    ['/kickoff', { ...kickoff, expectedVersion: saved.kickoff.version }],
    ['/site-survey', { ...survey, expectedVersion: row.version, outputExpectedVersion: row.outputVersion }]
  ] as const;
  const before = snapshot();
  for (const [action, payload] of currentInputs) {
    for (const invalid of [
      { summaryText: '', timeline: [] }, { summaryText: '초과'.repeat(15001), timeline: [] },
      { summaryText: '누락', timeline: undefined }, { summaryText: '잘못된 항목', timeline: [{ title: '제목', detail: '' }] },
      { summaryText: '항목 수 초과', timeline: Array.from({ length: 21 }, () => ({ title: '확인', detail: '내용' })) }
    ]) {
      assert.equal((await put(action, { ...payload, ...invalid, rawNotes: '바뀌면 안 되는 원문' }, 400)).code, 'INVALID_SUMMARY_PAYLOAD');
      assert.equal(snapshot(), before, action + ': invalid summary must roll back raw source and form metadata');
    }
    assert.equal((await put(action, { ...payload, expectedVersion: payload.expectedVersion - 1, rawNotes: '구버전 덮어쓰기' }, 409)).code, 'VERSION_CONFLICT');
    assert.equal(snapshot(), before);
  }
  assert.equal((await put('/site-survey', { ...survey, expectedVersion: row.version, outputExpectedVersion: 0, scopeText: '부분 저장 금지' }, 409)).code, 'VERSION_CONFLICT');
  assert.equal(snapshot(), before, 'stale output version cannot partially update survey details');
  const fresh = await get();
  for (const record of [fresh.kickoff, fresh.siteSurveys.find((entry: any) => entry.surveyDate === survey.surveyDate)]) {
    assert.equal(record.rawNotes, rawNotes); assert.equal(record.summaryText, summary.summaryText);
    assert.deepEqual(record.timeline, summary.timeline.map((entry, index) => ({ order: index + 1, ...entry })));
    assert.deepEqual(record.minutesFields, minutesFields);
  }
  const edited = await put('/kickoff', { ...kickoff, rawNotes: rawNotes + '\n검수 후 원문 수정', expectedVersion: saved.kickoff.version, summaryText: undefined, timeline: undefined });
  assert.equal(edited.kickoff.summaryText, ''); assert.deepEqual(edited.kickoff.timeline, [], 'source edits invalidate the previous summary');
  sql.close();
});

test('CF11 enforces assignment, optimistic versions, team scheduling rules, append-only ledgers, and prompt architecture', async () => {
  const { sql, env } = await setup();
  assert.equal((await worker.fetch(request(`/api/cases/${CASE_ID}/workflow`, OUTSIDER_TOKEN), env)).status, 404);

  const stale = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/kickoff`, ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ meetingAt: '2030-08-13T01:00:00.000Z', location: '', agenda: 'stale', participantUnits: [], rawNotes: '', status: 'PLANNED', expectedVersion: 0 }) }), env);
  assert.equal(stale.status, 409);

  const invalidMode = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/allocations`, ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf11-invalid-mode' }, body: JSON.stringify({ unitKey: 'vietqs-02', unitLabel: 'Finish Internal 1', office: 'VIETQS', schedulingMode: 'PERSON', discipline: 'FINISH', scopeText: '범위', basisText: '기준', startDate: '2030-08-15', endDate: '2030-08-20' }) }), env);
  assert.equal(invalidMode.status, 400);

  sql.run('INSERT INTO preview_workflow_events VALUES (?, ?, ?, ?, ?, ?, ?)', ['00000000-0000-4000-8000-000000000099', CASE_ID, ADMIN_ID, 'TEST_EVENT', CASE_ID, '{}', new Date().toISOString()]);
  assert.throws(() => sql.run("UPDATE preview_workflow_events SET event_type='FORGED'"), /append-only/u);
  assert.throws(() => sql.run("UPDATE preview_workflow_kickoffs SET agenda='FORGED', version=99, updated_at=? WHERE case_id=?", [new Date(Date.now() + 1000).toISOString(), CASE_ID]), /optimistic version/u);

  const systemPrompt = readFileSync(join(process.cwd(), 'docs', 'report-authoring', 'report-authoring-system-prompt.md'), 'utf8');
  const agents = readFileSync(join(process.cwd(), 'docs', 'report-authoring', 'chapter-agent-spec.yaml'), 'utf8');
  const typePrompts = readFileSync(join(process.cwd(), 'docs', 'report-authoring', 'type-chapter-prompts.yaml'), 'utf8');
  assert.match(systemPrompt, /EVIDENCE/u);
  assert.match(systemPrompt, /근거가 없거나 서로 충돌/u);
  assert.doesNotMatch(systemPrompt, /16,000/u);
  for (let index = 0; index <= 7; index += 1) assert.match(agents, new RegExp(`AGENT-0${index}`, 'u'));
  for (let index = 1; index <= 6; index += 1) assert.match(typePrompts, new RegExp(`TYPE-0${index}:`, 'u'));
  assert.match(typePrompts, /TYPE-05:[\s\S]*TEMPLATE_NOT_FOUND/u);
  sql.close();
});
