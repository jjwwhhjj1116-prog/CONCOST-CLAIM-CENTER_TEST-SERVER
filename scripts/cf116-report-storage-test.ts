import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN = '11600000-0000-4000-8000-000000000001';
const TOKEN = 'cf116-local-storage-admin';
const migrationRoot = new URL('../apps/cloudflare/migrations/', import.meta.url);
const textDocument = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const emptyDraft = { title: 'CF116 신규 합성 보고서', content: '', editorJson: { type: 'doc', attrs: { reportHeader: { enabled: true, text: null } } }, expectedVersion: 0, wizardStep: 1, selectedChapterId: 'PROMPT-TYPE-01-CH-01', saveKind: 'NAVIGATION' };

// The same SQLite-backed transactional D1 contract used by the existing Worker tests.
class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: Database, readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>(): Promise<T | null> {
    const statement = this.db.prepare(this.sql);
    try { statement.bind(this.values as never[]); return statement.step() ? statement.getAsObject() as T : null; }
    finally { statement.free(); }
  }
  async all<T>(): Promise<{ results: T[] }> {
    const statement = this.db.prepare(this.sql), results: T[] = [];
    try { statement.bind(this.values as never[]); while (statement.step()) results.push(statement.getAsObject() as T); return { results }; }
    finally { statement.free(); }
  }
  async run() {
    this.db.run(this.sql, this.values as never[]);
    return { success: true, meta: { changes: this.db.getRowsModified(), last_row_id: Number(this.db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0) } };
  }
}
class D1 {
  beforeBatch: ((statements: Statement[]) => Promise<void>) | undefined;
  constructor(readonly db: Database) {}
  prepare(sql: string) { return new Statement(this.db, sql); }
  async batch(statements: Statement[]) {
    const hook = this.beforeBatch; this.beforeBatch = undefined;
    if (hook) await hook(statements);
    this.db.run('BEGIN IMMEDIATE');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.db.run('COMMIT'); return results; }
    catch (error) { this.db.run('ROLLBACK'); throw error; }
  }
}
const request = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers); headers.set('X-Session-Token', TOKEN);
  if (init.body) headers.set('Content-Type', 'application/json');
  return new Request(`https://preview.example${path}`, { ...init, headers });
};
async function json(response: Response, expectedStatus = 200): Promise<any> {
  const body = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(body));
  return body;
}
const snapshot = (db: Database) => Object.fromEntries([
  'preview_report_drafts', 'preview_report_revisions', 'preview_report_hourly_backups', 'preview_case_activities'
].map(table => [table, db.exec(`SELECT * FROM ${table} ORDER BY rowid`)]));
const rows = (db: Database, table: string) => db.exec(`SELECT * FROM ${table}`)[0]?.values.length ?? 0;

async function fixture() {
  const SQL = await initSqlJs(), db = new SQL.Database(); db.run('PRAGMA foreign_keys=ON');
  const foundation = ['0001_cf_foundation.sql', '0001_cf02_preview_drafts.sql', '0002_cf03_preview_evidence.sql', '0003_cf04_preview_auth.sql'];
  const apply = (name: string) => db.exec(readFileSync(new URL(name, migrationRoot), 'utf8'));
  for (const name of foundation) apply(name);
  const now = new Date().toISOString();
  db.run('INSERT INTO preview_users (id,login_id,password_salt,password_hash,password_iterations,display_name,email,roles_json,is_active,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)', [ADMIN, 'cf116@example.invalid', '1'.repeat(32), '2'.repeat(64), 100000, '합성 관리자', 'cf116@example.invalid', '["admin"]', now]);
  // Seed an administrator before migrations whose approved template rows reference one.
  for (const name of readdirSync(migrationRoot).filter(name => /^\d{4}_.+\.sql$/u.test(name) && Number(name.slice(0, 4)) <= 61 && !foundation.includes(name)).sort()) apply(name);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(TOKEN));
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  db.run('INSERT INTO preview_sessions (id_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)', [hash, ADMIN, now, new Date(Date.now() + 3_600_000).toISOString()]);
  const d1 = new D1(db), env: CloudflareEnv = { DB: d1 as unknown as NonNullable<CloudflareEnv['DB']> };
  const created = await json(await worker.fetch(request('/api/cases', {
    method: 'POST', headers: { 'Idempotency-Key': 'cf116-new-report-storage' },
    body: JSON.stringify({ title: '신규 보고서 저장 경로 검수', claimType: 'TYPE-01', description: '합성 데이터만 사용', clientName: '합성 발주처', clientLegalPosition: 'VICTIM', clientPositionDetail: '', category: { major: '보고서', middle: '저장', minor: '검수' } })
  }), env), 201);
  const caseId = created.case.id as string, path = `/api/report-drafts?caseId=${caseId}`;
  const put = (body: Record<string, unknown>) => worker.fetch(request(path, { method: 'PUT', body: JSON.stringify(body) }), env);
  const get = () => worker.fetch(request(path), env);
  assert.deepEqual(db.exec('PRAGMA foreign_key_check'), []);
  assert.equal((await json(await get())).draft, null);
  assert.equal(rows(db, 'preview_report_hourly_backups'), 0);
  return { db, d1, env, caseId, put, get };
}

test('CF116 empty report first save includes hourly backup, retains version on step 1→2, and resumes from persisted step', async () => {
  const { db, put, get, env, caseId } = await fixture();
  try {
    const initial = await json(await put(emptyDraft));
    assert.equal(initial.draft.content, ''); assert.equal(initial.draft.version, 1); assert.equal(initial.draft.wizardStep, 1);
    assert.deepEqual(initial.draft.editorJson, emptyDraft.editorJson);
    assert.equal(initial.revisions.length, 1); assert.equal(initial.backups.length, 1);
    assert.equal(initial.backups[0].content, ''); assert.deepEqual(initial.backups[0].editorJson, emptyDraft.editorJson);
    assert.match(initial.backups[0].backupHour, /^\d{4}-\d{2}-\d{2}T\d{2}$/u);
    assert.equal(initial.backups[0].contentSha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const moved = await json(await put({ ...emptyDraft, expectedVersion: 1, wizardStep: 2 }));
    assert.equal(moved.draft.wizardStep, 2); assert.equal(moved.draft.version, 1);
    assert.deepEqual(moved.revisions, initial.revisions); assert.deepEqual(moved.backups, initial.backups);
    const resumed = await json(await get());
    assert.deepEqual(resumed, moved);
    const workspace = (await json(await worker.fetch(request('/api/report-workspaces'), env))).workspaces.find((record: any) => record.caseId === caseId);
    assert.equal(workspace.wizardStep, 2); assert.equal(workspace.version, 1);
    assert.equal(rows(db, 'preview_report_drafts'), 1); assert.equal(rows(db, 'preview_report_revisions'), 1); assert.equal(rows(db, 'preview_report_hourly_backups'), 1);
    assert.deepEqual(db.exec('PRAGMA integrity_check')[0].values, [['ok']]);
    assert.deepEqual(db.exec('PRAGMA foreign_key_check'), []);
  } finally { db.close(); }
});

test('CF116 late backup constraint failure returns 503, rolls back all initial writes and succeeds on explicit version-0 retry', async t => {
  const { db, put, get } = await fixture();
  const logs: unknown[] = []; t.mock.method(console, 'error', (...values: unknown[]) => { logs.push(...values); });
  try {
    const before = snapshot(db);
    // RAISE(ABORT) still aborts INSERT OR IGNORE, and fires after draft/revision/activity.
    db.exec("CREATE TRIGGER cf116_test_backup_failure BEFORE INSERT ON preview_report_hourly_backups BEGIN SELECT RAISE(ABORT,'CF116 constraint synthetic private source details'); END;");
    const body = { ...emptyDraft, content: '아직 저장되지 않은 합성 원문', editorJson: textDocument('아직 저장되지 않은 합성 원문') };
    const failed = await json(await put(body), 503);
    assert.equal(failed.code, 'REPORT_STORAGE_FAILED'); assert.equal(failed.currentVersion, undefined);
    assert.deepEqual(snapshot(db), before, 'failed final statement must roll back draft, revision, activity and backup together');
    assert.equal((await json(await get())).draft, null);
    assert.deepEqual(logs.map(value => JSON.parse(String(value))), [{ event: 'REPORT_INITIAL_SAVE_FAILED', category: 'CONSTRAINT', stage:'BATCH_EXECUTE',errorName:'Error',diagnostic:'UNCLASSIFIED' }], 'logs must not contain raw SQL, names, credentials or document content');
    db.exec('DROP TRIGGER cf116_test_backup_failure');
    const saved = await json(await put(body));
    assert.equal(saved.draft.version, 1); assert.equal(saved.draft.content, body.content);
    assert.deepEqual(saved.draft.editorJson, body.editorJson);
    assert.equal(saved.revisions.length, 1); assert.equal(saved.backups.length, 1);
    assert.equal(saved.backups[0].content, body.content);
    assert.deepEqual(db.exec('PRAGMA foreign_key_check'), []);
  } finally { db.close(); }
});

test('CF116 incompatible backup storage is not mislabeled as a version conflict and is recoverable after repair', async t => {
  const { db, put, get } = await fixture();
  const logs: unknown[] = []; t.mock.method(console, 'error', (...values: unknown[]) => { logs.push(...values); });
  try {
    const before = snapshot(db);
    // The capability probe sees id, but the actual batch detects an incomplete schema.
    db.exec('ALTER TABLE preview_report_hourly_backups RENAME COLUMN editor_json TO cf116_missing_editor_json');
    const failed = await json(await put({ ...emptyDraft, editorJson: null }), 503);
    assert.equal(failed.code, 'REPORT_STORAGE_FAILED'); assert.equal(failed.currentVersion, undefined);
    assert.equal((await json(await get())).draft, null);
    assert.equal(rows(db, 'preview_report_revisions'), 0); assert.equal(rows(db, 'preview_report_hourly_backups'), 0);
    assert.deepEqual(logs.map(value => JSON.parse(String(value))), [{ event: 'REPORT_INITIAL_SAVE_FAILED', category: 'STORAGE',stage:'BATCH_EXECUTE',errorName:'Error',diagnostic:'has no column named' }]);
    db.exec('ALTER TABLE preview_report_hourly_backups RENAME COLUMN cf116_missing_editor_json TO editor_json');
    assert.deepEqual(snapshot(db), before);
    const retry = await json(await put({ ...emptyDraft, editorJson: null }));
    assert.equal(retry.draft.version, 1); assert.equal(retry.draft.editorJson, null); assert.equal(retry.backups.length, 1); assert.equal(retry.backups[0].editorJson, null);
  } finally { db.close(); }
});

test('CF116 real interleaved first-save race returns 409 and retains the winning report before a version-aware retry', async t => {
  const { db, d1, put, get } = await fixture();
  const logs: unknown[] = []; t.mock.method(console, 'error', (...values: unknown[]) => { logs.push(...values); });
  try {
    const winner = { ...emptyDraft, title: '먼저 저장한 보고서', content: '먼저 확정된 합성 원문', editorJson: textDocument('먼저 확정된 합성 원문') };
    let winnerSnapshot: ReturnType<typeof snapshot> | undefined;
    d1.beforeBatch = async statements => {
      assert.match(statements[0].sql, /^INSERT INTO preview_report_drafts/u);
      const saved = await json(await put(winner));
      assert.equal(saved.draft.version, 1);
      winnerSnapshot = snapshot(db);
    };
    const losing = { ...emptyDraft, title: '뒤늦게 저장한 보고서', content: '덮어쓰면 안 되는 후발 요청', editorJson: textDocument('덮어쓰면 안 되는 후발 요청') };
    const conflict = await json(await put(losing), 409);
    assert.equal(conflict.code, 'VERSION_CONFLICT'); assert.equal(conflict.currentVersion, 1);
    assert.deepEqual(snapshot(db), winnerSnapshot, 'losing batch rollback must leave all committed winner rows unchanged');
    assert.deepEqual(logs, [], 'an actual optimistic conflict is not a storage-failure event');
    const canonical = await json(await get());
    assert.equal(canonical.draft.title, winner.title); assert.equal(canonical.draft.content, winner.content); assert.equal(canonical.backups.length, 1);
    const stale = await json(await put(losing), 409);
    assert.equal(stale.code, 'VERSION_CONFLICT'); assert.deepEqual(snapshot(db), winnerSnapshot);
    const retried = await json(await put({ ...losing, expectedVersion: canonical.draft.version, saveKind: 'MANUAL' }));
    assert.equal(retried.draft.version, 2); assert.equal(retried.draft.content, losing.content); assert.equal(retried.revisions.length, 2);
    assert.equal(retried.revisions.find((revision: any) => revision.version === 1).content, winner.content);
    assert.equal(retried.backups.length, 1, 'same-hour retries retain the first immutable recovery snapshot');
    assert.equal(retried.backups[0].content, winner.content);
    assert.deepEqual(db.exec('PRAGMA foreign_key_check'), []);
  } finally { db.close(); }
});
