import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { ensureReportTemplateFolder, validateReportTemplateFile } from '../apps/cloudflare/src/google-drive.js';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const migration = read('apps/cloudflare/migrations/0024_cf32_source_template_library.sql');

async function sourceDatabase() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys=ON');
  db.exec(`
    CREATE TABLE preview_users(id TEXT PRIMARY KEY,login_id TEXT,display_name TEXT,is_active INTEGER,roles_json TEXT);
    CREATE TABLE preview_report_prompt_sets(id TEXT PRIMARY KEY,organization_id TEXT,claim_type TEXT,name TEXT,system_prompt TEXT,status TEXT,version INTEGER,updated_by TEXT,updated_at TEXT,FOREIGN KEY(updated_by) REFERENCES preview_users(id));
    CREATE TABLE preview_report_chapter_prompts(id TEXT PRIMARY KEY,prompt_set_id TEXT,chapter_code TEXT,title TEXT,agent_code TEXT,role_prompt TEXT,instruction_prompt TEXT,ordinal INTEGER,version INTEGER,updated_by TEXT,updated_at TEXT,FOREIGN KEY(prompt_set_id) REFERENCES preview_report_prompt_sets(id),FOREIGN KEY(updated_by) REFERENCES preview_users(id));
    CREATE TABLE preview_report_prompt_history(id TEXT PRIMARY KEY,prompt_id TEXT,version INTEGER,role_prompt TEXT,instruction_prompt TEXT,changed_by TEXT,changed_at TEXT,UNIQUE(prompt_id,version),FOREIGN KEY(prompt_id) REFERENCES preview_report_chapter_prompts(id),FOREIGN KEY(changed_by) REFERENCES preview_users(id));
  `);
  const adminId = '00000000-0000-4000-8000-000000000001';
  const staffId = '00000000-0000-4000-8000-000000000002';
  db.run('INSERT INTO preview_users VALUES (?,?,?,?,?)', [adminId, 'admin@con-cost.com', 'Admin', 1, '["admin"]']);
  db.run('INSERT INTO preview_users VALUES (?,?,?,?,?)', [staffId, 'staff@con-cost.com', 'Staff', 1, '["staff"]']);
  const chapterCounts: Record<string, number> = { 'TYPE-01': 7, 'TYPE-02': 6, 'TYPE-03': 5, 'TYPE-04': 8, 'TYPE-06': 6 };
  for (const [claimType, count] of Object.entries(chapterCounts)) {
    const setId = `PROMPT-TYPE-${claimType.slice(-2)}`;
    db.run('INSERT INTO preview_report_prompt_sets VALUES (?,?,?,?,?,?,?,?,?)', [setId, 'concost', claimType, claimType, 'x'.repeat(120), 'ACTIVE', 1, adminId, '2026-01-01T00:00:00.000Z']);
    for (let ordinal = 1; ordinal <= count; ordinal += 1) {
      const chapterCode = `CH-${String(ordinal).padStart(2, '0')}`;
      db.run('INSERT INTO preview_report_chapter_prompts VALUES (?,?,?,?,?,?,?,?,?,?,?)', [`PROMPT-${claimType}-${chapterCode}`, setId, chapterCode, `Chapter ${ordinal}`, `AGENT-${String(Math.min(ordinal, 6)).padStart(2, '0')}`, 'generic role prompt that is long enough', 'generic instruction prompt that is long enough', ordinal, 1, adminId, '2026-01-01T00:00:00.000Z']);
    }
  }
  return { db, adminId, staffId };
}

test('CF32 maps all 32 private originals into nine source-analyzed categories and 32 distinct chapter prompts', async () => {
  const { db } = await sourceDatabase();
  db.exec(migration);
  const categoryRows = db.exec('SELECT category_code,primary_claim_type,source_file_count,json_array_length(outline_json) FROM preview_report_template_categories ORDER BY category_code')[0].values;
  assert.equal(categoryRows.length, 9);
  assert.equal(categoryRows.reduce((sum, row) => sum + Number(row[2]), 0), 32);
  assert.deepEqual(categoryRows.map((row) => row[1]), ['TYPE-02','TYPE-02','TYPE-06','TYPE-01','TYPE-06','TYPE-04','TYPE-01','TYPE-03','TYPE-01']);
  assert.ok(categoryRows.every((row) => Number(row[3]) >= 6));
  const prompts = db.exec('SELECT p.id,p.version,length(p.role_prompt),length(p.instruction_prompt),b.source_category_codes_json FROM preview_report_chapter_prompts p JOIN preview_report_prompt_source_basis b ON b.prompt_id=p.id ORDER BY p.id')[0].values;
  assert.equal(prompts.length, 32);
  assert.ok(prompts.every((row) => Number(row[1]) === 2 && Number(row[2]) >= 20 && Number(row[3]) >= 40 && String(row[4]).startsWith('["REF-')));
  assert.equal(db.exec('SELECT COUNT(*) FROM preview_report_prompt_history')[0].values[0][0], 64);
  db.close();
});

test('CF32 raw DB guards require an active Admin and a matching pending import before immutable source metadata', async () => {
  const { db, adminId, staffId } = await sourceDatabase();
  db.exec(migration);
  const categoryId = 'TPL-CATEGORY-01';
  const now = '2026-08-18T00:00:00.000Z';
  const operationId = '10000000-0000-4000-8000-000000000001';
  assert.throws(() => db.run('INSERT INTO preview_report_template_import_operations (id,organization_id,category_id,request_key,request_fingerprint,status,actor_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [operationId,'concost',categoryId,'request-key-1234567890','a'.repeat(64),'PENDING',staffId,now,now]), /active Admin/u);
  db.run('INSERT INTO preview_report_template_import_operations (id,organization_id,category_id,request_key,request_fingerprint,status,actor_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [operationId,'concost',categoryId,'request-key-1234567890','a'.repeat(64),'PENDING',adminId,now,now]);
  const fileId = '20000000-0000-4000-8000-000000000001';
  db.run('INSERT INTO preview_report_template_files VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [fileId,'concost',categoryId,'source.pdf','pdf','application/pdf',100,'b'.repeat(64),'google-file-id-0001','google-folder-id-001',adminId,now,operationId]);
  assert.throws(() => db.run('UPDATE preview_report_template_files SET original_name="changed.pdf" WHERE id=?', [fileId]), /append-only/u);
  assert.throws(() => db.run('DELETE FROM preview_report_template_files WHERE id=?', [fileId]), /cannot be deleted/u);
  db.run("UPDATE preview_report_template_import_operations SET status='SUCCEEDED',google_file_id='google-file-id-0001',updated_at='2026-08-18T00:00:01.000Z' WHERE id=?", [operationId]);
  assert.throws(() => db.run("UPDATE preview_report_template_import_operations SET status='FAILED' WHERE id=?", [operationId]), /terminal transition/u);
  db.close();
});

test('CF32 creates a private root/category Drive folder and accepts only signed report-template formats', async () => {
  const calls: Array<{ method: string; body?: Record<string, unknown> }> = [];
  let created = 0;
  const fetcher = async (_input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (method === 'GET') return new Response(JSON.stringify({ files: [] }), { headers: { 'Content-Type': 'application/json' } });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ method, body }); created += 1;
    return new Response(JSON.stringify({ id: `private-folder-${created}00`, name: body.name, mimeType: 'application/vnd.google-apps.folder', trashed: false }), { headers: { 'Content-Type': 'application/json' } });
  };
  const folders = await ensureReportTemplateFolder(fetcher, { accessToken: 'server-token', categoryCode: 'REF-07', categoryName: '하자조사 보고서' });
  assert.equal(folders.rootId, 'private-folder-300');
  assert.equal(folders.categoryId, 'private-folder-400');
  assert.equal(calls.length, 4);
  assert.deepEqual((calls[3].body as { parents: string[] }).parents, ['private-folder-300']);
  const pdf = new File([new TextEncoder().encode('%PDF-1.7\nsource')], 'template.pdf', { type: 'application/pdf' });
  assert.equal((await validateReportTemplateFile(pdf)).mimeType, 'application/pdf');
  await assert.rejects(validateReportTemplateFile(new File(['<html>'], 'template.pdf')), /does not match/u);
});

test('CF32 UI replaces fake-only preview with authenticated Drive originals and Admin folder import', () => {
  const studio = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const admin = read('apps/web/src/routes/PreviewAiAdmin.tsx');
  const worker = read('apps/cloudflare/src/index.ts');
  assert.match(studio, /원본 보고서 템플릿 선택·열람/u);
  assert.match(studio, /원본 PDF 열기/u);
  assert.match(studio, /PRIVATE COMPANY GOOGLE DRIVE/u);
  assert.match(admin, /원본 32개 폴더 선택·등록/u);
  assert.match(admin, /webkitdirectory/u);
  assert.match(admin, /클레임 업무 프로세스\.xlsx/u);
  assert.match(admin, /원본 분석 근거/u);
  assert.match(worker, /TEMPLATE_SOURCE_INTEGRITY_MISMATCH/u);
  assert.match(worker, /Only Admin can import report templates/u);
  assert.match(worker, /Cache-Control': 'private, no-store/u);
  assert.doesNotMatch(worker, /E:\\.*보고서 템플릿/u);
});
