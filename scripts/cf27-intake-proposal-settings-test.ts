import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';
import { proposalWorkbook, readProposalWorkbook } from '../apps/web/src/proposals/proposal-excel.js';

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');
const ADMIN_ID = '00000000-0000-4000-8000-000000000027';
const ADMIN_TOKEN = 'cf27-admin-session-token';
async function sha256(value: string): Promise<string> { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
class SqlStatement { private values: unknown[]=[]; constructor(private readonly database: Database,private readonly sql:string){} bind(...values:unknown[]):SqlStatement{this.values=values;return this;} async first<T>():Promise<T|null>{const statement=this.database.prepare(this.sql);try{statement.bind(this.values as any[]);return statement.step()?statement.getAsObject() as T:null;}finally{statement.free();}} async all<T>():Promise<{results:T[]}>{const statement=this.database.prepare(this.sql);const results:T[]=[];try{statement.bind(this.values as any[]);while(statement.step())results.push(statement.getAsObject() as T);return{results};}finally{statement.free();}} async run():Promise<{success:boolean;meta:{changes:number;last_row_id:number}}>{this.database.run(this.sql,this.values as any[]);const row=this.database.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0];return{success:true,meta:{changes:this.database.getRowsModified(),last_row_id:Number(row??0)}};} }
class SqlD1 { constructor(readonly database:Database){} prepare(sql:string):SqlStatement{return new SqlStatement(this.database,sql);} async batch(statements:SqlStatement[]):Promise<unknown[]>{this.database.run('BEGIN IMMEDIATE');try{const results=[];for(const statement of statements)results.push(await statement.run());this.database.run('COMMIT');return results;}catch(error){this.database.run('ROLLBACK');throw error;}} }
const request=(path:string,init:RequestInit={}):Request=>{const headers=new Headers(init.headers);headers.set('X-Session-Token',ADMIN_TOKEN);if(init.body)headers.set('Content-Type','application/json');return new Request(`https://preview.example${path}`,{...init,headers});};
async function setup():Promise<{sql:Database;env:CloudflareEnv}>{const SQL=await initSqlJs();const sql=new SQL.Database();sql.run('PRAGMA foreign_keys=ON');for(const name of ['0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql','0004_cf05_google_drive.sql','0005_cf06_case_operations.sql','0019_cf27_proposal_authoring.sql'])sql.exec(read(`apps/cloudflare/migrations/${name}`));const now=new Date().toISOString();sql.run('INSERT INTO preview_users VALUES (?,?,?,?,?,?,?,?,1,?)',[ADMIN_ID,'admin','1'.repeat(32),'2'.repeat(64),100000,'CF27 Admin','admin@example.invalid','["admin"]',now]);sql.run('INSERT INTO preview_sessions VALUES (?,?,?,?)',[await sha256(ADMIN_TOKEN),ADMIN_ID,now,new Date(Date.now()+3_600_000).toISOString()]);return{sql,env:{DB:new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']>}};}

test('CF27 persists intake, creator assignment, selected template, and proposal versions across restart', async () => {
  const {sql,env}=await setup();
  const created=await worker.fetch(request('/api/cases',{method:'POST',headers:{'Idempotency-Key':'cf27-intake-create-0001'},body:JSON.stringify({title:'신규 클레임 의뢰',claimType:'TYPE-03',description:'계약 분쟁 검토',category:{major:'건설 클레임',middle:'TYPE-03',minor:'사건 업무'}})}),env);
  assert.equal(created.status,201); const caseId=(await created.json() as {case:{id:string}}).case.id;
  const visible=await worker.fetch(request('/api/cases?limit=100&q='),env); const visibleBody=await visible.json() as {cases:Array<{id:string}>}; assert.ok(visibleBody.cases.some((item)=>item.id===caseId));
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_case_assignments')[0].values[0][0],1);
  const templates=await worker.fetch(request('/api/proposal-templates?claimType=TYPE-03'),env); const templateBody=await templates.json() as {templates:Array<{id:string}>}; assert.deepEqual(templateBody.templates.map((item)=>item.id),['CF27-TYPE-03']);
  const proposalResponse=await worker.fetch(request(`/api/cases/${caseId}/proposals`,{method:'POST',body:JSON.stringify({templateId:'CF27-TYPE-03'})}),env); assert.equal(proposalResponse.status,201); const proposal=(await proposalResponse.json() as {proposal:{id:string;version:number;currentVersionId:string}}).proposal;
  const saved=await worker.fetch(request(`/api/cases/${caseId}/proposals/${proposal.id}/versions`,{method:'POST',body:JSON.stringify({background:'계약 분쟁 검토 배경',objective:'쟁점과 대응방안 정리',method:'계약서와 공정자료 분석',expectedOutcome:'기술제안서와 검토계획',exclusions:'법률의견 제외',generationMode:'MANUAL',sourceDocumentVersionIds:[],version:proposal.version})}),env); assert.equal(saved.status,200); const savedBody=await saved.json() as {proposal:{version:number;versions:Array<{versionNumber:number}>}}; assert.equal(savedBody.proposal.version,2); assert.deepEqual(savedBody.proposal.versions.map((item)=>item.versionNumber),[2,1]);
  assert.throws(()=>sql.run("UPDATE preview_proposal_versions SET body_text='forged'"),/append-only/u);
  const exported=sql.export(); const SQL=await initSqlJs(); const restarted=new SQL.Database(exported); assert.equal(restarted.exec('SELECT COUNT(*) FROM preview_proposals')[0].values[0][0],1); assert.equal(restarted.exec('SELECT COUNT(*) FROM preview_proposal_versions')[0].values[0][0],2); restarted.close(); sql.close();
});

test('CF27 project intake continues with the newly created case selected in proposal authoring', () => {
  const cases = read('apps/web/src/case-management/CaseManagement.tsx');
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const report = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const router = read('apps/web/src/routes/Router.tsx');
  assert.match(cases, /\/proposals\/editor\?caseId=\$\{encodeURIComponent\(result\.case\.id\)\}&from=intake/u);
  assert.match(cases, /의뢰 저장 후 제안서 작성/u);
  assert.match(cases, /3단계 · 검수 완료하기/u);
  assert.match(cases, /확인 항목 전체 체크 · 검수 완료/u);
  assert.match(cases, /case-intake-review-checklist/u);
  assert.match(cases, /setReviewOpen\(true\)/u);
  assert.match(cases, /disabled=\{Boolean\(intakeFile\)&&\(!intakeDraft\|\|!reviewConfirmed\)\}/u);
  assert.match(cases, /invalidateReview\(\)/u);
  assert.match(proposal, /new URLSearchParams\(window\.location\.search\)\.get\('caseId'\)/u);
  assert.match(proposal, /res\.cases\.some\(\(item\) => item\.id === preferred\)/u);
  assert.match(proposal, /!activeProposal && selectedCaseId/u);
  assert.match(proposal, /현재 프로젝트 · 제안서 유형/u);
  assert.match(proposal, /유형별 대표 템플릿/u);
  assert.match(proposal, /입력 양식 내보내기/u);
  assert.match(proposal, /작성 Excel 가져오기/u);
  assert.match(proposal, /검수 완료 · 전체 합본 미리보기/u);
  assert.match(proposal, /← 수정 · 3단계로/u);
  assert.match(report, /지금 저장/u);
  assert.match(report, /이 단계 완료 · 다음 단계/u);
  assert.match(report, /← 이전 단계/u);
  assert.match(report, /저장된 최신본 검토 요청/u);
  assert.match(report, /승인본 최종 확정/u);
  assert.ok(
    router.indexOf("previewMode && ['PROP-01', 'PROP-02'].includes(currentRoute.id)") < router.indexOf("previewMode && currentRoute.id !== 'RESP-01'"),
    'preview mode must render the real proposal authoring surface before the generic feature placeholder'
  );
});

test('CF40 proposal Excel template round-trips client-specific fields without changing the approved structure', async () => {
  const source = { background:'발주처 요청 배경',objective:'클레임 검토 목적',method:'계약·현장자료 분석',expectedOutcome:'기술제안서 제출',exclusions:'법률의견 제외' };
  const bytes = proposalWorkbook(source,'CC-2026-040 · 발주처 프로젝트','TYPE-03 표준 기술제안서');
  assert.deepEqual([...bytes.slice(0,4)],[0x50,0x4b,0x03,0x04]);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const imported = await readProposalWorkbook(new File([buffer],'client-proposal.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  assert.deepEqual(imported,source);
});

test('CF27 live D1 cases are visible in the project schedule instead of static samples only', () => {
  const schedule = read('apps/web/src/workflow/ProjectWorkflowSchedule.tsx');
  assert.match(schedule, /apiRequest<\{ projects: WorkflowProject\[\]; dataBasis: string \}>\('\/api\/project-workflow\/schedule'\)/u);
  assert.match(schedule, /setProjects\(result\.projects\)/u);
  assert.doesNotMatch(schedule, /WORKFLOW_PROJECTS/u);
  assert.match(schedule, /실시간 프로젝트 · 신규 의뢰 자동 반영/u);
  assert.match(schedule, /프로젝트별 담당 PM·기준 일정 설정/u);
  assert.match(schedule, /PM·일정 설정/u);
  assert.match(schedule, /\/proposals\/editor\?caseId=\$\{caseId\}&projectId=/u);
  assert.match(schedule, /\/workflow\/award\?caseId=\$\{caseId\}&projectId=/u);
});

test('CF27 settings explains API-key activation and separates personal from admin controls', () => {
  const settings = read('apps/web/src/routes/PreviewSettings.tsx');
  const shell = read('apps/web/src/layout/AppShell.tsx');
  assert.match(shell, /aria-label="개인 및 관리자 설정 열기"/u);
  assert.match(settings, /API KEY 발급방법/u);
  assert.match(settings, /현재 로그인 역할/u);
  assert.match(settings, /회사 Drive·공용 AI·Memory 정책/u);
  assert.match(settings, /section === 'ADMIN' && isAdmin && workspace[\s\S]*<PreviewGoogleDriveSetup/u);
  assert.doesNotMatch(settings, /내 화면 맞춤 설정/u);
});

test('CF27 D1 create remains atomic and assigns the creator so the record is immediately listable', () => {
  const worker = read('apps/cloudflare/src/index.ts');
  assert.match(worker, /INSERT INTO preview_cases/u);
  assert.match(worker, /INSERT INTO preview_case_assignments \(case_id, user_id, assigned_by, assigned_at\)/u);
  assert.match(worker, /INSERT INTO preview_case_activities/u);
  assert.match(worker, /env\.DB\.batch\(\[/u);
});
