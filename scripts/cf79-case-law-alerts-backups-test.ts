import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN_ID='79000000-0000-4000-8000-000000000001';
const STAFF_ID='79000000-0000-4000-8000-000000000002';
const ADMIN_TOKEN='cf79-admin-session-token';
const STAFF_TOKEN='cf79-staff-session-token';
const migration=(name:string)=>readFileSync(join(process.cwd(),'apps','cloudflare','migrations',name),'utf8');

class SqlStatement {
  private values:unknown[]=[];
  constructor(private database:Database,private sql:string){}
  bind(...values:unknown[]){this.values=values;return this;}
  async first<T>(){const statement=this.database.prepare(this.sql);try{statement.bind(this.values as never[]);return statement.step()?statement.getAsObject() as T:null;}finally{statement.free();}}
  async all<T>(){const statement=this.database.prepare(this.sql);const results:T[]=[];try{statement.bind(this.values as never[]);while(statement.step())results.push(statement.getAsObject() as T);return{results};}finally{statement.free();}}
  async run(){this.database.run(this.sql,this.values as never[]);return{success:true,meta:{changes:this.database.getRowsModified()}};}
}
class SqlD1 {
  constructor(readonly database:Database){}
  prepare(sql:string){return new SqlStatement(this.database,sql);}
  async batch(statements:SqlStatement[]){this.database.run('BEGIN IMMEDIATE');try{const results=[];for(const statement of statements)results.push(await statement.run());this.database.run('COMMIT');return results;}catch(error){this.database.run('ROLLBACK');throw error;}}
}

const MIGRATIONS=[
  '0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql',
  '0004_cf05_google_drive.sql','0005_cf06_case_operations.sql','0006_cf07_report_studio_drafts.sql','0007_cf08_report_review_approval.sql','0008_cf09_final_output.sql','0009_cf09_output_actor_scope.sql',
  '0010_cf10_product_experience.sql','0011_cf11_project_workflow.sql','0012_cf12_report_ai_prompts.sql','0013_cf13_litigation_records.sql','0014_cf14_proposal_award_workflow.sql','0015_cf15_case_evidence_library.sql','0016_cf18_report_outline_evidence.sql','0017_cf19_multi_provider_ai.sql','0018_cf26_ai_credentials.sql','0019_cf27_proposal_authoring.sql','0020_cf28_workspace_settings.sql','0021_cf29_report_memory_learning.sql','0022_cf30_settings_template_preview.sql','0023_cf31_google_oauth_app_settings.sql','0024_cf32_source_template_library.sql','0025_cf33_type_authoring_guidelines.sql','0026_cf34_hermes_memory_architecture.sql','0027_cf35_guided_workspace.sql','0028_cf36_workflow_integrity_tutorial_approval_intake.sql','0029_cf37_report_workspace_resume.sql','0030_cf38_admin_account_management.sql','0031_cf39_integrated_project_workspace.sql','0032_cf40_pm_schedule_ai_import_security.sql','0033_cf42_proposal_studio.sql','0034_cf42_proposal_template_catalog.sql','0035_cf43_navigation_pm_password.sql','0036_cf44_proposal_pdf_template_source.sql','0037_cf47_intake_source.sql','0038_cf48_proposal_company_assets.sql','0039_cf51_proposal_prompt_management.sql','0040_cf52_hermes_bridge_intake_catalog.sql','0041_cf53_erp_project_bridge.sql','0042_cf54_proposal_template_prompt_profiles.sql','0043_cf60_structured_document_editor.sql','0044_cf64_proposal_full_chapter_editing.sql','0045_cf65_proposal_common_chapter_12.sql','0046_cf69_proposal_asset_versions.sql','0047_cf72_project_members_calendar.sql','0048_cf73_workflow_minutes_parity.sql','0049_cf75_ai_model_catalog.sql','0050_cf77_shared_intake_report_collaboration.sql','0051_cf78_business_card_contacts.sql','0052_cf79_case_law_member_alerts_backups.sql'
];

async function tokenHash(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');}
function req(path:string,token:string,init:RequestInit={}){const headers=new Headers(init.headers);headers.set('X-Session-Token',token);if(init.body&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');return new Request(`https://preview.example${path}`,{...init,headers});}
function kstToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}

async function setup():Promise<{sql:Database;env:CloudflareEnv}> {
  const SQL=await initSqlJs();const sql=new SQL.Database();sql.run('PRAGMA foreign_keys=ON');
  for(const name of MIGRATIONS.slice(0,4))sql.exec(migration(name));
  const now='2026-08-31T00:00:00.000Z';
  sql.run('INSERT INTO preview_users (id,login_id,password_salt,password_hash,password_iterations,display_name,email,roles_json,is_active,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)',[ADMIN_ID,'cf79-admin','1'.repeat(32),'2'.repeat(64),100000,'현동명','cf79-admin@example.invalid','["admin"]',now]);
  for(const name of MIGRATIONS.slice(4))sql.exec(migration(name));
  sql.run('INSERT INTO preview_users (id,login_id,password_salt,password_hash,password_iterations,display_name,email,roles_json,is_active,created_at,version) VALUES (?,?,?,?,?,?,?,?,1,?,1)',[STAFF_ID,'cf79-staff','3'.repeat(32),'4'.repeat(64),100000,'회원','cf79-staff@example.invalid','["staff"]',now]);
  for(const [token,id] of [[ADMIN_TOKEN,ADMIN_ID],[STAFF_TOKEN,STAFF_ID]] as const)sql.run('INSERT INTO preview_sessions (id_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)',[await tokenHash(token),id,now,'2099-01-01T00:00:00.000Z']);
  const lawFetch:typeof fetch=async(input)=>{
    const url=new URL(String(input));const id=url.searchParams.get('ID')??'12345';
    const row={판례일련번호:id,법원명:'대법원',사건번호:'2024다12345',선고일자:'2024. 5. 30.',사건명:'손해배상(기)',판시사항:'계약상 의무와 손해배상 범위에 관한 판단',판결요지:'구체적 사실관계와 계약 내용을 종합하여 판단하여야 한다.'};
    return Response.json(url.pathname.endsWith('lawSearch.do')?{PrecSearch:{prec:[row]}}:{PrecService:row});
  };
  return{sql,env:{DB:new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']>,LAW_API_OC:'cf79-test-oc',LAW_API_TEST_FETCH:lawFetch}};
}

function insertCase(sql:Database,id:string,number:string,title:string,status='INQUIRY'){
  const now='2026-08-31T00:00:00.000Z';
  sql.run('INSERT INTO preview_cases (id,organization_id,case_number,title,description,claim_type,status,version,category_major,category_middle,category_minor,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,'concost',number,title,'하자보수보증금과 지체상금 쟁점','TYPE-01',status,1,'클레임','기술검토','보고서',ADMIN_ID,now,now]);
}

function insertAwardedProject(sql:Database,caseId:string){
  const now='2026-08-31T00:00:00.000Z';const proposalId='79ab0000-0000-4000-8000-000000000010';const linkId='79ab0000-0000-4000-8000-000000000011';
  insertCase(sql,caseId,'CC-2026-79079','전 회원 수주 알림','INQUIRY');
  sql.run('INSERT INTO preview_proposals (id,organization_id,case_id,template_id,template_name_snapshot,template_body_snapshot,title,status,version,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[proposalId,'concost',caseId,'template-cf79','테스트 템플릿','본문','수주 알림 제안서','APPROVED',1,ADMIN_ID,now,now]);
  sql.run('INSERT INTO preview_proposal_links (id,organization_id,case_id,proposal_number,proposal_title,revision_label,client_name,sent_at,verification_status,award_status,award_decided_at,award_decided_by,contract_amount_krw,project_start_on,project_end_on,version,request_key,request_fingerprint,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[linkId,'concost',caseId,'PROP-79AB0000','수주 알림 제안서','확정 v1','발주처',now,'UNVERIFIED','WON',now,ADMIN_ID,10000000,kstToday(),kstToday(),2,'cf79-award-project','7'.repeat(64),ADMIN_ID,now,now]);
  sql.run('INSERT INTO preview_award_effective_states (proposal_link_id,case_id,effective_status,version,updated_by,updated_at) VALUES (?,?,?,?,?,?)',[linkId,caseId,'WON',1,ADMIN_ID,now]);
  sql.run("UPDATE preview_cases SET status='CONTRACT',version=2,updated_at='2026-08-31T00:00:01.000Z' WHERE id=? AND version=1",[caseId]);
  sql.run('INSERT INTO preview_case_assignments (case_id,user_id,assigned_by,assigned_at) VALUES (?,?,?,?)',[caseId,ADMIN_ID,ADMIN_ID,now]);
  sql.run('INSERT INTO preview_case_assignments (case_id,user_id,assigned_by,assigned_at) VALUES (?,?,?,?)',[caseId,STAFF_ID,ADMIN_ID,now]);
  sql.run('INSERT INTO preview_project_schedule_profiles (case_id,organization_id,responsible_pm_id,version,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',[caseId,'concost',ADMIN_ID,1,ADMIN_ID,now,now]);
  sql.run('INSERT INTO preview_project_stage_schedules (id,organization_id,case_id,stage_code,start_date,end_date,status,note_text,version,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',['79ab0000-0000-4000-8000-000000000012','concost',caseId,'KICKOFF',kstToday(),kstToday(),'PLANNED','착수회의 투입',1,ADMIN_ID,now,now]);
}

test('CF79 migration is repeatable and keeps immutable recovery and case-law records',async()=>{
  const{sql}=await setup();sql.exec(migration('0052_cf79_case_law_member_alerts_backups.sql'));
  assert.deepEqual(sql.exec('PRAGMA foreign_key_check'),[]);assert.equal(sql.exec('PRAGMA integrity_check')[0].values[0][0],'ok');
  assert.equal(Number(sql.exec("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='preview_report_hourly_backup_delete_guard'")[0].values[0][0]),1);sql.close();
});

test('CF79 proposal authoring scope hides intake DB deletions for every member',async()=>{
  const{sql,env}=await setup();const visible='79000000-0000-4000-8000-000000000010';const deleted='79000000-0000-4000-8000-000000000011';
  insertCase(sql,visible,'CC-2026-79010','CF79 제안서 작업 노출');insertCase(sql,deleted,'CC-2026-79011','CF79 제안서 삭제 숨김');
  sql.run("INSERT INTO preview_catalog_records (record_kind,record_id,organization_id,db_deleted,version,updated_by,created_at,updated_at) VALUES ('INTAKE',?,'concost',1,1,?,?,?)",[deleted,ADMIN_ID,'2026-08-31T00:00:00.000Z','2026-08-31T00:00:00.000Z']);
  const response=await worker.fetch(req('/api/cases?scope=proposal-authoring&limit=100&q=CF79',STAFF_TOKEN),env);assert.equal(response.status,200);
  const body=await response.json() as {cases:Array<{id:string}>};assert.deepEqual(body.cases.map((row)=>row.id),[visible]);sql.close();
});

test('CF79 report autosave creates one hourly recovery backup while internal revisions stay append-only',async()=>{
  const{sql,env}=await setup();const caseId='79000000-0000-4000-8000-000000000020';insertCase(sql,caseId,'CC-2026-79020','CF79 자동 저장');
  const save=async(expectedVersion:number,content:string)=>worker.fetch(req(`/api/report-drafts?caseId=${caseId}`,ADMIN_TOKEN,{method:'PUT',body:JSON.stringify({title:'시간별 복구 보고서',content,editorJson:null,expectedVersion,wizardStep:3,selectedChapterId:null,saveKind:'AUTO'})}),env);
  assert.equal((await save(0,'첫 자동 저장')).status,200);assert.equal((await save(1,'두 번째 자동 저장')).status,200);
  assert.equal(Number(sql.exec(`SELECT COUNT(*) FROM preview_report_revisions WHERE case_id='${caseId}'`)[0].values[0][0]),2);
  assert.equal(Number(sql.exec(`SELECT COUNT(*) FROM preview_report_hourly_backups WHERE case_id='${caseId}'`)[0].values[0][0]),1);sql.close();
});

test('CF79 shows every member the award and only assigned members the daily stage todo, then records acknowledgement',async()=>{
  const{sql,env}=await setup();const caseId='79000000-0000-4000-8000-000000000030';insertAwardedProject(sql,caseId);
  const response=await worker.fetch(req('/api/member-alerts',STAFF_TOKEN),env);assert.equal(response.status,200);
  const payload=await response.json() as {awards:Array<{eventKey:string;projectTitle:string}>;todos:Array<{eventKey:string;stageLabel:string}>};
  assert.equal(payload.awards[0]?.projectTitle,'전 회원 수주 알림');assert.equal(payload.todos[0]?.stageLabel,'착수회의');
  const keys=[...payload.awards,...payload.todos].map((row)=>row.eventKey);const acknowledged=await worker.fetch(req('/api/member-alerts',STAFF_TOKEN,{method:'PUT',body:JSON.stringify({eventKeys:keys})}),env);assert.equal(acknowledged.status,200);
  const after=await acknowledged.json() as {awards:unknown[];todos:unknown[]};assert.deepEqual(after.awards,[]);assert.deepEqual(after.todos,[]);sql.close();
});

test('CF79 searches official case law and preserves selected source identity, source hash and official URL',async()=>{
  const{sql,env}=await setup();const caseId='79000000-0000-4000-8000-000000000040';insertCase(sql,caseId,'CC-2026-79040','CF79 판례 근거');
  const prompt=sql.exec("SELECT id FROM preview_report_chapter_prompts WHERE chapter_code='CH-01' LIMIT 1")[0].values[0][0] as string;
  const search=await worker.fetch(req('/api/report-authoring/case-law/search',ADMIN_TOKEN,{method:'POST',body:JSON.stringify({caseId,chapterId:prompt,query:'하자보수보증금'})}),env);assert.equal(search.status,200);
  const candidates=(await search.json() as {results:Array<{precId:string;caseNumber:string}>}).results;assert.equal(candidates[0]?.caseNumber,'2024다12345');
  const selected=await worker.fetch(req('/api/report-authoring/case-law/select',ADMIN_TOKEN,{method:'POST',body:JSON.stringify({caseId,chapterId:prompt,precIds:[candidates[0].precId]})}),env);assert.equal(selected.status,201);
  const source=(await selected.json() as {sources:Array<{sourceSha256:string;officialUrl:string}>}).sources[0];assert.equal(source.sourceSha256.length,64);assert.match(source.officialUrl,/^https:\/\/www\.law\.go\.kr\/precInfoP\.do\?precSeq=/u);
  assert.throws(()=>sql.run('DELETE FROM preview_report_case_law_sources'),/case-law source snapshots cannot be deleted/u);sql.close();
});

test('CF84 rejects duplicate selections and a law detail response whose identity differs from the requested precedent',async()=>{
  const{sql,env}=await setup();const caseId='79000000-0000-4000-8000-000000000041';insertCase(sql,caseId,'CC-2026-79041','CF84 판례 식별자 검증');
  const prompt=sql.exec("SELECT id FROM preview_report_chapter_prompts WHERE chapter_code='CH-01' LIMIT 1")[0].values[0][0] as string;
  const duplicate=await worker.fetch(req('/api/report-authoring/case-law/select',ADMIN_TOKEN,{method:'POST',body:JSON.stringify({caseId,chapterId:prompt,precIds:['12345','12345']})}),env);
  assert.equal(duplicate.status,400);assert.equal((await duplicate.json() as {code:string}).code,'INVALID_CASE_LAW_SELECTION');
  env.LAW_API_TEST_FETCH=async()=>Response.json({PrecService:{판례일련번호:'99999',법원명:'대법원',사건번호:'2024다99999',선고일자:'2024. 5. 30.',사건명:'다른 판례',판시사항:'다른 판시사항',판결요지:'다른 판결요지'}});
  const mismatch=await worker.fetch(req('/api/report-authoring/case-law/select',ADMIN_TOKEN,{method:'POST',body:JSON.stringify({caseId,chapterId:prompt,precIds:['12345']})}),env);
  assert.equal(mismatch.status,502);assert.equal((await mismatch.json() as {code:string}).code,'LAW_API_DETAIL_ID_MISMATCH');
  assert.equal(Number(sql.exec('SELECT COUNT(*) FROM preview_report_case_law_sources')[0].values[0][0]),0);sql.close();
});

test('CF79 report UI exposes case-law selection/review and removes the redundant project basics tile',()=>{
  const studio=readFileSync('apps/web/src/routes/PreviewReportStudio.tsx','utf8');const proposal=readFileSync('apps/web/src/proposals/ProposalView.tsx','utf8');const shell=readFileSync('apps/web/src/layout/AppShell.tsx','utf8');
  assert.match(studio,/판례 근거 추가/u);assert.match(studio,/판례 인용 검수/u);assert.doesNotMatch(studio,/프로젝트 기본정보/u);assert.match(studio,/복구용 백업은 1시간 단위/u);
  assert.match(proposal,/scope=proposal-authoring/u);assert.match(shell,/신규 프로젝트 수주/u);assert.match(shell,/투입 To-do/u);
});

test('CF84 treats generated citation markers as identity links pending human review',()=>{
  const workerSource=readFileSync('apps/cloudflare/src/index.ts','utf8');
  assert.match(workerSource,/CASE_LAW_SOURCE_MARKER_MISMATCH/u);
  assert.match(workerSource,/status=markerAt>=0\?'REVIEW_REQUIRED':'INSUFFICIENT'/u);
  assert.doesNotMatch(workerSource,/status=markerAt>=0\?'VERIFIED'/u);
});
