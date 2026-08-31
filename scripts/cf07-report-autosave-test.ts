import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN_ID = '10000000-0000-4000-8000-000000000001';
const REVIEWER_ID = '10000000-0000-4000-8000-000000000002';
const ADMIN_TOKEN = 'cf07-admin-session-token';
const REVIEWER_TOKEN = 'cf07-reviewer-session-token';

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
    try {
      const results: unknown[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.run('COMMIT');
      return results;
    } catch (error) { this.database.run('ROLLBACK'); throw error; }
  }
}

async function databaseFixture(): Promise<{ sql: Database; env: CloudflareEnv }> {
  const SQL = await initSqlJs();
  const sql = new SQL.Database();
  sql.run('PRAGMA foreign_keys = ON');
  const migration = (name: string) => readFileSync(join(process.cwd(), 'apps', 'cloudflare', 'migrations', name), 'utf8');
  for (const name of [
    '0001_cf_foundation.sql', '0001_cf02_preview_drafts.sql', '0002_cf03_preview_evidence.sql',
    '0003_cf04_preview_auth.sql', '0004_cf05_google_drive.sql', '0005_cf06_case_operations.sql',
    '0006_cf07_report_studio_drafts.sql', '0029_cf37_report_workspace_resume.sql', '0030_cf38_admin_account_management.sql'
  ]) sql.exec(migration(name));
  const now = new Date().toISOString();
  const addUser = (id: string, login: string, roles: string) => sql.run('INSERT INTO preview_users (id,login_id,password_salt,password_hash,password_iterations,display_name,email,roles_json,is_active,created_at,version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1)', [id, login, '1'.repeat(32), '2'.repeat(64), 100000, login, `${login}@example.invalid`, roles, now]);
  addUser(ADMIN_ID, 'admin', '["admin"]');
  addUser(REVIEWER_ID, 'reviewer', '["reviewer"]');
  sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(ADMIN_TOKEN), ADMIN_ID, now, new Date(Date.now() + 3_600_000).toISOString()]);
  sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(REVIEWER_TOKEN), REVIEWER_ID, now, new Date(Date.now() + 3_600_000).toISOString()]);
  return { sql, env: { DB: new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']> } };
}

function request(path: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('X-Session-Token', token);
  if (init.body) headers.set('Content-Type', 'application/json');
  return new Request(`https://preview.example${path}`, { ...init, headers });
}

async function createCase(env: CloudflareEnv): Promise<string> {
  const response = await worker.fetch(request('/api/cases', ADMIN_TOKEN, {
    method: 'POST', headers: { 'Idempotency-Key': 'cf07-report-case-key' },
    body: JSON.stringify({ title: '물가변동 검토 사건', claimType: 'TYPE-06', description: '보고서 자동 저장 검증', category: { major: '건설', middle: '물가변동', minor: '보고서' } })
  }), env);
  assert.equal(response.status, 201);
  return (await response.json() as { case: { id: string } }).case.id;
}

test('CF07 report body autosaves with optimistic versions and survives database restart', async () => {
  const { sql, env } = await databaseFixture();
  const caseId = await createCase(env);
  const empty = await worker.fetch(request(`/api/report-drafts?caseId=${caseId}`, ADMIN_TOKEN), env);
  assert.deepEqual(await empty.json() as { draft: null; revisions: unknown[] }, { draft: null, revisions: [], phase: 'CF07_D1_REPORT_AUTOSAVE' } as any);

  const first = await worker.fetch(request(`/api/report-drafts?caseId=${caseId}`, ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ title: '물가변동 검토 보고서', content: '1차 작성 본문', expectedVersion: 0 }) }), env);
  assert.equal(first.status, 200);
  assert.equal((await first.json() as { draft: ReportShape }).draft.version, 1);
  const second = await worker.fetch(request(`/api/report-drafts?caseId=${caseId}`, ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ title: '물가변동 검토 보고서', content: '2차 자동 저장 본문', expectedVersion: 1 }) }), env);
  const secondBody = await second.json() as { draft: ReportShape; revisions: unknown[] };
  assert.equal(second.status, 200);
  assert.equal(secondBody.draft.version, 2);
  assert.equal(secondBody.draft.content, '2차 자동 저장 본문');
  assert.equal(secondBody.revisions.length, 2);

  const stale = await worker.fetch(request(`/api/report-drafts?caseId=${caseId}`, ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ title: '오래된 탭', content: '덮어쓰기 시도', expectedVersion: 1 }) }), env);
  assert.equal(stale.status, 409);
  const SQL = await initSqlJs();
  const restarted = new SQL.Database(sql.export());
  assert.deepEqual(restarted.exec('SELECT version, content FROM preview_report_drafts')[0].values[0], [2, '2차 자동 저장 본문']);
  assert.equal(restarted.exec('SELECT count(*) FROM preview_report_revisions')[0].values[0][0], 2);
  restarted.close(); sql.close();
});

interface ReportShape { version: number; content: string }

test('CF37 saves wizard position and exposes assigned resumable report workspaces', async () => {
  const { sql, env } = await databaseFixture();
  const caseId = await createCase(env);
  const chapterId = '70000000-0000-4000-8000-000000000037';
  const saved = await worker.fetch(request(`/api/report-drafts?caseId=${caseId}`, ADMIN_TOKEN, {
    method: 'PUT',
    body: JSON.stringify({ title: '이어쓰기 보고서', content: '챕터 초안', expectedVersion: 0, wizardStep: 3, selectedChapterId: chapterId })
  }), env);
  assert.equal(saved.status, 200);
  const savedBody = await saved.json() as { draft: ReportShape & { wizardStep: number; selectedChapterId: string } };
  assert.equal(savedBody.draft.wizardStep, 3);
  assert.equal(savedBody.draft.selectedChapterId, chapterId);

  const listed = await worker.fetch(request('/api/report-workspaces', ADMIN_TOKEN), env);
  assert.equal(listed.status, 200);
  const listBody = await listed.json() as { workspaces: Array<{ caseId: string; wizardStep: number; reportTitle: string }> };
  assert.deepEqual(listBody.workspaces.map((entry) => [entry.caseId, entry.wizardStep, entry.reportTitle]), [[caseId, 3, '이어쓰기 보고서']]);

  const SQL = await initSqlJs();
  const restarted = new SQL.Database(sql.export());
  assert.deepEqual(restarted.exec('SELECT wizard_step, selected_chapter_id FROM preview_report_drafts')[0].values[0], [3, chapterId]);
  restarted.close(); sql.close();
});

test('CF07 Reviewer can read an assigned report but cannot save, and D1 history is immutable', async () => {
  const { sql, env } = await databaseFixture();
  const caseId = await createCase(env);
  await worker.fetch(request(`/api/report-drafts?caseId=${caseId}`, ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ title: '검토 보고서', content: '승인 전 원문', expectedVersion: 0 }) }), env);
  sql.run('INSERT INTO preview_case_assignments VALUES (?, ?, ?, ?)', [caseId, REVIEWER_ID, ADMIN_ID, new Date().toISOString()]);
  const readable = await worker.fetch(request(`/api/report-drafts?caseId=${caseId}`, REVIEWER_TOKEN), env);
  assert.equal(readable.status, 200);
  assert.equal((await readable.json() as { draft: ReportShape }).draft.content, '승인 전 원문');
  const forbidden = await worker.fetch(request(`/api/report-drafts?caseId=${caseId}`, REVIEWER_TOKEN, { method: 'PUT', body: JSON.stringify({ title: '변조', content: '변조', expectedVersion: 1 }) }), env);
  assert.equal(forbidden.status, 403);
  assert.throws(() => sql.run("UPDATE preview_report_drafts SET content='raw overwrite', updated_at=? WHERE case_id=?", [new Date(Date.now() + 1_000).toISOString(), caseId]), /optimistic version is invalid/u);
  assert.throws(() => sql.run("UPDATE preview_report_revisions SET content='raw overwrite' WHERE case_id=?", [caseId]), /append-only/u);
  assert.throws(() => sql.run('DELETE FROM preview_report_revisions WHERE case_id=?', [caseId]), /append-only/u);
  sql.close();
});

test('CF07 Report Studio exposes case selection, debounce autosave, manual save, and finished template access', () => {
  const component = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'routes', 'PreviewReportStudio.tsx'), 'utf8');
  const router = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'routes', 'Router.tsx'), 'utf8');
  assert.match(component, /window\.setTimeout\(\(\) => \{ void saveNow\('AUTO'\); \}, 3000\)/u);
  assert.match(component, /지금 저장/u);
  assert.match(component, /완제품 템플릿 열람/u);
  assert.match(component, /beforeunload/u);
  assert.match(component, /저장한 보고서 이어쓰기/u);
  assert.match(component, /저장하고 이동/u);
  assert.match(component, /registerNavigationBlocker/u);
  assert.match(router, /currentRoute\.id === 'REPO-02'.*PreviewReportStudio/u);
});

test('CF38 Admin approves, blocks, reactivates, and resets D1 login accounts', async () => {
  const { sql, env } = await databaseFixture();
  const created = await worker.fetch(request('/api/admin/users', ADMIN_TOKEN, {
    method: 'POST', body: JSON.stringify({ loginId: 'new.user@con-cost.com', displayName: '신규 사용자', email: 'new.user@con-cost.com', password: 'initial-pass', roles: ['staff'] })
  }), env);
  assert.equal(created.status, 201);
  const account = (await created.json() as { user: WorkspaceAccount }).user;
  assert.equal(account.version, 1);
  assert.equal((await worker.fetch(new Request('https://preview.example/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: account.loginId, password: 'initial-pass' }) }), env)).status, 200);

  const deactivated = await worker.fetch(request(`/api/admin/users/${account.id}`, ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ action: 'DEACTIVATE', expectedVersion: 1 }) }), env);
  assert.equal(deactivated.status, 200);
  assert.equal((await worker.fetch(new Request('https://preview.example/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: account.loginId, password: 'initial-pass' }) }), env)).status, 401);
  assert.equal((await worker.fetch(request(`/api/admin/users/${account.id}`, ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ action: 'ACTIVATE', expectedVersion: 2 }) }), env)).status, 200);
  assert.equal((await worker.fetch(request(`/api/admin/users/${account.id}`, ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ action: 'RESET_PASSWORD', expectedVersion: 3, password: 'replacement-pass' }) }), env)).status, 200);
  assert.equal((await worker.fetch(new Request('https://preview.example/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: account.loginId, password: 'replacement-pass' }) }), env)).status, 200);
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_user_admin_events')[0].values[0][0], 4);
  assert.throws(() => sql.run('DELETE FROM preview_users WHERE id=?', [account.id]), /deactivated/u);
  sql.close();
});

interface WorkspaceAccount { id: string; loginId: string; version: number }
