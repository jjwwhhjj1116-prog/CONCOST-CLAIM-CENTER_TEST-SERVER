import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';
import {
  CLAIM_CENTER_DEPARTMENT_FOLDER_NAME,
  CONCOST_DRIVE_ROOT_NAME,
  ensureClaimCenterDepartmentRoot,
  type GoogleFetch
} from '../apps/cloudflare/src/google-drive.js';

const CASE_ID = '85000000-0000-4000-8000-000000000001';

class SqlStatement {
  private values: unknown[] = [];
  constructor(private readonly database: Database, private readonly sql: string) {}
  bind(...values: unknown[]): SqlStatement { this.values = values; return this; }
  async first<T>(): Promise<T | null> { const statement=this.database.prepare(this.sql); try { statement.bind(this.values as never[]); return statement.step()?statement.getAsObject() as T:null; } finally { statement.free(); } }
  async all<T>(): Promise<{ results: T[] }> { const statement=this.database.prepare(this.sql); const results:T[]=[]; try { statement.bind(this.values as never[]); while(statement.step())results.push(statement.getAsObject() as T); return {results}; } finally { statement.free(); } }
  async run(): Promise<{ success: boolean; meta: { changes: number } }> { this.database.run(this.sql,this.values as never[]); return {success:true,meta:{changes:this.database.getRowsModified()}}; }
}
class SqlD1 { constructor(private readonly database: Database) {} prepare(sql:string):SqlStatement{return new SqlStatement(this.database,sql);} }

async function digest(value:string):Promise<string>{const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(hash)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');}

test('CF85 기존 회원은 클레임센터로 이전되고 신규 회원은 부서 미지정으로 시작한다', async () => {
  const SQL=await initSqlJs(); const db=new SQL.Database();
  db.exec(`
    CREATE TABLE preview_users(id TEXT PRIMARY KEY,is_active INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE preview_user_admin_events(id TEXT PRIMARY KEY,actor_id TEXT,target_user_id TEXT,action TEXT,detail_json TEXT,created_at TEXT);
    CREATE TRIGGER preview_users_version_guard BEFORE UPDATE ON preview_users WHEN NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'login account update requires optimistic version'); END;
    CREATE TRIGGER preview_user_admin_events_update_guard BEFORE UPDATE ON preview_user_admin_events BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER preview_user_admin_events_delete_guard BEFORE DELETE ON preview_user_admin_events BEGIN SELECT RAISE(ABORT,'append-only'); END;
    INSERT INTO preview_users VALUES ('existing',1,1);
  `);
  db.exec(readFileSync('apps/cloudflare/migrations/0055_cf85_drive_department_access.sql','utf8'));
  assert.equal(db.exec("SELECT department_code FROM preview_users WHERE id='existing'")[0].values[0][0],'CLAIM_CENTER');
  assert.equal(db.exec("SELECT version FROM preview_users WHERE id='existing'")[0].values[0][0],2);
  db.exec("INSERT INTO preview_users(id,is_active) VALUES ('new',1)");
  assert.equal(db.exec("SELECT department_code FROM preview_users WHERE id='new'")[0].values[0][0],'UNASSIGNED');
  db.close();
});

test('CF85 오래된 Drive 루트 이름은 파일 ID를 유지한 채 표준 이름으로 복구한다', async () => {
  const calls:Array<{method:string;url:URL;body:Record<string,unknown>|null}>=[];
  const fetcher:GoogleFetch=async(input,init)=>{
    const url=new URL(String(input)); const method=init?.method??'GET';
    const body=typeof init?.body==='string'?JSON.parse(init.body) as Record<string,unknown>:null;
    calls.push({method,url,body});
    if(method==='GET'){
      const query=url.searchParams.get('q')??'';
      if(query.includes("value='ORGANIZATION_ROOT'"))return Response.json({files:[{id:'organization_root_85001',name:'CONCOST ERP 그룹웨어',mimeType:'application/vnd.google-apps.folder',trashed:false}]});
      if(query.includes("value='DEPARTMENT_ROOT'"))return Response.json({files:[{id:'department_root_850001',name:'02_클레임센터',mimeType:'application/vnd.google-apps.folder',trashed:false,parents:['organization_root_85001']}]});
    }
    if(method==='PATCH'&&url.pathname.endsWith('/organization_root_85001'))return Response.json({id:'organization_root_85001',name:CONCOST_DRIVE_ROOT_NAME});
    if(method==='PATCH'&&url.pathname.endsWith('/department_root_850001'))return Response.json({id:'department_root_850001',name:CLAIM_CENTER_DEPARTMENT_FOLDER_NAME});
    return new Response('unexpected',{status:500});
  };
  const result=await ensureClaimCenterDepartmentRoot(fetcher,'token');
  assert.deepEqual(result,{organizationRootId:'organization_root_85001',departmentRootId:'department_root_850001'});
  assert.deepEqual(calls.filter((call)=>call.method==='PATCH').map((call)=>call.body?.name),['CONCOST 자료실','20_클레임센터']);
});

test('CF85 Drive API는 스튜디오 세션의 부서 권한을 서버에서 강제한다', async () => {
  const SQL=await initSqlJs(); const db=new SQL.Database(); const now='2026-09-01T00:00:00.000Z';
  db.exec(`
    CREATE TABLE preview_users(id TEXT PRIMARY KEY,login_id TEXT,display_name TEXT,email TEXT,roles_json TEXT,is_active INTEGER,department_code TEXT);
    CREATE TABLE preview_sessions(id_hash TEXT PRIMARY KEY,user_id TEXT,created_at TEXT,expires_at TEXT);
    CREATE TABLE preview_cases(id TEXT PRIMARY KEY,organization_id TEXT,case_number TEXT,title TEXT,description TEXT,claim_type TEXT,status TEXT,version INTEGER,category_major TEXT,category_middle TEXT,category_minor TEXT,client_legal_position TEXT,client_position_detail TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE preview_case_assignments(case_id TEXT,user_id TEXT);
    CREATE TABLE preview_proposals(id TEXT PRIMARY KEY,organization_id TEXT,case_id TEXT,status TEXT);
    CREATE TABLE preview_proposal_links(id TEXT PRIMARY KEY,organization_id TEXT,case_id TEXT,proposal_number TEXT,award_status TEXT);
    CREATE TABLE preview_award_effective_states(proposal_link_id TEXT PRIMARY KEY,effective_status TEXT);
    CREATE TABLE preview_catalog_records(record_kind TEXT,record_id TEXT,organization_id TEXT,db_deleted INTEGER,PRIMARY KEY(record_kind,record_id));
    CREATE TABLE preview_case_evidence(id TEXT,case_id TEXT,organization_id TEXT,category TEXT,workflow_category TEXT,original_name TEXT,mime_type TEXT,byte_size INTEGER,sha256 TEXT,chunk_count INTEGER,storage_provider TEXT,uploaded_by_name TEXT,uploaded_at TEXT);
    CREATE TABLE preview_google_case_operations(workflow_category TEXT);
    CREATE TABLE preview_google_case_evidence(id TEXT,case_id TEXT,organization_id TEXT,category TEXT,workflow_category TEXT,original_name TEXT,mime_type TEXT,byte_size INTEGER,sha256 TEXT,uploaded_by_name TEXT,uploaded_at TEXT,google_file_id TEXT,google_folder_id TEXT);
  `);
  db.run('INSERT INTO preview_cases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[CASE_ID,'concost','CC-2026-00085','Drive 권한 검증',null,'TYPE-01','CONTRACT',1,'기술','클레임','검토','UNSPECIFIED',null,now,now,null]);
  const proposal='85000000-0000-4000-8000-000000000002'; const link='85000000-0000-4000-8000-000000000003';
  db.run('INSERT INTO preview_proposals VALUES (?,?,?,?)',[proposal,'concost',CASE_ID,'APPROVED']);
  db.run('INSERT INTO preview_proposal_links VALUES (?,?,?,?,?)',[link,'concost',CASE_ID,'PROP-85','WON']);
  db.run('INSERT INTO preview_award_effective_states VALUES (?,?)',[link,'WON']);
  const members=[
    ['claim','CLAIM_CENTER','["staff"]'],['support','MANAGEMENT_SUPPORT','["staff"]'],['developer','DEVELOPMENT','["staff"]'],['admin','DEVELOPMENT','["admin"]']
  ];
  const env:CloudflareEnv={DB:new SqlD1(db) as unknown as NonNullable<CloudflareEnv['DB']>};
  for(const [login,department,roles] of members){
    const id=`85000000-0000-4000-8000-${login.padEnd(12,'0').slice(0,12)}`; const token=`cf85-${login}-token`;
    db.run('INSERT INTO preview_users VALUES (?,?,?,?,?,?,?)',[id,login,login,`${login}@example.invalid`,roles,1,department]);
    db.run('INSERT INTO preview_sessions VALUES (?,?,?,?)',[await digest(token),id,now,'2099-01-01T00:00:00.000Z']);
    const response=await worker.fetch(new Request(`https://preview.example/api/cases/${CASE_ID}/evidence`,{headers:{'X-Session-Token':token}}),env);
    if(login==='developer'){
      assert.equal(response.status,403,`${login} department policy`);
      assert.equal((await response.json() as {code:string}).code,'DRIVE_DEPARTMENT_FORBIDDEN');
    }else{
      assert.notEqual(response.status,403,`${login} must pass the Drive department gate`);
    }
  }
  db.close();
});

test('CF85 UI는 실제 Drive 경로와 부서 권한을 회원에게 명확히 표시한다', () => {
  const hub=readFileSync('apps/web/src/routes/PreviewEvidenceHub.tsx','utf8');
  const evidence=readFileSync('apps/web/src/evidence/CaseEvidencePanel.tsx','utf8');
  const users=readFileSync('apps/web/src/routes/PreviewAdminUsers.tsx','utf8');
  assert.match(hub,/CONCOST 자료실 \/ 20_클레임센터/u);
  assert.match(hub,/폴더 구조 확인·복구/u);
  assert.match(evidence,/자료종류\(업로더_날짜\)/u);
  assert.match(users,/Drive 부서 권한/u);
});
