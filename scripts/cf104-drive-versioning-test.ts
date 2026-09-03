import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';
import { encryptSecret, GOOGLE_DRIVE_SCOPE, readEvidenceFolderNames } from '../apps/cloudflare/src/google-drive.js';
import { parseVersionAnalysis } from '../apps/cloudflare/src/evidence-versioning.js';
import { extractEvidenceText } from '../apps/cloudflare/src/intake-source.js';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

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
  '0041_cf53_erp_project_bridge.sql','0047_cf72_project_members_calendar.sql','0048_cf73_workflow_minutes_parity.sql','0055_cf85_drive_department_access.sql'
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


const versionMigration = migration('0058_cf104_evidence_versions.sql');
const upload = (env: CloudflareEnv, name: string, content: string, token = STAFF_TOKEN, category = 'MEETING_MINUTES', key = crypto.randomUUID(), extra: Record<string,string> = {}) => {
  const form = evidenceForm(category,name,'text/plain',Array.from(new TextEncoder().encode(content)));
  for (const [field,value] of Object.entries(extra)) form.set(field,value);
  return worker.fetch(request(`/api/cases/${CASE_ID}/evidence`,token,{method:'POST',headers:{'Idempotency-Key':key},body:form}),env);
};
const list = async (env: CloudflareEnv) => (await (await worker.fetch(request(`/api/cases/${CASE_ID}/evidence`,STAFF_TOKEN),env)).json() as any).files as any[];
function allowGemini(sql: Database) {
  sql.run("UPDATE preview_ai_data_governance SET provider_service_tier='PAID_NO_PRODUCT_IMPROVEMENT',confidential_external_ai_enabled=1,acknowledged_by=?,acknowledged_at=?,version=version+1,updated_at=? WHERE organization_id='concost'",[ADMIN_ID,'2098-09-03T00:00:00Z','2098-09-03T00:00:00Z']);
}
function mockAnalysis(env: CloudflareEnv, id: string, score = .9, subsequent = true) {
  let calls=0;
  env.GEMINI_TEST_FETCH = async () => { calls++; return Response.json({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify({existing_file_id:id,similarity_score:score,is_subsequent_version:subsequent,change_summary:['회의 결정사항 추가'],recommendation:'REPLACE_AS_LATEST'})}]}]}); };
  return () => calls;
}

test('CF104 project access is department OR assignment, with matching insert guards and proxy downloads',async()=>{
  const {sql,env}=await setup(); sql.exec(versionMigration);
  sql.run('DELETE FROM preview_case_assignments WHERE case_id=? AND user_id=?',[CASE_ID,STAFF_ID]);
  const first=await upload(env,'minutes.txt','safe synthetic meeting');
  assert.equal(first.status,201,await first.clone().text());
  const file=(await first.json() as any).file;
  const downloaded=await worker.fetch(request(file.downloadUrl,STAFF_TOKEN),env);
  assert.equal(downloaded.status,200); assert.equal(await downloaded.text(),'safe synthetic meeting');
  sql.run("UPDATE preview_users SET department_code='DEVELOPMENT',version=version+1 WHERE id=?",[STAFF_ID]);
  assert.equal((await worker.fetch(request(file.downloadUrl,STAFF_TOKEN),env)).status,403);
  assert.equal((await upload(env,'blocked.txt','cannot upload')).status,403);
  sql.run('INSERT INTO preview_case_assignments(case_id,user_id,assigned_by,assigned_at) VALUES(?,?,?,?)',[CASE_ID,STAFF_ID,ADMIN_ID,'2026-09-03T00:00:00Z']);
  assert.equal((await worker.fetch(request(file.downloadUrl,STAFF_TOKEN),env)).status,200);
  assert.equal((await upload(env,'source.txt','different category',STAFF_TOKEN,'SITE_DOCUMENT')).status,201);
  assert.equal((await worker.fetch(new Request(`https://preview.example${file.downloadUrl}`),env)).status,401);
  assert.equal(sql.exec('PRAGMA foreign_key_check').length,0); sql.close();
});

test('CF104 deployment maintenance stops every Worker route before database access',async()=>{
  const env={RELEASE_MAINTENANCE:'1',DB:{prepare(){throw new Error('Database must not be reached during maintenance');}}} as unknown as CloudflareEnv;
  for(const path of ['/api/cases','/api/cases/evidence/00000000-0000-4000-8000-000000000104/download','/auth/google/callback','/readiness']){
    const response=await worker.fetch(new Request(`https://preview.example${path}`),env);
    assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'60');
    assert.equal((await response.json() as any).code,'RELEASE_MAINTENANCE');
  }
});

test('CF104 hash duplicates include renamed files and preserve successful request replay',async()=>{
  const {sql,env}=await setup(); sql.exec(versionMigration);
  let calls=0; env.GEMINI_TEST_FETCH=async()=>{calls++;throw Error('must not call');};
  const key=crypto.randomUUID();
  assert.equal((await upload(env,'first.txt','identical',STAFF_TOKEN,'MEETING_MINUTES',key)).status,201);
  const replay=await upload(env,'first.txt','identical',STAFF_TOKEN,'MEETING_MINUTES',key);
  assert.equal(replay.status,200);assert.equal((await replay.json() as any).replay,true);
  const duplicate=await upload(env,'renamed.txt','identical');assert.equal(duplicate.status,409);
  const duplicateBody=await duplicate.json() as any;
  assert.equal(duplicateBody.status,'DUPLICATE_EXACT');assert.equal(calls,0);
  assert.equal(duplicateBody.file.id,duplicateBody.existing_file.id);
  assert.equal(duplicateBody.file.driveUrl,null);assert.equal(duplicateBody.file.googleFileId,undefined);
  assert.equal(duplicateBody.file.downloadUrl,`/api/cases/evidence/${duplicateBody.file.id}/download`);
  assert.equal((await upload(env,'other-category.txt','identical',STAFF_TOKEN,'SITE_DOCUMENT')).status,201);
  assert.equal((await list(env)).length,2);sql.close();
});

test('CF104 Gemini review requires paid governance, confirmation binds user/content and replacement retains history',async()=>{
  const {sql,env}=await setup();sql.exec(versionMigration);
  const first=await upload(env,'minutes.txt','version one');
  assert.equal(first.status,201);
  const base=(await first.json() as any).file;
  const calls=mockAnalysis(env,base.id);
  assert.equal((await upload(env,'minutes2.txt','version two')).status,403); assert.equal(calls(),0);
  allowGemini(sql);
  const key=crypto.randomUUID();
  const pending=await upload(env,'minutes2.txt','version two',STAFF_TOKEN,'MEETING_MINUTES',key);
  assert.equal(pending.status,409,await pending.clone().text());
  const review=await pending.json() as any;
  assert.equal(review.status,'VERSION_CONFLICT_CONFIRMATION');assert.equal(review.nextVersion,2);
  assert.equal((await list(env)).length,1);
  const extra={reviewId:review.reviewId,versionChoice:'REPLACE_AS_LATEST'};
  assert.equal((await upload(env,'minutes2.txt','tampered',STAFF_TOKEN,'MEETING_MINUTES',key,extra)).status,409);
  assert.equal((await upload(env,'minutes2.txt','version two',PM_TOKEN,'MEETING_MINUTES',key,extra)).status,409);
  const saved=await upload(env,'minutes2.txt','version two',STAFF_TOKEN,'MEETING_MINUTES',key,extra);
  assert.equal(saved.status,201,await saved.clone().text());
  assert.equal((await saved.json() as any).file.versionNumber,2);
  const files=await list(env);
  assert.equal(files.filter(f=>f.isLatest).length,1);assert.equal(files.find(f=>f.id===base.id).isLatest,false);
  assert.equal(files.find(f=>f.isLatest).versionNumber,2);
  assert.deepEqual(files.find(f=>f.isLatest).changeSummary,['회의 결정사항 추가']);
  assert.equal((await worker.fetch(request(base.downloadUrl,STAFF_TOKEN),env)).status,200);
  assert.equal((await upload(env,'again.txt','version one')).status,409);
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_evidence_upload_locks')[0].values[0][0],0);
  assert.equal(sql.exec('PRAGMA foreign_key_check').length,0);sql.close();
});

test('CF104 keep separate and stale review do not silently replace files',async()=>{
  const {sql,env}=await setup();sql.exec(versionMigration);allowGemini(sql);
  const base=(await (await upload(env,'v1.txt','one')).json() as any).file;
  mockAnalysis(env,base.id,.75,false);
  const pending=await (await upload(env,'v2.txt','two')).json() as any;
  const second=await upload(env,'v2.txt','two',STAFF_TOKEN,'MEETING_MINUTES',crypto.randomUUID(),{reviewId:pending.reviewId,versionChoice:'KEEP_AS_NEW_SEPARATE'});
  assert.equal(second.status,201,await second.clone().text());
  assert.equal((await list(env)).filter(f=>f.isLatest).length,2);
  const stale=await upload(env,'v2.txt','two changed',STAFF_TOKEN,'MEETING_MINUTES',crypto.randomUUID(),{reviewId:pending.reviewId,versionChoice:'REPLACE_AS_LATEST'});
  assert.equal(stale.status,409);
  assert.equal((await list(env)).filter(f=>f.isLatest).length,2);sql.close();
});

test('CF104 additive migration preserves populated evidence and reapplying it is harmless',async()=>{
  const {sql,env}=await setup();
  // Existing bytes from before CF104; immutable manifest and audit remain unchanged.
  const now='2026-09-03T00:00:00Z';const id=crypto.randomUUID();
  sql.run('INSERT INTO preview_case_evidence(id,organization_id,case_id,category,workflow_category,original_name,mime_type,byte_size,sha256,chunk_count,storage_provider,uploaded_by_id,uploaded_by_name,uploaded_at,idempotency_key,request_fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,'concost',CASE_ID,'TAKEOFF_SOURCE','MEETING_MINUTES','legacy.txt','text/plain',6,await sha256('legacy'),1,'D1_TEMPORARY',STAFF_ID,'프로젝트 Staff',now,crypto.randomUUID(),'a'.repeat(64)]);
  sql.run('INSERT INTO preview_case_evidence_chunks VALUES(?,?,?,?)',[id,0,6,new TextEncoder().encode('legacy')]);
  const before=JSON.stringify(sql.exec('SELECT * FROM preview_case_evidence'));
  sql.exec(versionMigration);sql.exec(versionMigration);
  assert.equal(JSON.stringify(sql.exec('SELECT * FROM preview_case_evidence')),before);
  const files=await list(env);assert.equal(files[0].versionNumber,1);
  assert.equal(await (await worker.fetch(request(files[0].downloadUrl,STAFF_TOKEN),env)).text(),'legacy');
  assert.equal(sql.exec('PRAGMA integrity_check')[0].values[0][0],'ok');assert.equal(sql.exec('PRAGMA foreign_key_check').length,0);
  sql.close();
});

async function mockDrive(sql: Database, env: CloudflareEnv) {
  const master='ab'.repeat(32);const encrypted=await encryptSecret('synthetic-refresh-token',master,'concost:google-refresh');
  Object.assign(env,{GOOGLE_CLIENT_ID:'synthetic-client.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'synthetic-client-secret',GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY:master,GOOGLE_OAUTH_REDIRECT_ORIGIN:'https://preview.example',GOOGLE_ALLOWED_DOMAIN:'example.invalid',ALLOW_TEST_GOOGLE_MODES:'true'});
  sql.run('INSERT INTO preview_google_credentials VALUES(?,?,?,?,?,?,?)',['concost',encrypted.ciphertextHex,encrypted.ivHex,GOOGLE_DRIVE_SCOPE,ADMIN_ID,'2026-09-03T00:00:00Z','2026-09-03T00:00:00Z']);
  const state={uploads:0,renames:[] as string[],failRename:false,failFolderLookup:false,folderReads:0,folders:new Map<string,any>(),beforeUpload:null as null|(()=>Promise<void>),files:new Map<string,string>()};let ordinal=0;
  env.GOOGLE_TEST_FETCH=async(input,init)=>{
    const url=new URL(String(input));const method=init?.method??'GET';
    if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-access-token',token_type:'Bearer',expires_in:3600,scope:GOOGLE_DRIVE_SCOPE});
    if(url.searchParams.get('alt')==='media')return new Response(state.files.get(url.pathname.split('/').pop()!)??'missing');
    if(url.pathname.includes('/upload/')){
      state.uploads++;await state.beforeUpload?.();
      const body=await (init?.body as Blob).text();const chunks=body.split('\r\n\r\n');const metadata=JSON.parse(chunks[1].split('\r\n--')[0]);const content=chunks[2].split('\r\n--')[0];
      const id=`synthetic-file-${state.uploads}`;state.files.set(id,content);
      return Response.json({id,name:metadata.name,mimeType:init?.body?body.match(/Content-Type: ([^\r]+)\r\n\r\n[^]*?\r\n--[^]*?Content-Type: ([^\r]+)/)?.[2]:'text/plain',size:String(new TextEncoder().encode(content).length)});
    }
    if(method==='PATCH'){
      const metadata=JSON.parse(String(init?.body));state.renames.push(metadata.name);
      return state.failRename?new Response('synthetic failure',{status:500}):Response.json({id:url.pathname.split('/').pop(),name:metadata.name});
    }
    if(method==='GET'){
      if(url.searchParams.get('pageSize')==='1000'){state.folderReads++;if(state.failFolderLookup)return new Response('Unavailable',{status:503});}
      const query=url.searchParams.get('q')??'';
      const properties=[...query.matchAll(/appProperties has \{ key='([^']+)' and value='([^']*)' \}/gu)];
      const parent=query.match(/'([^']+)' in parents/u)?.[1];
      return Response.json({files:[...state.folders.values()].filter(folder=>properties.every(([,key,value])=>folder.appProperties?.[key]===value)&&(!parent||folder.parents?.includes(parent)))});
    }
    if(method==='POST'){
      const metadata=JSON.parse(String(init?.body));const folder={id:`synthetic-folder-${++ordinal}`,name:metadata.name,mimeType:'application/vnd.google-apps.folder',trashed:false,parents:metadata.parents,appProperties:metadata.appProperties};state.folders.set(folder.id,folder);return Response.json(folder);
    }
    throw Error(`Unexpected mock request ${method} ${url.pathname}`);
  };
  return state;
}

test('CF105 folder names use Drive metadata, preserve attribution and never disclose Drive IDs',async()=>{
  const {sql,env}=await setup();sql.exec(versionMigration);const state=await mockDrive(sql,env);
  const key=crypto.randomUUID();const first=await upload(env,'minutes.txt','first',STAFF_TOKEN,'MEETING_MINUTES',key);
  assert.equal(first.status,201);const created=await first.json() as any;
  assert.match(created.file.folder.name,/^회의록\(/u);
  assert.match(created.file.folder.key,/^[0-9a-f]{64}$/u);
  const second=await upload(env,'site.txt','site document',STAFF_TOKEN,'SITE_DOCUMENT');assert.equal(second.status,201);
  const folders=[...state.folders.values()].filter(folder=>['MEETING_MINUTES','SITE_DOCUMENT'].includes(folder.appProperties?.claimCenterFolderKind));
  assert.equal(folders.length,2);
  for(const folder of folders)folder.name='동일한 실제 폴더명 (변경됨)';
  const before=JSON.stringify(sql.exec('SELECT * FROM preview_google_case_evidence'));
  const files=await list(env);
  assert.equal(files.length,2);assert.equal(new Set(files.map(file=>file.folder.key)).size,2);
  assert.ok(files.every(file=>file.folder.name==='동일한 실제 폴더명 (변경됨)'));
  assert.equal(files.find(file=>file.id===created.file.id).uploadedBy,created.file.uploadedBy);
  assert.equal(files.find(file=>file.id===created.file.id).folder.key,created.file.folder.key);
  const replay=await upload(env,'minutes.txt','first',STAFF_TOKEN,'MEETING_MINUTES',key);
  assert.equal(replay.status,200);const replayed=await replay.json() as any;
  assert.deepEqual(replayed.file.folder,files.find(file=>file.id===created.file.id).folder);
  assert.doesNotMatch(JSON.stringify([created,files,replayed]),/synthetic-(?:folder|file)-|https:\/\/drive\.google\.com/u);
  assert.equal(JSON.stringify(sql.exec('SELECT * FROM preview_google_case_evidence')),before);
  const writes=state.uploads;state.failFolderLookup=true;
  const fallback=await list(env);assert.equal(fallback.length,2);assert.ok(fallback.every(file=>file.folder.name===null));
  assert.equal(await (await worker.fetch(request(created.file.downloadUrl,STAFF_TOKEN),env)).text(),'first');
  assert.equal(state.uploads,writes);assert.equal(state.renames.length,0);
  sql.run("UPDATE preview_users SET department_code='DEVELOPMENT',version=version+1 WHERE id=?",[STAFF_ID]);
  sql.run('DELETE FROM preview_case_assignments WHERE case_id=? AND user_id=?',[CASE_ID,STAFF_ID]);
  const reads=state.folderReads;
  assert.equal((await worker.fetch(request(`/api/cases/${CASE_ID}/evidence`,STAFF_TOKEN),env)).status,403);
  assert.equal(state.folderReads,reads);sql.close();
});

test('CF105 folder lookup validates project ownership, pages empty responses and retains partial results',async()=>{
  let calls=0;const id='synthetic-folder-allowed';const hidden='synthetic-folder-hidden';
  const folder={id,name:'実際 <img src=x> 폴더',mimeType:'application/vnd.google-apps.folder',trashed:false,appProperties:{claimCenterCaseId:CASE_ID}};
  const names=await readEvidenceFolderNames(async(input,init)=>{
    assert.equal(init?.method??'GET','GET');assert.equal(new URL(String(input)).searchParams.get('pageSize'),'1000');calls++;
    if(calls===1)return Response.json({files:[],nextPageToken:'page-2'});
    if(calls===2)return Response.json({files:[folder,{...folder,id:hidden,appProperties:{claimCenterCaseId:ADMIN_ID}},{...folder,id:'synthetic-trashed',trashed:true},{...folder,id:'synthetic-file-type',mimeType:'text/plain'},{...folder,id:'synthetic-not-requested'}],nextPageToken:'page-3'});
    return new Response('Unavailable',{status:503});
  },async()=>'synthetic-token',CASE_ID,[id,hidden,'synthetic-trashed','synthetic-file-type']);
  assert.equal(calls,3);assert.deepEqual([...names],[[id,folder.name]]);
});

test('CF105 metadata timeout covers token refresh and stalled JSON bodies', {timeout:18_000}, async()=>{
  for(const phase of ['token','body']){
    let signal:AbortSignal|null|undefined;
    const started=Date.now();
    const result=await readEvidenceFolderNames(async(_input,init)=>{
      signal=init?.signal;
      if(phase==='token')return new Promise<Response>((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(signal!.reason),{once:true}));
      return new Response(new ReadableStream({start(controller){signal!.addEventListener('abort',()=>controller.error(signal!.reason),{once:true});}}));
    },async(fetcher)=>{if(phase==='token')await fetcher('https://oauth2.googleapis.com/token',{method:'POST'});return 'synthetic-token';},CASE_ID,['synthetic-folder-stalled']);
    assert.equal(result.size,0);assert.equal(signal?.aborted,true);
    assert.ok(Date.now()-started<9_000,`${phase} exceeded metadata deadline`);
  }
});

test('CF104 Drive replacement archives remotely, streams downloads and retains file ID on rename failure',async()=>{
  const {sql,env}=await setup();sql.exec(versionMigration);allowGemini(sql);const state=await mockDrive(sql,env);
  const first=await upload(env,'v1.txt','first');assert.equal(first.status,201,await first.clone().text());
  const base=(await first.json() as any).file;mockAnalysis(env,base.id);
  assert.equal(await (await worker.fetch(request(base.downloadUrl,STAFF_TOKEN),env)).text(),'first');
  const review=await (await upload(env,'v2.txt','second')).json() as any;
  assert.equal(review.status,'VERSION_CONFLICT_CONFIRMATION');assert.equal(state.uploads,1);
  const replacement=await upload(env,'v2.txt','second',STAFF_TOKEN,'MEETING_MINUTES',crypto.randomUUID(),{reviewId:review.reviewId,versionChoice:'REPLACE_AS_LATEST'});
  assert.equal(replacement.status,201,await replacement.clone().text());assert.match(state.renames[0],/^\[OLD_\d{4}-\d{2}-\d{2}\] v1.txt$/);
  const latest=(await replacement.json() as any).file;assert.equal(latest.versionNumber,2);mockAnalysis(env,latest.id);
  const next=await (await upload(env,'v3.txt','third')).json() as any;state.failRename=true;
  const key=crypto.randomUUID();const extra={reviewId:next.reviewId,versionChoice:'REPLACE_AS_LATEST'};
  const failure=await upload(env,'v3.txt','third',STAFF_TOKEN,'MEETING_MINUTES',key,extra);
  assert.equal(failure.status,503);assert.equal((await failure.json() as any).code,'RECONCILIATION_REQUIRED');
  assert.equal(sql.exec("SELECT google_file_id FROM preview_google_case_operations WHERE status='RECONCILIATION_REQUIRED'")[0].values[0][0],'synthetic-file-3');
  assert.equal((await list(env)).filter(f=>f.isLatest)[0].id,latest.id);
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_evidence_upload_locks')[0].values[0][0],1);
  assert.equal((await upload(env,'v3.txt','third',STAFF_TOKEN,'MEETING_MINUTES',key,extra)).status,409);assert.equal(state.uploads,3);
  sql.close();
});

test('CF104 concurrent Drive uploads serialize per category before any second remote write',async()=>{
  const {sql,env}=await setup();sql.exec(versionMigration);const state=await mockDrive(sql,env);
  let release!:()=>void;let entered!:()=>void;const paused=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{entered=resolve;});
  state.beforeUpload=async()=>{entered();await paused;};
  const first=upload(env,'one.txt','first');await started;
  const second=await upload(env,'two.txt','second');assert.equal(second.status,409);assert.equal((await second.json() as any).code,'UPLOAD_IN_PROGRESS');
  assert.equal(state.uploads,1);release();assert.equal((await first).status,201);
  assert.equal((await list(env)).length,1);assert.equal(sql.exec('SELECT COUNT(*) FROM preview_evidence_upload_locks')[0].values[0][0],0);sql.close();
});

test('CF104 malformed analysis and unmigrated writes fail closed',async()=>{
  assert.throws(()=>parseVersionAnalysis({existing_file_id:'x',similarity_score:NaN,is_subsequent_version:true,change_summary:[],recommendation:'REPLACE_AS_LATEST'},['x']));
  assert.throws(()=>parseVersionAnalysis({existing_file_id:'other-project',similarity_score:.9,is_subsequent_version:true,change_summary:[],recommendation:'REPLACE_AS_LATEST'},['x']));
  const {sql,env}=await setup();const result=await upload(env,'one.txt','first');assert.equal(result.status,503);assert.equal((await result.json() as any).code,'EVIDENCE_SCHEMA_UPGRADE_REQUIRED');sql.close();
});

test('CF104 unused review becomes stale when another document changes the snapshot',async()=>{
  const {sql,env}=await setup();sql.exec(versionMigration);allowGemini(sql);
  const base=(await (await upload(env,'base.txt','base')).json() as any).file;mockAnalysis(env,base.id);
  const pending=await (await upload(env,'revision.txt','revision')).json() as any;
  const form=evidenceForm('MEETING_MINUTES','photo.png','image/png',[137,80,78,71,13,10,26,10]);
  assert.equal((await worker.fetch(request(`/api/cases/${CASE_ID}/evidence`,STAFF_TOKEN,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:form}),env)).status,201);
  const result=await upload(env,'revision.txt','revision',STAFF_TOKEN,'MEETING_MINUTES',crypto.randomUUID(),{reviewId:pending.reviewId,versionChoice:'REPLACE_AS_LATEST'});
  assert.equal(result.status,409);assert.equal((await result.json() as any).code,'VERSION_REVIEW_STALE');
  assert.equal((await list(env)).filter(f=>f.isLatest).length,2);sql.close();
});

test('CF104 Drive upload followed by DB failure retains reconciliation identity and blocks repeat writes',async()=>{
  const {sql,env}=await setup();sql.exec(versionMigration);const state=await mockDrive(sql,env);
  env.DB!.batch=async()=>{throw Error('synthetic commit failure');};
  const failed=await upload(env,'uncommitted.txt','content');assert.equal(failed.status,503);
  assert.equal((await failed.json() as any).code,'RECONCILIATION_REQUIRED');
  assert.equal(sql.exec("SELECT google_file_id FROM preview_google_case_operations WHERE status='RECONCILIATION_REQUIRED'")[0].values[0][0],'synthetic-file-1');
  assert.equal((await list(env)).length,0);assert.equal((await upload(env,'retry.txt','content')).status,409);assert.equal(state.uploads,1);sql.close();
});

test('CF104 document comparison extracts DOCX/HWPX/XLSX/TXT safely and enforces the 0.75 threshold',async()=>{
  const {zipSync,strToU8}=createRequire(resolve('apps/web/package.json'))('fflate');
  const docx=zipSync({'word/document.xml':strToU8('<w:document><w:t>회의 &amp; 일정</w:t></w:document>')});
  const hwpx=zipSync({'Contents/section0.xml':strToU8('<hp:p><hp:t>현장조사 내용</hp:t></hp:p>')});
  const xlsx=zipSync({'[Content_Types].xml':strToU8('<Types/>'),'xl/worksheets/sheet1.xml':strToU8('<worksheet><c r="A1" t="inlineStr"><is><t>산출 내용</t></is></c></worksheet>')});
  assert.equal(await extractEvidenceText('a.docx','application/octet-stream',docx),'회의 & 일정');
  assert.equal(await extractEvidenceText('a.hwpx','application/octet-stream',hwpx),'현장조사 내용');
  assert.match(await extractEvidenceText('a.xlsx','application/octet-stream',xlsx),/A1: 산출 내용/);
  assert.equal(await extractEvidenceText('a.txt','text/plain',new TextEncoder().encode('원문')),'원문');
  const corrupt=docx.slice();const view=new DataView(corrupt.buffer);for(let i=0;i<corrupt.length-46;i++){if(view.getUint32(i,true)===0x02014b50){view.setUint32(i+24,1,true);break;}}
  await assert.rejects(extractEvidenceText('bad.docx','application/octet-stream',corrupt));
  const {sql,env}=await setup();sql.exec(versionMigration);allowGemini(sql);
  const base=(await (await upload(env,'base.txt','base')).json() as any).file;
  mockAnalysis(env,base.id,.749,false);assert.equal((await upload(env,'separate.txt','other')).status,201);
  mockAnalysis(env,base.id,.1,true);assert.equal((await upload(env,'subsequent.txt','revision')).status,409);sql.close();
});
