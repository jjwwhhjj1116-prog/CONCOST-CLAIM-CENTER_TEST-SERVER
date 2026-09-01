import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const ADMIN_ID = '84000000-0000-4000-8000-000000000001';
const STAFF_ID = '84000000-0000-4000-8000-000000000002';

async function database(adminBeforeLegacySeeds: boolean) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys=ON');
  db.exec(`
    CREATE TABLE preview_users(id TEXT PRIMARY KEY,login_id TEXT,display_name TEXT,is_active INTEGER,roles_json TEXT);
    CREATE TABLE preview_report_prompt_sets(id TEXT PRIMARY KEY,organization_id TEXT,claim_type TEXT,name TEXT,system_prompt TEXT,status TEXT,version INTEGER,updated_by TEXT,updated_at TEXT,FOREIGN KEY(updated_by) REFERENCES preview_users(id));
    CREATE TABLE preview_report_chapter_prompts(id TEXT PRIMARY KEY,prompt_set_id TEXT,chapter_code TEXT,title TEXT,agent_code TEXT,role_prompt TEXT,instruction_prompt TEXT,ordinal INTEGER,version INTEGER,updated_by TEXT,updated_at TEXT,FOREIGN KEY(prompt_set_id) REFERENCES preview_report_prompt_sets(id),FOREIGN KEY(updated_by) REFERENCES preview_users(id));
    CREATE TABLE preview_report_prompt_history(id TEXT PRIMARY KEY,prompt_id TEXT,version INTEGER,role_prompt TEXT,instruction_prompt TEXT,changed_by TEXT,changed_at TEXT,UNIQUE(prompt_id,version),FOREIGN KEY(prompt_id) REFERENCES preview_report_chapter_prompts(id),FOREIGN KEY(changed_by) REFERENCES preview_users(id));
  `);
  const insertAdmin = () => {
    db.run('INSERT INTO preview_users VALUES (?,?,?,?,?)', [ADMIN_ID,'admin@con-cost.com','Admin',1,'["admin"]']);
    db.run('INSERT INTO preview_users VALUES (?,?,?,?,?)', [STAFF_ID,'staff@con-cost.com','Staff',1,'["staff"]']);
  };
  if (adminBeforeLegacySeeds) insertAdmin();
  db.exec(read('apps/cloudflare/migrations/0024_cf32_source_template_library.sql'));
  db.exec(read('apps/cloudflare/migrations/0025_cf33_type_authoring_guidelines.sql'));
  if (!adminBeforeLegacySeeds) insertAdmin();
  db.exec(read('apps/cloudflare/migrations/0054_cf84_claim_report_guideline_package.sql'));
  return db;
}

test('CF84 repairs the test D1 seed-order gap and activates the supplied package', async () => {
  const db = await database(false);
  assert.equal(Number(db.exec('SELECT COUNT(*) FROM preview_report_prompt_sets')[0].values[0][0]), 6);
  assert.equal(Number(db.exec('SELECT COUNT(*) FROM preview_report_template_categories')[0].values[0][0]), 9);
  assert.equal(Number(db.exec('SELECT COUNT(*) FROM preview_report_type_guidelines')[0].values[0][0]), 6);
  assert.equal(Number(db.exec("SELECT COUNT(*) FROM preview_report_chapter_prompts WHERE status='ACTIVE'")[0].values[0][0]), 60);
  assert.equal(Number(db.exec('SELECT COUNT(*) FROM preview_report_prompt_source_basis')[0].values[0][0]), 60);
  const counts = db.exec("SELECT s.claim_type,COUNT(p.id) FROM preview_report_prompt_sets s JOIN preview_report_chapter_prompts p ON p.prompt_set_id=s.id AND p.status='ACTIVE' GROUP BY s.claim_type ORDER BY s.claim_type")[0].values;
  assert.deepEqual(counts.map((row) => [row[0], Number(row[1])]), [
    ['TYPE-01',10],['TYPE-02',10],['TYPE-03',10],['TYPE-04',10],['TYPE-05',10],['TYPE-06',10]
  ]);
  assert.deepEqual(db.exec('PRAGMA foreign_key_check'), []);
  assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok');
  db.close();
});

test('CF84 preserves all CT, module, output-profile and conditional chapter instructions', async () => {
  const db = await database(true);
  const raw = String(db.exec("SELECT config_json FROM preview_report_guideline_packages WHERE status='ACTIVE'")[0].values[0][0]);
  const config = JSON.parse(raw) as { claimTypes: unknown[]; modules: unknown[]; outputProfiles: unknown[]; classificationModel: { routingPriority: string[] } };
  assert.equal(config.claimTypes.length, 6);
  assert.equal(config.modules.length, 11);
  assert.equal(config.outputProfiles.length, 9);
  assert.deepEqual(config.classificationModel.routingPriority, ['CT05','CT04','CT01','CT06','CT02','CT03']);
  const guide = db.exec("SELECT source_sha256,stage1_prompt,stage2_prompt FROM preview_report_type_guidelines WHERE claim_type='TYPE-02'")[0].values[0];
  assert.equal(String(guide[0]), '37a53a68e36c5855e9de8458433b496d51f930db7e6fe36453a9160cb5c9a8ca');
  assert.match(String(guide[1]), /주유형 정확히 1개.*출력 프로필 정확히 1개/u);
  assert.match(String(guide[2]), /판례 안전 규칙/u);
  const conditional = String(db.exec("SELECT instruction_prompt FROM preview_report_chapter_prompts WHERE id='PROMPT-TYPE-02-CH-09'")[0].values[0][0]);
  assert.match(conditional, /조건부 챕터/u);
  assert.match(conditional, /NOT_APPLICABLE/u);
  assert.equal(Number(db.exec("SELECT COUNT(*) FROM preview_report_template_categories WHERE source_file_count>0")[0].values[0][0]), 9);
  db.close();
});

test('CF84 keeps package snapshots immutable and restores Admin-versioned prompt guards', async () => {
  const db = await database(true);
  assert.throws(() => db.run('UPDATE preview_report_guideline_packages SET package_name=?', ['tamper']), /immutable/u);
  assert.throws(() => db.run("UPDATE preview_report_chapter_prompts SET role_prompt=?,version=version+1,updated_by=?,updated_at=? WHERE id='PROMPT-TYPE-01-CH-01'", ['staff edit is blocked',STAFF_ID,'2099-01-01T00:00:00.000Z']), /active Admin/u);
  assert.throws(() => db.run("DELETE FROM preview_report_type_guidelines WHERE claim_type='TYPE-01'"), /cannot be deleted/u);
  db.close();
});
