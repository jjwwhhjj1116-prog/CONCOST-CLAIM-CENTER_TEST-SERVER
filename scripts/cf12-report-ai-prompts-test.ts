import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const STAFF_ID = '00000000-0000-4000-8000-000000000002';
const OUTSIDER_ID = '00000000-0000-4000-8000-000000000003';
const CASE_ID = '40000000-0000-4000-8000-000000000010';
const ADMIN_TOKEN = 'cf12-admin-session-token';
const STAFF_TOKEN = 'cf12-staff-session-token';
const OUTSIDER_TOKEN = 'cf12-outsider-session-token';

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
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

async function setup(): Promise<{ sql: Database; env: CloudflareEnv; providerRequests: Array<Record<string, unknown>> }> {
  const SQL = await initSqlJs(); const sql = new SQL.Database(); sql.run('PRAGMA foreign_keys = ON');
  for (const name of ['0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql','0004_cf05_google_drive.sql','0005_cf06_case_operations.sql']) sql.exec(migration(name));
  const now = new Date().toISOString();
  const insertUser = (id: string, login: string, roles: string) => sql.run('INSERT INTO preview_users VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)', [id, login, '1'.repeat(32), '2'.repeat(64), 100000, login, `${login}@example.invalid`, roles, now]);
  insertUser(ADMIN_ID, 'admin', '["admin"]');
  sql.exec(migration('0010_cf10_product_experience.sql'));
  insertUser(STAFF_ID, 'staff', '["staff"]'); insertUser(OUTSIDER_ID, 'outsider', '["staff"]');
  sql.exec(migration('0006_cf07_report_studio_drafts.sql')); sql.exec(migration('0007_cf08_report_review_approval.sql')); sql.exec(migration('0008_cf09_final_output.sql')); sql.exec(migration('0009_cf09_output_actor_scope.sql')); sql.exec(migration('0011_cf11_project_workflow.sql')); sql.exec(migration('0012_cf12_report_ai_prompts.sql'));
  sql.run('INSERT INTO preview_case_assignments VALUES (?, ?, ?, ?)', [CASE_ID, STAFF_ID, ADMIN_ID, now]);
  for (const [token, id] of [[ADMIN_TOKEN, ADMIN_ID],[STAFF_TOKEN, STAFF_ID],[OUTSIDER_TOKEN, OUTSIDER_ID]] as const) sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(token), id, now, new Date(Date.now() + 3_600_000).toISOString()]);
  const providerRequests: Array<Record<string, unknown>> = [];
  const openAiFetch: typeof fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer SYNTHETIC_SERVER_ONLY_KEY');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>; providerRequests.push(body);
    assert.equal(body.model, 'gpt-5.6'); assert.equal('apiKey' in body, false);
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '## 검토 목적\n\n확인된 내부 사건 자료를 기준으로 작성한 장별 초안입니다. [근거: kickoffRecord / v1]' }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { sql, providerRequests, env: { DB: new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']>, OPENAI_API_KEY: 'SYNTHETIC_SERVER_ONLY_KEY', OPENAI_TEST_FETCH: openAiFetch } };
}
function request(path: string, token: string, init: RequestInit = {}): Request { const headers = new Headers(init.headers); headers.set('X-Session-Token', token); if (init.body) headers.set('Content-Type', 'application/json'); return new Request(`https://preview.example${path}`, { ...init, headers }); }

test('CF12 makes prompt bodies Admin-only and preserves optimistic prompt history', async () => {
  const { sql, env } = await setup();
  const admin = await worker.fetch(request('/api/admin/report-prompts', ADMIN_TOKEN), env); assert.equal(admin.status, 200);
  const body = await admin.json() as { settings: { modelCode: string; apiKeyConfigured: boolean }; promptSets: Array<{ claimType: string; status: string; chapters: Array<{ chapterCode: string; version: number; rolePrompt: string; instructionPrompt: string }> }> };
  assert.equal(body.settings.modelCode, 'gpt-5.6'); assert.equal(body.settings.apiKeyConfigured, true);
  assert.equal(body.promptSets.find((entry) => entry.claimType === 'TYPE-05')?.status, 'TEMPLATE_NOT_FOUND');
  assert.equal(body.promptSets.reduce((total, entry) => total + entry.chapters.length, 0), 32);
  assert.equal((await worker.fetch(request('/api/admin/report-prompts', STAFF_TOKEN), env)).status, 403);

  const chapter = body.promptSets[0].chapters[0];
  const updated = await worker.fetch(request(`/api/admin/report-prompts/TYPE-01/${chapter.chapterCode}`, ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ rolePrompt: `${chapter.rolePrompt} 관리자 검증 역할을 추가합니다.`, instructionPrompt: `${chapter.instructionPrompt} 검토 질문을 마지막에 표시합니다.`, expectedVersion: chapter.version }) }), env);
  assert.equal(updated.status, 200); assert.equal(sql.exec('SELECT COUNT(*) FROM preview_report_prompt_history')[0].values[0][0], 1);
  assert.throws(() => sql.run('UPDATE preview_report_chapter_prompts SET role_prompt=?, version=version+1, updated_by=?, updated_at=? WHERE id=?', ['권한 없는 변경을 시도하는 충분히 긴 역할 프롬프트입니다.', STAFF_ID, new Date(Date.now() + 10_000).toISOString(), 'PROMPT-TYPE-01-CH-01']), /Admin/u);
  sql.close();
});

test('CF12 writers receive chapter metadata only and generate from server-held latest model configuration', async () => {
  const { sql, env, providerRequests } = await setup();
  const configResponse = await worker.fetch(request(`/api/report-authoring/config?caseId=${CASE_ID}`, STAFF_TOKEN), env); assert.equal(configResponse.status, 200);
  const configText = await configResponse.text(); assert.doesNotMatch(configText, /rolePrompt|instructionPrompt|systemPrompt|OPENAI_API_KEY|SYNTHETIC_SERVER_ONLY_KEY/u);
  const config = JSON.parse(configText) as { available: boolean; aiConnected: boolean; modelLabel: string; chapters: Array<{ id: string }> };
  assert.equal(config.available, true); assert.equal(config.aiConnected, true); assert.equal(config.modelLabel, 'gpt-5.6');
  assert.equal((await worker.fetch(request(`/api/report-authoring/config?caseId=${CASE_ID}`, OUTSIDER_TOKEN), env)).status, 404);

  const generated = await worker.fetch(request('/api/report-authoring/generate', ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ caseId: CASE_ID, chapterId: config.chapters[0].id, expectedDraftVersion: 0 }) }), env);
  assert.equal(generated.status, 200);
  const generatedText = await generated.text(); assert.match(generatedText, /장별 초안/u); assert.doesNotMatch(generatedText, /SYNTHETIC_SERVER_ONLY_KEY/u);
  assert.equal(providerRequests.length, 1); assert.equal(sql.exec('SELECT COUNT(*) FROM preview_report_ai_generations')[0].values[0][0], 1);
  const studio = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'routes', 'PreviewReportStudio.tsx'), 'utf8');
  assert.match(studio, /챕터별 자동작성\(권장\)/u); assert.match(studio, /전체 한 번에 작성/u); assert.match(studio, /프롬프트 원문은 관리자만/u);

  const noKeyEnv = { ...env, OPENAI_API_KEY: undefined };
  const disconnected = await worker.fetch(request('/api/report-authoring/generate', ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ caseId: CASE_ID, chapterId: config.chapters[0].id, expectedDraftVersion: 0 }) }), noKeyEnv);
  assert.equal(disconnected.status, 503); assert.equal(providerRequests.length, 1);
  sql.close();
});
