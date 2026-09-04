import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';
import { encryptSecret, GOOGLE_DRIVE_SCOPE, GOOGLE_DRIVE_UPLOAD_API } from '../apps/cloudflare/src/google-drive.js';

const ADMIN_ID='78000000-0000-4000-8000-000000000001'; const STAFF_ID='78000000-0000-4000-8000-000000000002'; const PM_ID='78000000-0000-4000-8000-000000000003';
const ADMIN_TOKEN='cf78-admin-session-token'; const STAFF_TOKEN='cf78-staff-session-token'; const MASTER_KEY='78'.repeat(32);
const migration=(name:string)=>readFileSync(join(process.cwd(),'apps','cloudflare','migrations',name),'utf8');

class SqlStatement { private values:unknown[]=[]; constructor(private database:Database,private sql:string){} bind(...values:unknown[]){this.values=values;return this;} async first<T>(){const statement=this.database.prepare(this.sql);try{statement.bind(this.values as never[]);return statement.step()?statement.getAsObject() as T:null;}finally{statement.free();}} async all<T>(){const statement=this.database.prepare(this.sql);const results:T[]=[];try{statement.bind(this.values as never[]);while(statement.step())results.push(statement.getAsObject() as T);return{results};}finally{statement.free();}} async run(){this.database.run(this.sql,this.values as never[]);return{success:true,meta:{changes:this.database.getRowsModified()}};} }
class SqlD1 { constructor(readonly database:Database){} prepare(sql:string){return new SqlStatement(this.database,sql);} async batch(statements:SqlStatement[]){this.database.run('BEGIN IMMEDIATE');try{const results=[];for(const statement of statements)results.push(await statement.run());this.database.run('COMMIT');return results;}catch(error){this.database.run('ROLLBACK');throw error;}} }
async function tokenHash(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');}

const MIGRATIONS=[
  '0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql',
  '0004_cf05_google_drive.sql','0005_cf06_case_operations.sql','0006_cf07_report_studio_drafts.sql','0007_cf08_report_review_approval.sql','0008_cf09_final_output.sql','0009_cf09_output_actor_scope.sql',
  '0010_cf10_product_experience.sql','0011_cf11_project_workflow.sql','0012_cf12_report_ai_prompts.sql','0013_cf13_litigation_records.sql','0014_cf14_proposal_award_workflow.sql','0015_cf15_case_evidence_library.sql','0016_cf18_report_outline_evidence.sql','0017_cf19_multi_provider_ai.sql','0018_cf26_ai_credentials.sql','0019_cf27_proposal_authoring.sql','0020_cf28_workspace_settings.sql','0021_cf29_report_memory_learning.sql','0022_cf30_settings_template_preview.sql','0023_cf31_google_oauth_app_settings.sql','0024_cf32_source_template_library.sql','0025_cf33_type_authoring_guidelines.sql','0026_cf34_hermes_memory_architecture.sql','0027_cf35_guided_workspace.sql','0028_cf36_workflow_integrity_tutorial_approval_intake.sql','0029_cf37_report_workspace_resume.sql','0030_cf38_admin_account_management.sql','0031_cf39_integrated_project_workspace.sql','0032_cf40_pm_schedule_ai_import_security.sql','0033_cf42_proposal_studio.sql','0034_cf42_proposal_template_catalog.sql','0035_cf43_navigation_pm_password.sql','0036_cf44_proposal_pdf_template_source.sql','0037_cf47_intake_source.sql','0038_cf48_proposal_company_assets.sql','0039_cf51_proposal_prompt_management.sql','0040_cf52_hermes_bridge_intake_catalog.sql','0041_cf53_erp_project_bridge.sql','0042_cf54_proposal_template_prompt_profiles.sql','0043_cf60_structured_document_editor.sql','0044_cf64_proposal_full_chapter_editing.sql','0045_cf65_proposal_common_chapter_12.sql','0046_cf69_proposal_asset_versions.sql','0047_cf72_project_members_calendar.sql','0048_cf73_workflow_minutes_parity.sql','0049_cf75_ai_model_catalog.sql','0050_cf77_shared_intake_report_collaboration.sql','0051_cf78_business_card_contacts.sql'
];

async function setup():Promise<{sql:Database;env:CloudflareEnv}> {
  const SQL=await initSqlJs();const sql=new SQL.Database();sql.run('PRAGMA foreign_keys=ON');
  for(const name of MIGRATIONS.slice(0,4))sql.exec(migration(name));
  const now='2026-08-31T00:00:00.000Z';
  sql.run('INSERT INTO preview_users (id,login_id,password_salt,password_hash,password_iterations,display_name,email,roles_json,is_active,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)',[ADMIN_ID,'admin@example.invalid','1'.repeat(32),'2'.repeat(64),100000,'관리자','admin@example.invalid','["admin"]',now]);
  for(const name of MIGRATIONS.slice(4))sql.exec(migration(name));
  sql.run('INSERT INTO preview_users (id,login_id,password_salt,password_hash,password_iterations,display_name,email,roles_json,is_active,created_at,version) VALUES (?,?,?,?,?,?,?,?,1,?,1)',[STAFF_ID,'staff@example.invalid','3'.repeat(32),'4'.repeat(64),100000,'회원','staff@example.invalid','["staff"]',now]);
  sql.run('INSERT INTO preview_users (id,login_id,password_salt,password_hash,password_iterations,display_name,email,roles_json,is_active,created_at,version) VALUES (?,?,?,?,?,?,?,?,1,?,1)',[PM_ID,'pm@example.invalid','5'.repeat(32),'6'.repeat(64),100000,'현동명','pm@example.invalid','["pm"]',now]);
  for(const [token,id] of [[ADMIN_TOKEN,ADMIN_ID],[STAFF_TOKEN,STAFF_ID]] as const)sql.run('INSERT INTO preview_sessions (id_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)',[await tokenHash(token),id,now,'2099-01-01T00:00:00.000Z']);
  const encrypted=await encryptSecret('refresh-token-cf78',MASTER_KEY,'concost:google-refresh');
  sql.run('INSERT INTO preview_google_credentials (organization_id,encrypted_refresh_token,iv,scope,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',['concost',encrypted.ciphertextHex,encrypted.ivHex,GOOGLE_DRIVE_SCOPE,ADMIN_ID,now,now]);
  let uploadedSize=0;let uploadedName='';
  const googleFetch:typeof fetch=async(input,init)=>{
    const target=String(input);const method=init?.method??'GET';
    if(target.includes('/token'))return Response.json({access_token:'access-token-cf78-valid',token_type:'Bearer'});
    if(target.startsWith(GOOGLE_DRIVE_UPLOAD_API)){const body=init?.body as Blob;const text=await body.text();uploadedName=(text.match(/"name":"([^"]+)"/u)?.[1]??'card.jpg');uploadedSize=100;return Response.json({id:'business_card_file_12345',name:uploadedName,mimeType:'image/jpeg',size:String(uploadedSize),webViewLink:'https://drive.google.com/file/d/business_card_file_12345/view'});}
    const url=new URL(target);if(method==='GET'&&url.pathname.endsWith('/files'))return Response.json({files:[]});
    if(method==='POST'&&url.pathname.endsWith('/files')){const body=JSON.parse(String(init?.body)) as {name:string;mimeType:string};const id=body.name==='CONCOST ERP 그룹웨어'?'concost_root_cf78':body.name==='02_클레임센터'?'claim_center_cf78':'business_cards_cf78';return Response.json({id,name:body.name,mimeType:body.mimeType,trashed:false,parents:[]});}
    return new Response('unexpected google request',{status:500});
  };
  const geminiFetch:typeof fetch=async()=>Response.json({candidates:[{content:{parts:[{text:JSON.stringify({name:'홍길동',company:'테크노바',department:'AI 개발팀',title:'수석연구원',mobile:'010-1234-5678',phone:'02-123-4567',fax:'',email:'gildong@technova.com',address:'서울특별시 송파구',website:'https://technova.com',notes:'',tags:'AI, 기술협력'})}]}}]});
  return{sql,env:{DB:new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']>,GEMINI_API_KEY:`AIza${'x'.repeat(40)}`,GEMINI_TEST_FETCH:geminiFetch,GOOGLE_TEST_FETCH:googleFetch,ALLOW_TEST_GOOGLE_MODES:'true',GOOGLE_CLIENT_ID:`${'1'.repeat(24)}.apps.googleusercontent.com`,GOOGLE_CLIENT_SECRET:'client-secret-cf78-valid',GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY:MASTER_KEY,GOOGLE_OAUTH_REDIRECT_ORIGIN:'https://preview.example',GOOGLE_ALLOWED_DOMAIN:'con-cost.com',GOOGLE_ALLOWED_ACCOUNT:'concost.dt@gmail.com'}};
}
function req(path:string,token:string,init:RequestInit={}){const headers=new Headers(init.headers);headers.set('X-Session-Token',token);return new Request(`https://preview.example${path}`,{...init,headers});}

test('CF77/CF78 migrations preserve existing rows, keep collaboration append-only, and are repeatable',async()=>{
  const{sql}=await setup();
  const before=Number(sql.exec('SELECT COUNT(*) FROM preview_cases')[0].values[0][0]);
  sql.exec(migration('0050_cf77_shared_intake_report_collaboration.sql'));sql.exec(migration('0051_cf78_business_card_contacts.sql'));
  assert.equal(Number(sql.exec('SELECT COUNT(*) FROM preview_cases')[0].values[0][0]),before);
  assert.deepEqual(sql.exec('PRAGMA foreign_key_check'),[]);assert.equal(sql.exec('PRAGMA integrity_check')[0].values[0][0],'ok');
  assert.equal(Number(sql.exec("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='preview_business_card_events_delete_guard'")[0].values[0][0]),1);
  sql.close();
});

test('CF77 shares the same active project schedule with unassigned members while keeping edit authority with PM/admin',async()=>{
  const{sql,env}=await setup();const created='2026-08-31T02:00:00.000Z';const accepted='2026-08-31T02:01:00.000Z';
  const caseId='79000000-0000-4000-8000-000000000010';const proposalId='79000000-0000-4000-8000-000000000011';const linkId='79000000-0000-4000-8000-000000000012';
  sql.run('INSERT INTO preview_cases (id,organization_id,case_number,title,claim_type,status,version,category_major,category_middle,category_minor,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[caseId,'concost','CC-2026-79010','전 회원 공유 일정','TYPE-01','INQUIRY',1,'클레임','기술검토','보고서',ADMIN_ID,created,created]);
  sql.run('INSERT INTO preview_proposals (id,organization_id,case_id,template_id,template_name_snapshot,template_body_snapshot,title,status,version,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[proposalId,'concost',caseId,'template-shared','공유 템플릿','본문','공유 제안서','APPROVED',1,ADMIN_ID,created,created]);
  sql.run('INSERT INTO preview_proposal_links (id,organization_id,case_id,proposal_number,proposal_title,revision_label,client_name,sent_at,verification_status,award_status,award_decided_at,award_decided_by,contract_amount_krw,project_start_on,project_end_on,version,request_key,request_fingerprint,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[linkId,'concost',caseId,'PROP-79000000','공유 제안서','확정 v1','공유 발주처',accepted,'UNVERIFIED','WON',accepted,ADMIN_ID,10000000,'2026-08-31','2026-09-30',2,'cf77-shared-schedule','7'.repeat(64),ADMIN_ID,created,accepted]);
  sql.run('INSERT INTO preview_award_effective_states (proposal_link_id,case_id,effective_status,version,updated_by,updated_at) VALUES (?,?,?,?,?,?)',[linkId,caseId,'WON',1,ADMIN_ID,accepted]);
  sql.run("UPDATE preview_cases SET status='CONTRACT',version=2,updated_at=? WHERE id=? AND version=1",[accepted,caseId]);
  const adminResponse=await worker.fetch(req('/api/project-workflow/schedule',ADMIN_TOKEN),env);const memberResponse=await worker.fetch(req('/api/project-workflow/schedule',STAFF_TOKEN),env);
  assert.equal(adminResponse.status,200);assert.equal(memberResponse.status,200);
  const adminProjects=(await adminResponse.json() as {projects:Array<{caseId:string}>}).projects;const memberProjects=(await memberResponse.json() as {projects:Array<{caseId:string;canManageSchedule:boolean}>}).projects;
  assert.deepEqual(memberProjects.map((project)=>project.caseId),adminProjects.map((project)=>project.caseId));assert.equal(memberProjects.find((project)=>project.caseId===caseId)?.canManageSchedule,false);
  sql.close();
});

test('CF77 enforces PM-owned chapter collaboration and recoverable delivered-project schedule removal',async()=>{
  const{sql,env}=await setup();const now='2026-08-31T01:00:00.000Z';const later='2026-08-31T01:01:00.000Z';
  const caseId='78000000-0000-4000-8000-000000000010';
  sql.run('INSERT INTO preview_cases (id,organization_id,case_number,title,claim_type,status,version,category_major,category_middle,category_minor,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[caseId,'concost','CC-2026-78010','협업 테스트','TYPE-01','CLOSED',1,'클레임','기술검토','보고서',PM_ID,now,now]);
  sql.run('INSERT INTO preview_case_assignments (case_id,user_id,assigned_by,assigned_at) VALUES (?,?,?,?)',[caseId,PM_ID,ADMIN_ID,now]);
  sql.run('INSERT INTO preview_case_assignments (case_id,user_id,assigned_by,assigned_at) VALUES (?,?,?,?)',[caseId,STAFF_ID,PM_ID,now]);
  sql.run('INSERT INTO preview_project_schedule_profiles (case_id,organization_id,responsible_pm_id,version,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',[caseId,'concost',PM_ID,1,PM_ID,now,now]);
  sql.run('INSERT INTO preview_report_chapter_assignments (case_id,organization_id,chapter_id,chapter_code,chapter_title,assignee_id,status,draft_text,version,assigned_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[caseId,'concost','chapter-01','CH-01','프로젝트 개요',STAFF_ID,'IN_PROGRESS','',1,PM_ID,PM_ID,now,now]);
  sql.run('UPDATE preview_report_chapter_assignments SET status=?,draft_text=?,version=?,updated_by=?,updated_at=? WHERE case_id=? AND chapter_id=?',['READY','회원 검수 초안',2,STAFF_ID,later,caseId,'chapter-01']);
  sql.run('INSERT INTO preview_report_chapter_revisions (id,case_id,chapter_id,version,status,draft_text,content_sha256,saved_by,saved_at) VALUES (?,?,?,?,?,?,?,?,?)',['78000000-0000-4000-8000-000000000011',caseId,'chapter-01',2,'READY','회원 검수 초안','a'.repeat(64),STAFF_ID,later]);
  assert.throws(()=>sql.run('UPDATE preview_report_chapter_assignments SET status=?,version=?,updated_by=?,updated_at=? WHERE case_id=? AND chapter_id=?',['APPLIED',3,STAFF_ID,'2026-08-31T01:02:00.000Z',caseId,'chapter-01']),/report chapter assignment update is invalid/u);
  sql.run('UPDATE preview_report_chapter_assignments SET status=?,version=?,updated_by=?,updated_at=? WHERE case_id=? AND chapter_id=?',['APPLIED',3,PM_ID,'2026-08-31T01:02:00.000Z',caseId,'chapter-01']);
  assert.throws(()=>sql.run('INSERT INTO preview_project_schedule_visibility (case_id,organization_id,visibility,reason_code,reason_text,drive_verified,verification_json,version,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[caseId,'concost','HIDDEN','DELIVERED_ARCHIVED','납품 완료 보관',0,'{}',1,PM_ID,now,now]),/project schedule visibility actor or archive manifest is invalid/u);
  sql.run('INSERT INTO preview_project_schedule_visibility (case_id,organization_id,visibility,reason_code,reason_text,drive_verified,manifest_sha256,verification_json,version,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[caseId,'concost','HIDDEN','DELIVERED_ARCHIVED','납품 완료 보관',1,'b'.repeat(64),'{"ready":true}',1,PM_ID,now,now]);
  assert.throws(()=>sql.run('DELETE FROM preview_project_schedule_visibility WHERE case_id=?',[caseId]),/project schedule visibility cannot be deleted/u);
  const denied=await worker.fetch(req('/api/report-authoring/outline/generate',STAFF_TOKEN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caseId})}),env);
  assert.equal(denied.status,403);assert.equal((await denied.json() as {code:string}).code,'RESPONSIBLE_PM_REQUIRED');sql.close();
});

test('CF108 collaboration APPLY uses the latest saved outline title, not the assignment snapshot', async () => {
  const { sql, env } = await setup();
  sql.exec(migration('0054_cf84_claim_report_guideline_package.sql'));
  const caseId = '78000000-0000-4000-8000-000000000108';
  const now = new Date().toISOString();
  sql.run('INSERT INTO preview_cases (id,organization_id,case_number,title,claim_type,status,version,category_major,category_middle,category_minor,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [caseId,'concost','CC-2026-78108','목차 반영 테스트','TYPE-01','INQUIRY',1,'클레임','기술검토','보고서',ADMIN_ID,now,now]);
  const configResponse = await worker.fetch(req(`/api/report-authoring/config?caseId=${caseId}`, ADMIN_TOKEN), env);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json() as { chapters: Array<{ id: string; chapterCode: string; title: string; promptVersion: number }> };
  assert.ok(config.chapters.length);
  const chapter = config.chapters[0];
  const call = (path: string, method: string, body: unknown, token = ADMIN_TOKEN) => worker.fetch(req(path, token, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);
  const collaborationPath = `/api/report-chapter-collaboration?caseId=${caseId}`;
  const assigned = await call(collaborationPath, 'PUT', { chapterId: chapter.id, assigneeId: STAFF_ID, expectedVersion: 0 });
  assert.equal(assigned.status, 200, await assigned.text());
  const ready = await call(collaborationPath, 'POST', { chapterId: chapter.id, action: 'MARK_READY', draftText: '회원 검수 원고 보존', expectedVersion: 1, expectedReportVersion: 0 }, STAFF_TOKEN);
  assert.equal(ready.status, 200, await ready.text());
  const draft = await call(`/api/report-drafts?caseId=${caseId}`, 'PUT', { title: '합성 보고서', content: '기존 다른 챕터 보존', editorJson: null, expectedVersion: 0, wizardStep: 4, selectedChapterId: chapter.id, saveKind: 'MANUAL' });
  assert.equal(draft.status, 200, await draft.text());
  const savePayload = { title: '합성 보고서', content: '기존 다른 챕터 보존', editorJson: null, expectedVersion: 1, wizardStep: 4, selectedChapterId: chapter.id, saveKind: 'MANUAL' };
  for (const invalidId of ['', 'with space', 'chapter/path', "chapter'quote", 'x'.repeat(101)]) {
    const invalid = await call(`/api/report-drafts?caseId=${caseId}`, 'PUT', { ...savePayload, selectedChapterId: invalidId });
    assert.equal(invalid.status, 400, invalidId);
  }
  const deniedSave = await call(`/api/report-drafts?caseId=${caseId}`, 'PUT', savePayload, STAFF_TOKEN);
  assert.equal(deniedSave.status, 403);
  const uuidSave = await call(`/api/report-drafts?caseId=${caseId}`, 'PUT', { ...savePayload, selectedChapterId: '78000000-0000-4000-8000-000000000109' });
  assert.equal(uuidSave.status, 200);
  const staleSave = await call(`/api/report-drafts?caseId=${caseId}`, 'PUT', savePayload);
  assert.equal(staleSave.status, 409);
  const outline = await call('/api/report-authoring/outline', 'PUT', { caseId, status: 'CONFIRMED', expectedVersion: 0, items: config.chapters.map(ch => ({ chapterId: ch.id, chapterCode: ch.chapterCode, chapterTitle: ch.id === chapter.id ? '검수 중 수정한 최신 제목' : ch.title, promptVersion: ch.promptVersion, planningNote: '' })) });
  assert.equal(outline.status, 200, await outline.text());
  const applied = await call(collaborationPath, 'POST', { chapterId: chapter.id, action: 'APPLY', draftText: '회원 검수 원고 보존', expectedVersion: 2, expectedReportVersion: 2 });
  assert.equal(applied.status, 200, await applied.text());
  const saved = sql.exec('SELECT content,version FROM preview_report_drafts WHERE case_id=?', [caseId])[0].values[0];
  assert.ok(String(saved[0]).includes(`## ${chapter.chapterCode} 검수 중 수정한 최신 제목`));
  assert.ok(String(saved[0]).includes('기존 다른 챕터 보존'));
  assert.ok(String(saved[0]).includes('회원 검수 원고 보존'));
  assert.equal(saved[1], 3);
  sql.close();
});

test('CF78 analyzes with Gemini, requires human-confirmed fields, stores the original in Drive, and supports admin-only soft archive',async()=>{
  const{sql,env}=await setup();const bytes=new Uint8Array(100);bytes.set([0xff,0xd8,0xff,0xe0]);const file=new File([bytes],'card.jpg',{type:'image/jpeg'});
  const analyzeForm=new FormData();analyzeForm.set('file',file);
  const analyzed=await worker.fetch(req('/api/business-cards/analyze',STAFF_TOKEN,{method:'POST',body:analyzeForm}),env);assert.equal(analyzed.status,200);
  const analysis=(await analyzed.json() as {analysis:{id:string;fields:Record<string,string>}}).analysis;assert.equal(analysis.fields.name,'홍길동');
  const registerForm=new FormData();registerForm.set('file',file);registerForm.set('analysisId',analysis.id);registerForm.set('fields',JSON.stringify(analysis.fields));
  const registered=await worker.fetch(req('/api/business-cards',STAFF_TOKEN,{method:'POST',headers:{'Idempotency-Key':'business-card:cf78-0001'},body:registerForm}),env);assert.equal(registered.status,201,await registered.text());
  const listed=await worker.fetch(req('/api/business-cards?q=%ED%99%8D%EA%B8%B8%EB%8F%99',STAFF_TOKEN),env);const cards=(await listed.json() as {cards:Array<{id:string;name:string;version:number;deletedAt:string|null}>}).cards;assert.equal(cards.length,1);assert.equal(cards[0].name,'홍길동');
  const forbidden=await worker.fetch(req(`/api/business-cards/${cards[0].id}`,STAFF_TOKEN,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'ARCHIVE',expectedVersion:cards[0].version})}),env);assert.equal(forbidden.status,403);
  const archived=await worker.fetch(req(`/api/business-cards/${cards[0].id}`,ADMIN_TOKEN,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'ARCHIVE',expectedVersion:cards[0].version})}),env);assert.equal(archived.status,200);
  assert.equal(Number(sql.exec('SELECT COUNT(*) FROM preview_business_cards WHERE deleted_at IS NOT NULL')[0].values[0][0]),1);
  assert.throws(()=>sql.run('DELETE FROM preview_business_cards'),/PHYSICAL_DELETE_FORBIDDEN/u);sql.close();
});

test('CF78 routes and responsive UI expose contacts to members and DB management only to admins',()=>{
  const router=readFileSync('apps/web/src/routes/Router.tsx','utf8');const shell=readFileSync('apps/web/src/layout/AppShell.tsx','utf8');const ui=readFileSync('apps/web/src/routes/BusinessCardContacts.tsx','utf8');const css=readFileSync('apps/web/src/routes/BusinessCardContacts.css','utf8');
  assert.match(router,/CONTACT-03[\s\S]*allowedRoles: ADMIN_ONLY/u);assert.match(shell,/인맥관리[\s\S]*CONTACT-03/u);assert.match(ui,/Gemini 구조화 인식/u);assert.match(ui,/Google Drive 원본 저장/u);assert.match(ui,/AiGenerationProgressModal/u);assert.match(ui,/timeoutMs:55_000/u);assert.match(ui,/Gemini 인식 다시 시도/u);assert.match(css,/@media\(max-width:720px\)/u);
});
