import React from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewReportStudio } from '../src/routes/PreviewReportStudio';
import { editorHtmlToMarkdown, renderStructuredDocumentHtml } from '../src/documents/StructuredDocumentEditor';
import { renameUnstructuredReportTitles } from '../src/reports/report-outline-sync';
import { marked } from 'marked';
import { chapters, reportJson } from '../../../scripts/fixtures/cf108-report';
import appHtml from '../index.html?raw';
import '../src/routes/PreviewReportStudio.css';
import '../src/documents/StructuredDocumentEditor.css';
import '../src/preview-theme.css';
import '../src/theme-system.css';

const params = new URLSearchParams(location.search);
document.head.prepend(...Array.from(new DOMParser().parseFromString(appHtml, 'text/html').head.querySelectorAll('style,link[rel="stylesheet"]')).map(node => node.cloneNode(true)));
document.documentElement.dataset.theme = 'light';
const cases = [{ id: 'cf108-case', caseNumber: 'CF108-001', title: '목차 제목 동기화 합성 검수 프로젝트', claimType: 'TYPE-01', status: 'CONTRACT' }];
const initialDraft = { caseId: cases[0].id, title: '합성 클레임 검토 보고서', content: editorHtmlToMarkdown(renderStructuredDocumentHtml(reportJson)), editorJson: params.has('markdown') ? null : reportJson, version: 1, wizardStep: 4, selectedChapterId: 'ch1', updatedAt: new Date().toISOString(), updatedBy: { id: 'qa', name: '합성 PM' } };
const initialOutline = { persistenceAvailable: true, status: 'CONFIRMED', version: 1, updatedAt: null, updatedBy: null, items: chapters.map(ch => ({ chapterId: ch.id, chapterCode: ch.chapterCode, chapterTitle: ch.title, promptVersion: 1, planningNote: '' })) };
const storageKey = `cf108-qa-${params.has('markdown') ? 'markdown' : 'json'}-${params.has('readonly') ? 'readonly' : 'pm'}`;
let state = params.has('reset') ? { draft: initialDraft, outline: initialOutline } : JSON.parse(sessionStorage.getItem(storageKey) || 'null') || { draft: initialDraft, outline: initialOutline };
let failDraft = false;
const audit = (value: string) => { document.getElementById('qa-audit')!.textContent = value; };
document.getElementById('qa-fail')!.onclick = () => { failDraft = true; audit('다음 본문 저장 503 예정'); };
const withoutHeadings = (json: typeof reportJson) => json.content?.filter(node => node.type !== 'heading');
document.getElementById('qa-check')!.onclick = () => {
  const markdown = '<!-- AI-CHAPTER:CH-01:START -->\n## CH-01 검토결론 요약\n\n본문 검토결론 요약\n\n| 항목 | 값 |\n| --- | --- |\n| 원문 | 123 |\n\n```md\n## CH-01 검토결론 요약\n```\n<!-- AI-CHAPTER:CH-01:END -->';
  const renamed = renameUnstructuredReportTitles(markdown, [{ chapterCode: 'CH-01', previousTitle: '검토결론 요약', title: '검수 <제목> &lt; *확인*' }]);
  const oldHeading = '## CH-01 검토결론 요약';
  const changes = [{ chapterCode: 'CH-01', previousTitle: '첫 제목', title: '수정 제목' }, { chapterCode: 'CH-02', previousTitle: '둘째 제목', title: '둘째 수정' }];
  const html = '<div><h2 style="color: red"><b>첫 제목</b></h2><p>원문</p><h2>CH-02 둘째 제목</h2><table><tr><td>보존</td></tr></table><img src="/qa.jpg" width="220" height="120"></div>';
  const htmlResult = renameUnstructuredReportTitles(html, changes);
  const htmlDom = new DOMParser().parseFromString(htmlResult.content, 'text/html');
  const reference = '## CH-01 [첫 제목][ref]\r\n\r\n본문\r\n\r\n[ref]: https://example.invalid\r\n';
  const referenceResult = renameUnstructuredReportTitles(reference, [changes[0]]);
  const checks = {
    nonHeadingJsonPreserved: !state.draft.editorJson || JSON.stringify(withoutHeadings(state.draft.editorJson)) === JSON.stringify(withoutHeadings(reportJson)),
    editorAndContentHeadings: state.outline.items.map((item: { chapterCode: string; chapterTitle: string }) => ({ title: item.chapterTitle, inContent: state.draft.content.includes(item.chapterTitle), inJson: !state.draft.editorJson || JSON.stringify(state.draft.editorJson).includes(item.chapterTitle) })),
    markdownOnlyHeadingChanged: renamed.matched.length === 1 && renamed.content.substring(renamed.content.indexOf('\n\n')) === markdown.substring(markdown.indexOf('\n\n')),
    codeBlockUntouched: renamed.content.includes('```md\n' + oldHeading),
    literalTitleSafe: new DOMParser().parseFromString(marked.parse(renamed.content) as string, 'text/html').querySelector('h2')?.textContent === 'CH-01 검수 <제목> &lt; *확인*',
    importedHtmlTitles: htmlResult.matched.length === 2 && htmlDom.querySelector('h2 b')?.textContent === '수정 제목' && htmlDom.querySelector('h2')?.style.color === 'red',
    importedTableImagePreserved: htmlDom.querySelector('table')?.textContent === '보존' && htmlDom.querySelector('img')?.getAttribute('width') === '220',
    referenceLinkPreserved: referenceResult.matched.length === 1 && referenceResult.content.includes('https://example.invalid') && referenceResult.content.includes('<a href="https://example.invalid">'),
    crlfBodyPreserved: referenceResult.content.endsWith('\r\n본문\r\n\r\n[ref]: https://example.invalid\r\n'),
    version: state.draft.version, wizardStep: state.draft.wizardStep
  };
  document.getElementById('qa-checks')!.textContent = JSON.stringify(checks, null, 2);
};
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  const method = init?.method ?? 'GET';
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (method === 'PUT' && ['/api/report-authoring/outline', '/api/report-drafts'].includes(url.pathname)) {
    if (params.has('readonly')) return response({ error: '합성 읽기 전용' }, 403);
    const body = JSON.parse(String(init?.body));
    const key = url.pathname.endsWith('outline') ? 'outline' : 'draft';
    if (key === 'draft' && failDraft) { failDraft = false; audit('본문 저장 503 · 서버 본문 유지'); return response({ error: '합성 저장 오류: 다시 시도하세요.' }, 503); }
    if (body.expectedVersion !== state[key].version) return response({ error: '합성 버전 충돌' }, 409);
    state[key] = { ...state[key], ...body, version: state[key].version + 1, updatedAt: new Date().toISOString() };
    sessionStorage.setItem(storageKey, JSON.stringify(state));
    audit(`${key} 저장 v${state[key].version} · 목차 ${state.outline.items.map((item: { chapterTitle: string }) => item.chapterTitle).join(' / ')}`);
    return response(key === 'outline' ? { outlinePlan: state.outline } : { draft: state.draft, revisions: [], backups: [] });
  }
  if (method !== 'GET') return response({ error: 'CF108: 미등록 합성 쓰기 차단' }, 405);
  if (url.pathname === '/api/cases') return response({ cases });
  if (url.pathname === '/api/report-workspaces') return response({ workspaces: [] });
  if (url.pathname === '/api/report-drafts') return response({ draft: state.draft, revisions: [], backups: [] });
  if (url.pathname === '/api/report-reviews') return response({ reviews: [] });
  if (url.pathname === '/api/report-finalizations') return response({ finalizations: [] });
  if (url.pathname === '/api/report-chapter-collaboration') return response({ assignments: [], members: [], canManage: !params.has('readonly'), currentUserId: 'qa' });
  if (url.pathname === '/api/report-authoring/config') return response({ available: true, claimType: 'TYPE-01', chapters, outlinePlan: state.outline, sourceGroups: [], templates: [], templateLibrary: [], aiConnected: false, assistantConnected: false });
  if (url.pathname === '/api/report-authoring/case-law') return response({ sources: [], citations: [], apiConfigured: false });
  return response({ error: 'CF108: 미등록 합성 요청 차단' }, 404);
};
window.open = (() => null) as typeof window.open;
createRoot(document.getElementById('root')!).render(<PreviewReportStudio roles={params.has('readonly') ? ['reviewer'] : ['pm']} onNavigate={path => audit(`이동 요청: ${path}`)} />);
