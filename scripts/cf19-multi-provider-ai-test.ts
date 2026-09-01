import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const STAFF_ID = '00000000-0000-4000-8000-000000000002';
const CASE_ID = '40000000-0000-4000-8000-000000000010';
const ADMIN_TOKEN = 'cf19-admin-session-token';
const STAFF_TOKEN = 'cf19-staff-session-token';
const GEMINI_KEY = 'SYNTHETIC_GEMINI_SERVER_ONLY_KEY';

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
  async batch(statements: SqlStatement[]): Promise<unknown[]> { this.database.run('BEGIN IMMEDIATE'); try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.run('COMMIT'); return results; } catch (error) { this.database.run('ROLLBACK'); throw error; } }
}
const migration = (name: string): string => readFileSync(join(process.cwd(), 'apps', 'cloudflare', 'migrations', name), 'utf8');
const request = (path: string, token: string, init: RequestInit = {}): Request => { const headers = new Headers(init.headers); headers.set('X-Session-Token', token); if (init.body) headers.set('Content-Type', 'application/json'); return new Request(`https://preview.example${path}`, { ...init, headers }); };

async function setup(): Promise<{ sql: Database; env: CloudflareEnv; requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> }> {
  const SQL = await initSqlJs(); const sql = new SQL.Database(); sql.run('PRAGMA foreign_keys = ON');
  for (const name of ['0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql','0004_cf05_google_drive.sql','0005_cf06_case_operations.sql']) sql.exec(migration(name));
  const now = new Date().toISOString();
  const insertUser = (id: string, login: string, roles: string) => sql.run('INSERT INTO preview_users VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)', [id, login, '1'.repeat(32), '2'.repeat(64), 100000, login, `${login}@example.invalid`, roles, now]);
  insertUser(ADMIN_ID, 'admin', '["admin"]'); sql.exec(migration('0010_cf10_product_experience.sql')); insertUser(STAFF_ID, 'staff', '["pm"]');
  for (const name of ['0006_cf07_report_studio_drafts.sql','0007_cf08_report_review_approval.sql','0008_cf09_final_output.sql','0009_cf09_output_actor_scope.sql','0011_cf11_project_workflow.sql','0012_cf12_report_ai_prompts.sql','0017_cf19_multi_provider_ai.sql','0049_cf75_ai_model_catalog.sql']) sql.exec(migration(name));
  sql.run('INSERT INTO preview_case_assignments VALUES (?, ?, ?, ?)', [CASE_ID, STAFF_ID, ADMIN_ID, now]);
  for (const [token, id] of [[ADMIN_TOKEN, ADMIN_ID],[STAFF_TOKEN, STAFF_ID]] as const) sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(token), id, now, new Date(Date.now() + 3_600_000).toISOString()]);
  const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const geminiFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers); const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url: String(input), headers, body });
    assert.equal(headers.get('x-goog-api-key'), GEMINI_KEY); assert.equal(headers.has('Authorization'), false);
    return new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '## Gemini 검증 초안\n\n승인된 사건 자료만 사용한 챕터입니다. [확인 필요]' }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { sql, requests, env: { DB: new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']>, GEMINI_API_KEY: GEMINI_KEY, GEMINI_TEST_FETCH: geminiFetch } };
}

test('CF19 creates three independently versioned routes and exposes only secret connection state', async () => {
  const { sql, env } = await setup();
  const response = await worker.fetch(request('/api/admin/report-prompts', ADMIN_TOKEN), env); assert.equal(response.status, 200);
  const text = await response.text(); assert.doesNotMatch(text, new RegExp(GEMINI_KEY, 'u'));
  const body = JSON.parse(text) as { aiConfig: { providers: Array<{ providerKind: string; connected: boolean; models: Array<{ code: string }> }>; routes: Array<{ taskKind: string; providerKind: string; modelCode: string; version: number }> } };
  assert.equal(body.aiConfig.routes.length, 3);
  assert.deepEqual(body.aiConfig.routes.map((route) => route.taskKind), ['OUTLINE_PLANNING','CHAPTER_WRITING','FACT_CHECK']);
  assert.equal(body.aiConfig.routes.find((route) => route.taskKind === 'OUTLINE_PLANNING')?.providerKind, 'OPENAI');
  assert.equal(body.aiConfig.routes.find((route) => route.taskKind === 'CHAPTER_WRITING')?.modelCode, 'gemini-3.6-flash');
  assert.equal(body.aiConfig.providers.find((item) => item.providerKind === 'GEMINI')?.connected, true);
  assert.equal(body.aiConfig.providers.find((item) => item.providerKind === 'GEMINI')?.models.some((model) => model.code === 'gemini-3.7-flash'), true);
  assert.equal(body.aiConfig.providers.find((item) => item.providerKind === 'ANTHROPIC')?.connected, false);
  assert.throws(() => sql.run("INSERT INTO preview_report_ai_routes VALUES ('concost','BAD_TASK','GEMINI','gpt-5.6','medium','GEMINI_API_KEY',1,?,?)", [ADMIN_ID, new Date().toISOString()]), /CHECK/u);
  sql.close();
});

test('CF19 routes chapter writing through Gemini and never exposes the API key', async () => {
  const { sql, env, requests } = await setup();
  const configResponse = await worker.fetch(request(`/api/report-authoring/config?caseId=${CASE_ID}`, STAFF_TOKEN), env); assert.equal(configResponse.status, 200);
  const configText = await configResponse.text(); assert.doesNotMatch(configText, new RegExp(GEMINI_KEY, 'u'));
  const config = JSON.parse(configText) as { aiConnected: boolean; providerLabel: string; modelLabel: string; chapters: Array<{ id: string }> };
  assert.equal(config.aiConnected, true); assert.equal(config.providerLabel, 'GEMINI'); assert.equal(config.modelLabel, 'gemini-3.6-flash');
  const generated = await worker.fetch(request('/api/report-authoring/generate', STAFF_TOKEN, { method: 'POST', body: JSON.stringify({ caseId: CASE_ID, chapterId: config.chapters[0].id, expectedDraftVersion: 0 }) }), env);
  assert.equal(generated.status, 200); const generatedText = await generated.text(); assert.match(generatedText, /Gemini 검증 초안/u); assert.doesNotMatch(generatedText, new RegExp(GEMINI_KEY, 'u'));
  assert.equal(requests.length, 1); assert.match(requests[0].url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.6-flash:generateContent/u);
  assert.equal((requests[0].body.generationConfig as any).thinkingConfig.thinkingLevel, 'medium'); assert.equal(typeof (requests[0].body.contents as any[])[0].parts[0].text, 'string'); assert.equal(typeof (requests[0].body.system_instruction as any).parts[0].text, 'string');
  assert.deepEqual(sql.exec('SELECT provider_kind, task_kind, model_code FROM preview_report_ai_generations')[0].values[0], ['GEMINI','CHAPTER_WRITING','gemini-3.6-flash']);
  sql.close();
});

test('CF19 maps Gemini key failures to a safe diagnostic without exposing provider details', async () => {
  const { sql, env } = await setup();
  env.GEMINI_TEST_FETCH = async () => new Response(JSON.stringify({
    error: { code: 400, status: 'INVALID_ARGUMENT', message: `API key not valid. ${GEMINI_KEY}` }
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const configResponse = await worker.fetch(request(`/api/report-authoring/config?caseId=${CASE_ID}`, STAFF_TOKEN), env);
  const config = await configResponse.json() as { chapters: Array<{ id: string }> };
  const generated = await worker.fetch(request('/api/report-authoring/generate', STAFF_TOKEN, { method: 'POST', body: JSON.stringify({ caseId: CASE_ID, chapterId: config.chapters[0].id, expectedDraftVersion: 0 }) }), env);
  assert.equal(generated.status, 502);
  const text = await generated.text();
  assert.doesNotMatch(text, new RegExp(GEMINI_KEY, 'u'));
  const body = JSON.parse(text) as { code: string; providerReason: string; providerStatus: number };
  assert.deepEqual([body.code, body.providerReason, body.providerStatus], ['GEMINI_INVALID_API_KEY','INVALID_ARGUMENT',400]);
  sql.close();
});

test('CF19 exposes only a safe nested Gemini reason code', async () => {
  const { sql, env } = await setup();
  env.GEMINI_TEST_FETCH = async () => new Response(JSON.stringify({
    error: {
      code: 400,
      status: 'INVALID_ARGUMENT',
      message: `Sensitive provider message ${GEMINI_KEY}`,
      details: [{
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED',
        metadata: { secret: GEMINI_KEY, service: 'generativelanguage.googleapis.com' }
      }]
    }
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const configResponse = await worker.fetch(request(`/api/report-authoring/config?caseId=${CASE_ID}`, STAFF_TOKEN), env);
  const config = await configResponse.json() as { chapters: Array<{ id: string }> };
  const generated = await worker.fetch(request('/api/report-authoring/generate', STAFF_TOKEN, { method: 'POST', body: JSON.stringify({ caseId: CASE_ID, chapterId: config.chapters[0].id, expectedDraftVersion: 0 }) }), env);
  assert.equal(generated.status, 502);
  const text = await generated.text();
  assert.doesNotMatch(text, new RegExp(GEMINI_KEY, 'u'));
  assert.doesNotMatch(text, /Sensitive provider message|generativelanguage\.googleapis\.com/u);
  const body = JSON.parse(text) as { code: string; providerReason: string; providerStatus: number };
  assert.deepEqual([body.code, body.providerReason, body.providerStatus], ['GEMINI_AUTH_KEY_NOT_READY','ACCESS_TOKEN_TYPE_UNSUPPORTED',400]);
  sql.close();
});

test('CF19 safely classifies the Interactions API error envelope', async () => {
  const { sql, env } = await setup();
  env.GEMINI_TEST_FETCH = async () => new Response(JSON.stringify({
    error: { code: 'model_not_found', message: `Model does not exist. ${GEMINI_KEY}` }
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const configResponse = await worker.fetch(request(`/api/report-authoring/config?caseId=${CASE_ID}`, STAFF_TOKEN), env);
  const config = await configResponse.json() as { chapters: Array<{ id: string }> };
  const generated = await worker.fetch(request('/api/report-authoring/generate', STAFF_TOKEN, { method: 'POST', body: JSON.stringify({ caseId: CASE_ID, chapterId: config.chapters[0].id, expectedDraftVersion: 0 }) }), env);
  const text = await generated.text();
  assert.equal(generated.status, 502);
  assert.doesNotMatch(text, new RegExp(GEMINI_KEY, 'u'));
  const body = JSON.parse(text) as { code: string; providerReason: string };
  assert.deepEqual([body.code, body.providerReason], ['GEMINI_MODEL_NOT_AVAILABLE','MODEL_NOT_AVAILABLE']);
  sql.close();
});

test('CF19 maps provider location failures without exposing the raw message', async () => {
  const { sql, env } = await setup();
  env.GEMINI_TEST_FETCH = async () => new Response(JSON.stringify({
    error: { code: 'invalid_request', message: `This API is not available in your current location. ${GEMINI_KEY}` }
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const configResponse = await worker.fetch(request(`/api/report-authoring/config?caseId=${CASE_ID}`, STAFF_TOKEN), env);
  const config = await configResponse.json() as { chapters: Array<{ id: string }> };
  const generated = await worker.fetch(request('/api/report-authoring/generate', STAFF_TOKEN, { method: 'POST', body: JSON.stringify({ caseId: CASE_ID, chapterId: config.chapters[0].id, expectedDraftVersion: 0 }) }), env);
  const text = await generated.text();
  assert.doesNotMatch(text, new RegExp(GEMINI_KEY, 'u'));
  assert.doesNotMatch(text, /This API is not available/u);
  const body = JSON.parse(text) as { code: string; providerReason: string };
  assert.deepEqual([body.code, body.providerReason], ['GEMINI_REGION_UNAVAILABLE','REGION_UNAVAILABLE']);
  sql.close();
});

test('CF19 Admin can switch each role to an allowed provider/model with optimistic history', async () => {
  const { sql, env } = await setup();
  const update = await worker.fetch(request('/api/admin/report-prompts/settings', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ taskKind: 'CHAPTER_WRITING', providerKind: 'ANTHROPIC', modelCode: 'claude-sonnet-5', reasoningEffort: 'medium', expectedVersion: 1 }) }), env);
  assert.equal(update.status, 200); const body = await update.json() as { settings: { providerKind: string; modelCode: string; version: number; apiKeyConfigured: boolean } };
  assert.deepEqual([body.settings.providerKind, body.settings.modelCode, body.settings.version, body.settings.apiKeyConfigured], ['ANTHROPIC','claude-sonnet-5',2,false]);
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_report_ai_route_history')[0].values[0][0], 1);
  const geminiUpdate = await worker.fetch(request('/api/admin/report-prompts/settings', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ taskKind: 'FACT_CHECK', providerKind: 'GEMINI', modelCode: 'gemini-3.7-flash', reasoningEffort: 'medium', expectedVersion: 1 }) }), env);
  assert.equal(geminiUpdate.status, 200); assert.equal(sql.exec("SELECT model_code FROM preview_report_ai_routes WHERE task_kind='FACT_CHECK'")[0].values[0][0], 'gemini-3.7-flash');
  const stale = await worker.fetch(request('/api/admin/report-prompts/settings', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ taskKind: 'CHAPTER_WRITING', providerKind: 'GEMINI', modelCode: 'gemini-3.5-flash', reasoningEffort: 'high', expectedVersion: 1 }) }), env); assert.equal(stale.status, 409);
  const mismatch = await worker.fetch(request('/api/admin/report-prompts/settings', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ taskKind: 'FACT_CHECK', providerKind: 'ANTHROPIC', modelCode: 'gemini-3.6-flash', reasoningEffort: 'medium', expectedVersion: 1 }) }), env); assert.equal(mismatch.status, 400);
  sql.close();
});

test('CF19 UI presents role routing without browser-side API key input', () => {
  const adminUi = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'routes', 'PreviewAiAdmin.tsx'), 'utf8');
  assert.match(adminUi, /목차 기획/u); assert.match(adminUi, /챕터 본문 작성/u); assert.match(adminUi, /사실·근거 확인/u);
  assert.match(adminUi, /OpenAI · ChatGPT|providerKind/u); assert.match(adminUi, /키 값 비공개/u);
  assert.doesNotMatch(adminUi, /type=["']password["']|API Key 입력/u);
});
