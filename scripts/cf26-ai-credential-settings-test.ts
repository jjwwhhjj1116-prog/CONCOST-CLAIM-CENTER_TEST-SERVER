import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const STAFF_ID = '00000000-0000-4000-8000-000000000002';
const CASE_ID = '40000000-0000-4000-8000-000000000010';
const ADMIN_TOKEN = 'cf26-admin-session-token';
const STAFF_TOKEN = 'cf26-staff-session-token';
const ADMIN_RELOGIN_TOKEN = 'cf26-admin-relogin-session-token';
const STAFF_RELOGIN_TOKEN = 'cf26-staff-relogin-session-token';
const PERSONAL_KEY = 'AQ.PERSONAL_GEMINI_KEY_123456789';
const ORGANIZATION_KEY = 'AQ.ORGANIZATION_GEMINI_KEY_123456789';
const ENVIRONMENT_KEY = 'AQ.ENVIRONMENT_GEMINI_KEY_123456789';
const MASTER_KEY = '7'.repeat(64);

async function sha256(value: string): Promise<string> { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
class SqlStatement {
  private values: unknown[] = [];
  constructor(private readonly database: Database, private readonly sql: string) {}
  bind(...values: unknown[]): SqlStatement { this.values = values; return this; }
  async first<T>(): Promise<T | null> { const statement = this.database.prepare(this.sql); try { statement.bind(this.values as any[]); return statement.step() ? statement.getAsObject() as T : null; } finally { statement.free(); } }
  async all<T>(): Promise<{ results: T[] }> { const statement = this.database.prepare(this.sql); const results: T[] = []; try { statement.bind(this.values as any[]); while (statement.step()) results.push(statement.getAsObject() as T); return { results }; } finally { statement.free(); } }
  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> { this.database.run(this.sql, this.values as any[]); const row = this.database.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0]; return { success: true, meta: { changes: this.database.getRowsModified(), last_row_id: Number(row ?? 0) } }; }
}
class SqlD1 {
  constructor(readonly database: Database) {}
  prepare(sql: string): SqlStatement { return new SqlStatement(this.database, sql); }
  async batch(statements: SqlStatement[]): Promise<unknown[]> { this.database.run('BEGIN IMMEDIATE'); try { const results=[]; for (const statement of statements) results.push(await statement.run()); this.database.run('COMMIT'); return results; } catch (error) { this.database.run('ROLLBACK'); throw error; } }
}
const migration = (name: string): string => readFileSync(join(process.cwd(), 'apps', 'cloudflare', 'migrations', name), 'utf8');
const request = (path: string, token: string, init: RequestInit = {}): Request => { const headers = new Headers(init.headers); headers.set('X-Session-Token', token); if (init.body) headers.set('Content-Type','application/json'); return new Request(`https://preview.example${path}`, { ...init, headers }); };

async function setup(): Promise<{ sql: Database; env: CloudflareEnv; usedKeys: string[] }> {
  const SQL = await initSqlJs(); const sql = new SQL.Database(); sql.run('PRAGMA foreign_keys=ON');
  for (const name of ['0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql','0004_cf05_google_drive.sql','0005_cf06_case_operations.sql']) sql.exec(migration(name));
  const now = new Date().toISOString();
  const insertUser = (id: string, login: string, roles: string) => sql.run('INSERT INTO preview_users VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)', [id, login, '1'.repeat(32), '2'.repeat(64), 100000, login, `${login}@example.invalid`, roles, now]);
  insertUser(ADMIN_ID,'admin','["admin"]'); sql.exec(migration('0010_cf10_product_experience.sql')); insertUser(STAFF_ID,'staff','["pm"]');
  for (const name of ['0006_cf07_report_studio_drafts.sql','0007_cf08_report_review_approval.sql','0008_cf09_final_output.sql','0009_cf09_output_actor_scope.sql','0011_cf11_project_workflow.sql','0012_cf12_report_ai_prompts.sql','0017_cf19_multi_provider_ai.sql','0018_cf26_ai_credentials.sql','0056_cf86_ai_runtime_reliability.sql']) sql.exec(migration(name));
  sql.run('INSERT INTO preview_case_assignments VALUES (?, ?, ?, ?)', [CASE_ID, STAFF_ID, ADMIN_ID, now]);
  for (const [token,id] of [[ADMIN_TOKEN,ADMIN_ID],[STAFF_TOKEN,STAFF_ID]] as const) sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(token),id,now,new Date(Date.now()+3_600_000).toISOString()]);
  const usedKeys: string[] = [];
  const env: CloudflareEnv = {
    DB: new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']>,
    AI_CREDENTIAL_MASTER_KEY: MASTER_KEY,
    GEMINI_API_KEY: ENVIRONMENT_KEY,
    GEMINI_TEST_FETCH: async (_input, init) => {
      usedKeys.push(new Headers(init?.headers).get('x-goog-api-key') ?? '');
      return new Response(JSON.stringify({ candidates:[{ content:{ parts:[{ text:'OK' }] } }] }), { status:200, headers:{ 'Content-Type':'application/json' } });
    }
  };
  return { sql, env, usedKeys };
}

test('CF26 stores personal and organization keys only as ciphertext and enforces scope', async () => {
  const { sql, env } = await setup();
  const personal = await worker.fetch(request('/api/settings/ai-credentials/GEMINI', STAFF_TOKEN, { method:'PUT', body:JSON.stringify({ scope:'USER', apiKey:PERSONAL_KEY, expectedVersion:0 }) }), env);
  assert.equal(personal.status,200); const personalText=await personal.text(); assert.doesNotMatch(personalText,new RegExp(PERSONAL_KEY,'u'));
  const stored=sql.exec("SELECT ciphertext_hex,iv_hex,key_fingerprint,status,version FROM preview_ai_credentials WHERE owner_scope='USER'")[0].values[0];
  assert.notEqual(stored[0],PERSONAL_KEY); assert.equal(String(stored[1]).length,24); assert.equal(String(stored[2]).length,64); assert.deepEqual(stored.slice(3),['ACTIVE',1]);
  const unsupportedPersonal=await worker.fetch(request('/api/settings/ai-credentials/OPENAI',STAFF_TOKEN,{method:'PUT',body:JSON.stringify({scope:'USER',apiKey:'sk-personal-openai-key-that-must-not-save',expectedVersion:0})}),env); assert.equal(unsupportedPersonal.status,400); assert.equal((await unsupportedPersonal.json() as {code:string}).code,'PERSONAL_PROVIDER_NOT_ALLOWED');
  const forbidden=await worker.fetch(request('/api/settings/ai-credentials/GEMINI',STAFF_TOKEN,{method:'PUT',body:JSON.stringify({scope:'ORGANIZATION',apiKey:ORGANIZATION_KEY,expectedVersion:0})}),env); assert.equal(forbidden.status,403);
  const organization=await worker.fetch(request('/api/settings/ai-credentials/GEMINI',ADMIN_TOKEN,{method:'PUT',body:JSON.stringify({scope:'ORGANIZATION',apiKey:ORGANIZATION_KEY,expectedVersion:0})}),env); assert.equal(organization.status,200); assert.doesNotMatch(await organization.text(),new RegExp(ORGANIZATION_KEY,'u'));
  for (const [token,id] of [[ADMIN_RELOGIN_TOKEN,ADMIN_ID],[STAFF_RELOGIN_TOKEN,STAFF_ID]] as const) sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(token),id,new Date().toISOString(),new Date(Date.now()+3_600_000).toISOString()]);
  const staffReload=await worker.fetch(request('/api/settings/ai-credentials',STAFF_RELOGIN_TOKEN),env); const staffPayload=await staffReload.json() as {providers:Array<{providerKind:string;personal:{configured:boolean;fingerprint:string|null};organization:{configured:boolean}}>}; const staffGemini=staffPayload.providers.find((provider)=>provider.providerKind==='GEMINI'); assert.equal(staffGemini?.personal.configured,true); assert.equal(staffGemini?.organization.configured,true); assert.equal(staffGemini?.personal.fingerprint,String(stored[2]).slice(0,12));
  const adminReload=await worker.fetch(request('/api/settings/ai-credentials',ADMIN_RELOGIN_TOKEN),env); const adminPayload=await adminReload.json() as {providers:Array<{providerKind:string;personal:{configured:boolean};organization:{configured:boolean}}>}; const adminGemini=adminPayload.providers.find((provider)=>provider.providerKind==='GEMINI'); assert.equal(adminGemini?.personal.configured,false); assert.equal(adminGemini?.organization.configured,true); assert.doesNotMatch(JSON.stringify({staffPayload,adminPayload}),new RegExp(`${PERSONAL_KEY}|${ORGANIZATION_KEY}`,'u'));
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_ai_credential_history')[0].values[0][0],2);
  assert.throws(() => sql.run("UPDATE preview_ai_credentials SET owner_id='concost',owner_scope='ORGANIZATION',version=2,updated_at='2099-01-01T00:00:00Z' WHERE owner_scope='USER'"),/AI credential identity/u);
  sql.close();
});

test('CF26 uses personal key before organization and environment, then falls back after disable', async () => {
  const { sql, env, usedKeys } = await setup();
  await worker.fetch(request('/api/settings/ai-credentials/GEMINI',ADMIN_TOKEN,{method:'PUT',body:JSON.stringify({scope:'ORGANIZATION',apiKey:ORGANIZATION_KEY,expectedVersion:0})}),env);
  await worker.fetch(request('/api/settings/ai-credentials/GEMINI',STAFF_TOKEN,{method:'PUT',body:JSON.stringify({scope:'USER',apiKey:PERSONAL_KEY,expectedVersion:0})}),env);
  let configResponse=await worker.fetch(request(`/api/report-authoring/config?caseId=${CASE_ID}`,STAFF_TOKEN),env); let config=await configResponse.json() as {credentialSource:string;assistantConnected:boolean;assistantCredentialSource:string;chapters:Array<{id:string}>}; assert.equal(config.credentialSource,'PERSONAL'); assert.equal(config.assistantConnected,true); assert.equal(config.assistantCredentialSource,'PERSONAL');
  const generated=await worker.fetch(request('/api/report-authoring/generate',STAFF_TOKEN,{method:'POST',body:JSON.stringify({caseId:CASE_ID,chapterId:config.chapters[0].id,expectedDraftVersion:0})}),env); assert.equal(generated.status,200); assert.equal(usedKeys.at(-1),PERSONAL_KEY);
  const improved=await worker.fetch(request('/api/report-authoring/improve',STAFF_TOKEN,{method:'POST',body:JSON.stringify({caseId:CASE_ID,content:'기존 보고서 초안입니다.',instruction:'문장을 더 명확하게 개선해 주세요.',expectedDraftVersion:0})}),env); assert.equal(improved.status,200); assert.equal(usedKeys.at(-1),PERSONAL_KEY); assert.equal((await improved.json() as {providerKind:string;credentialSource:string}).providerKind,'GEMINI');
  const successFetch=env.GEMINI_TEST_FETCH; env.GEMINI_TEST_FETCH=async()=>new Response(JSON.stringify({error:{status:'RESOURCE_EXHAUSTED',message:'quota exhausted'}}),{status:429,headers:{'Content-Type':'application/json'}});
  const exhausted=await worker.fetch(request('/api/report-authoring/improve',STAFF_TOKEN,{method:'POST',body:JSON.stringify({caseId:CASE_ID,content:'무료 할당량 경계 테스트입니다.',instruction:'문장을 더 명확하게 개선해 주세요.',expectedDraftVersion:0})}),env); assert.equal(exhausted.status,502); const exhaustedBody=await exhausted.json() as {code:string;error:string}; assert.equal(exhaustedBody.code,'GEMINI_QUOTA_EXHAUSTED'); assert.match(exhaustedBody.error,/새 Gemini API 키로 교체/u); env.GEMINI_TEST_FETCH=successFetch;
  const disabled=await worker.fetch(request('/api/settings/ai-credentials/GEMINI',STAFF_TOKEN,{method:'DELETE',body:JSON.stringify({scope:'USER',expectedVersion:1})}),env); assert.equal(disabled.status,200);
  configResponse=await worker.fetch(request(`/api/report-authoring/config?caseId=${CASE_ID}`,STAFF_TOKEN),env); config=await configResponse.json() as {credentialSource:string;assistantConnected:boolean;assistantCredentialSource:string;chapters:Array<{id:string}>}; assert.equal(config.credentialSource,'ORGANIZATION'); assert.equal(config.assistantConnected,true); assert.equal(config.assistantCredentialSource,'ORGANIZATION');
  const organizationImprove=await worker.fetch(request('/api/report-authoring/improve',STAFF_TOKEN,{method:'POST',body:JSON.stringify({caseId:CASE_ID,content:'개인 키가 없으면 관리자 공용 키로 개선합니다.',instruction:'문장을 더 명확하게 개선해 주세요.',expectedDraftVersion:0})}),env); assert.equal(organizationImprove.status,200); assert.equal((await organizationImprove.json() as {credentialSource:string}).credentialSource,'ORGANIZATION'); assert.equal(usedKeys.at(-1),ORGANIZATION_KEY);
  const tested=await worker.fetch(request('/api/settings/ai-credentials/GEMINI/test',ADMIN_TOKEN,{method:'POST',body:JSON.stringify({scope:'ORGANIZATION',modelCode:'gemini-3.7-flash'})}),env); assert.equal(tested.status,200); assert.equal(usedKeys.at(-1),ORGANIZATION_KEY);
  const health=sql.exec("SELECT status,model_code,provider_status,latency_ms FROM preview_ai_provider_health WHERE owner_scope='ORGANIZATION' AND provider_kind='GEMINI'")[0].values[0];assert.equal(health[0],'HEALTHY');assert.equal(health[1],'gemini-3.7-flash');assert.equal(health[2],200);assert.ok(Number(health[3])>=0);
  const responseText=await tested.text(); assert.doesNotMatch(responseText,new RegExp(`${PERSONAL_KEY}|${ORGANIZATION_KEY}|${ENVIRONMENT_KEY}`,'u'));
  sql.close();
});

test('CF26 UI exposes a settings route but never reads stored raw keys back', () => {
  const router=readFileSync(join(process.cwd(),'apps','web','src','routes','Router.tsx'),'utf8');
  const shell=readFileSync(join(process.cwd(),'apps','web','src','layout','AppShell.tsx'),'utf8');
  const settings=readFileSync(join(process.cwd(),'apps','web','src','routes','PreviewSettings.tsx'),'utf8');
  assert.match(router,/path: '\/settings'/u); assert.match(shell,/label: '설정'/u); assert.doesNotMatch(shell,/내 설정|내 AI 및 연결 설정/u); assert.match(settings,/type="password"/u); assert.match(settings,/개인 Gemini 연결 설정/u); assert.match(settings,/scope === 'USER' \? payload\.providers\.filter\(\(provider\) => provider\.providerKind === 'GEMINI'\)/u); assert.doesNotMatch(settings,/setKeys\([^)]*apiKey/u);
  assert.match(settings,/gpt-5\.6-sol/u); assert.match(settings,/gpt-5\.6-terra/u); assert.match(settings,/gpt-5\.6-luna/u); assert.match(settings,/claude-sonnet-5/u); assert.match(settings,/claude-opus-5/u); assert.match(settings,/gemini-3\.7-flash/u);
});
