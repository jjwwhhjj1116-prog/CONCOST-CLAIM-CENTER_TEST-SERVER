import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

async function guidelineDatabase() {
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
  db.run('INSERT INTO preview_users VALUES (?,?,?,?,?)', [adminId,'admin@con-cost.com','Admin',1,'["admin"]']);
  db.run('INSERT INTO preview_users VALUES (?,?,?,?,?)', [staffId,'staff@con-cost.com','Staff',1,'["staff"]']);
  const counts: Record<string,number> = { 'TYPE-01':7,'TYPE-02':6,'TYPE-03':5,'TYPE-04':8,'TYPE-05':0,'TYPE-06':6 };
  for (const [claimType,count] of Object.entries(counts)) {
    const setId = `PROMPT-TYPE-${claimType.slice(-2)}`;
    db.run('INSERT INTO preview_report_prompt_sets VALUES (?,?,?,?,?,?,?,?,?)',[setId,'concost',claimType,claimType,'x'.repeat(120),claimType==='TYPE-05'?'TEMPLATE_NOT_FOUND':'ACTIVE',1,adminId,'2026-01-01T00:00:00.000Z']);
    for (let ordinal=1; ordinal<=count; ordinal+=1) {
      const code=`CH-${String(ordinal).padStart(2,'0')}`;
      db.run('INSERT INTO preview_report_chapter_prompts VALUES (?,?,?,?,?,?,?,?,?,?,?)',[`PROMPT-${claimType}-${code}`,setId,code,`Chapter ${ordinal}`,`AGENT-${String(Math.min(ordinal,6)).padStart(2,'0')}`,'generic role prompt that is long enough','generic instruction prompt that is long enough',ordinal,1,adminId,'2026-01-01T00:00:00.000Z']);
    }
  }
  db.exec(read('apps/cloudflare/migrations/0024_cf32_source_template_library.sql'));
  db.exec(read('apps/cloudflare/migrations/0025_cf33_type_authoring_guidelines.sql'));
  return { db,adminId,staffId };
}

test('CF33 imports six SHA-pinned two-stage type guidelines and exact active chapter trees', async () => {
  const { db } = await guidelineDatabase();
  const guides=db.exec('SELECT claim_type,source_file_name,length(source_sha256),version FROM preview_report_type_guidelines ORDER BY claim_type')[0].values;
  assert.equal(guides.length,6);
  assert.deepEqual(guides.map((row)=>row[0]),['TYPE-01','TYPE-02','TYPE-03','TYPE-04','TYPE-05','TYPE-06']);
  assert.ok(guides.every((row)=>Number(row[2])===64&&Number(row[3])===1));
  const counts=db.exec("SELECT s.claim_type,COUNT(p.id) FROM preview_report_prompt_sets s LEFT JOIN preview_report_chapter_prompts p ON p.prompt_set_id=s.id AND p.status='ACTIVE' GROUP BY s.claim_type ORDER BY s.claim_type")[0].values;
  assert.deepEqual(counts.map((row)=>[row[0],Number(row[1])]),[['TYPE-01',6],['TYPE-02',5],['TYPE-03',7],['TYPE-04',6],['TYPE-05',7],['TYPE-06',6]]);
  assert.equal(db.exec("SELECT status FROM preview_report_prompt_sets WHERE claim_type='TYPE-05'")[0].values[0][0],'ACTIVE');
  assert.equal(db.exec('SELECT COUNT(*) FROM preview_report_type_guideline_history')[0].values[0][0],6);
  assert.match(String(db.exec("SELECT instruction_prompt FROM preview_report_chapter_prompts WHERE id='PROMPT-TYPE-01-CH-04'")[0].values[0][0]),/5단 구조/u);
  db.close();
});

test('CF33 type policy and chapter status are Admin-versioned and history is append-only', async () => {
  const { db,adminId,staffId } = await guidelineDatabase();
  assert.throws(()=>db.run("UPDATE preview_report_type_guidelines SET target_work=?,version=2,updated_by=?,updated_at=? WHERE claim_type='TYPE-01'",['staff cannot edit this guideline because role validation applies',staffId,'2026-08-19T00:00:00.000Z']),/active Admin/u);
  db.run("UPDATE preview_report_type_guidelines SET target_work=?,version=2,updated_by=?,updated_at=? WHERE claim_type='TYPE-01'",['관리자가 검증한 대상 업무 범위를 새 버전으로 안전하게 저장합니다.',adminId,'2099-08-19T00:00:00.000Z']);
  assert.throws(()=>db.run("UPDATE preview_report_chapter_prompts SET status='ARCHIVED',version=version+1,updated_by=?,updated_at=? WHERE id='PROMPT-TYPE-01-CH-01'",[adminId,'2026-08-19T00:00:01.000Z']),/optimistic version/u);
  assert.throws(()=>db.run('UPDATE preview_report_type_guideline_history SET version=99'),/append-only/u);
  assert.throws(()=>db.run("DELETE FROM preview_report_type_guidelines WHERE claim_type='TYPE-01'"),/cannot be deleted/u);
  db.close();
});

test('CF33 Admin UI separates type policy from chapter roles and report authoring consumes both stages', () => {
  const admin=read('apps/web/src/routes/PreviewAiAdmin.tsx');
  const studio=read('apps/web/src/routes/PreviewReportStudio.tsx');
  const worker=read('apps/cloudflare/src/index.ts');
  assert.match(admin,/보고서 유형별 작성 지침 · 관리자 전용/u);
  assert.match(admin,/STAGE 1 · 목차 생성/u);
  assert.match(admin,/STAGE 2 · 챕터 작성/u);
  assert.match(admin,/챕터별 역할·작성 지침/u);
  assert.match(studio,/AI 목차 자동생성/u);
  assert.match(studio,/관리자 승인.*작성 지침/u);
  assert.match(worker,/preview_report_type_guidelines/u);
  assert.match(worker,/유형별 Stage 2 공통 지침/u);
  assert.doesNotMatch(worker,/TYPE_0[1-6]_.*\.md.*E:\\/u);
});
