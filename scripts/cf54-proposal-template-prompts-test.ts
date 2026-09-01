import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const read=(path:string)=>readFileSync(join(process.cwd(),path),'utf8');
const ADMIN='00000000-0000-4000-8000-000000000054';
const STAFF='00000000-0000-4000-8000-000000000055';
const ADMIN_TOKEN='cf54-admin-session-token';
const STAFF_TOKEN='cf54-staff-session-token';
async function sha256(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');}
class SqlStatement{private values:unknown[]=[];constructor(private readonly db:Database,private readonly sql:string){}bind(...values:unknown[]){this.values=values;return this;}async first<T>():Promise<T|null>{const statement=this.db.prepare(this.sql);try{statement.bind(this.values as any[]);return statement.step()?statement.getAsObject() as T:null;}finally{statement.free();}}async all<T>():Promise<{results:T[]}>{const statement=this.db.prepare(this.sql);const results:T[]=[];try{statement.bind(this.values as any[]);while(statement.step())results.push(statement.getAsObject() as T);return{results};}finally{statement.free();}}async run(){this.db.run(this.sql,this.values as any[]);return{success:true,meta:{changes:this.db.getRowsModified()}};}}
class SqlD1{constructor(readonly database:Database){}prepare(sql:string){return new SqlStatement(this.database,sql);}async batch(statements:SqlStatement[]){this.database.run('BEGIN IMMEDIATE');try{const results=[];for(const statement of statements)results.push(await statement.run());this.database.run('COMMIT');return results;}catch(reason){this.database.run('ROLLBACK');throw reason;}}}
const request=(path:string,token:string,init:RequestInit={})=>{const headers=new Headers(init.headers);headers.set('X-Session-Token',token);if(init.body)headers.set('Content-Type','application/json');return new Request(`https://preview.example${path}`,{...init,headers});};

async function setup(){
  const SQL=await initSqlJs();const sql=new SQL.Database();sql.run('PRAGMA foreign_keys=ON');
  for(const name of ['0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql','0005_cf06_case_operations.sql','0019_cf27_proposal_authoring.sql','0033_cf42_proposal_studio.sql','0034_cf42_proposal_template_catalog.sql','0036_cf44_proposal_pdf_template_source.sql'])sql.exec(read(`apps/cloudflare/migrations/${name}`));
  const now='2026-08-24T01:00:00.000Z';
  for(const [id,login,name,roles] of [[ADMIN,'yjw@con-cost.com','유종욱','["admin"]'],[STAFF,'staff@con-cost.com','직원','["staff"]']] as const)sql.run('INSERT INTO preview_users VALUES (?,?,?,?,?,?,?,?,1,?)',[id,login,'1'.repeat(32),'2'.repeat(64),100000,name,login,roles,now]);
  sql.exec(read('apps/cloudflare/migrations/0042_cf54_proposal_template_prompt_profiles.sql'));
  const sessionExpiry=new Date(Date.now()+3_600_000).toISOString();
  sql.run('INSERT INTO preview_sessions VALUES (?,?,?,?)',[await sha256(ADMIN_TOKEN),ADMIN,now,sessionExpiry]);
  sql.run('INSERT INTO preview_sessions VALUES (?,?,?,?)',[await sha256(STAFF_TOKEN),STAFF,now,sessionExpiry]);
  return{sql,env:{DB:new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']>} as CloudflareEnv};
}

test('CF54 stores isolated admin-only prompt profiles for every proposal template',async()=>{
  const {sql,env}=await setup();
  const adminResponse=await worker.fetch(request('/api/proposal-studio/config',ADMIN_TOKEN),env);assert.equal(adminResponse.status,200,await adminResponse.clone().text());
  const admin=await adminResponse.json() as {phase:string;templateTypes:Array<{id:string;representativeSourceId:string;promptReady:boolean}>;promptProfiles:Array<{templateSourceId:string;templateSourceName:string;templateCategory:string;version:number;chapters:Array<{chapterNumber:number;executionOrder:number;instructionText:string;version:number}>}>};
  assert.equal(admin.phase,'CF66_PROPOSAL_TYPE_CATALOG');assert.equal(admin.templateTypes.length,6);assert.equal(admin.promptProfiles.length,6);assert.ok(admin.promptProfiles.every((profile)=>profile.chapters.length===3));assert.ok(admin.templateTypes.every((type)=>type.representativeSourceId&&type.promptReady));
  const defaultProfile=admin.promptProfiles.find((profile)=>profile.templateSourceId==='CF42-SRC-260728');assert.ok(defaultProfile);assert.equal(defaultProfile.templateCategory,'REDEVELOPMENT_FINANCE');assert.deepEqual(defaultProfile.chapters.map((prompt)=>prompt.chapterNumber),[2,1,3]);assert.deepEqual(defaultProfile.chapters.map((prompt)=>prompt.executionOrder),[1,2,3]);
  const staffResponse=await worker.fetch(request('/api/proposal-studio/config',STAFF_TOKEN),env);assert.equal(staffResponse.status,200);const staffText=await staffResponse.text();assert.doesNotMatch(staffText,/systemInstruction|validationInstruction|instructionText/u);assert.match(staffText,/promptProfileStatus/u);
  const denied=await worker.fetch(request('/api/proposal-studio/prompt-profiles/CF42-SRC-260728/chapters/2',STAFF_TOKEN,{method:'PUT',body:JSON.stringify({chapterTitle:'당 현장의 핵심 쟁점 분석',instructionText:'직원이 변경하면 안 됩니다. '.repeat(40),isActive:true,version:1})}),env);assert.equal(denied.status,403);
  const chapter2=defaultProfile.chapters.find((prompt)=>prompt.chapterNumber===2)!;const revised=`${chapter2.instructionText}\n관리자 추가 규칙: 증빙 출처를 sourceRefs에 기록하고 통합 쟁점을 마지막에 둔다.`;
  const updated=await worker.fetch(request('/api/proposal-studio/prompt-profiles/CF42-SRC-260728/chapters/2',ADMIN_TOKEN,{method:'PUT',body:JSON.stringify({chapterTitle:chapter2.chapterNumber===2?'당 현장의 핵심 쟁점 분석':'오류',instructionText:revised,isActive:true,version:chapter2.version})}),env);assert.equal(updated.status,200,await updated.clone().text());const updatedBody=await updated.json() as {profile:{chapters:Array<{chapterNumber:number;version:number;instructionText:string}>}};assert.equal(updatedBody.profile.chapters.find((prompt)=>prompt.chapterNumber===2)?.version,2);assert.match(updatedBody.profile.chapters.find((prompt)=>prompt.chapterNumber===2)?.instructionText??'',/sourceRefs/u);
  assert.equal(sql.exec("SELECT COUNT(*) FROM preview_proposal_template_prompt_history WHERE template_source_id='CF42-SRC-260728' AND record_kind='CHAPTER' AND chapter_number=2")[0].values[0][0],1);
  assert.equal(sql.exec("SELECT version FROM preview_proposal_template_chapter_prompts WHERE template_source_id='CF42-SRC-250104' AND chapter_number=2")[0].values[0][0],1);
});

test('CF86 proposal AI generation preserves 2 to 1 to 3 instructions in one bounded provider request',()=>{
  const source=read('apps/cloudflare/src/index.ts');
  assert.match(source,/const orderedPrompts=\(\[2,1,3\] as const\)/u);assert.match(source,/const combinedRoute=\{\.\.\.route,reasoningEffort:'medium'\}/u);assert.match(source,/최상위 키는 chapter2, chapter1, chapter3, validation/u);assert.match(source,/AI_VALIDATION_REQUIRES_HUMAN_REVIEW/u);assert.match(source,/aiGenerationTrace/u);assert.match(source,/promptProfile\.templateCategory/u);
  assert.doesNotMatch(source,/organizationGemini,75_000/u);assert.doesNotMatch(source,/organizationGemini,45_000/u);
  const ui=read('apps/web/src/proposals/ProposalView.tsx');assert.match(ui,/timeoutMs:generationMode==='AI'\?105_000:30_000/u);assert.match(ui,/Gemini 초안 다시 작성/u);
  const progress=read('apps/web/src/components/AiGenerationProgressModal.tsx');assert.match(progress,/timeoutHintSeconds = 220/u);assert.doesNotMatch(progress,/예상 진행률|setProgress|stageIndex/u);
});
