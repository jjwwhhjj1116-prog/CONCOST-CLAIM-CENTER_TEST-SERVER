import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN = '12200000-0000-4000-8000-000000000001';
const REVIEWER = '12200000-0000-4000-8000-000000000002';
const TOKEN = 'cf122-local-admin';
const REVIEWER_TOKEN = 'cf122-local-reviewer';
const migrationRoot = new URL('../apps/cloudflare/migrations/', import.meta.url);
const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '보존할 검수 본문 123,456원' }] }, { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '합성 수량 12' }] }] }] }] }, { type: 'image', attrs: { src: 'data:image/png;base64,c3ludGhldGlj', alt: '합성 이미지' } }] };
const draft = { title: 'CF122 삭제 검수 보고서', content: '보존할 검수 본문 123,456원', editorJson: document, expectedVersion: 0, wizardStep: 4, selectedChapterId: 'PROMPT-TYPE-01-CH-01', saveKind: 'MANUAL' };

// Same transactional SQLite-backed D1 contract as CF116; hooks interleave real API calls.
class Statement {
  private values: unknown[] = [];
  constructor(private readonly owner: D1, readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>(): Promise<T | null> {
    const statement = this.owner.db.prepare(this.sql);
    try { statement.bind(this.values as never[]); return statement.step() ? statement.getAsObject() as T : null; }
    finally { statement.free(); }
  }
  async all<T>(): Promise<{ results: T[] }> {
    const statement = this.owner.db.prepare(this.sql), results: T[] = [];
    try { statement.bind(this.values as never[]); while (statement.step()) results.push(statement.getAsObject() as T); return { results }; }
    finally { statement.free(); }
  }
  async run() {
    const hook = this.owner.beforeRun; this.owner.beforeRun = undefined;
    if (hook) await hook(this);
    this.owner.db.run(this.sql, this.values as never[]);
    return { success: true, meta: { changes: this.owner.db.getRowsModified(), last_row_id: Number(this.owner.db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0) } };
  }
}
class D1 {
  beforeRun: ((statement: Statement) => Promise<void>) | undefined;
  beforeBatch: ((statements: Statement[]) => Promise<void>) | undefined;
  constructor(readonly db: Database) {}
  prepare(sql: string) { return new Statement(this, sql); }
  async batch(statements: Statement[]) {
    const hook = this.beforeBatch; this.beforeBatch = undefined;
    if (hook) await hook(statements);
    this.db.run('BEGIN IMMEDIATE');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.db.run('COMMIT'); return results; }
    catch (error) { this.db.run('ROLLBACK'); throw error; }
  }
}
function request(path: string, init: RequestInit = {}, token: string | null = TOKEN) {
  const headers = new Headers(init.headers);
  if (token) headers.set('X-Session-Token', token);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (init.method && init.method !== 'GET' && !headers.has('Origin')) headers.set('Origin', 'https://preview.example');
  return new Request(`https://preview.example${path}`, { ...init, headers });
}
async function json(response: Response, expectedStatus = 200): Promise<any> {
  const body = await response.json(); assert.equal(response.status, expectedStatus, JSON.stringify(body)); return body;
}
const snapshot = (db: Database, includeActivity = false) => Object.fromEntries(
  (db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0]?.values ?? [])
    .map(([name]) => String(name)).filter(name => includeActivity || name !== 'preview_case_activities')
    .map(name => [name, db.exec(`SELECT * FROM "${name}" ORDER BY rowid`)]),
);
const markers = (db: Database) => db.exec("SELECT case_id,actor_id,event_type FROM preview_case_activities WHERE event_type='REPORT_WORKSPACE_DELETED' ORDER BY rowid")[0]?.values ?? [];

async function fixture() {
  const SQL = await initSqlJs(), db = new SQL.Database(); db.run('PRAGMA foreign_keys=ON');
  const foundation = ['0001_cf_foundation.sql', '0001_cf02_preview_drafts.sql', '0002_cf03_preview_evidence.sql', '0003_cf04_preview_auth.sql'];
  const apply = (name: string) => db.exec(readFileSync(new URL(name, migrationRoot), 'utf8'));
  for (const name of foundation) apply(name);
  const now = new Date().toISOString();
  for (const [id, name, roles, token] of [[ADMIN, '합성 관리자', '["admin"]', TOKEN], [REVIEWER, '합성 검수자', '["reviewer","director"]', REVIEWER_TOKEN]]) {
    db.run('INSERT INTO preview_users (id,login_id,password_salt,password_hash,password_iterations,display_name,email,roles_json,is_active,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)', [id, `${id}@example.invalid`, '1'.repeat(32), '2'.repeat(64), 100000, name, `${id}@example.invalid`, roles, now]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    db.run('INSERT INTO preview_sessions (id_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)', [hash, id, now, new Date(Date.now() + 3_600_000).toISOString()]);
  }
  for (const name of readdirSync(migrationRoot).filter(name => /^\d{4}_.+\.sql$/u.test(name) && Number(name.slice(0, 4)) <= 62 && !foundation.includes(name)).sort()) apply(name);
  const d1 = new D1(db), env: CloudflareEnv = { DB: d1 as unknown as NonNullable<CloudflareEnv['DB']> };
  const call = (path: string, init: RequestInit = {}, token: string | null = TOKEN) => worker.fetch(request(path, init, token), env);
  const create = async (suffix: string) => {
    const created = await json(await call('/api/cases', { method: 'POST', headers: { 'Idempotency-Key': `cf122-case-${suffix}` }, body: JSON.stringify({ title: `합성 프로젝트 ${suffix}`, claimType: 'TYPE-01', description: '외부 전송 없는 로컬 합성 검수', clientName: '합성 발주처', clientLegalPosition: 'VICTIM', clientPositionDetail: '', category: { major: '보고서', middle: '삭제', minor: '검수' } }) }), 201);
    const caseId = created.case.id as string;
    await json(await call(`/api/report-drafts?caseId=${caseId}`, { method: 'PUT', body: JSON.stringify({ ...draft, title: `${draft.title} ${suffix}` }) }));
    return caseId;
  };
  const caseId = await create('target'), otherId = await create('preserved');
  db.run('INSERT INTO preview_case_assignments VALUES (?,?,?,?)', [caseId, REVIEWER, ADMIN, now]);
  const submitted = await json(await call('/api/report-reviews', { method: 'POST', headers: { 'Idempotency-Key': 'cf122-review-before-delete' }, body: JSON.stringify({ caseId, expectedVersion: 1, note: '합성 독립 검수' }) }), 201);
  const reviewId = submitted.reviews[0].id as string;
  await json(await call(`/api/report-reviews/${reviewId}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVED', note: '검수 완료', expectedStatus: 'PENDING' }) }, REVIEWER_TOKEN));
  const finalization = await json(await call('/api/report-finalizations', { method: 'POST', headers: { 'Idempotency-Key': 'cf122-final-before-delete' }, body: JSON.stringify({ caseId, reviewId }) }), 201);
  const path = `/api/report-workspaces/${caseId}/delete`;
  const remove = (expectedVersion = 1, token: string | null = TOKEN) => call(path, { method: 'POST', body: JSON.stringify({ expectedVersion }) }, token);
  const put = (body: Record<string, unknown>) => call(`/api/report-drafts?caseId=${caseId}`, { method: 'PUT', body: JSON.stringify(body) });
  return { db, d1, call, caseId, otherId, path, remove, put, reviewId, finalizationId: finalization.finalizations[0].id as string };
}

test('CF122 delete is admin-only, same-origin JSON, and validates expected version without mutations', async () => {
  const { db, call, path, remove } = await fixture();
  try {
    const before = snapshot(db, true);
    await json(await remove(1, null), 401);
    await json(await remove(1, REVIEWER_TOKEN), 403);
    await json(await call(path, { method: 'POST', headers: { Origin: 'https://foreign.example' }, body: JSON.stringify({ expectedVersion: 1 }) }), 403);
    await json(await call(path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ expectedVersion: 1 }) }), 400);
    for (const body of [{}, { expectedVersion: -1 }, { expectedVersion: '1' }, { expectedVersion: 1, deleteFiles: true }]) {
      await json(await call(path, { method: 'POST', body: JSON.stringify(body) }), 400);
    }
    await json(await remove(2), 409);
    assert.deepEqual(snapshot(db, true), before);
    assert.equal((await json(await call('/api/report-workspaces'))).canDelete, true);
    assert.equal((await json(await call('/api/report-workspaces', {}, REVIEWER_TOKEN))).canDelete, false);
  } finally { db.close(); }
});

test('CF122 deleting removes only its active workspace, preserves all business records, and blocks stale saves/re-entry', async () => {
  const { db, call, caseId, otherId, remove, put } = await fixture();
  try {
    const before = snapshot(db), activities = db.exec('SELECT * FROM preview_case_activities ORDER BY rowid')[0]?.values ?? [];
    await json(await remove());
    assert.deepEqual(markers(db), [[caseId, ADMIN, 'REPORT_WORKSPACE_DELETED']]);
    assert.deepEqual(snapshot(db), before, 'draft, rich content, revisions, backups, approval, finalization, projects and settings must remain byte-for-byte intact');
    assert.deepEqual(db.exec('SELECT * FROM preview_case_activities ORDER BY rowid')[0]?.values.slice(0, activities.length), activities);
    const workspaces = (await json(await call('/api/report-workspaces'))).workspaces;
    assert.equal(workspaces.some((row: any) => row.caseId === caseId), false);
    assert.equal(workspaces.some((row: any) => row.caseId === otherId), true);
    assert.equal((await json(await call(`/api/report-drafts?caseId=${caseId}`), 410)).code, 'REPORT_DELETED');
    for (const expectedVersion of [0, 1]) assert.equal((await json(await put({ ...draft, expectedVersion, saveKind: 'AUTO' }), 410)).code, 'REPORT_DELETED');
    const repeated = await remove(); assert.ok([409, 410].includes(repeated.status), `duplicate deletion returned ${repeated.status}`);
    assert.equal(markers(db).length, 1);
    assert.equal(db.exec('SELECT count(*) FROM preview_case_activities')[0].values[0][0], activities.length + 1, 're-entry and rejected saves may not append extra audit records');
    assert.deepEqual(snapshot(db), before);
    await json(await call(`/api/cases/${caseId}`));
    assert.deepEqual(db.exec('PRAGMA foreign_key_check'), []);
    assert.deepEqual(db.exec('PRAGMA integrity_check')[0].values, [['ok']]);
  } finally { db.close(); }
});

test('CF122 delete detects a concurrently saved version and leaves the newer report active', async () => {
  const { db, d1, remove, put, call, caseId } = await fixture();
  try {
    let won = false;
    d1.beforeRun = async statement => {
      assert.match(statement.sql, /INSERT.*preview_case_activities/su);
      const saved = await json(await put({ ...draft, expectedVersion: 1, title: '동시 저장된 새 제목' }));
      assert.equal(saved.draft.version, 2); won = true;
    };
    await json(await remove(), 409);
    assert.equal(won, true); assert.equal(markers(db).length, 0);
    assert.equal((await json(await call(`/api/report-drafts?caseId=${caseId}`))).draft.title, '동시 저장된 새 제목');
    assert.equal((await json(await call('/api/report-workspaces'))).workspaces.some((row: any) => row.caseId === caseId), true);
  } finally { db.close(); }
});

test('CF122 a deletion interleaved before a draft write cannot mutate or resurrect the report', async () => {
  const { db, d1, remove, put } = await fixture();
  try {
    const before = snapshot(db);
    d1.beforeBatch = async statements => { assert.match(statements[0].sql, /UPDATE preview_report_drafts/u); await json(await remove()); };
    const response = await put({ ...draft, expectedVersion: 1, content: '삭제 뒤 도착한 오래된 자동저장', saveKind: 'AUTO' });
    assert.ok([409, 410].includes(response.status), `stale save returned ${response.status}`);
    assert.deepEqual(snapshot(db), before);
    assert.equal(markers(db).length, 1);
  } finally { db.close(); }
});

test('CF122 metadata navigation races cannot change a deleted report, and concurrent deletes append one marker', async () => {
  const { db, d1, remove, put } = await fixture();
  try {
    const before = snapshot(db);
    d1.beforeRun = async statement => {
      assert.match(statement.sql, /UPDATE preview_report_drafts SET wizard_step/u);
      d1.beforeRun = async inner => { assert.match(inner.sql, /INSERT.*preview_case_activities/su); await json(await remove()); };
      await json(await remove(), 409);
    };
    const response = await put({ ...draft, title: `${draft.title} target`, expectedVersion: 1, wizardStep: 2, saveKind: 'NAVIGATION' });
    assert.ok([409, 410].includes(response.status), `late navigation returned ${response.status}`);
    assert.equal(markers(db).length, 1);
    assert.deepEqual(snapshot(db), before);
  } finally { db.close(); }
});

test('CF122 archived reports reject chapter, outline, review and finalization writes without touching history', async () => {
  const { db, call, caseId, remove, reviewId } = await fixture();
  try {
    await json(await remove()); const before = snapshot(db, true);
    const requests: Array<[string, RequestInit]> = [
      [`/api/report-chapter-collaboration?caseId=${caseId}`, { method: 'POST', body: JSON.stringify({ action: 'APPLY', chapterId: draft.selectedChapterId, expectedVersion: 1, expectedReportVersion: 1 }) }],
      ['/api/report-authoring/outline', { method: 'PUT', body: JSON.stringify({ caseId, expectedVersion: 0, status: 'DRAFT', items: [] }) }],
      ['/api/report-reviews', { method: 'POST', headers: { 'Idempotency-Key': 'cf122-deleted-new-review' }, body: JSON.stringify({ caseId, expectedVersion: 1, note: '삭제 후 검수 요청' }) }],
      ['/api/report-finalizations', { method: 'POST', headers: { 'Idempotency-Key': 'cf122-deleted-new-final' }, body: JSON.stringify({ caseId, reviewId }) }],
    ];
    for (const [path, init] of requests) assert.equal((await json(await call(path, init), 410)).code, 'REPORT_DELETED', path);
    assert.deepEqual(snapshot(db, true), before);
  } finally { db.close(); }
});

test('CF122 failed delete storage cannot claim success or alter retained records', async () => {
  const { db, remove, call, caseId } = await fixture();
  try {
    const before = snapshot(db, true);
    db.exec("CREATE TRIGGER cf122_delete_failure BEFORE INSERT ON preview_case_activities WHEN NEW.event_type='REPORT_WORKSPACE_DELETED' BEGIN SELECT RAISE(ABORT,'CF122 synthetic private database detail'); END;");
    const response = await remove(); const body = await json(response, 503);
    assert.doesNotMatch(JSON.stringify(body), /synthetic private|RAISE|INSERT INTO/u);
    assert.deepEqual(snapshot(db, true), before); assert.equal(markers(db).length, 0);
    assert.equal((await json(await call('/api/report-workspaces'))).workspaces.some((row: any) => row.caseId === caseId), true);
  } finally { db.close(); }
});

test('CF122 an active URL case cannot bypass the deleted case in a mutation body', async () => {
  const { db, call, caseId, otherId, remove } = await fixture();
  try {
    await json(await remove()); const before = snapshot(db, true);
    for (const path of ['/api/report-authoring/outline', '/api/report-reviews', '/api/report-finalizations']) {
      const response = await call(`${path}?caseId=${otherId}`, { method: path.endsWith('/outline') ? 'PUT' : 'POST', body: JSON.stringify({ caseId, expectedVersion: 1 }) });
      assert.equal((await json(response, 400)).code, 'INVALID_CASE_ID');
    }
    assert.deepEqual(snapshot(db, true), before);
  } finally { db.close(); }
});

test('CF122 deletion during outline creation or update prevents both outline and audit writes', async () => {
  for (const existing of [false, true]) {
    const { db, d1, call, caseId, remove } = await fixture();
    try {
      const config = await json(await call(`/api/report-authoring/config?caseId=${caseId}`));
      const body = { caseId, expectedVersion: 0, status: 'DRAFT', items: config.chapters.map((chapter: any) => ({ chapterId: chapter.id, chapterCode: chapter.chapterCode, chapterTitle: chapter.title, promptVersion: chapter.promptVersion, planningNote: '' })) };
      assert.ok(body.items.length > 0);
      const write = () => call('/api/report-authoring/outline', { method: 'PUT', body: JSON.stringify(body) });
      if (existing) { await json(await write()); body.expectedVersion = 1; body.items[0].chapterTitle = '삭제 전 요청한 새 목차'; }
      const before = snapshot(db); let afterDelete: ReturnType<typeof snapshot> | undefined;
      d1.beforeBatch = async statements => {
        assert.match(statements[0].sql, existing ? /UPDATE preview_report_outline_plans/u : /INSERT INTO preview_report_outline_plans/u);
        await json(await remove()); afterDelete = snapshot(db, true);
      };
      await json(await write(), 409);
      assert.ok(afterDelete, 'actual outline transaction interleaving must run');
      assert.deepEqual(snapshot(db), before);
      assert.deepEqual(snapshot(db, true), afterDelete, 'no late outline audit/outbox may be created');
    } finally { db.close(); }
  }
});

test('CF122 deletion during review submission rolls back review events and leaves no late notifications', async () => {
  const { db, d1, call, otherId } = await fixture();
  try {
    const before = snapshot(db); let afterDelete: ReturnType<typeof snapshot> | undefined;
    d1.beforeBatch = async statements => {
      assert.match(statements[0].sql, /INSERT INTO preview_report_reviews/u);
      await json(await call(`/api/report-workspaces/${otherId}/delete`, { method: 'POST', body: JSON.stringify({ expectedVersion: 1 }) }));
      afterDelete = snapshot(db, true);
    };
    await json(await call('/api/report-reviews', { method: 'POST', headers: { 'Idempotency-Key': 'cf122-review-race' }, body: JSON.stringify({ caseId: otherId, expectedVersion: 1, note: '삭제와 경합하는 요청' }) }), 409);
    assert.ok(afterDelete); assert.deepEqual(snapshot(db), before); assert.deepEqual(snapshot(db, true), afterDelete);
    assert.deepEqual(db.exec('PRAGMA foreign_key_check'), []);
  } finally { db.close(); }
});

test('CF122 deletion during finalization rolls back output events and preserves the approval', async () => {
  const { db, d1, call, otherId } = await fixture();
  try {
    const now = new Date().toISOString();
    db.run('INSERT INTO preview_case_assignments VALUES (?,?,?,?)', [otherId, REVIEWER, ADMIN, now]);
    const review = await json(await call('/api/report-reviews', { method: 'POST', headers: { 'Idempotency-Key': 'cf122-review-for-final-race' }, body: JSON.stringify({ caseId: otherId, expectedVersion: 1, note: '최종 확정 경쟁 검수' }) }), 201);
    const reviewId = review.reviews.find((row: any) => row.caseId === otherId).id;
    await json(await call(`/api/report-reviews/${reviewId}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVED', note: '승인 원본 유지', expectedStatus: 'PENDING' }) }, REVIEWER_TOKEN));
    const before = snapshot(db); let afterDelete: ReturnType<typeof snapshot> | undefined;
    d1.beforeBatch = async statements => {
      assert.match(statements[0].sql, /INSERT INTO preview_report_finalizations/u);
      await json(await call(`/api/report-workspaces/${otherId}/delete`, { method: 'POST', body: JSON.stringify({ expectedVersion: 1 }) }));
      afterDelete = snapshot(db, true);
    };
    await json(await call('/api/report-finalizations', { method: 'POST', headers: { 'Idempotency-Key': 'cf122-final-race' }, body: JSON.stringify({ caseId: otherId, reviewId }) }), 409);
    assert.ok(afterDelete); assert.deepEqual(snapshot(db), before); assert.deepEqual(snapshot(db, true), afterDelete);
    assert.deepEqual(db.exec('PRAGMA foreign_key_check'), []);
  } finally { db.close(); }
});

test('CF122 deletion during approval prevents review, notification and email outbox writes', async () => {
  const { db, d1, call, otherId } = await fixture();
  try {
    db.run('INSERT INTO preview_case_assignments VALUES (?,?,?,?)', [otherId, REVIEWER, ADMIN, new Date().toISOString()]);
    const review = await json(await call('/api/report-reviews', { method: 'POST', headers: { 'Idempotency-Key': 'cf122-review-for-decision-race' }, body: JSON.stringify({ caseId: otherId, expectedVersion: 1, note: '승인 경쟁 검수' }) }), 201);
    const reviewId = review.reviews.find((row: any) => row.caseId === otherId).id;
    const before = snapshot(db); let afterDelete: ReturnType<typeof snapshot> | undefined;
    d1.beforeBatch = async statements => {
      assert.match(statements[0].sql, /UPDATE preview_report_reviews/u);
      assert.ok(statements.some(statement => statement.sql.includes('preview_email_outbox')), 'exercise actual approval notification path');
      await json(await call(`/api/report-workspaces/${otherId}/delete`, { method: 'POST', body: JSON.stringify({ expectedVersion: 1 }) }));
      afterDelete = snapshot(db, true);
    };
    await json(await call(`/api/report-reviews/${reviewId}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVED', note: '늦은 승인 차단', expectedStatus: 'PENDING' }) }, REVIEWER_TOKEN), 409);
    assert.ok(afterDelete); assert.deepEqual(snapshot(db), before); assert.deepEqual(snapshot(db, true), afterDelete);
  } finally { db.close(); }
});

test('CF122 deletion during chapter SAVE prevents assignment, revision and audit changes', async () => {
  const { db, d1, call, caseId, remove } = await fixture();
  try {
    const config = await json(await call(`/api/report-authoring/config?caseId=${caseId}`));
    const chapterId = config.chapters[0].id, path = `/api/report-chapter-collaboration?caseId=${caseId}`;
    await json(await call(path, { method: 'PUT', body: JSON.stringify({ chapterId, assigneeId: REVIEWER, expectedVersion: 0 }) }));
    const before = snapshot(db); let afterDelete: ReturnType<typeof snapshot> | undefined;
    d1.beforeBatch = async statements => {
      assert.match(statements[0].sql, /UPDATE preview_report_chapter_assignments/u);
      await json(await remove()); afterDelete = snapshot(db, true);
    };
    await json(await call(path, { method: 'POST', body: JSON.stringify({ chapterId, action: 'SAVE', draftText: '삭제 후 늦게 도착한 챕터 원고', expectedVersion: 1, expectedReportVersion: 1 }) }, REVIEWER_TOKEN), 409);
    assert.ok(afterDelete); assert.deepEqual(snapshot(db), before); assert.deepEqual(snapshot(db, true), afterDelete);
  } finally { db.close(); }
});
