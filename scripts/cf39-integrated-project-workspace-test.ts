import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const PM_ID = '00000000-0000-4000-8000-000000000002';
const REVIEWER_ID = '00000000-0000-4000-8000-000000000004';
const STAFF_ID = '00000000-0000-4000-8000-000000000039';
const CASE_ID = '40000000-0000-4000-8000-000000000010';
const ADMIN_TOKEN = 'cf39-admin-session-token';
const PM_TOKEN = 'cf39-pm-session-token';
const REVIEWER_TOKEN = 'cf39-reviewer-session-token';
const STAFF_TOKEN = 'cf39-staff-session-token';
const ADMIN_CURRENT_PASSWORD = 'Synthetic-Current-A7!';
const ADMIN_NEXT_PASSWORD = 'Synthetic-Next-B8!';
const PM_ROSTER = [
  [PM_ID, 'pm', '이경훈'],
  ['00000000-0000-4000-8000-000000000051', 'pm-hdm', '현동명'],
  ['00000000-0000-4000-8000-000000000052', 'pm-lwh', '이원희'],
  ['00000000-0000-4000-8000-000000000053', 'pm-cyb', '최영배'],
  ['00000000-0000-4000-8000-000000000054', 'pm-jbs', '장범선']
] as const;

const migrations = [
  '0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql','0004_cf05_google_drive.sql','0005_cf06_case_operations.sql',
  '0006_cf07_report_studio_drafts.sql','0007_cf08_report_review_approval.sql','0008_cf09_final_output.sql','0009_cf09_output_actor_scope.sql','0010_cf10_product_experience.sql',
  '0011_cf11_project_workflow.sql','0012_cf12_report_ai_prompts.sql','0013_cf13_litigation_records.sql','0014_cf14_proposal_award_workflow.sql','0015_cf15_case_evidence_library.sql',
  '0016_cf18_report_outline_evidence.sql','0017_cf19_multi_provider_ai.sql','0018_cf26_ai_credentials.sql','0019_cf27_proposal_authoring.sql','0020_cf28_workspace_settings.sql',
  '0021_cf29_report_memory_learning.sql','0022_cf30_settings_template_preview.sql','0023_cf31_google_oauth_app_settings.sql','0024_cf32_source_template_library.sql','0025_cf33_type_authoring_guidelines.sql',
  '0026_cf34_hermes_memory_architecture.sql','0027_cf35_guided_workspace.sql','0028_cf36_workflow_integrity_tutorial_approval_intake.sql','0029_cf37_report_workspace_resume.sql',
  '0030_cf38_admin_account_management.sql','0031_cf39_integrated_project_workspace.sql','0032_cf40_pm_schedule_ai_import_security.sql','0035_cf43_navigation_pm_password.sql',
  '0041_cf53_erp_project_bridge.sql','0047_cf72_project_members_calendar.sql','0048_cf73_workflow_minutes_parity.sql'
];

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function passwordHash(password: string, saltHex: string, iterations: number): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((entry) => Number.parseInt(entry, 16)));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256);
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class SqlStatement {
  private values: unknown[] = [];
  constructor(private readonly database: Database, private readonly sql: string) {}
  bind(...values: unknown[]): SqlStatement { this.values = values.map((value) => value instanceof ArrayBuffer ? new Uint8Array(value) : value); return this; }
  async first<T>(): Promise<T | null> { const statement = this.database.prepare(this.sql); try { statement.bind(this.values as any[]); return statement.step() ? statement.getAsObject() as T : null; } finally { statement.free(); } }
  async all<T>(): Promise<{ results: T[] }> { const statement = this.database.prepare(this.sql); const results: T[] = []; try { statement.bind(this.values as any[]); while (statement.step()) results.push(statement.getAsObject() as T); return { results }; } finally { statement.free(); } }
  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> { this.database.run(this.sql, this.values as any[]); const row = this.database.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0]; return { success: true, meta: { changes: this.database.getRowsModified(), last_row_id: Number(row ?? 0) } }; }
}

class SqlD1 {
  constructor(readonly database: Database) {}
  prepare(sql: string): SqlStatement { return new SqlStatement(this.database, sql); }
  async batch(statements: SqlStatement[]): Promise<unknown[]> { this.database.run('BEGIN IMMEDIATE'); try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.run('COMMIT'); return results; } catch (error) { this.database.run('ROLLBACK'); throw error; } }
}

function migration(name: string): string { return readFileSync(join(process.cwd(), 'apps', 'cloudflare', 'migrations', name), 'utf8'); }
function request(path: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('X-Session-Token', token);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  return new Request(`https://preview.example${path}`, { ...init, headers });
}
function evidenceForm(category: string, name: string, mimeType: string, bytes: number[]): FormData {
  const form = new FormData();
  form.set('category', category);
  form.set('file', new File([Uint8Array.from(bytes).buffer], name, { type: mimeType }));
  return form;
}

async function setup(): Promise<{ sql: Database; env: CloudflareEnv }> {
  const SQL = await initSqlJs();
  const sql = new SQL.Database();
  sql.run('PRAGMA foreign_keys=ON');
  const now = '2026-08-21T00:00:00.000Z';
  const adminSalt = 'a1'.repeat(16);
  const adminPasswordHash = await passwordHash(ADMIN_CURRENT_PASSWORD, adminSalt, 310000);
  for (const name of migrations) {
    sql.exec(migration(name));
    if (name === '0009_cf09_output_actor_scope.sql') {
      const add = (id: string, login: string, label: string, roles: string, salt = '1'.repeat(32), hash = '2'.repeat(64), iterations = 100000) => sql.run(
        'INSERT INTO preview_users (id,login_id,password_salt,password_hash,password_iterations,display_name,email,roles_json,is_active,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)',
        [id, login, salt, hash, iterations, label, login.includes('@') ? login : `${login}@example.invalid`, roles, now]
      );
      add(ADMIN_ID, 'yjw@con-cost.com', '관리자', '["admin"]', adminSalt, adminPasswordHash, 310000);
      for (const [id, login, label] of PM_ROSTER) add(id, login, label, label === '현동명' ? '["ceo","admin"]' : '["pm"]');
      add(REVIEWER_ID, 'reviewer', '검토자', '["reviewer"]');
      add(STAFF_ID, 'staff-cf39', '프로젝트 Staff', '["staff"]');
    }
  }
  for (const userId of [PM_ID, REVIEWER_ID, STAFF_ID]) sql.run('INSERT OR IGNORE INTO preview_case_assignments (case_id,user_id,assigned_by,assigned_at) VALUES (?,?,?,?)', [CASE_ID, userId, ADMIN_ID, now]);
  for (const [token, userId] of [[ADMIN_TOKEN, ADMIN_ID], [PM_TOKEN, PM_ID], [REVIEWER_TOKEN, REVIEWER_ID], [STAFF_TOKEN, STAFF_ID]] as const) {
    sql.run('INSERT INTO preview_sessions VALUES (?,?,?,?)', [await sha256(token), userId, now, '2099-01-01T00:00:00.000Z']);
  }
  const geminiFetch: typeof fetch = async () => new Response(JSON.stringify({
    status: 'completed',
    steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ summary: '현장 범위와 제출 일정에 합의했습니다.', timeline: [{ title: '범위 확정', detail: '발주처 제공자료 확인 후 현장조사 범위를 확정합니다.' }, { title: '후속 업무', detail: 'PM이 다음 회의 전 자료 목록을 확인합니다.' }] }) }] }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return { sql, env: { DB: new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']>, GEMINI_API_KEY: 'AQ.SYNTHETIC_CF39_ORGANIZATION_KEY', GEMINI_TEST_FETCH: geminiFetch } };
}

test('CF43 PM choices are exactly the requested five members while the workspace Admin is excluded', async () => {
  const { sql, env } = await setup();
  const seededCase = sql.exec('SELECT version,updated_at FROM preview_cases WHERE id=?', [CASE_ID])[0].values[0];
  const seededCaseVersion = Number(seededCase[0]);
  const seededCaseUpdatedAt = new Date(Date.parse(String(seededCase[1])) + 1).toISOString();
  sql.run("UPDATE preview_cases SET status='CONTRACT',version=version+1,updated_at=? WHERE id=? AND version=?", [seededCaseUpdatedAt,CASE_ID,seededCaseVersion]);
  sql.run("INSERT INTO preview_proposal_links (id,organization_id,case_id,proposal_number,proposal_title,revision_label,client_name,sent_at,response_due_on,proposed_amount_krw,document_url,document_sha256,verification_status,award_status,award_decided_at,award_decided_by,contract_amount_krw,project_start_on,project_end_on,version,request_key,request_fingerprint,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ['40000000-0000-4000-8000-000000000099','concost',CASE_ID,'PROP-CF43-ROSTER','PM 명단 검증 제안서','V1','합성 발주처','2026-08-21T00:00:00.000Z',null,1,null,null,'UNVERIFIED','WON','2026-08-21T00:00:00.000Z',ADMIN_ID,1,'2026-08-21','2026-08-21',2,'cf43-roster-seed-0001','a'.repeat(64),ADMIN_ID,'2026-08-21T00:00:00.000Z','2026-08-21T00:00:00.000Z']);
  sql.run('INSERT OR IGNORE INTO preview_case_assignments (case_id,user_id,assigned_by,assigned_at) VALUES (?,?,?,?)', [CASE_ID,ADMIN_ID,ADMIN_ID,'2026-08-21T00:00:01.000Z']);
  sql.run('DROP TRIGGER preview_schedule_profile_insert_guard');
  sql.run('INSERT INTO preview_project_schedule_profiles (case_id,organization_id,responsible_pm_id,version,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [CASE_ID,'concost',ADMIN_ID,1,ADMIN_ID,'2026-08-21T00:00:01.000Z','2026-08-21T00:00:01.000Z']);
  const legacySchedule = await worker.fetch(request('/api/project-workflow/schedule', ADMIN_TOKEN), env);
  const legacyProject = (await legacySchedule.json() as any).projects.find((entry: any) => entry.caseId === CASE_ID);
  assert.equal(legacyProject.responsiblePm, null);
  assert.equal(legacyProject.profileVersion, 1);
  const options = await worker.fetch(request(`/api/project-workflow/pm-options?caseId=${CASE_ID}`, ADMIN_TOKEN), env);
  assert.equal(options.status, 200);
  const names = (await options.json() as any).users.map((entry: any) => entry.displayName);
  assert.deepEqual(names, ['현동명', '이원희', '이경훈', '최영배', '장범선']);
  assert.equal(names.includes('관리자'), false);
  const targetId = PM_ROSTER[1][0];
  sql.run('DELETE FROM preview_case_assignments WHERE case_id=? AND user_id=?', [CASE_ID,targetId]);
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_case_assignments WHERE case_id=? AND user_id=?', [CASE_ID,targetId])[0].values[0][0], 0);
  const assigned = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/profile`, ADMIN_TOKEN, { method:'PUT', body:JSON.stringify({ responsiblePmId:targetId,expectedProfileVersion:1 }) }), env);
  assert.equal(assigned.status, 200);
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_case_assignments WHERE case_id=? AND user_id=?', [CASE_ID,targetId])[0].values[0][0], 1);
  const adminDenied = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/profile`, ADMIN_TOKEN, { method:'PUT', body:JSON.stringify({ responsiblePmId:ADMIN_ID,expectedProfileVersion:2 }) }), env);
  assert.equal(adminDenied.status, 400);
  sql.close();
});

test('CF43 each signed-in member can persistently change their own password without exposing a plaintext value', async () => {
  const { sql, env } = await setup();
  const mismatch = await worker.fetch(request('/api/settings/password', ADMIN_TOKEN, { method:'PUT', body:JSON.stringify({ currentPassword:'wrong-current',newPassword:ADMIN_NEXT_PASSWORD }) }), env);
  assert.equal(mismatch.status, 403);
  const changed = await worker.fetch(request('/api/settings/password', ADMIN_TOKEN, { method:'PUT', body:JSON.stringify({ currentPassword:ADMIN_CURRENT_PASSWORD,newPassword:ADMIN_NEXT_PASSWORD }) }), env);
  assert.equal(changed.status, 200);
  const oldLogin = await worker.fetch(new Request('https://preview.example/api/auth/login', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ loginId:'yjw@con-cost.com',password:ADMIN_CURRENT_PASSWORD }) }), env);
  assert.equal(oldLogin.status, 401);
  const newLogin = await worker.fetch(new Request('https://preview.example/api/auth/login', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ loginId:'yjw@con-cost.com',password:ADMIN_NEXT_PASSWORD }) }), env);
  assert.equal(newLogin.status, 200);
  assert.equal(sql.exec("SELECT COUNT(*) FROM preview_user_admin_events WHERE actor_id=target_user_id AND action='PASSWORD_RESET'")[0].values[0][0], 1);
  const settingsSource = readFileSync(join(process.cwd(),'apps','web','src','routes','PreviewSettings.tsx'),'utf8');
  assert.match(settingsSource, /로그인 비밀번호 변경/u);
  assert.match(settingsSource, /autoComplete="current-password"/u);
  assert.doesNotMatch(settingsSource, /1147/u);
  sql.close();
});

test('CF39 all assigned login roles upload project-wide evidence categories and immutable attribution survives listing', async () => {
  const { sql, env } = await setup();
  sql.exec(migration('0055_cf85_drive_department_access.sql'));
  sql.exec(migration('0058_cf104_evidence_versions.sql'));
  const meeting = await worker.fetch(request(`/api/cases/${CASE_ID}/evidence`, STAFF_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf39-meeting-recording-0001' }, body: evidenceForm('MEETING_RECORDING', 'kickoff.mp3', 'audio/mpeg', [0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x41]) }), env);
  assert.equal(meeting.status, 201);
  assert.equal((await meeting.json() as any).file.category, 'MEETING_RECORDING');
  const final = await worker.fetch(request(`/api/cases/${CASE_ID}/evidence`, REVIEWER_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf39-final-deliverable-0001' }, body: evidenceForm('FINAL_DELIVERABLE', 'approved-report.pdf', 'application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]) }), env);
  assert.equal(final.status, 201);
  const rows = sql.exec('SELECT category,workflow_category,uploaded_by_id FROM preview_case_evidence ORDER BY uploaded_at');
  assert.deepEqual(rows[0].values.map((row) => [row[0], row[1]]), [['TAKEOFF_SOURCE', 'MEETING_RECORDING'], ['TAKEOFF_SOURCE', 'FINAL_DELIVERABLE']]);
  assert.deepEqual(rows[0].values.map((row) => row[2]), [STAFF_ID, REVIEWER_ID]);
  sql.run('DELETE FROM preview_case_assignments WHERE case_id=? AND user_id=?', [CASE_ID, STAFF_ID]);
  const list = await worker.fetch(request(`/api/cases/${CASE_ID}/evidence`, STAFF_TOKEN), env);
  const body = await list.json() as any;
  assert.equal(body.phase, 'CF85_DRIVE_DEPARTMENT_ACCESS');
  assert.equal(body.accessMode, 'STUDIO_SESSION_PROXY');
  assert.equal(body.driveLibraryUrl, null);
  assert.deepEqual(new Set(body.files.map((file: any) => file.category)), new Set(['MEETING_RECORDING', 'FINAL_DELIVERABLE']));
  assert.equal(body.files.every((file: any) => file.driveUrl === null && !Object.hasOwn(file, 'googleFileId') && !Object.hasOwn(file, 'googleFolderId')), true);
  const download = await worker.fetch(request(body.files[0].downloadUrl, STAFF_TOKEN), env);
  assert.equal(download.status, 200);
  assert.equal(Object.keys(body.categories).length, 13);
  assert.throws(() => sql.run("UPDATE preview_case_evidence SET workflow_category='COURT_DOCUMENT'"), /append-only/u);
  sql.close();
});

test('CF39 kickoff notes use the Admin organization Gemini route and persist a safe meeting timeline', async () => {
  const { sql, env } = await setup();
  const current = Number(sql.exec('SELECT COALESCE(version,0) FROM preview_workflow_kickoffs WHERE case_id=?', [CASE_ID])[0]?.values[0]?.[0] ?? 0);
  const save = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/kickoff`, PM_TOKEN, { method: 'PUT', body: JSON.stringify({ meetingAt: '2026-08-21T01:00:00.000Z', location: '회의실', agenda: '현장 범위와 제출 일정 협의', participantUnits: ['발주처', '클레임센터'], rawNotes: '10:00 발주처 자료 목록 확인. 10:30 PM이 현장조사 범위를 정리하기로 함.', status: 'COMPLETED', expectedVersion: current }) }), env);
  assert.equal(save.status, 200);
  const summarize = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/kickoff-summary`, PM_TOKEN, { method: 'POST', body: JSON.stringify({ expectedVersion: current + 1 }) }), env);
  assert.equal(summarize.status, 200);
  const kickoff = sql.exec('SELECT summary_text,timeline_json FROM preview_workflow_kickoffs WHERE case_id=?', [CASE_ID])[0].values[0];
  assert.match(String(kickoff[0]), /현장 범위/u);
  assert.equal(JSON.parse(String(kickoff[1])).length, 2);
  assert.match(String(sql.exec("SELECT detail_json FROM preview_workflow_events WHERE event_type='KICKOFF_DRAFT_GENERATED' ORDER BY created_at DESC LIMIT 1")[0].values[0][0]), /GEMINI:gemini-3\.6-flash:ORGANIZATION/u);
  sql.close();
});

test('CF39 proposal AI preserves the approved template and uses only the Admin organization Gemini credential', async () => {
  const { sql, env } = await setup();
  const providerBodies: Array<Record<string, unknown>> = [];
  env.GEMINI_TEST_FETCH = async (_input, init) => {
    providerBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const content = {
      chapter2: { chapter: 2, title: '당 현장의 핵심 쟁점 분석', issues: Array.from({ length: 5 }, (_, index) => ({ no: index + 1, heading: `핵심 쟁점 ${index + 1}`, body: `ㅇ 승인 템플릿과 의뢰 자료를 근거로 쟁점 ${index + 1}의 사실관계와 필요한 검토를 정리합니다.` })) },
      chapter1: { chapter: 1, title: '용역의 목적', slogan: '클라이언트의 권익을 지키는 것', bullets: Array.from({ length: 5 }, (_, index) => `ㅇ 확정된 쟁점 ${index + 1}을 근거로 검토하고 실행 가능한 대응 기준을 마련합니다.`), footnote: '※ 법률적 판단은 협력 법무법인이 전담합니다.' },
      chapter3: { chapter: 3, title: '업무 수행 내용', rows: Array.from({ length: 5 }, (_, index) => ({ no: index + 1, task: `수행 업무 ${index + 1}`, detail: ['자료 검토', '근거 정리'], deliverables: ['검토표'], mapping: `쟁점 ${Math.min(index + 1, 5)}` })) },
      validation: { result: 'PASS', findings: [] }
    };
    return new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(content) }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const caseResponse = await worker.fetch(request(`/api/cases/${CASE_ID}`, PM_TOKEN), env);
  const project = (await caseResponse.json() as any).case;
  const templatesResponse = await worker.fetch(request(`/api/proposal-templates?claimType=${encodeURIComponent(project.claimType)}`, PM_TOKEN), env);
  const template = (await templatesResponse.json() as any).templates[0];
  assert.ok(template?.id);
  const created = await worker.fetch(request(`/api/cases/${CASE_ID}/proposals`, PM_TOKEN, { method: 'POST', body: JSON.stringify({ templateId: template.id }) }), env);
  assert.equal(created.status, 201);
  const proposal = (await created.json() as any).proposal;
  const generated = await worker.fetch(request(`/api/cases/${CASE_ID}/proposals/${proposal.id}/versions`, PM_TOKEN, { method: 'POST', body: JSON.stringify({ background: '발주처 제공자료와 의뢰 녹취를 검토합니다.', objective: '클라이언트 관점의 쟁점을 정리합니다.', method: '계약문서와 현장 근거를 교차 확인합니다.', expectedOutcome: '검증 가능한 기술제안서를 작성합니다.', exclusions: '확인되지 않은 법률 판단은 제외합니다.', generationMode: 'AI', sourceDocumentVersionIds: [], version: proposal.version }) }), env);
  assert.equal(generated.status, 200);
  const version = (await generated.json() as any).proposal.versions[0];
  assert.equal(version.providerId, 'GEMINI');
  assert.equal(version.modelId, 'gemini-3.6-flash');
  assert.equal(providerBodies.length, 1);
  assert.match(JSON.stringify(providerBodies[0].system_instruction), /선택 템플릿/u);
  assert.match(JSON.stringify(providerBodies[0].contents), /sourcePriority/u);
  assert.match(JSON.stringify(providerBodies[0].contents), /template/u);
  assert.match(JSON.stringify(providerBodies[0].system_instruction), /최종 자가검증/u);
  sql.close();
});

test('CF39 judgment performance is derived only from recorded court events and final delivery has a Drive-backed finder UI', async () => {
  const { sql, env } = await setup();
  const recordPayload = { caseId: CASE_ID, courtName: '서울중앙지방법원', courtCaseNumber: '2026가합39001', caseTitle: '공사대금 청구의 소', divisionName: '민사 제39부', partiesText: '원고 발주처 / 피고 시공사', filedOn: '2026-01-01', currentStage: 'JUDGEMENT', nextHearingAt: null, verificationStatus: 'VERIFIED', officialSourceUrl: 'https://www.scourt.go.kr/portal/information/events/search' };
  const created = await worker.fetch(request('/api/litigation-records', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf39-litigation-record-0001' }, body: JSON.stringify(recordPayload) }), env);
  assert.equal(created.status, 201);
  const recordId = (await created.json() as any).record.id;
  const event = await worker.fetch(request(`/api/litigation-records/${recordId}/events`, ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf39-judgement-event-0001' }, body: JSON.stringify({ eventType: 'JUDGEMENT', occurredAt: '2026-08-20T01:00:00.000Z', title: '1심 판결 선고', detailText: '법원 공식 기록에 판결 선고가 등록되었습니다.', verificationStatus: 'VERIFIED', officialSourceUrl: 'https://www.scourt.go.kr/portal/information/events/search', sourceSha256: 'a'.repeat(64), createCourtSchedule: false }) }), env);
  assert.equal(event.status, 200);
  const outcomes = await worker.fetch(request('/api/litigation-outcomes', PM_TOKEN), env);
  assert.equal(outcomes.status, 200);
  const outcome = (await outcomes.json() as any).outcomes.find((item: any) => item.id === recordId);
  assert.equal(outcome.outcomeStatus, 'JUDGEMENT_RECORDED');
  assert.match(outcome.performanceSummary, /공식 근거 확인/u);
  const deliverySource = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'routes', 'PreviewDeliveryCenter.tsx'), 'utf8');
  assert.match(deliverySource, /FINAL_DELIVERABLE/u);
  assert.match(deliverySource, /allowedCategories=\{\['FINAL_DELIVERABLE'\]\}/u);
  assert.match(deliverySource, /Drive에서 열기|Google Drive/u);
  const evidencePanelSource = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'evidence', 'CaseEvidencePanel.tsx'), 'utf8');
  assert.match(evidencePanelSource, /스튜디오 권한으로 다운로드/u);
  assert.doesNotMatch(evidencePanelSource, /driveLibraryUrl/u);
  const outcomeSource = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'routes', 'PreviewOutcomeCenter.tsx'), 'utf8');
  assert.match(outcomeSource, /litigation-outcomes/u);
  sql.close();
});

test('CF40 responsible PM owns explicit stage schedules and approved change requests update the calendar atomically', async () => {
  const { sql, env } = await setup();
  const assigned = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/profile`, ADMIN_TOKEN, {
    method: 'PUT', body: JSON.stringify({ responsiblePmId: PM_ID, expectedProfileVersion: 0 })
  }), env);
  assert.equal(assigned.status, 200);
  const saved = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/stages/KICKOFF`, PM_TOKEN, {
    method: 'PUT', body: JSON.stringify({ startDate: '2026-08-24', endDate: '2026-08-24', status: 'PLANNED', noteText: '발주처 참석 일정 확인', expectedVersion: 0 })
  }), env);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json() as any).schedule.version, 1);
  const denied = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/stages/KICKOFF`, STAFF_TOKEN, {
    method: 'PUT', body: JSON.stringify({ startDate: '2026-08-25', endDate: '2026-08-25', status: 'PLANNED', noteText: '직접 변경 시도', expectedVersion: 1 })
  }), env);
  assert.equal(denied.status, 403);
  const requested = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/change-requests`, STAFF_TOKEN, {
    method: 'POST', headers: { 'Idempotency-Key': 'cf40-schedule-change-0001' }, body: JSON.stringify({ stageCode: 'KICKOFF', proposedStartDate: '2026-08-26', proposedEndDate: '2026-08-26', reasonText: '발주처 요청으로 착수회의 날짜 변경', expectedScheduleVersion: 1 })
  }), env);
  assert.equal(requested.status, 201);
  const requestId = (await requested.json() as any).request.id;
  const notificationBefore = sql.exec("SELECT notification_type,user_id FROM preview_project_notifications WHERE change_request_id=?", [requestId])[0].values[0];
  assert.deepEqual(notificationBefore, ['SCHEDULE_CHANGE_REQUESTED', PM_ID]);
  const approved = await worker.fetch(request(`/api/project-workflow/change-requests/${requestId}/decision`, PM_TOKEN, {
    method: 'POST', body: JSON.stringify({ decision: 'APPROVED', reviewNote: '담당 PM 일정 변경 승인' })
  }), env);
  assert.equal(approved.status, 200);
  const exact = sql.exec("SELECT start_date,end_date,version FROM preview_project_stage_schedules WHERE case_id=? AND stage_code='KICKOFF'", [CASE_ID])[0].values[0];
  assert.deepEqual(exact, ['2026-08-26', '2026-08-26', 2]);
  const dashboard = await worker.fetch(request('/api/dashboard/kpi', STAFF_TOKEN), env);
  assert.equal(dashboard.status, 200);
  const dashboardBody = await dashboard.json() as any;
  assert.ok(dashboardBody.projectScheduleReminders.some((item: any) => item.caseId === CASE_ID && item.startDate === '2026-08-26'));
  assert.throws(() => sql.run("UPDATE preview_project_stage_schedules SET updated_by=? WHERE case_id=?", [STAFF_ID, CASE_ID]), /schedule update|PM authority/u);
  sql.close();
});

test('CF70 linked schedule screens accept the same PM latest version and batch-save all workflow stages together', async () => {
  const { sql, env } = await setup();
  const assigned = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/profile`, ADMIN_TOKEN, {
    method:'PUT',body:JSON.stringify({ responsiblePmId:PM_ID,expectedProfileVersion:0 })
  }),env);
  assert.equal(assigned.status,200);

  const first = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/stages/KICKOFF`,PM_TOKEN,{
    method:'PUT',body:JSON.stringify({ startDate:'2026-09-01',endDate:'2026-09-01',status:'PLANNED',noteText:'일정표 최초 저장',expectedVersion:0 })
  }),env);
  assert.equal(first.status,200);
  const samePmStale = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/stages/KICKOFF`,PM_TOKEN,{
    method:'PUT',body:JSON.stringify({ startDate:'2026-09-02',endDate:'2026-09-02',status:'IN_PROGRESS',noteText:'착수회의 화면 연동 저장',expectedVersion:0 })
  }),env);
  assert.equal(samePmStale.status,200);
  assert.equal((await samePmStale.json() as any).schedule.version,2);

  const otherUserStale = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/stages/KICKOFF`,ADMIN_TOKEN,{
    method:'PUT',body:JSON.stringify({ startDate:'2026-09-03',endDate:'2026-09-03',status:'PLANNED',noteText:'다른 사용자 구버전 덮어쓰기',expectedVersion:0 })
  }),env);
  assert.equal(otherUserStale.status,409);

  const batch = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/stages`,PM_TOKEN,{
    method:'PUT',body:JSON.stringify({ items:[
      { stageCode:'KICKOFF',startDate:'2026-09-04',endDate:'2026-09-04',status:'COMPLETED',noteText:'착수 완료',expectedVersion:1 },
      { stageCode:'SITE_SURVEY',startDate:'2026-09-05',endDate:'2026-09-06',status:'PLANNED',noteText:'현장 일정',expectedVersion:0 },
      { stageCode:'TAKEOFF_COST',startDate:'2026-09-07',endDate:'2026-09-12',status:'PLANNED',noteText:'물량 일정',expectedVersion:0 },
      { stageCode:'REPORT_WRITING',startDate:'2026-09-13',endDate:'2026-09-20',status:'PLANNED',noteText:'보고서 일정',expectedVersion:0 }
    ] })
  }),env);
  assert.equal(batch.status,200);
  const batchBody = await batch.json() as any;
  assert.equal(batchBody.phase,'CF70_ATOMIC_PROJECT_SCHEDULE_BATCH');
  assert.equal(batchBody.schedules.length,4);
  const rows = sql.exec('SELECT stage_code,start_date,end_date,version FROM preview_project_stage_schedules WHERE case_id=? ORDER BY stage_code',[CASE_ID])[0].values;
  assert.equal(rows.length,4);
  assert.deepEqual(rows.find((row)=>row[0]==='KICKOFF'),['KICKOFF','2026-09-04','2026-09-04',3]);

  const before = JSON.stringify(rows);
  const rejectedBatch = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/stages`,ADMIN_TOKEN,{
    method:'PUT',body:JSON.stringify({ items:[
      { stageCode:'KICKOFF',startDate:'2026-10-01',endDate:'2026-10-01',status:'PLANNED',noteText:'충돌',expectedVersion:0 },
      { stageCode:'SITE_SURVEY',startDate:'2026-10-02',endDate:'2026-10-02',status:'PLANNED',noteText:'함께 저장되면 안 됨',expectedVersion:1 }
    ] })
  }),env);
  assert.equal(rejectedBatch.status,409);
  const after = JSON.stringify(sql.exec('SELECT stage_code,start_date,end_date,version FROM preview_project_stage_schedules WHERE case_id=? ORDER BY stage_code',[CASE_ID])[0].values);
  assert.equal(after,before,'conflicted batch must not partially change another stage');

  const scheduleUi = readFileSync(join(process.cwd(),'apps','web','src','workflow','ProjectWorkflowSchedule.tsx'),'utf8');
  const operationsUi = readFileSync(join(process.cwd(),'apps','web','src','workflow','WorkflowOperations.tsx'),'utf8');
  assert.match(scheduleUi,/projects\/\$\{encodeURIComponent\(project\.caseId\)\}\/stages`/u);
  assert.doesNotMatch(scheduleUi,/for \(const stage of filled\)[\s\S]{0,500}apiRequest/u);
  assert.match(operationsUi,/error\.message \|\| '다른 사용자가/u);
  sql.close();
});

test('CF53 project intake needs only the linked proposal result, then PM and dates are set on the schedule page', async () => {
  const { sql, env } = await setup();
  let erpRequest: { url: string; headers: Headers; payload: Record<string, unknown> } | null = null;
  env.ERP_PROJECT_WEBHOOK_URL = 'https://erp.example.com/api/integrations/claim-center/projects';
  env.ERP_PROJECT_WEBHOOK_SECRET = 'synthetic-cf53-webhook-secret';
  env.ERP_TEST_FETCH = async (input, init) => {
    erpRequest = {
      url: String(input),
      headers: new Headers(init?.headers),
      payload: JSON.parse(String(init?.body)) as Record<string, unknown>
    };
    return new Response(JSON.stringify({ projectId:'ERP-PRJ-CF53-001' }), { status:200,headers:{'Content-Type':'application/json'} });
  };
  const caseVersion = Number(sql.exec('SELECT version FROM preview_cases WHERE id=?', [CASE_ID])[0].values[0][0]);
  const proposalPayload = {
    caseId: CASE_ID, proposalNumber: 'PROP-CF40-001', proposalTitle: 'CF40 프로젝트 접수 제안서', revisionLabel: 'V1-SENT',
    clientName: '합성 발주처', sentAt: '2026-08-21T02:00:00.000Z', responseDueOn: '2026-08-30', proposedAmountKrw: 44000000,
    documentUrl: 'https://preview.example/proposals/cf40.pdf', documentSha256: 'b'.repeat(64), verificationStatus: 'VERIFIED', expectedCaseVersion: caseVersion
  };
  const linked = await worker.fetch(request('/api/proposal-workflow/links', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf40-proposal-link-0001' }, body: JSON.stringify(proposalPayload) }), env);
  assert.equal(linked.status, 200);
  const proposal = (await linked.json() as any).proposal;
  const confirmed = await worker.fetch(request(`/api/proposal-workflow/links/${proposal.id}/decision`, ADMIN_TOKEN, {
    method: 'POST', headers: { 'Idempotency-Key': 'cf53-award-simple-0001' }, body: JSON.stringify({ decision:'WON',expectedLinkVersion:proposal.version,expectedCaseVersion:proposal.caseVersion })
  }), env);
  assert.equal(confirmed.status, 200);
  const confirmedBody = await confirmed.json() as any;
  assert.equal(confirmedBody.erpSync.status,'SYNCED');
  assert.equal(confirmedBody.erpSync.erpProjectId,'ERP-PRJ-CF53-001');
  assert.ok(erpRequest);
  const capturedErpRequest = erpRequest as unknown as { url: string; headers: Headers; payload: Record<string, unknown> };
  assert.equal(capturedErpRequest.url,'https://erp.example.com/api/integrations/claim-center/projects');
  assert.equal(capturedErpRequest.headers.get('Idempotency-Key'),`claim-center-project:${CASE_ID}`);
  assert.match(capturedErpRequest.headers.get('X-CONCOST-Signature') ?? '',/^sha256=[0-9a-f]{64}$/u);
  assert.equal(Object.hasOwn(capturedErpRequest.payload,'contractAmountKrw'),false);
  assert.equal(Object.hasOwn(capturedErpRequest.payload,'proposedAmountKrw'),false);
  assert.equal(capturedErpRequest.payload.source,'CLAIM_CENTER_STUDIO');
  assert.equal((capturedErpRequest.payload.project as any).externalId,CASE_ID);
  const syncRow = sql.exec('SELECT status,erp_project_id,attempts FROM preview_erp_project_syncs WHERE case_id=?',[CASE_ID])[0].values[0];
  assert.deepEqual(syncRow,['SYNCED','ERP-PRJ-CF53-001',1]);
  const retried = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/erp-sync`,PM_TOKEN,{ method:'POST' }),env);
  assert.equal(retried.status,200);
  assert.equal((await retried.json() as any).erpSync.status,'SYNCED');
  assert.equal(sql.exec('SELECT attempts FROM preview_erp_project_syncs WHERE case_id=?',[CASE_ID])[0].values[0][0],1);
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_project_schedule_profiles WHERE case_id=?', [CASE_ID])[0].values[0][0], 0);
  const schedule = await worker.fetch(request('/api/project-workflow/schedule', PM_TOKEN), env);
  assert.equal(schedule.status, 200);
  const scheduleBody = await schedule.json() as any;
  let project = scheduleBody.projects.find((item: any) => item.caseId === CASE_ID);
  assert.ok(project, JSON.stringify(scheduleBody));
  assert.equal(project.responsiblePm, null);
  const assigned = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/profile`, ADMIN_TOKEN, { method:'PUT', body:JSON.stringify({ responsiblePmId:PM_ID,expectedProfileVersion:0 }) }), env);
  assert.equal(assigned.status, 200);
  const refreshed = await worker.fetch(request('/api/project-workflow/schedule', PM_TOKEN), env);
  project = (await refreshed.json() as any).projects.find((item: any) => item.caseId === CASE_ID);
  assert.equal(project.responsiblePm.id, PM_ID); assert.equal(project.canManageSchedule, true);
  assert.ok(project.stages.filter((item: any) => ['KICKOFF','SITE_SURVEY','TAKEOFF_COST','REPORT_WRITING'].includes(item.stageCode)).every((item: any) => item.scheduleExplicit === false));
  sql.close();
});

test('CF40 internal text stays local by default, then minimizes identifiers under acknowledged paid policy', async () => {
  const { sql, env } = await setup();
  let providerCalls = 0;
  env.GEMINI_TEST_FETCH = async () => {
    providerCalls += 1;
    const result = {
      meetingAt: '2026-08-28T01:00:00.000Z', surveyDate: null, location: '현장 회의실', agenda: '현장 범위와 제출 일정',
      participants: ['발주처 담당자', '프로젝트 PM'], leadUnit: '클레임센터', sourceNotes: '10시 현장 범위 확인. 11시 제출일 합의.',
      summary: '착수회의 내용을 원문 근거에 따라 정리한 검토용 초안입니다.', timeline: [{ title: '범위 확인', detail: '발주처 제공자료와 현장 범위를 확인했습니다.' }], missingFields: []
    };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const form = () => {
    const value = new FormData(); value.set('workflowKind', 'KICKOFF'); value.set('dataClass', 'INTERNAL');
    value.set('file', new File(['담당 010-1234-5678, pm@example.com\n10시 현장 범위 확인'], '착수회의.csv', { type: 'text/csv' })); return value;
  };
  const local = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/ai-import`, PM_TOKEN, { method: 'POST', body: form() }), env);
  assert.equal(local.status, 200); assert.equal(providerCalls, 0);
  const localBody = await local.json() as any;
  assert.equal(localBody.generator, 'LOCAL_STRUCTURED_FALLBACK');
  assert.equal(localBody.security.providerTier, 'LOCAL_ONLY');
  assert.match(localBody.import.sourceNotes, /현장 범위 확인/u);
  assert.deepEqual(sql.exec("SELECT status,error_code FROM preview_workflow_ai_imports ORDER BY created_at DESC LIMIT 1")[0].values[0], ['SUCCEEDED', 'LOCAL_STRUCTURED_FALLBACK']);
  const acknowledged = await worker.fetch(request('/api/settings/ai-governance', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ providerServiceTier: 'PAID_NO_PRODUCT_IMPROVEMENT', confidentialExternalAiEnabled: true, expectedVersion: 1, acknowledgement: '유료 서비스의 비학습 조건과 회사 보안정책을 확인했습니다' }) }), env);
  assert.equal(acknowledged.status, 200);
  const imported = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/ai-import`, PM_TOKEN, { method: 'POST', body: form() }), env);
  assert.equal(imported.status, 200); assert.equal(providerCalls, 1);
  const body = await imported.json() as any;
  assert.equal(body.security.rawProviderPayloadStored, false); assert.ok(body.security.redactionCount >= 2);
  assert.equal(body.import.location, '현장 회의실'); assert.equal(body.import.timeline.length, 1);
  const columns = sql.exec("PRAGMA table_info('preview_workflow_ai_imports')")[0].values.map((row) => row[1]);
  assert.equal(columns.includes('raw_payload'), false); assert.equal(columns.includes('response_text'), false);
  const ui = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'workflow', 'WorkflowOperations.tsx'), 'utf8');
  assert.match(ui, /끌어 놓으면/u); assert.match(ui, /회사 회의록 XLSX 내보내기/u); assert.match(ui, /CONCOST_회의록_양식\.xlsx/u); assert.match(ui, /비학습 조건/u);
  assert.match(ui, /PROJECT CALENDAR · SINGLE SOURCE/u);
  assert.match(ui, /persistSharedSchedule/u);
  assert.match(ui, /착수회의 기록 저장/u);
  assert.match(ui, /현장조사 기록 저장/u);
  assert.match(ui, /팀 투입·기준 일정 저장/u);
  const scheduleUi = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'workflow', 'ProjectWorkflowSchedule.tsx'), 'utf8');
  assert.match(scheduleUi, /전체 일정 저장 완료/u);
  assert.match(scheduleUi, /확인하고 닫기/u);
  sql.close();
});
