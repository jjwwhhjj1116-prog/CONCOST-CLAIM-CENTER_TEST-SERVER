import React from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewReportStudio } from '../src/routes/PreviewReportStudio';
import { PreviewDeliveryCenter } from '../src/routes/PreviewDeliveryCenter';
import { ReleaseNotice } from '../src/layout/ReleaseNotice';
import { editorHtmlToMarkdown, renderStructuredDocumentHtml } from '../src/documents/StructuredDocumentEditor';
import { mergeGeneratedChapter } from '../src/reports/report-generated-chapter';
import { requestNavigation } from '../src/navigation-guard';
import { chapters, reportJson } from '../../../scripts/fixtures/cf108-report';
import appHtml from '../index.html?raw';
import '../src/routes/PreviewReportStudio.css';
import '../src/routes/PreviewQualityCenters.css';
import '../src/documents/StructuredDocumentEditor.css';
import '../src/preview-theme.css';
import '../src/theme-system.css';

// Only synthetic API responses: no fallback fetch, account, persistence, or live records.
const params = new URLSearchParams(location.search);
const assigned = params.has('assigned');
document.head.prepend(...Array.from(new DOMParser().parseFromString(appHtml, 'text/html').head.querySelectorAll('style,link[rel="stylesheet"]')).map(node => node.cloneNode(true)));
document.documentElement.dataset.theme = 'light';
const cases = [{ id: 'cf114-case', caseNumber: 'CF114-001', title: '협업 원고 저장·서식 보존 합성 프로젝트', claimType: 'TYPE-01', status: 'CONTRACT' }];
let draft = { caseId: cases[0].id, title: '협업 검수 합성 보고서', content: editorHtmlToMarkdown(renderStructuredDocumentHtml(reportJson)), editorJson: structuredClone(reportJson), version: 1, wizardStep: Number(params.get('step')) || 4, selectedChapterId: 'ch2', updatedAt: new Date().toISOString(), updatedBy: { id: 'qa', name: '합성 PM' } };
let outline = { persistenceAvailable: true, status: 'CONFIRMED', version: 1, updatedAt: null, updatedBy: null, items: chapters.map(ch => ({ chapterId: ch.id, chapterCode: ch.chapterCode, chapterTitle: ch.title, promptVersion: 1, planningNote: '' })) };
let assignments = chapters.map(ch => ({ caseId: cases[0].id, chapterId: ch.id, chapterCode: ch.chapterCode, chapterTitle: ch.title, assigneeId: 'qa-staff', assigneeName: '합성 담당자', status: assigned ? 'IN_PROGRESS' : 'READY', draftText: `${ch.chapterCode} 협업 검수 원고입니다.`, version: 1, updatedByName: '합성 담당자', updatedAt: new Date().toISOString(), canEdit: true }));
const collaboration = (applied = false) => ({ assignments, members: [{ id: 'qa-staff', displayName: '합성 담당자', roles: ['staff'] }], canManage: !assigned, currentUserId: assigned ? 'qa-staff' : 'qa', reportVersion: draft.version, applied });
const finalDocument = { caseNumber: cases[0].caseNumber, caseTitle: cases[0].title, title: '승인 당시 확정 보고서', content: draft.content, editorJson: structuredClone(reportJson), version: 7 };
const finalizations = [{ id: 'cf114-final', caseId: cases[0].id, caseNumber: cases[0].caseNumber, caseTitle: cases[0].title, reportVersion: 7, reportTitle: finalDocument.title, finalizedBy: { id: 'qa-pm', name: '합성 확정자' }, finalizedAt: '2026-09-07T00:00:00Z', approvedBy: '합성 승인자', approvedAt: '2026-09-06T23:00:00Z', outputs: [{ id: 'cf114-output', format: 'PDF', fileName: '기존 보관 확정본.pdf', byteSize: 42000, contentSha256: 'synthetic', createdAt: '2026-09-07T00:00:00Z' }] }];
let failSave = false;
const log: unknown[] = [];
function audit(event: unknown) {
  log.push(event);
  document.getElementById('qa-audit')!.textContent = JSON.stringify({ events: log, assignments: assignments.map(({ chapterId, version, status, draftText }) => ({ chapterId, version, status, draftText })), reportVersion: draft.version }, null, 2);
}
if (params.has('delivery')) {
  // Native <img> requests do not use window.fetch. Supply only this known fixture asset.
  document.addEventListener('error', event => {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.getAttribute('src') === '/api/proposal-studio/assets/BRAND_LOGO?v=1') {
      target.src = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="280" height="80"><rect width="280" height="80" fill="#ffffff"/><rect x="8" y="8" width="64" height="64" rx="8" fill="#1b7093"/><text x="86" y="48" font-family="sans-serif" font-size="24" fill="#172554">CF114 QA</text></svg>')}`;
      audit('BRAND_LOGO_SYNTHETIC');
    }
  }, true);
}
document.getElementById('qa-fail')!.onclick = () => { failSave = true; audit('다음 협업 저장 503 예정'); };
document.getElementById('qa-navigate')!.onclick = () => {
  const proceed = () => audit('NAVIGATED:/projects/schedule');
  if (!requestNavigation('/projects/schedule', proceed)) proceed();
};
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  const method = init?.method ?? 'GET';
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (method === 'POST' && url.pathname === '/api/report-chapter-collaboration') {
    const body = JSON.parse(String(init?.body));
    const assignment = assignments.find(item => item.chapterId === body.chapterId);
    if (!assignment || body.expectedVersion !== assignment.version || body.expectedReportVersion !== draft.version) return response({ error: '합성 버전 충돌' }, 409);
    if (failSave) { failSave = false; audit({ action: body.action, result: 503, retained: assignment.draftText }); return response({ error: '합성 협업 저장 실패: 원고는 유지됩니다. 다시 시도하세요.' }, 503); }
    if (body.action === 'APPLY') {
      if (assigned) return response({ error: 'PM만 반영 가능합니다.' }, 403);
      // Client integration uses the production merge helper; it is not a live API test.
      const before = draft.editorJson;
      const merged = mergeGeneratedChapter(before, assignment.chapterCode, body.draftEditorJson);
      const firstChapter = (json: typeof reportJson) => json.content?.slice(0, (json.content?.findIndex(node => node.type === 'aiChapterMarker' && node.attrs?.marker === 'AI-CHAPTER:CH-01:END') ?? -1) + 1);
      audit({ action: 'APPLY', untouchedChapterJsonPreserved: JSON.stringify(firstChapter(before)) === JSON.stringify(firstChapter(merged)), incomingStructuredNodes: body.draftEditorJson.content?.length });
      draft = { ...draft, editorJson: merged, content: editorHtmlToMarkdown(renderStructuredDocumentHtml(merged)), version: draft.version + 1 };
    }
    assignments = assignments.map(item => item === assignment ? { ...item, draftText: body.draftText, status: body.action === 'APPLY' ? 'APPLIED' : body.action === 'MARK_READY' ? 'READY' : 'IN_PROGRESS', version: item.version + 1 } : item);
    audit({ action: body.action, result: 200, chapterId: body.chapterId });
    return response(collaboration(body.action === 'APPLY'));
  }
  if (method === 'PUT' && url.pathname === '/api/report-drafts') {
    const body = JSON.parse(String(init?.body));
    if (assigned) return response({ error: '일반 담당자는 전체 보고서를 저장할 수 없습니다.' }, 403);
    if (body.expectedVersion !== draft.version) return response({ error: '합성 버전 충돌' }, 409);
    const changedFields = ['title', 'content', 'editorJson', 'wizardStep', 'selectedChapterId'].filter(key => JSON.stringify(body[key]) !== JSON.stringify(draft[key as keyof typeof draft]));
    draft = { ...draft, ...body, version: draft.version + 1 };
    audit({ action: 'SAVE_REPORT', version: draft.version, at: new Date().toISOString(), changedFields });
    return response({ draft, revisions: [], backups: [] });
  }
  if (method === 'PUT' && url.pathname === '/api/report-authoring/outline') {
    const body = JSON.parse(String(init?.body));
    if (assigned) return response({ error: '전체 목차 수정 권한 없음' }, 403);
    if (body.expectedVersion !== outline.version) return response({ error: '합성 버전 충돌' }, 409);
    outline = { ...outline, ...body, version: outline.version + 1 };
    return response({ outlinePlan: outline });
  }
  if (method === 'POST' && url.pathname === '/api/report-authoring/improve') {
    const body = JSON.parse(String(init?.body));
    audit({ action: 'IMPROVE_SYNTHETIC', original: body.content });
    return response({ content: '선택한 문장을 검수한 합성 개선안입니다.' });
  }
  if (method !== 'GET') return response({ error: 'CF114: 미등록 합성 쓰기 차단' }, 405);
  if (url.pathname === '/api/cases') return response({ cases });
  if (url.pathname === '/api/report-workspaces') return response({ workspaces: [] });
  if (url.pathname === '/api/report-drafts') return response({ draft, revisions: [], backups: [] });
  if (url.pathname === '/api/report-reviews') return response({ reviews: [] });
  if (url.pathname === '/api/report-finalizations') return response({ finalizations: params.has('delivery') ? finalizations : [] });
  if (url.pathname === '/api/report-finalizations/cf114-final/document') { audit('READ_IMMUTABLE_FINAL:v7'); return response({ document: finalDocument }); }
  if (url.pathname === '/api/cases/cf114-case/evidence') return response({ files: [], storagePolicy: 'GOOGLE_DRIVE_REQUIRED', googleDriveConnected: false });
  if (url.pathname === '/api/report-chapter-collaboration') return response(collaboration());
  if (url.pathname === '/api/report-authoring/config') return response({ available: true, claimType: 'TYPE-01', chapters, outlinePlan: outline, sourceGroups: [], templates: [], templateLibrary: [], aiConnected: true, providerLabel: 'QA', modelLabel: '합성 모델', assistantConnected: true });
  if (url.pathname === '/api/report-authoring/case-law') return response({ sources: [], citations: [], apiConfigured: false });
  return response({ error: 'CF114: 미등록 합성 요청 차단' }, 404);
};
window.open = (() => null) as typeof window.open;
audit('합성 상태 준비');
function ReleaseFixture() {
  const [open, setOpen] = React.useState(true);
  return <><button type="button" onClick={() => { setOpen(true); audit('RELEASE_REOPEN'); }}>업데이트 다시 열기</button><ReleaseNotice open={open} onClose={() => { setOpen(false); audit('RELEASE_CLOSED'); }}/></>;
}
createRoot(document.getElementById('root')!).render(params.has('release') ? <ReleaseFixture/> : params.has('delivery') ? <PreviewDeliveryCenter onNavigate={path => audit(`이동 요청: ${path}`)}/> : <PreviewReportStudio roles={assigned ? ['staff'] : ['pm']} onNavigate={path => audit(`이동 요청: ${path}`)} />);
