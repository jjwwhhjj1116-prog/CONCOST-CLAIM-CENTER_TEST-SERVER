import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const STAFF_ID = '00000000-0000-4000-8000-000000000002';
const OUTSIDER_ID = '00000000-0000-4000-8000-000000000003';
const CASE_ID = '40000000-0000-4000-8000-000000000010';
const ADMIN_TOKEN = 'cf14-admin-session-token';
const STAFF_TOKEN = 'cf14-staff-session-token';
const OUTSIDER_TOKEN = 'cf14-outsider-session-token';

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class SqlStatement {
  private values: unknown[] = [];
  constructor(private readonly database: Database, private readonly sql: string) {}
  bind(...values: unknown[]): SqlStatement { this.values = values; return this; }
  async first<T>(): Promise<T | null> { const statement = this.database.prepare(this.sql); try { statement.bind(this.values as any[]); return statement.step() ? statement.getAsObject() as T : null; } finally { statement.free(); } }
  async all<T>(): Promise<{ results: T[] }> { const statement = this.database.prepare(this.sql); const results: T[] = []; try { statement.bind(this.values as any[]); while (statement.step()) results.push(statement.getAsObject() as T); return { results }; } finally { statement.free(); } }
  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> { this.database.run(this.sql, this.values as any[]); const row = this.database.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0]; return { success: true, meta: { changes: this.database.getRowsModified(), last_row_id: Number(row ?? 0) } }; }
}
class SqlD1 {
  constructor(readonly database: Database) {}
  prepare(sql: string): SqlStatement { return new SqlStatement(this.database, sql); }
  async batch(statements: SqlStatement[]): Promise<unknown[]> { this.database.run('BEGIN IMMEDIATE'); try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.run('COMMIT'); return results; } catch (error) { this.database.run('ROLLBACK'); throw error; } }
}

const migration = (name: string): string => readFileSync(join(process.cwd(), 'apps', 'cloudflare', 'migrations', name), 'utf8');

async function setup(): Promise<{ sql: Database; env: CloudflareEnv; providerInputs: string[] }> {
  const SQL = await initSqlJs(); const sql = new SQL.Database(); sql.run('PRAGMA foreign_keys = ON');
  for (const name of ['0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql','0004_cf05_google_drive.sql','0005_cf06_case_operations.sql']) sql.exec(migration(name));
  const now = new Date().toISOString();
  const insertUser = (id: string, login: string, roles: string) => sql.run('INSERT INTO preview_users VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)', [id, login, '1'.repeat(32), '2'.repeat(64), 100000, login, `${login}@example.invalid`, roles, now]);
  insertUser(ADMIN_ID, 'admin', '["admin"]');
  sql.exec(migration('0010_cf10_product_experience.sql'));
  insertUser(STAFF_ID, 'staff', '["staff"]'); insertUser(OUTSIDER_ID, 'outsider', '["staff"]');
  for (const name of ['0006_cf07_report_studio_drafts.sql','0007_cf08_report_review_approval.sql','0008_cf09_final_output.sql','0009_cf09_output_actor_scope.sql','0011_cf11_project_workflow.sql','0012_cf12_report_ai_prompts.sql','0013_cf13_litigation_records.sql','0014_cf14_proposal_award_workflow.sql','0047_cf72_project_members_calendar.sql']) sql.exec(migration(name));
  sql.run('INSERT INTO preview_case_assignments VALUES (?, ?, ?, ?)', [CASE_ID, STAFF_ID, ADMIN_ID, now]);
  for (const [token, id] of [[ADMIN_TOKEN, ADMIN_ID],[STAFF_TOKEN, STAFF_ID],[OUTSIDER_TOKEN, OUTSIDER_ID]] as const) sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(token), id, now, new Date(Date.now() + 3_600_000).toISOString()]);
  const providerInputs: string[] = [];
  const providerFetch: typeof fetch = async (_input, init) => { const body = JSON.parse(String(init?.body)) as { input: string }; providerInputs.push(body.input); return new Response(JSON.stringify({ output_text: '검증된 제안서와 수주 결정을 반영한 보고서 초안입니다.' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  return { sql, providerInputs, env: { DB: new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']>, OPENAI_API_KEY: 'SYNTHETIC_SERVER_KEY', OPENAI_TEST_FETCH: providerFetch } };
}

function request(path: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers); headers.set('X-Session-Token', token); if (init.body) headers.set('Content-Type', 'application/json');
  return new Request(`https://preview.example${path}`, { ...init, headers });
}

const proposalPayload = {
  caseId: CASE_ID,
  proposalNumber: 'PROP-2026-014',
  proposalTitle: '합성 프로젝트 클레임 검토 용역 제안서',
  revisionLabel: 'V2-SENT',
  clientName: '합성건설 주식회사',
  sentAt: '2026-08-14T01:00:00.000Z',
  responseDueOn: '2026-08-28',
  proposedAmountKrw: 33000000,
  documentUrl: 'https://preview.example/proposals/PROP-2026-014.pdf',
  documentSha256: 'a'.repeat(64),
  verificationStatus: 'VERIFIED',
  expectedCaseVersion: 1
};

test('CF14 links immutable sent proposals and advances only won work to a performance project', async () => {
  const { sql, env } = await setup();
  const created = await worker.fetch(request('/api/proposal-workflow/links', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf14-proposal-link-0001' }, body: JSON.stringify(proposalPayload) }), env);
  assert.equal(created.status, 200);
  const proposal = (await created.json() as { proposal: { id: string; awardStatus: string; caseVersion: number; caseStatus: string; reportEvidenceEligible: boolean } }).proposal;
  assert.equal(proposal.awardStatus, 'PENDING'); assert.equal(proposal.caseVersion, 2); assert.equal(proposal.caseStatus, 'REPORT_DRAFTING'); assert.equal(proposal.reportEvidenceEligible, true);

  const replay = await worker.fetch(request('/api/proposal-workflow/links', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf14-proposal-link-0001' }, body: JSON.stringify(proposalPayload) }), env);
  assert.equal(replay.status, 200); assert.equal((await replay.json() as { proposal: { id: string } }).proposal.id, proposal.id);
  assert.equal((await worker.fetch(request('/api/proposal-workflow/links', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf14-proposal-link-0001' }, body: JSON.stringify({ ...proposalPayload, clientName: '변조 거래처' }) }), env)).status, 409);

  const decisionPayload = { decision: 'WON', decisionNote: '거래처 발주서 및 계약서 날인을 확인했습니다.', decidedAt: '2026-08-14T03:00:00.000Z', contractAmountKrw: 30000000, projectStartOn: '2026-08-17', projectEndOn: '2026-12-31', expectedLinkVersion: 1, expectedCaseVersion: 2 };
  const decided = await worker.fetch(request(`/api/proposal-workflow/links/${proposal.id}/decision`, ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf14-award-decision-0001' }, body: JSON.stringify(decisionPayload) }), env);
  assert.equal(decided.status, 200);
  const won = (await decided.json() as { proposal: { awardStatus: string; isPerformanceProject: boolean; caseVersion: number } }).proposal;
  assert.equal(won.awardStatus, 'WON'); assert.equal(won.isPerformanceProject, true); assert.equal(won.caseVersion, 3);
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_award_decisions')[0].values[0][0], 1);
  assert.equal(sql.exec("SELECT COUNT(*) FROM preview_case_activities WHERE event_type IN ('PROPOSAL_LINKED','AWARD_DECIDED')")[0].values[0][0], 2);
  assert.throws(() => sql.run("UPDATE preview_proposal_links SET proposal_title='위조' WHERE id=?", [proposal.id]), /immutable|award transition/u);
  assert.throws(() => sql.run('DELETE FROM preview_award_decisions'), /append-only/u);
  sql.close();
});

test('CF14 applies INQUIRY → PROPOSAL → CONTRACT with optimistic case and link versions', async () => {
  const { sql, env } = await setup();
  const caseResponse = await worker.fetch(request('/api/cases', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf14-case-create-0001' }, body: JSON.stringify({ title: '신규 제안 프로젝트', description: '수주 전 프로젝트', claimType: 'TYPE-03', category: { major: '건설클레임', middle: '일반클레임', minor: '제안' } }) }), env);
  assert.equal(caseResponse.status, 201);
  const project = (await caseResponse.json() as { case: { id: string; version: number; status: string } }).case;
  assert.equal(project.status, 'INQUIRY');
  const payload = { ...proposalPayload, caseId: project.id, proposalNumber: 'PROP-2026-NEW', expectedCaseVersion: project.version };
  const linkedResponse = await worker.fetch(request('/api/proposal-workflow/links', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf14-proposal-link-new1' }, body: JSON.stringify(payload) }), env);
  const linked = (await linkedResponse.json() as { proposal: { id: string; caseStatus: string; caseVersion: number } }).proposal;
  assert.equal(linked.caseStatus, 'PROPOSAL'); assert.equal(linked.caseVersion, 2);
  const stale = await worker.fetch(request(`/api/proposal-workflow/links/${linked.id}/decision`, ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf14-award-stale-0001' }, body: JSON.stringify({ decision: 'WON', decisionNote: '수주 확정 근거입니다.', decidedAt: '2026-08-14T03:00:00.000Z', contractAmountKrw: 10000000, projectStartOn: '2026-08-17', projectEndOn: '2026-10-30', expectedLinkVersion: 1, expectedCaseVersion: 1 }) }), env);
  assert.equal(stale.status, 409);
  const won = await worker.fetch(request(`/api/proposal-workflow/links/${linked.id}/decision`, ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf14-award-new-0001' }, body: JSON.stringify({ decision: 'WON', decisionNote: '발주서 수령과 계약 조건을 확인했습니다.', decidedAt: '2026-08-14T03:00:00.000Z', contractAmountKrw: 10000000, projectStartOn: '2026-08-17', projectEndOn: '2026-10-30', expectedLinkVersion: 1, expectedCaseVersion: 2 }) }), env);
  assert.equal(won.status, 200); assert.equal((await won.json() as { proposal: { caseStatus: string } }).proposal.caseStatus, 'CONTRACT');
  sql.close();
});

test('CF14 shares pre-award authoring and lists with every member while preserving verified source boundaries', async () => {
  const { sql, env, providerInputs } = await setup();
  const created = await worker.fetch(request('/api/proposal-workflow/links', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf14-admin-link-shared-0001' }, body: JSON.stringify(proposalPayload) }), env);
  assert.equal(created.status, 200);
  const shared = (await (await worker.fetch(request('/api/proposal-workflow', OUTSIDER_TOKEN), env)).json() as { proposals: unknown[] }).proposals;
  assert.equal(shared.length, 1, 'all active members must see the same pre-award proposal list');
  const badVerified = await worker.fetch(request('/api/proposal-workflow/links', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf14-bad-source-0001' }, body: JSON.stringify({ ...proposalPayload, documentUrl: 'javascript:alert(1)' }) }), env);
  assert.equal(badVerified.status, 400);
  const config = await worker.fetch(request(`/api/report-authoring/config?caseId=${CASE_ID}`, ADMIN_TOKEN), env);
  const chapterId = (await config.json() as { chapters: Array<{ id: string }> }).chapters[0].id;
  const generated = await worker.fetch(request('/api/report-authoring/generate', ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ caseId: CASE_ID, chapterId, expectedDraftVersion: 0 }) }), env);
  assert.equal(generated.status, 200);
  assert.match(providerInputs[0], /PROP-2026-014/u); assert.match(providerInputs[0], /verifiedProposalSnapshots/u); assert.match(providerInputs[0], /Proposal facts require VERIFIED/u);
  sql.close();
});

test('CF14 routes WF-01 and WF-02 to a responsive D1 proposal-award workspace', () => {
  const router = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'routes', 'Router.tsx'), 'utf8');
  const component = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'workflow', 'ProposalAwardWorkflow.tsx'), 'utf8');
  const css = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'workflow', 'ProposalAwardWorkflow.css'), 'utf8');
  assert.match(router, /\['WF-01', 'WF-02'\][\s\S]*ProposalAwardWorkflow/u);
  assert.match(component, /수주가 확인된 프로젝트만 착수회의 이후 단계/u);
  assert.match(component, /LINKED PROPOSAL SNAPSHOT/u);
  assert.match(component, /BUSINESS DEVELOPMENT · LIVE WORKFLOW/u);
  assert.match(css, /@media \(max-width: 1024px\)/u); assert.match(css, /@media \(max-width: 680px\)/u);
});
