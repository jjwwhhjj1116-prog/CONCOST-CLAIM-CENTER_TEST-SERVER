import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../src/layout/AppShell';
import appHtml from '../index.html?raw';
import '../src/preview-theme.css';
import '../src/theme-system.css';
import '../src/layout/SoftLaunchNotice.css';
import '../src/layout/WorkspaceHelpCenter.css';
// Use the actual app shell's inline base CSS, ahead of the same theme sheets.
const baseStyle = new DOMParser().parseFromString(appHtml, 'text/html').querySelector('style');
if (baseStyle) document.head.prepend(baseStyle);
const params = new URLSearchParams(location.search);
const userId = params.get('user') ?? 'cf113-qa-user';
if (params.has('reset')) localStorage.removeItem(`claim-studio-release-2026-09-04-v1:${userId}`);
window.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.endsWith('/api/member-alerts')) return new Response(JSON.stringify({ available:true,today:'2026-09-04',todos:[],awards:params.has('alerts')?[{eventKey:'cf113-fake',caseId:'cf113',caseNumber:'QA-001',projectTitle:'합성 알림 검수',message:'실제 업무 데이터가 아닙니다.',awardedAt:'2026-09-04T00:00:00Z'}]:[] }),{status:200,headers:{'content-type':'application/json'}});
  if (url.endsWith('/api/settings/tutorial')) return new Response(JSON.stringify({tutorial:{completedTutorialVersion:params.has('tutorial')?null:'2026-08-31-v1',version:1},currentTutorialVersion:'2026-08-31-v1'}),{status:200,headers:{'content-type':'application/json'}});
  return new Response('{}',{status:404});
};
createRoot(document.getElementById('root')!).render(<AppShell currentPath="/dashboard" currentSearch="" userId={userId} userName="합성 검수" roles={['admin']} previewMode={params.has('tutorial')} onNavigate={()=>undefined} onExpireSession={()=>undefined}><h2>공지 동작 검수</h2><p>이 화면은 모든 API 요청을 합성 응답으로 처리합니다.</p></AppShell>);
