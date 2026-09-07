import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
const oldSql=readFileSync('apps/cloudflare/migrations/0032_cf40_pm_schedule_ai_import_security.sql','utf8');
const migration=readFileSync('apps/cloudflare/migrations/0060_cf116_workflow_import_access_guard.sql','utf8');
function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE preview_cases(id TEXT PRIMARY KEY,organization_id TEXT,deleted_at TEXT);
    CREATE TABLE preview_users(id TEXT PRIMARY KEY,is_active INTEGER,roles_json TEXT);
    CREATE TABLE preview_case_assignments(case_id TEXT,user_id TEXT);
    CREATE TABLE preview_ai_data_governance(organization_id TEXT,confidential_external_ai_enabled INTEGER,provider_service_tier TEXT);
    INSERT INTO preview_cases VALUES('project','concost',NULL),('other-org','other',NULL),('deleted','concost','2026-09-07');
    INSERT INTO preview_users VALUES('admin',1,'["admin"]'),('assigned',1,'["pm"]'),('outsider',1,'["pm"]'),('disabled',0,'["admin"]');
    INSERT INTO preview_case_assignments VALUES('project','assigned');
    INSERT INTO preview_ai_data_governance VALUES('concost',1,'PAID_NO_PRODUCT_IMPROVEMENT');`);
  db.exec(oldSql.slice(oldSql.indexOf('CREATE TABLE preview_workflow_ai_imports'),oldSql.indexOf('CREATE TABLE preview_ai_data_governance')));
  db.exec(oldSql.slice(oldSql.indexOf('CREATE TRIGGER preview_workflow_ai_import_insert_guard'),oldSql.indexOf('CREATE TRIGGER preview_ai_governance_update_guard')));
  const add=(actor='admin',dataClass='INTERNAL',status='SUCCEEDED',model='gemini-3.7-flash',error:string|null=null,project='project')=>db.prepare(`INSERT INTO preview_workflow_ai_imports(id,organization_id,case_id,workflow_kind,original_name,mime_type,byte_size,source_sha256,data_class,redaction_count,provider_kind,model_code,status,error_code,created_by,created_at) VALUES(?,'concost',?,'KICKOFF','meeting.wav','audio/wav',100,?, ?,0,'GEMINI',?,?,?,?,?)`).run(crypto.randomUUID(),project,'a'.repeat(64),dataClass,model,status,error,actor,'2026-09-07T00:00:00Z');
  return {db,add};
}
test('CF116 exact legacy guard fails unassigned admin; replacement preserves existing audits and permits current project access',()=>{
  const {db,add}=fixture();try{
    add('assigned');const before=db.prepare('SELECT * FROM preview_workflow_ai_imports').all();
    assert.throws(()=>add(),/outside approved data policy/);
    db.exec(migration);assert.deepEqual(db.prepare('SELECT * FROM preview_workflow_ai_imports').all(),before);
    db.exec(migration);assert.deepEqual(db.prepare('SELECT * FROM preview_workflow_ai_imports').all(),before);
    add();add('assigned');
    for(const actor of ['outsider','disabled','missing'])assert.throws(()=>add(actor),/access or external data policy/);
    for(const project of ['other-org','deleted','missing'])assert.throws(()=>add('admin','INTERNAL','SUCCEEDED','gemini-3.7-flash',null,project),/access or external data policy/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');
  }finally{db.close();}
});
test('CF116 local original-only imports work without external consent, while every company class retains paid-policy protection',()=>{
  const {db,add}=fixture();try{
    db.exec(migration);db.exec("UPDATE preview_ai_data_governance SET confidential_external_ai_enabled=0,provider_service_tier='UNVERIFIED_OR_FREE'");
    for(const dataClass of ['INTERNAL','CONFIDENTIAL','RESTRICTED']){
      for(const status of ['SUCCEEDED','FAILED'])assert.throws(()=>add('admin',dataClass,status),/access or external data policy/);
      add('admin',dataClass,'BLOCKED_BY_POLICY');
      add('admin',dataClass,'SUCCEEDED','local-structured-v1','LOCAL_STRUCTURED_FALLBACK');
      for(const error of [null,'WRONG_CODE'])assert.throws(()=>add('admin',dataClass,'SUCCEEDED','local-structured-v1',error),/access or external data policy/);
    }
    add('admin','GENERAL');
    assert.throws(()=>add('outsider','INTERNAL','BLOCKED_BY_POLICY'),/access or external data policy/);
  }finally{db.close();}
});
