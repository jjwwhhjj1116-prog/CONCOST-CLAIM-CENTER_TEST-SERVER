import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import { GoogleDriveError } from '../apps/cloudflare/src/google-drive';
import { prepareEvidenceVersion, evidenceVersionStatements } from '../apps/cloudflare/src/evidence-versioning';
import { fetchEvidenceUpload } from '../apps/web/src/evidence/upload-evidence';

class Statement {
  values: unknown[] = [];
  constructor(readonly db: Database, readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async all<T>(): Promise<{ results: T[] }> {
    const statement = this.db.prepare(this.sql);
    try { statement.bind(this.values as any[]); const results: T[] = []; while (statement.step()) results.push(statement.getAsObject() as T); return { results }; }
    finally { statement.free(); }
  }
  async first<T>(): Promise<T | null> { return (await this.all<T>()).results[0] ?? null; }
  async run() { this.db.run(this.sql, this.values as any[]); return { meta: { changes: this.db.getRowsModified() } }; }
}

async function fixture() {
  const SQL = await initSqlJs(); const sql = new SQL.Database();
  sql.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE preview_cases(id TEXT PRIMARY KEY, organization_id TEXT, deleted_at TEXT);
    CREATE TABLE preview_users(id TEXT PRIMARY KEY, is_active INTEGER, display_name TEXT, roles_json TEXT, department_code TEXT);
    CREATE TABLE preview_case_assignments(case_id TEXT, user_id TEXT);
    CREATE TABLE preview_case_evidence(id TEXT PRIMARY KEY, organization_id TEXT, case_id TEXT, workflow_category TEXT, original_name TEXT, mime_type TEXT, byte_size INTEGER, sha256 TEXT, uploaded_by_name TEXT, uploaded_by_id TEXT, uploaded_at TEXT, idempotency_key TEXT, request_fingerprint TEXT, chunk_count INTEGER, storage_provider TEXT);
    CREATE TABLE preview_google_case_evidence AS SELECT *, '' AS google_file_id, '' AS google_folder_id, '' AS operation_id, '' AS category FROM preview_case_evidence WHERE 0;
    CREATE TABLE preview_google_case_operations(id TEXT, organization_id TEXT, case_id TEXT, category TEXT, idempotency_key TEXT, request_fingerprint TEXT, status TEXT, created_by TEXT);
    INSERT INTO preview_cases VALUES('case-1','concost',NULL);
    INSERT INTO preview_users VALUES('user-1',1,'검수자','["staff"]','CLAIM_CENTER');
    INSERT INTO preview_case_evidence VALUES('original','concost','case-1','MEETING_MINUTES','원본.txt','text/plain',3,'original-sha','검수자','user-1','2026-09-07T00:00:00Z','original-key','original-fingerprint',1,'D1_TEMPORARY');
  `);
  sql.exec(readFileSync('apps/cloudflare/migrations/0058_cf104_evidence_versions.sql', 'utf8'));
  const db = { prepare: (query: string) => new Statement(sql, query) };
  const args = (form = new FormData()) => ({ db, caseId: 'case-1', category: 'MEETING_MINUTES', userId: 'user-1', sha256: 'new-sha', fingerprint: 'new-fingerprint', form, fileName: '새 회의록.txt', analyze: async () => { throw new GoogleDriveError('PAID_NO_TRAINING_REQUIRED', 403, 'AI 비교 정책 미승인'); } });
  return { sql, db, args };
}

const codeIs = (code: string) => (error: unknown) => error instanceof GoogleDriveError && error.code === code;

test('CF115 comparison failure is explicit; chosen separate upload creates v1 without AI or replacing history', async () => {
  const { sql, db, args } = await fixture();
  try {
    const original = JSON.stringify(sql.exec('SELECT * FROM preview_case_evidence'));
    await assert.rejects(prepareEvidenceVersion(args()), codeIs('PAID_NO_TRAINING_REQUIRED'));
    assert.equal(sql.exec('SELECT COUNT(*) FROM preview_evidence_upload_locks')[0].values[0][0], 0);
    const form = new FormData(); form.set('versionMode', 'SEPARATE');
    const { plan } = await prepareEvidenceVersion(args(form));
    assert.ok(plan); assert.equal(plan.base, null); assert.equal(plan.versionNumber, 1);
    assert.equal(plan.modelCode, 'MANUAL_SEPARATE'); assert.equal(plan.reviewId, null);
    for (const statement of evidenceVersionStatements(db, plan, 'new-file')) await statement.run();
    assert.deepEqual(sql.exec('SELECT group_id,version_num,is_latest,supersedes_id,model_code FROM preview_evidence_versions')[0].values, [['new-file', 1, 1, null, 'MANUAL_SEPARATE']]);
    assert.equal(JSON.stringify(sql.exec('SELECT * FROM preview_case_evidence')), original, 'original file metadata must remain unchanged');
    await assert.rejects(prepareEvidenceVersion(args(form)), codeIs('UPLOAD_IN_PROGRESS'), 'separate uploads retain the category lock');
    assert.equal(sql.exec('PRAGMA foreign_key_check').length, 0);
  } finally { sql.close(); }
});

test('CF115 separate mode cannot bypass exact duplicates, validated choices, or server review for replacement', async () => {
  const { sql, args } = await fixture();
  try {
    const separate = new FormData(); separate.set('versionMode', 'SEPARATE');
    const duplicate = await prepareEvidenceVersion({ ...args(separate), sha256: 'original-sha' });
    assert.equal(duplicate.response?.status, 409); assert.equal((await duplicate.response!.json()).code, 'DUPLICATE_EXACT');
    for (const mode of ['', 'AUTO', 'REPLACE_AS_LATEST', new File(['bad'], 'mode.txt')]) {
      const form = new FormData(); form.set('versionMode', mode);
      await assert.rejects(prepareEvidenceVersion(args(form)), codeIs('INVALID_VERSION_MODE'));
    }
    const repeated = new FormData(); repeated.append('versionMode', 'SEPARATE'); repeated.append('versionMode', 'SEPARATE');
    await assert.rejects(prepareEvidenceVersion(args(repeated)), codeIs('INVALID_VERSION_MODE'));
    for (const key of ['reviewId', 'versionChoice']) {
      const form = new FormData(); form.set('versionMode', 'SEPARATE'); form.set(key, '');
      await assert.rejects(prepareEvidenceVersion(args(form)), codeIs('INVALID_VERSION_MODE'));
    }
    const replace = new FormData(); replace.set('versionChoice', 'REPLACE_AS_LATEST');
    await assert.rejects(prepareEvidenceVersion(args(replace)), codeIs('INVALID_VERSION_CHOICE'));
    replace.set('reviewId', 'forged-review');
    await assert.rejects(prepareEvidenceVersion(args(replace)), codeIs('VERSION_REVIEW_STALE'));
    assert.equal(sql.exec('SELECT COUNT(*) FROM preview_evidence_upload_locks')[0].values[0][0], 0);
  } finally { sql.close(); }
});

test('CF115 shared uploader offers only explicit separate-save recovery and preserves cancellation/current-project guards', async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let action = 'AI 비교 없이 별도 저장'; let calls = 0; let mounted = 0; let removed = 0; let current = true;
  let beforeChoice = () => {};
  class Element extends EventTarget {
    children: Element[] = []; textContent = '';
    append(...elements: Element[]) { this.children.push(...elements); }
    setAttribute() {} close() {} remove() { removed++; }
    showModal() {
      mounted++; beforeChoice();
      if (action === 'Escape') { this.dispatchEvent(new Event('cancel', { cancelable: true })); return; }
      if (action === 'back') { window.dispatchEvent(new Event('popstate')); return; }
      const button = this.children.at(-1)!.children.find(child => child.textContent === action);
      assert.ok(button, `Missing action: ${action}`); button.dispatchEvent(new Event('click'));
    }
  }
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
  Object.defineProperty(globalThis, 'document', { value: { createElement: () => new Element(), body: new Element() }, configurable: true });
  const url = '/api/cases/00000000-0000-4000-8000-000000000115/evidence';
  const request = () => { const form = new FormData(); form.set('file', new File(['원문'], '회의록.txt')); return { method: 'POST', headers: { 'Idempotency-Key': 'original-upload-key' }, body: form }; };
  try {
    for (const [code, status] of [['PAID_NO_TRAINING_REQUIRED', 403], ['ORGANIZATION_GEMINI_NOT_CONFIGURED', 503], ['VERSION_ANALYSIS_UNAVAILABLE', 503], ['VERSION_TEXT_EXTRACTION_FAILED', 422], ['VERSION_COMPARE_TOO_LARGE', 413], ['INVALID_VERSION_ANALYSIS', 502]] as const) {
      calls = 0;
      const init = request(); init.body.set('reviewId', 'old-review'); init.body.set('versionChoice', 'REPLACE_AS_LATEST');
      globalThis.fetch = async (_url, supplied) => {
        calls++;
        if (calls === 1) return Response.json({ error: '문서 AI 비교 불가', code }, { status });
        assert.equal(supplied, init); assert.equal(new Headers(supplied!.headers).get('Idempotency-Key'), 'original-upload-key');
        const form = supplied!.body as FormData;
        assert.equal(form.get('versionMode'), 'SEPARATE'); assert.equal(form.has('reviewId'), false); assert.equal(form.has('versionChoice'), false);
        assert.equal(await (form.get('file') as File).text(), '원문');
        return Response.json({ file: { id: 'separate' } }, { status: 201 });
      };
      assert.equal((await fetchEvidenceUpload(url, init)).status, 201); assert.equal(calls, 2);
    }
    for (action of ['취소', 'Escape', 'back']) {
      calls = 0; const init = request();
      globalThis.fetch = async () => { calls++; return Response.json({ code: 'PAID_NO_TRAINING_REQUIRED' }, { status: 403 }); };
      assert.equal((await (await fetchEvidenceUpload(url, init)).json()).code, 'UPLOAD_CANCELLED');
      assert.equal(calls, 1); assert.equal(init.body.has('versionMode'), false);
    }
    action = 'AI 비교 없이 별도 저장'; calls = 0;
    beforeChoice = () => { current = false; };
    assert.equal((await (await fetchEvidenceUpload(url, request(), { isCurrent: () => current })).json()).code, 'UPLOAD_CANCELLED');
    assert.equal(calls, 1, 'project changes while confirming must not send retry');
    beforeChoice = () => {}; current = true;
    for (const code of ['FORBIDDEN', 'EVIDENCE_INTEGRITY_FAILED', 'GOOGLE_DRIVE_NOT_CONNECTED', 'RECONCILIATION_REQUIRED', 'EVIDENCE_SCHEMA_UPGRADE_REQUIRED', 'UPLOAD_IN_PROGRESS', 'INVALID_EVIDENCE_PAYLOAD']) {
      calls = 0; const previousMounted = mounted;
      globalThis.fetch = async () => { calls++; return Response.json({ code }, { status: 403 }); };
      assert.equal((await (await fetchEvidenceUpload(url, request())).json()).code, code);
      assert.equal(calls, 1); assert.equal(mounted, previousMounted, `${code} must not offer bypass`);
    }
    calls = 0; const previousMounted = mounted;
    globalThis.fetch = async () => { calls++; return Response.json({ code: 'VERSION_ANALYSIS_UNAVAILABLE' }, { status: 503 }); };
    assert.equal((await fetchEvidenceUpload(url, request())).status, 503); assert.equal(calls, 2);
    assert.equal(mounted, previousMounted + 1, 'a failed separate retry must not loop on consent');
    assert.equal(mounted, removed, 'every modal removes itself');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
