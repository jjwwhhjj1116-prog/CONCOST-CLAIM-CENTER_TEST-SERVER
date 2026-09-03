import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const OUTSIDER_ID = '00000000-0000-4000-8000-000000000002';
const CASE_ID = '40000000-0000-4000-8000-000000000010';
const ADMIN_TOKEN = 'cf16-admin-session-token';
const OUTSIDER_TOKEN = 'cf16-outsider-session-token';

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class SqlStatement {
  private values: unknown[] = [];
  constructor(private readonly database: Database, private readonly sql: string) {}
  bind(...values: unknown[]): SqlStatement {
    this.values = values.map((value) => value instanceof ArrayBuffer ? new Uint8Array(value) : value);
    return this;
  }
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
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.run('COMMIT');
      return results;
    } catch (error) {
      this.database.run('ROLLBACK');
      throw error;
    }
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
  sql.exec(migration('0015_cf15_case_evidence_library.sql'));
  sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(ADMIN_TOKEN), ADMIN_ID, now, new Date(Date.now() + 3_600_000).toISOString()]);
  sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(OUTSIDER_TOKEN), OUTSIDER_ID, now, new Date(Date.now() + 3_600_000).toISOString()]);
  return { sql, env: { DB: new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']> } };
}

function request(path: string, token = ADMIN_TOKEN, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('X-Session-Token', token);
  return new Request(`https://preview.example${path}`, { ...init, headers });
}

function evidenceForm(bytes: Uint8Array, category: 'TAKEOFF_SOURCE' | 'COST_BREAKDOWN', name = 'project-takeoff.xlsx'): FormData {
  const form = new FormData();
  form.set('category', category);
  form.set('file', new File([Uint8Array.from(bytes).buffer], name, { type: 'application/octet-stream' }));
  return form;
}

test('CF16 uploads chunked project evidence and exposes the identical file in the project library after restart', async () => {
  const { sql, env } = await setup();
  const bytes = new Uint8Array(500_200);
  bytes[0] = 0x50; bytes[1] = 0x4b; bytes[2] = 0x03; bytes[3] = 0x04;
  bytes.fill(0x41, 4);
  const upload = await worker.fetch(request(`/api/cases/${CASE_ID}/evidence`, ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf16-takeoff-upload-0001' }, body: evidenceForm(bytes, 'TAKEOFF_SOURCE') }), env);
  assert.equal(upload.status, 201);
  const uploadBody = await upload.json() as { file: { id: string; category: string; downloadUrl: string; uploadedBy: string }; replay: boolean };
  assert.equal(uploadBody.file.category, 'TAKEOFF_SOURCE');
  assert.equal(uploadBody.file.uploadedBy, 'admin');
  assert.equal(uploadBody.replay, false);
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_case_evidence_chunks')[0].values[0][0], 2);
  assert.equal(sql.exec("SELECT COUNT(*) FROM preview_case_activities WHERE event_type='EVIDENCE_UPLOADED'")[0].values[0][0], 1);

  const replay = await worker.fetch(request(`/api/cases/${CASE_ID}/evidence`, ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf16-takeoff-upload-0001' }, body: evidenceForm(bytes, 'TAKEOFF_SOURCE') }), env);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json() as { replay: boolean }).replay, true);
  const mismatch = await worker.fetch(request(`/api/cases/${CASE_ID}/evidence`, ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf16-takeoff-upload-0001' }, body: evidenceForm(bytes, 'COST_BREAKDOWN') }), env);
  assert.equal(mismatch.status, 409);

  const list = await worker.fetch(request(`/api/cases/${CASE_ID}/evidence?category=TAKEOFF_SOURCE`), env);
  assert.equal(list.status, 200);
  const listBody = await list.json() as { files: Array<{ id: string; originalName: string }>; temporaryStorage: boolean; migrationTarget: string };
  assert.equal(listBody.files.length, 1);
  assert.equal(listBody.files[0].originalName, 'project-takeoff.xlsx');
  assert.equal(listBody.temporaryStorage, true);
  assert.equal(listBody.migrationTarget, 'GOOGLE_DRIVE');

  const download = await worker.fetch(request(uploadBody.file.downloadUrl), env);
  assert.equal(download.status, 200);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
  assert.equal((await worker.fetch(request(`/api/cases/${CASE_ID}/evidence`, OUTSIDER_TOKEN), env)).status, 404);

  const SQL = await initSqlJs();
  const restarted = new SQL.Database(sql.export());
  assert.equal(restarted.exec('SELECT COUNT(*) FROM preview_case_evidence')[0].values[0][0], 1);
  assert.equal(restarted.exec('SELECT SUM(byte_size) FROM preview_case_evidence_chunks')[0].values[0][0], bytes.byteLength);
  restarted.close();
  sql.close();
});

test('CF16 keeps evidence bytes and attribution append-only and renders the upload surface in both workflow and library', async () => {
  const { sql } = await setup();
  const now = new Date().toISOString();
  sql.run('INSERT INTO preview_case_evidence VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['50000000-0000-4000-8000-000000000001', 'concost', CASE_ID, 'COST_BREAKDOWN', 'cost.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 4, 'a'.repeat(64), 1, 'D1_TEMPORARY', ADMIN_ID, 'admin', now, 'cf16-raw-evidence-0001', 'b'.repeat(64)]);
  sql.run('INSERT INTO preview_case_evidence_chunks VALUES (?,?,?,?)', ['50000000-0000-4000-8000-000000000001', 0, 4, new Uint8Array([0x50, 0x4b, 0x03, 0x04])]);
  assert.throws(() => sql.run("UPDATE preview_case_evidence SET original_name='forged.xlsx'"), /append-only/u);
  assert.throws(() => sql.run('DELETE FROM preview_case_evidence_chunks'), /append-only/u);

  const workflow = readFileSync('apps/web/src/workflow/WorkflowOperations.tsx', 'utf8');
  const library = readFileSync('apps/web/src/routes/PreviewEvidenceHub.tsx', 'utf8');
  const panel = readFileSync('apps/web/src/evidence/CaseEvidencePanel.tsx', 'utf8');
  assert.match(workflow, /산출자료·내역자료 → 회사 Google Drive에 업로드하세요/u);
  assert.match(workflow, /allowedCategories=\{\['KICKOFF_MATERIAL', 'MEETING_MINUTES', 'MEETING_RECORDING'\]\}/u);
  assert.match(workflow, /allowedCategories=\{\['SITE_PHOTO', 'SITE_RECORDING', 'SITE_DOCUMENT'\]\}/u);
  assert.match(workflow, /allowedCategories=\{\['TAKEOFF_SOURCE', 'COST_BREAKDOWN'\]\}/u);
  assert.match(library, /CaseEvidencePanel caseId=\{selectedCaseId\}/u);
  assert.match(panel, /visibleCategories\.map/u);
  assert.match(panel, /TAKEOFF_SOURCE/u);
  assert.match(panel, /COST_BREAKDOWN/u);
  assert.match(panel, /uploadedBy/u);
  assert.match(panel, /uploadedAt/u);
  sql.close();
});
