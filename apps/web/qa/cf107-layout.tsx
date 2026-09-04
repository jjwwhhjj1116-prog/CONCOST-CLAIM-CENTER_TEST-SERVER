import React from 'react';
import { createRoot } from 'react-dom/client';
import { WorkflowOperations } from '../src/workflow/WorkflowOperations';
import { PreviewReportStudio } from '../src/routes/PreviewReportStudio';
import appHtml from '../index.html?raw';
import '../src/workflow/WorkflowOperations.css';
import '../src/evidence/CaseEvidencePanel.css';
import '../src/routes/PreviewReportStudio.css';
import '../src/documents/StructuredDocumentEditor.css';
import '../src/preview-theme.css';
import '../src/theme-system.css';

const params = new URLSearchParams(location.search);
// Use the real app's base styles, including border-box, before component themes.
const appHead = new DOMParser().parseFromString(appHtml, 'text/html').head;
document.head.prepend(...Array.from(appHead.querySelectorAll('style, link[rel="stylesheet"]')).map(node => node.cloneNode(true)));
document.documentElement.dataset.theme = params.has('dark') ? 'dark' : 'light';
const cases = [1, 2].map(n => ({ id: `case-${n}`, caseNumber: `CF107-00${n}`, title: n === 1 ? '세교구역 재건축 시공사 공사비 증액 관련 기술 검토 및 클레임 용역 · 합성 검수 프로젝트' : '두 번째 합성 프로젝트', claimType: 'TYPE-01', clientName: '합성 발주처', status: 'CONTRACT', version: 1 }));
const projects = cases.map(c => ({ id: `project-${c.id}`, caseId: c.id, responsiblePm: { id: 'pm-1', name: '검수 PM' }, canManageSchedule: true, stages: ['KICKOFF', 'SITE_SURVEY', 'TAKEOFF_COST'].map(stageCode => ({ stageCode, startDate: '2026-09-04', endDate: '2026-09-18', scheduleStatus: 'PLANNED', scheduleNote: '합성 일정 · 회사 데이터는 저장하지 않습니다.', scheduleVersion: 1, scheduleExplicit: true })) }));
const config = {
  claimType: 'TYPE-01', available: !params.has('unavailable'), unavailableReason: params.has('unavailable') ? '검수: 이 유형에 승인된 보고서 템플릿이 없습니다. 관리자에게 등록을 요청하세요.' : null, aiConnected: false, credentialSource: 'NONE', providerLabel: 'Claude', modelLabel: 'QA', outlineAiConnected: false, outlineProviderLabel: 'OpenAI', outlineModelLabel: 'QA', assistantConnected: false, assistantCredentialSource: 'NONE', assistantProviderLabel: 'GEMINI', assistantModelLabel: 'QA',
  chapters: [{ id: 'ch1', chapterCode: 'CH01', title: '개요', agentCode: 'QA', ordinal: 1, promptVersion: 1 }], typeGuideline: null,
  outlinePlan: { persistenceAvailable: true, status: 'DRAFT', version: 1, updatedAt: null, updatedBy: null, items: [] },
  sourceGroups: ['제안서·수주', '착수회의·회의록', '현장조사', '물량산출·내역', '프로젝트 자료실', '법원·소송 자료'].map((label, i) => ({ code: `SOURCE-${i}`, label, status: i === 1 ? 'READY' : 'MISSING', itemCount: i === 1 ? 1 : 0, detail: i === 1 ? '합성 회의록 1개 연결' : '연결된 자료 없음', route: '/workflow/kickoff' })),
  templates: [{ claimType: 'TYPE-01', templateName: '합성 템플릿', purposeText: 'QA', version: 1, finishedExample: '합성 본문' }],
  templateLibrary: ['TYPE-01', 'REF-02'].map((categoryCode, i) => ({ id: `tpl${i}`, categoryCode, displayName: i === 0 ? '공사비 증액 클레임 검토 보고서 · 합성 원본 템플릿' : '두 번째 합성 원본 템플릿', primaryClaimType: 'TYPE-01', secondaryClaimTypes: [], matchesCurrentType: i === 0, expectedSourceCount: 1, uploadedSourceCount: 0, analysisSummary: '검수용', outline: ['개요'], analysisVersion: 1, files: [] }))
};
const navigate = (path: string) => { document.querySelector('#qa-navigation')!.textContent = `이동 요청: ${path}`; };
// CF109 exercises the same selector with absent metadata, no projects and pending loads.
if (params.has('empty')) cases.splice(0);
if (params.has('unassigned')) projects.forEach(project => { project.responsiblePm = null as never; });
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (method !== 'GET') {
    document.querySelector('#qa-requests')!.textContent = `합성 쓰기 차단: ${method} ${url.pathname}`;
    return response({ error: 'CF107: 실제 저장을 차단한 합성 검수 화면입니다.' }, 409);
  }
  if (url.pathname === '/api/cases') return response({ cases });
  if (url.pathname === '/api/project-workflow/schedule') return response({ projects });
  if (params.has('loading') && /^\/api\/cases\/case-\d\/workflow$/.test(url.pathname)) return new Promise<Response>(() => {});
  if (/^\/api\/cases\/case-\d\/workflow$/.test(url.pathname)) return response({ case: cases.find(c => url.pathname.includes(c.id))!, kickoff: null, siteSurveys: [], allocations: [], events: [], googleDrive: { connected: false, deferredByUser: true, uploadEnabled: false } });
  if (url.pathname.endsWith('/evidence')) return response({ files: [], storagePolicy: 'D1_TEST_FALLBACK', googleDriveConnected: false });
  if (url.pathname === '/api/report-workspaces') return response({ workspaces: [] });
  if (url.pathname === '/api/report-drafts') return response({ draft: null, revisions: [], backups: [] });
  if (url.pathname === '/api/report-reviews') return response({ reviews: [] });
  if (url.pathname === '/api/report-finalizations') return response({ finalizations: [] });
  if (url.pathname === '/api/report-chapter-collaboration') return response({ assignments: [], members: [], canManage: true, currentUserId: 'pm-1' });
  if (url.pathname === '/api/report-authoring/config') return response(config);
  if (url.pathname === '/api/report-authoring/case-law') return response({ sources: [], citations: [], apiConfigured: false });
  document.querySelector('#qa-requests')!.textContent = `미등록 GET: ${url.pathname}`;
  return response({ error: `CF107: 알 수 없는 합성 요청 ${url.pathname}` }, 404);
};
window.open = ((url?: string | URL) => { navigate(String(url)); return null; }) as typeof window.open;
createRoot(document.getElementById('root')!).render(params.get('view') === 'report'
  ? <PreviewReportStudio roles={params.has('admin') ? ['admin'] : ['pm']} onNavigate={navigate} />
  : <WorkflowOperations routeId={params.get('view') === 'quantity' ? 'WF-05' : params.get('view') === 'survey' ? 'WF-04' : 'WF-03'} roles={['pm']} onNavigate={navigate} />);
