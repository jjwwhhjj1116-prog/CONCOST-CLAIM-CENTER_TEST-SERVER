import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReportBodyPages } from '../src/documents/ReportBodyPages';
import { DocumentReviewPages } from '../src/documents/DocumentPreviewPane';
import { paginateReport } from '../src/documents/report-pagination';
import '../src/preview-theme.css';
import '../src/theme-system.css';
import '../src/documents/StructuredDocumentEditor.css';
import '../src/documents/DocumentReviewWorkspace.css';
const paragraphs = Array.from({length:44},(_,i)=>`<p>문단-${i} 현장조사 및 클레임 검토 자료입니다.</p>`).join('');
const long = `<p>${Array.from({length:350},(_,i)=>`<strong>긴문장-${i}</strong> 근거를 보존합니다. `).join('')}</p>`;
const table = `<table><thead><tr><th>항목</th><th>금액</th></tr></thead><tbody>${Array.from({length:28},(_,i)=>`<tr><td>자료-${i}</td><td>${i*1000}</td></tr>`).join('')}</tbody></table>`;
const list = `<ol start="7">${Array.from({length:40},(_,i)=>`<li>목록-${i}</li>`).join('')}</ol>`;
const html = paragraphs + '<div data-document-page-break="true"></div><p>수동 구분 다음</p>' + long + table + list;
function App(){
  const [header,setHeader]=useState(true),[checks,setChecks]=useState('');
  const verify=()=>{
    const source=document.querySelector<HTMLElement>('.report-pagination-source .structured-editor__preview')!;
    const pages=[...document.querySelectorAll<HTMLElement>('.report-paginated-sheet')];
    const text=pages.map(page=>page.querySelector('.structured-editor__preview')!.textContent).join('');
    const original=new DOMParser().parseFromString(html,'text/html');original.querySelector('thead')?.remove();
    const withoutHeaders=pages.map(page=>{const clone=page.cloneNode(true) as HTMLElement;clone.querySelectorAll('thead').forEach(n=>n.remove());return clone.querySelector('.structured-editor__preview')!.textContent;}).join('');
    setChecks(JSON.stringify({pages:pages.length,contentPreserved:withoutHeaders===original.body.textContent,rows:pages.reduce((n,p)=>n+p.querySelectorAll('tbody tr').length,0),sizes:pages.map(p=>[p.offsetWidth,p.offsetHeight]),overflow:pages.some(p=>p.dataset.pageFitOverflow==='true'),manualBreakAtPageStart:pages.some(p=>p.querySelector('.structured-editor__preview')?.textContent?.startsWith('수동 구분 다음')),recompute:paginateReport(source,source.clientHeight).pages.length,textLength:text.length},null,2));
  };
  return <><button onClick={()=>setHeader(!header)}>머리글 전환</button><button onClick={verify}>분할 검증</button><pre id="checks">{checks}</pre><div className="structured-editor" style={{width:'100%'}}><DocumentReviewPages width={1123} previewContent={<article className="report-final-document"><ReportBodyPages html={html} header={header&&<header><h2>클레임 검토 보고서</h2><p>합성 페이지 검수 · 원문 보존</p></header>}/></article>}><div>연속 편집 영역</div></DocumentReviewPages></div></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
