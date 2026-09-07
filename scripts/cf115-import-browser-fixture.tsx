import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { fetchEvidenceUpload } from '../apps/web/src/evidence/upload-evidence';
import { WorkflowOperations } from '../apps/web/src/workflow/WorkflowOperations';
import { minutesFieldDefaults } from '../apps/cloudflare/src/company-minutes';
import '../apps/web/src/evidence/CaseEvidencePanel.css';
import '../apps/web/src/workflow/WorkflowOperations.css';
import '../apps/web/src/preview-theme.css';
import '../apps/web/src/theme-system.css';

// Browser-only synthetic API. No network fallback, live records, or company files.
const caseId = '00000000-0000-4000-8000-000000000115';
const file = { id: 'cf115-file', originalName: '합성 회의록.txt', storageProvider: 'D1_TEMPORARY', downloadUrl: '/synthetic-not-downloadable', driveUrl: null };
const workflowMode = new URLSearchParams(location.search).has('workflow');
const secondCaseId = '00000000-0000-4000-8000-000000000116';
const cases = [caseId, secondCaseId].map((id, index) => ({ id, caseNumber: `QA-CF115-${index + 1}`, title: `CF115 합성 검증 ${index ? 'B' : 'A'} (실제 업무 아님)`, claimType: 'TYPE-01', clientName: '합성 발주처', status: 'CONTRACT', version: 1 }));
const storageKey = 'cf115-only-synthetic-workflow';
// Only fixture-owned synthetic state, never account/session/auth storage.
let saved: Record<string, any> = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}');
let workflowRequests: unknown[] = [];
let aiMode = 'SUCCESS', aiAttempts = 0, failSave = false;
const meetingContent = '김검수: 9월 9일까지 원도면과 수량을 대조하겠습니다.\n박요청: 추가 금액은 아직 확정하지 않았습니다.\n이확인: 누수 여부는 사진만으로 판단할 수 없습니다.\n누수 확인 담당자와 다음 회의 날짜는 정하지 않았습니다.\n원도면을 먼저 확인한 후 추가 조사를 협의하기로 했습니다.';
const draft = { minutesFields: { ...minutesFieldDefaults, author: '김검수', authorDepartment: '시험팀', authorPosition: '연구원', clientName: '합성 발주처', reportingDepartment: '시험팀', clientParticipants: '박요청', participants: '김검수, 이확인', meetingTitle: '시험 도면 검토 회의', meetingStartTime: '10:00' }, meetingAt: '2026-09-07T01:00:00.000Z', surveyDate: '2026-09-07', location: '합성 회의실', agenda: '시험 도면 검토 회의', participants: ['김검수', '이확인'], leadUnit: '시험팀', sourceNotes: `CF115 자동정리 검증용 - 실제 업무 아님\n회의명: 시험 도면 검토 회의\n${meetingContent}`, meetingContent, summary: '원도면과 수량 대조를 9월 9일까지 진행한다. 추가 금액은 미확정이며 사진만으로 누수 여부를 판단하지 않는다. 누수 확인 담당자와 다음 회의 날짜는 미정이다.', timeline: [{ order: 1, title: '원도면과 수량 대조', detail: '김검수 · 2026-09-09까지' }], missingFields: ['종료 시간'] };
const payload = (id: string) => ({ case: cases.find(c => c.id === id)!, kickoff: saved[id]?.kickoff ?? null, siteSurveys: saved[id]?.siteSurveys ?? [], allocations: [], events: [], googleDrive: { connected: true, deferredByUser: false, uploadEnabled: true } });
const schedule = () => ({ projects: cases.map(c => ({ id: `project-${c.id}`, caseId: c.id, responsiblePm: { id: 'synthetic-pm', name: '합성 PM' }, canManageSchedule: true, stages: ['KICKOFF', 'SITE_SURVEY', 'TAKEOFF_COST'].map(stageCode => ({ stageCode, startDate: '2026-09-07', endDate: '2026-09-09', scheduleStatus: 'PLANNED', scheduleNote: '합성 검증 일정', scheduleVersion: 1, scheduleExplicit: true })) })) });
const audit = () => { const node = document.getElementById('cf115-workflow-audit'); if (node) node.textContent = JSON.stringify({ requests: workflowRequests, saved }, null, 2); };
let mode = 'COMPARE_FAIL';
let requests: unknown[] = [];
let saves = 0;
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  if (workflowMode) {
    const method = init?.method ?? 'GET';
    const currentId = /\/cases\/([0-9a-f-]{36})/.exec(url.pathname)?.[1] ?? caseId;
    if (url.pathname === '/api/cases') return Response.json({ cases });
    if (url.pathname === '/api/project-workflow/schedule') return Response.json(schedule());
    if (/\/workflow$/.test(url.pathname)) return Response.json(payload(currentId));
    if (/\/evidence$/.test(url.pathname) && method === 'GET') return Response.json({ files: [], googleDriveConnected: true, storagePolicy: 'GOOGLE_DRIVE_REQUIRED' });
    if (/\/evidence$/.test(url.pathname) && method === 'POST') {
      const form = init!.body as FormData;
      workflowRequests.push({ path: url.pathname, method, fileName: (form.get('file') as File).name, category: form.get('category') }); audit();
      return Response.json({ file: { ...file, originalName: (form.get('file') as File).name, storageProvider: 'GOOGLE_DRIVE' } });
    }
    if (/\/workflow\/ai-import$/.test(url.pathname)) {
      const form = init!.body as FormData;
      workflowRequests.push({ path: url.pathname, method, fileName: (form.get('file') as File).name, kind: form.get('workflowKind'), dataClass: form.get('dataClass') }); audit();
      aiAttempts += 1;
      if (aiMode === 'DELAY') await new Promise(resolve => setTimeout(resolve, 12000));
      if (aiMode === 'FAIL_ONCE' && aiAttempts === 1) return Response.json({ error: '합성 AI 일시 오류 · 원본 보관은 완료됨' }, { status: 503 });
      return Response.json({ import: { ...draft, summary: aiMode === 'LOCAL_ONLY' ? '' : draft.summary, timeline: aiMode === 'LOCAL_ONLY' ? [] : draft.timeline }, generator: aiMode === 'LOCAL_ONLY' ? 'LOCAL_STRUCTURED_FALLBACK' : 'GEMINI', security: { providerTier: aiMode === 'LOCAL_ONLY' ? 'LOCAL_ONLY' : 'PAID_NO_PRODUCT_IMPROVEMENT', redactionCount: 0 } });
    }
    if (/\/workflow\/(kickoff|site-survey)$/.test(url.pathname) && method === 'PUT') {
      const body = JSON.parse(String(init!.body));
      workflowRequests.push({ path: url.pathname, method, body, fail: failSave }); audit();
      if (failSave) { failSave = false; return Response.json({ error: '합성 저장 실패 · 입력 유지 검수' }, { status: 503 }); }
      const state = saved[currentId] ??= {};
      if (url.pathname.endsWith('/kickoff')) state.kickoff = { ...body, summaryText: body.summaryText ?? '', timeline: body.timeline ?? [], version: (state.kickoff?.version ?? 0) + 1, updatedAt: '2026-09-07T02:00:00Z', updatedByName: '합성 검수자' };
      else state.siteSurveys = [{ ...body, id: 'synthetic-survey', folderPath: '/synthetic-only', photoCount: 0, audioCount: 0, documentCount: 1, summaryText: body.summaryText ?? '', timeline: body.timeline ?? [], version: 1, outputVersion: 1, outputStatus: 'DRAFTED' }];
      sessionStorage.setItem(storageKey, JSON.stringify(saved)); audit();
      return Response.json(payload(currentId));
    }
    if (/\/stages\//.test(url.pathname)) { const body = JSON.parse(String(init!.body)); return Response.json({ schedule: { ...body, version: body.expectedVersion + 1 } }); }
    return Response.json({ error: `미등록 합성 요청 차단: ${method} ${url.pathname}` }, { status: 404 });
  }
  if (url.pathname !== `/api/cases/${caseId}/evidence` || init?.method !== 'POST' || !(init.body instanceof FormData)) return Response.json({ error: '미등록 합성 요청 차단' }, { status: 404 });
  const versionMode = init.body.get('versionMode');
  const versionChoice = init.body.get('versionChoice');
  requests.push({ mode, versionMode, versionChoice });
  if (mode === 'DUPLICATE') return Response.json({ status: 'DUPLICATE_EXACT', existing_file: { name: file.originalName, uploader: '합성 담당자', created_at: '2026-09-07T00:00:00Z' }, file }, { status: 409 });
  if (versionMode === 'SEPARATE' || versionChoice) { saves += 1; return Response.json({ file, separate: versionMode === 'SEPARATE' || versionChoice === 'KEEP_AS_NEW_SEPARATE' }); }
  if (mode === 'VERSION_CONFLICT') return Response.json({ status: 'VERSION_CONFLICT_CONFIRMATION', reviewId: 'synthetic-review', nextVersion: 2, existing_file: { name: file.originalName, uploader: '합성 담당자', created_at: '2026-09-07T00:00:00Z' }, analysis: { change_summary: ['합성 비교: 회의 일정 1건 변경'] } }, { status: 409 });
  return Response.json({ code: 'PAID_NO_TRAINING_REQUIRED', error: '합성 정책 차단: 회사 문서 비교를 현재 사용할 수 없습니다. 파일은 아직 저장하지 않았습니다.' }, { status: 403 });
};

function Fixture() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const start = async (nextMode: string) => {
    mode = nextMode; requests = []; saves = 0; setResult(null); setBusy(true);
    const body = new FormData();
    body.set('file', new File(['회의명: 합성 일정 확인\n회의내용: 자료 확인 후 협의'], file.originalName, { type: 'text/plain' }));
    body.set('category', 'MEETING_MINUTES');
    try {
      const response = await fetchEvidenceUpload(`/api/cases/${caseId}/evidence`, { method: 'POST', headers: { 'Idempotency-Key': 'cf115-synthetic' }, body }, { reuseExact: true });
      setResult({ status: response.status, body: await response.json(), requests, saves });
    } catch (error) { setResult({ error: String(error), requests, saves }); }
    finally { setBusy(false); }
  };
  return <main style={{ maxWidth: 840, margin: '30px auto', padding: 18, fontFamily: 'sans-serif', color: '#172b45' }}><h1>CF115 가져오기 합성 검수</h1><p>실제 공통 업로더 · API 전체 합성 응답 · 외부 저장 없음</p><div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}><button disabled={busy} onClick={() => void start('COMPARE_FAIL')}>비교 실패 파일 가져오기</button><button disabled={busy} onClick={() => void start('DUPLICATE')}>동일 원본 다시 가져오기</button><button disabled={busy} onClick={() => void start('VERSION_CONFLICT')}>후속 버전 파일 가져오기</button></div><p role="status">{busy ? '합성 업로드 응답 대기' : '검수 준비'}</p><pre id="cf115-audit" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(result, null, 2)}</pre></main>;
}
function WorkflowFixture() {
  const [epoch, setEpoch] = useState(0);
  const dropSynthetic = () => { const dataTransfer = new DataTransfer(); dataTransfer.items.add(new File([draft.sourceNotes], 'cf115-meeting.txt', { type: 'text/plain' })); document.querySelector('.workflow-ai-importer')?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })); };
  const switchContext = () => { const query = new URLSearchParams(location.search); query.set('caseId', query.get('caseId') === secondCaseId ? caseId : secondCaseId); history.replaceState(null, '', `${location.pathname}?${query}`); setEpoch(n => n + 1); };
  return <main style={{ maxWidth: 1440, margin: '20px auto', padding: 16 }}><section style={{ border: '2px solid #eab308', padding: 12, marginBottom: 14 }}><h1>CF115 실제 화면 · 합성 API 검수 전용</h1><p>모든 API는 합성 응답이며 실제 서버·회사 자료에 접근하지 않습니다. 테스트 버튼은 합성 File을 실제 importer 드롭 이벤트로 전달합니다.</p><div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}><button onClick={dropSynthetic}>합성 TXT 드롭</button><label>합성 AI 응답<select aria-label="합성 AI 응답" onChange={e => { aiMode = e.target.value; aiAttempts = 0; }}><option value="SUCCESS">정상</option><option value="FAIL_ONCE">첫 요청 실패 후 성공</option><option value="DELAY">12초 지연</option><option value="LOCAL_ONLY">원문만 가져오기</option></select></label><button onClick={() => { failSave = true; }}>다음 기록 저장 실패</button><button onClick={switchContext}>합성 프로젝트 강제 전환 (오래된 응답 검수)</button><button onClick={() => { saved = {}; workflowRequests = []; sessionStorage.removeItem(storageKey); setEpoch(n => n + 1); }}>합성 기록 초기화</button></div><details><summary>합성 요청·저장 원장</summary><pre id="cf115-workflow-audit" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify({ requests: workflowRequests, saved }, null, 2)}</pre></details></section><WorkflowOperations key={epoch} routeId={new URLSearchParams(location.search).has('survey') ? 'WF-04' : 'WF-03'} roles={['admin', 'pm']} onNavigate={path => alert(`합성 경로 이동 요청: ${path}`)} /></main>;
}
createRoot(document.getElementById('root')!).render(workflowMode ? <WorkflowFixture/> : <Fixture/>);
