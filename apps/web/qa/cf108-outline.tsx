import React from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewReportStudio } from '../src/routes/PreviewReportStudio';
import { BusinessCardContacts } from '../src/routes/BusinessCardContacts';
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
const qaLogStyle=document.createElement('style');qaLogStyle.textContent='#qa-generation{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;max-height:200px;overflow:auto}';document.head.append(qaLogStyle);
document.head.prepend(...Array.from(new DOMParser().parseFromString(appHtml, 'text/html').head.querySelectorAll('style,link[rel="stylesheet"]')).map(node => node.cloneNode(true)));
document.documentElement.dataset.theme = params.has('dark') ? 'dark' : 'light';
const cases = [{ id: 'cf108-case', caseNumber: 'CF108-001', title: '목차 제목 동기화 합성 검수 프로젝트', claimType: 'TYPE-01', status: 'CONTRACT' }];
const cf112Json = { type:'doc', content:[{type:'paragraph',content:[{type:'text',text:'기존 검수 본문은 보존합니다.'}]}, ...(reportJson.content ?? []).filter(node => node.type === 'table' || node.type === 'image')] };
const fixtureJson = params.has('cf112') ? cf112Json : reportJson;
const initialDraft = { caseId: cases[0].id, title: '합성 클레임 검토 보고서', content: editorHtmlToMarkdown(renderStructuredDocumentHtml(fixtureJson)), editorJson: params.has('markdown') ? null : fixtureJson, version: 1, wizardStep: Number(params.get('step')) || 4, selectedChapterId: 'ch1', updatedAt: new Date().toISOString(), updatedBy: { id: 'qa', name: '합성 PM' } };
const initialOutline = { persistenceAvailable: true, status: 'CONFIRMED', version: 1, updatedAt: null, updatedBy: null, items: chapters.map(ch => ({ chapterId: ch.id, chapterCode: ch.chapterCode, chapterTitle: ch.title, promptVersion: 1, planningNote: '' })) };
const storageKey = `${params.has('cf112') ? 'cf112' : params.has('cf110') ? 'cf110' : 'cf108'}-qa-${params.has('markdown') ? 'markdown' : 'json'}-${params.has('readonly') ? 'readonly' : 'pm'}`;
let state = params.has('reset') ? { draft: initialDraft, outline: initialOutline } : JSON.parse(sessionStorage.getItem(storageKey) || 'null') || { draft: initialDraft, outline: initialOutline };
let failDraft = false;
let generationCount=0, failedGeneration=false; const generationLog:string[]=[];
const generationAudit=()=>{let node=document.getElementById('qa-generation');if(!node){node=document.createElement('pre');node.id='qa-generation';document.querySelector('nav')?.append(node);}node.textContent=JSON.stringify({calls:generationLog,version:state.draft.version,content:state.draft.content,editorJson:state.draft.editorJson},null,2);};
let cards = [{ id: '00000000-0000-4000-8000-000000000110', name:'합성 연락처', company:'삭제 검수 회사', department:'검수 부서', title:'담당자', mobile:'010-0000-0000', phone:'',email:'qa@example.invalid',address:'합성 주소',tags:'합성 자료',googleDriveUrl:'#source',geminiModelCode:'QA',version:1,createdAt:new Date().toISOString(),createdByName:'합성 관리자',deletedAt:null as string|null }];
if(params.has('contacts')) { const toggle=document.createElement('a');toggle.href='?cf110=1&contacts=1&database=1';toggle.textContent='합성 DB관리';document.querySelector('nav')?.append(toggle); }
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
    nonHeadingRenderedPreserved: !state.draft.editorJson || renderStructuredDocumentHtml({ type: 'doc', content: withoutHeadings(state.draft.editorJson) }) === renderStructuredDocumentHtml({ type: 'doc', content: withoutHeadings(reportJson) }),
    normalizedNodeDifferences: !state.draft.editorJson ? [] : withoutHeadings(state.draft.editorJson)?.flatMap((node: unknown, index: number) => JSON.stringify(node) === JSON.stringify(withoutHeadings(reportJson)?.[index]) ? [] : [{ index, before: withoutHeadings(reportJson)?.[index], after: node }]),
    editorAndContentHeadings: state.outline.items.map((item: { chapterCode: string; chapterTitle: string }) => ({ title: item.chapterTitle, inContent: state.draft.content.includes(item.chapterTitle), inJson: !state.draft.editorJson || JSON.stringify(state.draft.editorJson).includes(item.chapterTitle) })),
    markdownOnlyHeadingChanged: renamed.matched.length === 1 && renamed.content.substring(renamed.content.indexOf('\n\n')) === markdown.substring(markdown.indexOf('\n\n')),
    codeBlockUntouched: renamed.content.includes('```md\n' + oldHeading),
    literalTitleSafe: new DOMParser().parseFromString(marked.parse(renamed.content) as string, 'text/html').querySelector('h2')?.textContent === 'CH-01 검수 <제목> &lt; *확인*',
    importedHtmlTitles: htmlResult.matched.length === 2 && htmlDom.querySelector('h2 b')?.textContent === '수정 제목' && htmlDom.querySelector('h2')?.style.color === 'red',
    importedTableImagePreserved: htmlDom.querySelector('table')?.textContent === '보존' && htmlDom.querySelector('img')?.getAttribute('width') === '220',
    referenceLinkPreserved: referenceResult.matched.length === 1 && referenceResult.content.includes('https://example.invalid') && referenceResult.content.includes('<a href="https://example.invalid">'),
    crlfBodyPreserved: referenceResult.content.endsWith('\r\n본문\r\n\r\n[ref]: https://example.invalid\r\n'),
    version: state.draft.version, wizardStep: state.draft.wizardStep,
    savedHeader: state.draft.editorJson?.attrs?.reportHeader ?? null
  };
  document.getElementById('qa-checks')!.textContent = JSON.stringify(checks, null, 2);
};
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  const method = init?.method ?? 'GET';
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.pathname.startsWith('/api/business-cards')) {
    if(method==='GET')return response({cards:url.searchParams.has('includeArchived')&&!params.has('readonly')?cards:cards.filter(card=>!card.deletedAt)});
    if(method==='PUT') {
      if(params.has('readonly'))return response({error:'관리자만 삭제할 수 있습니다.'},403);
      if(failDraft){failDraft=false;return response({error:'합성 삭제 실패: 다시 시도하세요.'},503);}
      const body=JSON.parse(String(init?.body));
      if(body.expectedVersion!==cards[0]?.version)return response({error:'버전 충돌'},409);
      cards=cards.map(card=>({...card,version:card.version+1,deletedAt:body.action==='ARCHIVE'?new Date().toISOString():null}));
      audit(`명함 ${body.action} · Drive 원본 보존 · v${cards[0]?.version}`);
      return response({card:cards[0]});
    }
    return response({error:'합성 명함 미등록 요청 차단'},405);
  }
  if (method === 'PUT' && ['/api/report-authoring/outline', '/api/report-drafts'].includes(url.pathname)) {
    if (params.has('readonly')) return response({ error: '합성 읽기 전용' }, 403);
    const body = JSON.parse(String(init?.body));
    const key = url.pathname.endsWith('outline') ? 'outline' : 'draft';
    if (key === 'draft' && failDraft) { failDraft = false; audit('본문 저장 503 · 서버 본문 유지'); return response({ error: '합성 저장 오류: 다시 시도하세요.' }, 503); }
    if (body.expectedVersion !== state[key].version) return response({ error: '합성 버전 충돌' }, 409);
    state[key] = { ...state[key], ...body, version: state[key].version + 1, updatedAt: new Date().toISOString() };
    sessionStorage.setItem(storageKey, JSON.stringify(state));
    if(params.has('cf112')){generationLog.push('SAVE:'+state.draft.version);generationAudit();}
    audit(`${key} 저장 v${state[key].version} · 목차 ${state.outline.items.map((item: { chapterTitle: string }) => item.chapterTitle).join(' / ')}`);
    return response(key === 'outline' ? { outlinePlan: state.outline } : { draft: state.draft, revisions: [], backups: [] });
  }
  if(params.has('cf112') && method==='POST' && url.pathname==='/api/report-authoring/generate') {
    const body=JSON.parse(String(init?.body));
    if(body.expectedDraftVersion!==state.draft.version)return response({error:'합성 생성 버전 충돌'},409);
    generationCount++; generationLog.push('GENERATE:'+body.chapterId+':v'+body.expectedDraftVersion);generationAudit();
    if(params.has('failsecond')&&generationCount===2&&!failedGeneration){failedGeneration=true;return response({error:'합성 AI 공급자 실패'},502);}
    if(params.has('failsave')&&!failedGeneration){failedGeneration=true;failDraft=true;}
    const chapter=chapters.find(ch=>ch.id===body.chapterId)!;
    return response({chapter:{chapterCode:chapter.chapterCode,title:chapter.title,content:'실제 API 대신 합성 결과: '+chapter.chapterCode+' 근거 확인 필요.'}});
  }
  if (method !== 'GET') return response({ error: 'CF108: 미등록 합성 쓰기 차단' }, 405);
  if (url.pathname === '/api/cases') return response({ cases });
  if (url.pathname === '/api/report-workspaces') return response({ workspaces: [] });
  if (url.pathname === '/api/report-drafts') return response({ draft: state.draft, revisions: [], backups: [] });
  if (url.pathname === '/api/report-reviews') return response({ reviews: [] });
  if (url.pathname === '/api/report-finalizations') return response({ finalizations: [] });
  if (url.pathname === '/api/report-chapter-collaboration') return response({ assignments: [], members: [], canManage: !params.has('readonly'), currentUserId: 'qa' });
  if (url.pathname === '/api/report-authoring/config') return response({ available: true, claimType: 'TYPE-01', chapters, outlinePlan: state.outline, sourceGroups: [], templates: [], templateLibrary: [], aiConnected: params.has('cf112') && !params.has('nokey'), providerLabel:'QA', modelLabel:'합성 모델', assistantConnected: false });
  if (url.pathname === '/api/report-authoring/case-law') return response({ sources: [], citations: [], apiConfigured: false });
  return response({ error: 'CF108: 미등록 합성 요청 차단' }, 404);
};
window.open = (() => null) as typeof window.open;
createRoot(document.getElementById('root')!).render(params.has('contacts') ? <BusinessCardContacts mode={params.has('database')?'DATABASE':'LIST'} roles={params.has('readonly')?['staff']:['admin']} onNavigate={path=>audit(`이동 요청: ${path}`)}/> : <PreviewReportStudio roles={params.has('readonly') ? ['reviewer'] : ['pm']} onNavigate={path => audit(`이동 요청: ${path}`)} />);
