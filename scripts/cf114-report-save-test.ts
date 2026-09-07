import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN = '11400000-0000-4000-8000-000000000001';
const REVIEWER = '11400000-0000-4000-8000-000000000002';
const OTHER_REVIEWER = '11400000-0000-4000-8000-000000000003';
const ADMIN_TOKEN = 'cf114-local-admin';
const REVIEWER_TOKEN = 'cf114-local-reviewer';
const OTHER_REVIEWER_TOKEN = 'cf114-local-other-reviewer';
const TITLE = '공사비 검토 보고서';
const CONTENT = '검수한 본문 123,456원';
const DOCUMENT = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'left' }, content: [{ type: 'text', text: CONTENT }] }] };
const migration = (name: string) => readFileSync(new URL(`../apps/cloudflare/migrations/${name}`, import.meta.url), 'utf8');

class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: Database, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>(): Promise<T | null> {
    const statement = this.db.prepare(this.sql);
    try { statement.bind(this.values as any[]); return statement.step() ? statement.getAsObject() as T : null; }
    finally { statement.free(); }
  }
  async all<T>(): Promise<{ results: T[] }> {
    const statement = this.db.prepare(this.sql), results: T[] = [];
    try { statement.bind(this.values as any[]); while (statement.step()) results.push(statement.getAsObject() as T); return { results }; }
    finally { statement.free(); }
  }
  async run() {
    this.db.run(this.sql, this.values as any[]);
    return { success: true, meta: { changes: this.db.getRowsModified(), last_row_id: Number(this.db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0) } };
  }
}
class D1 {
  constructor(readonly db: Database) {}
  prepare(sql: string) { return new Statement(this.db, sql); }
  async batch(statements: Statement[]) {
    this.db.run('BEGIN IMMEDIATE');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.db.run('COMMIT'); return results; }
    catch (error) { this.db.run('ROLLBACK'); throw error; }
  }
}

const request = (path: string, token = ADMIN_TOKEN, init: RequestInit = {}) => {
  const headers = new Headers(init.headers); headers.set('X-Session-Token', token);
  if (init.body) headers.set('Content-Type', 'application/json');
  return new Request(`https://preview.example${path}`, { ...init, headers });
};
async function json(response: Response, expectedStatus = 200): Promise<any> {
  const body = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(body));
  return body;
}
const snapshot = (db: Database) => Object.fromEntries([
  'preview_report_drafts', 'preview_report_revisions', 'preview_report_reviews',
  'preview_report_review_events', 'preview_report_finalizations', 'preview_report_output_events'
].map(table => [table, db.exec(`SELECT * FROM ${table} ORDER BY rowid`)]));

async function fixture() {
  const SQL = await initSqlJs(), db = new SQL.Database();
  db.run('PRAGMA foreign_keys=ON');
  for (const name of [
    '0001_cf_foundation.sql', '0001_cf02_preview_drafts.sql', '0002_cf03_preview_evidence.sql',
    '0003_cf04_preview_auth.sql', '0004_cf05_google_drive.sql', '0005_cf06_case_operations.sql',
    '0006_cf07_report_studio_drafts.sql', '0007_cf08_report_review_approval.sql',
    '0008_cf09_final_output.sql', '0009_cf09_output_actor_scope.sql',
    '0029_cf37_report_workspace_resume.sql', '0043_cf60_structured_document_editor.sql'
  ]) db.exec(migration(name));
  const now = new Date().toISOString();
  for (const [id, login, roles, token] of [[ADMIN, 'admin', '["admin"]', ADMIN_TOKEN], [REVIEWER, 'reviewer', '["reviewer"]', REVIEWER_TOKEN], [OTHER_REVIEWER, 'other-reviewer', '["reviewer"]', OTHER_REVIEWER_TOKEN]]) {
    db.run('INSERT INTO preview_users VALUES (?,?,?,?,?,?,?,?,1,?)', [id, login, '1'.repeat(32), '2'.repeat(64), 100000, login, `${login}@example.invalid`, roles, now]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    db.run('INSERT INTO preview_sessions VALUES (?,?,?,?)', [hash, id, now, new Date(Date.now() + 3_600_000).toISOString()]);
  }
  const env: CloudflareEnv = { DB: new D1(db) as unknown as NonNullable<CloudflareEnv['DB']> };
  const created = await json(await worker.fetch(request('/api/cases', ADMIN_TOKEN, {
    method: 'POST', headers: { 'Idempotency-Key': 'cf114-local-case-create' },
    body: JSON.stringify({ title: '승인 버전 보존 검증', claimType: 'TYPE-02', description: '합성 테스트', category: { major: '보고서', middle: '검수', minor: '저장' } })
  }), env), 201);
  const caseId = created.case.id as string;
  db.run('INSERT INTO preview_case_assignments VALUES (?,?,?,?)', [caseId, REVIEWER, ADMIN, now]);
  const put = (body: Record<string, unknown>) => worker.fetch(request(`/api/report-drafts?caseId=${caseId}`, ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify(body) }), env);
  const initial = { title: TITLE, content: CONTENT, editorJson: DOCUMENT, expectedVersion: 0, wizardStep: 4, selectedChapterId: 'chapter-one', saveKind: 'MANUAL' };
  assert.equal((await json(await put(initial))).draft.version, 1);
  const submitted = await json(await worker.fetch(request('/api/report-reviews', ADMIN_TOKEN, {
    method: 'POST', headers: { 'Idempotency-Key': 'cf114-local-review' }, body: JSON.stringify({ caseId, expectedVersion: 1, note: '독립 검수' })
  }), env), 201);
  const reviewId = submitted.reviews[0].id as string;
  await json(await worker.fetch(request(`/api/report-reviews/${reviewId}/decision`, REVIEWER_TOKEN, {
    method: 'POST', body: JSON.stringify({ decision: 'APPROVED', note: '본문 검수 완료', expectedStatus: 'PENDING' })
  }), env));
  const finalized = await json(await worker.fetch(request('/api/report-finalizations', ADMIN_TOKEN, {
    method: 'POST', headers: { 'Idempotency-Key': 'cf114-local-finalization' }, body: JSON.stringify({ caseId, reviewId })
  }), env), 201);
  return { db, env, caseId, put, initial, reviewId, finalizationId: finalized.finalizations[0].id as string };
}

test('CF114 migration preserves an existing approved report and permits only metadata updates without a new version', async () => {
  const { db, env, caseId, put, initial, reviewId, finalizationId } = await fixture();
  try {
    const before = snapshot(db);
    const fix = migration('0059_cf114_report_workspace_version_guard.sql');
    db.exec(fix); assert.deepEqual(snapshot(db), before);
    db.exec(fix); assert.deepEqual(snapshot(db), before, 'reapplying the trigger migration must not alter stored business records');
    assert.deepEqual(db.exec('PRAGMA integrity_check')[0].values, [['ok']]);
    assert.deepEqual(db.exec('PRAGMA foreign_key_check'), []);
    const identity = db.exec('SELECT title,content,editor_json,version,updated_by,updated_at FROM preview_report_drafts')[0].values;
    const history = snapshot(db);
    for (const [saveKind, wizardStep, selectedChapterId] of [['AUTO', 5, 'chapter-two'], ['NAVIGATION', 2, 'chapter-one'], ['MANUAL', 2, 'chapter-one']] as const) {
      const saved = await json(await put({ ...initial, expectedVersion: 1, saveKind, wizardStep, selectedChapterId }));
      assert.equal(saved.draft.version, 1, `${saveKind} must retain the approved content version`);
      assert.equal(saved.draft.wizardStep, wizardStep); assert.equal(saved.draft.selectedChapterId, selectedChapterId);
      assert.equal(saved.revisions.length, 1);
      assert.deepEqual(db.exec('SELECT title,content,editor_json,version,updated_by,updated_at FROM preview_report_drafts')[0].values, identity);
    }
    const after = snapshot(db);
    for (const table of Object.keys(history).filter(table => table !== 'preview_report_drafts')) assert.deepEqual(after[table], history[table], table);
    const review = (await json(await worker.fetch(request(`/api/report-reviews?caseId=${caseId}`), env))).reviews.find((item: any) => item.id === reviewId);
    assert.equal(review.status, 'APPROVED'); assert.equal(review.reportVersion, 1);
    const finalization = (await json(await worker.fetch(request(`/api/report-finalizations?caseId=${caseId}`), env))).finalizations.find((item: any) => item.id === finalizationId);
    assert.equal(finalization.reportVersion, 1); assert.equal(finalization.reviewId, reviewId);
    assert.throws(() => db.run('UPDATE preview_report_drafts SET content=? WHERE case_id=?', ['same-version tampering', caseId]), /optimistic version/u);
    assert.throws(() => db.run('UPDATE preview_report_drafts SET title=? WHERE case_id=?', ['same-version title tampering', caseId]), /optimistic version/u);
    assert.throws(() => db.run('UPDATE preview_report_drafts SET editor_json=? WHERE case_id=?', [JSON.stringify({ ...DOCUMENT, attrs: { reportHeader: { enabled: false, text: null } } }), caseId]), /optimistic version/u);
    assert.throws(() => db.run('UPDATE preview_report_drafts SET updated_by=? WHERE case_id=?', [REVIEWER, caseId]), /optimistic version/u);
  } finally { db.close(); }
});

test('CF114 actual text, formatting-only and title edits each create a new immutable report revision', async () => {
  const { db, put, initial } = await fixture();
  try {
    db.exec(migration('0059_cf114_report_workspace_version_guard.sql'));
    let payload = { ...initial, expectedVersion: 1, content: '검수한 본문 234,567원', editorJson: { ...DOCUMENT, content: [{ ...DOCUMENT.content[0], content: [{ type: 'text', text: '검수한 본문 234,567원' }] }] } };
    const text = await json(await put(payload)); assert.equal(text.draft.version, 2); assert.equal(text.revisions.length, 2);
    payload = { ...payload, expectedVersion: 2, editorJson: { ...payload.editorJson, content: [{ ...payload.editorJson.content[0], attrs: { textAlign: 'right' } }] } };
    const formatted = await json(await put(payload)); assert.equal(formatted.draft.version, 3); assert.equal(formatted.revisions.length, 3);
    assert.equal(formatted.draft.content, text.draft.content); assert.equal(formatted.draft.editorJson.content[0].attrs.textAlign, 'right');
    const titled = await json(await put({ ...payload, expectedVersion: 3, title: '수정된 보고서 제목' }));
    assert.equal(titled.draft.version, 4); assert.equal(titled.revisions.length, 4);
    assert.deepEqual(db.exec('SELECT report_version,status FROM preview_report_reviews')[0].values, [[1, 'APPROVED']], 'the historical approval remains attached only to version 1');
    assert.deepEqual(db.exec('SELECT version,content,editor_json FROM preview_report_revisions ORDER BY version')[0].values[0], [1, CONTENT, JSON.stringify(DOCUMENT)]);
  } finally { db.close(); }
});

test('CF114 stale expectedVersion returns 409 even for an otherwise identical metadata-only save', async () => {
  const { db, put, initial } = await fixture();
  try {
    db.exec(migration('0059_cf114_report_workspace_version_guard.sql'));
    const before = snapshot(db);
    for (const expectedVersion of [0, 2]) {
      const body = await json(await put({ ...initial, expectedVersion, wizardStep: 5, selectedChapterId: 'chapter-two' }), 409);
      assert.equal(body.code, 'VERSION_CONFLICT'); assert.equal(body.currentVersion, 1);
      assert.deepEqual(snapshot(db), before, 'a stale save must not change report position, revision or approval');
    }
  } finally { db.close(); }
});

test('CF114 final document reads the immutable approved revision and rejects unauthenticated or other-case readers', async () => {
  const { db, env, put, initial, finalizationId } = await fixture();
  try {
    db.exec(migration('0059_cf114_report_workspace_version_guard.sql'));
    const path = `/api/report-finalizations/${finalizationId}/document`;
    const approved = (await json(await worker.fetch(request(path), env))).document;
    assert.equal(approved.title, TITLE); assert.equal(approved.content, CONTENT);
    assert.equal(approved.version, 1); assert.deepEqual(approved.editorJson, DOCUMENT);
    assert.deepEqual((await json(await worker.fetch(request(path, REVIEWER_TOKEN), env))).document, approved);

    const other = await json(await worker.fetch(request('/api/cases', ADMIN_TOKEN, {
      method: 'POST', headers: { 'Idempotency-Key': 'cf114-local-other-case' },
      body: JSON.stringify({ title: '다른 프로젝트', claimType: 'TYPE-02', description: '접근 격리 검증', category: { major: '보고서', middle: '검수', minor: '권한' } })
    }), env), 201);
    db.run('INSERT INTO preview_case_assignments VALUES (?,?,?,?)', [other.case.id, OTHER_REVIEWER, ADMIN, new Date().toISOString()]);
    await json(await worker.fetch(request(`/api/report-finalizations?caseId=${other.case.id}`, OTHER_REVIEWER_TOKEN), env));
    await json(await worker.fetch(request(path, OTHER_REVIEWER_TOKEN), env), 404);
    await json(await worker.fetch(new Request(`https://preview.example${path}`), env), 401);
    await json(await worker.fetch(request('/api/report-finalizations/11400000-0000-4000-8000-000000000099/document'), env), 404);

    const modified = await json(await put({ ...initial, expectedVersion: 1, title: '승인 이후 수정 중인 제목', content: '승인되지 않은 후속 본문', editorJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '승인되지 않은 후속 본문', marks: [{ type: 'underline' }] }] }] } }));
    assert.equal(modified.draft.version, 2);
    const beforeRead = snapshot(db);
    assert.deepEqual((await json(await worker.fetch(request(path), env))).document, approved, 'finalized output must not read the newer draft title, text or editor formatting');
    assert.deepEqual(snapshot(db), beforeRead, 'reading an approved document must not modify revisions, reviews or output records');
  } finally { db.close(); }
});
