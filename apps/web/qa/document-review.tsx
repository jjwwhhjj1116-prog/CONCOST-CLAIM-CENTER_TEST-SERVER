// Local Vite-only regression fixture. Not an application route or production build entry.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { JSONContent } from '@tiptap/core';
import { StructuredDocumentEditor, renderStructuredDocumentHtml, editorHtmlToMarkdown, markdownToEditorHtml } from '../src/documents/StructuredDocumentEditor';
import { DocumentPreviewPane } from '../src/documents/DocumentPreviewPane';
import { ProposalFinalChapterPages } from '../src/proposals/ProposalView';
import { ReportFinalDocumentPreview } from '../src/routes/PreviewReportStudio';
import '../src/theme-system.css';
import '../src/documents/StructuredDocumentEditor.css';
import '../src/routes/PreviewReportStudio.css';

const p = (text:string):JSONContent => ({type:'paragraph',content:[{type:'text',text}]});
const sample:JSONContent={type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'편집·출력 간격 검증'}]},p('이 문단 다음의 빈 줄을 클릭하여 간격을 바꾸세요.'),{type:'documentSpacer',attrs:{heightPx:24}},p('이 문장은 빈 줄 다음에 오는 본문입니다.'),{type:'paragraph'},{type:'paragraph'},{type:'paragraph'},p('연속 빈 문단은 자동 쪽 나누기가 아닙니다.'),{type:'table',attrs:{tableWidth:100},content:[{type:'tableRow',content:['업무','금액'].map(text=>({type:'tableHeader',attrs:{colwidth:[330]},content:[p(text)]}))},{type:'tableRow',content:['검토','1,000'].map(text=>({type:'tableCell',attrs:{colwidth:[330]},content:[p(text)]}))}]}]};
const markdown=(json:JSONContent)=>editorHtmlToMarkdown(renderStructuredDocumentHtml(json,{pageMode:'a4-portrait'}));
const noCount=()=>undefined;
function contracts():string[]{
 const results:string[]=[];
 const check=(label:string,run:()=>void)=>{try{run();results.push(`PASS ${label}`);}catch(e){results.push(`FAIL ${label}: ${String(e)}`);}};
 const assert=(condition:unknown,message:string)=>{if(!condition)throw Error(message);};
 const parse=(html:string)=>new DOMParser().parseFromString(html,'text/html');
 for(const count of [0,1,2,3,4,10])check(`빈 문단 ${count}개 유지`,()=>{
  const doc:JSONContent={type:'doc',content:[p('앞'),...Array.from({length:count},()=>({type:'paragraph'})),p('뒤')]};
  const original=JSON.stringify(doc);const html=renderStructuredDocumentHtml(doc,{pageMode:'a4-portrait'});
  assert(!html.includes('data-document-page-break'),'암묵적 쪽 나누기');
  assert(parse(html).querySelectorAll('p').length===count+2,'빈 문단 유실');assert(JSON.stringify(doc)===original,'원본 변경');
 });
 check('공백·hardBreak 빈 문단 유지',()=>{
  const doc:JSONContent={type:'doc',content:[p('앞'),p(' '),p('\u00a0'),{type:'paragraph',content:[{type:'hardBreak'}]},p('뒤')]};
  assert(!renderStructuredDocumentHtml(doc,{pageMode:'a4-portrait'}).includes('data-document-page-break'),'암묵적 쪽 나누기');
 });
 check('간격·쪽 나누기·챕터 마커 5회 왕복',()=>{
  let html=renderStructuredDocumentHtml({type:'doc',content:[p('앞'),{type:'documentSpacer',attrs:{heightPx:24}},{type:'documentSpacer',attrs:{heightPx:48}},{type:'documentPageBreak'},p('뒤')]});
  html+='<div data-ai-chapter-marker="AI-CHAPTER:CH01:START"></div>';
  for(let i=0;i<5;i++){
   const md=editorHtmlToMarkdown(html);assert(md.includes('DOCUMENT-SPACER:24')&&md.includes('DOCUMENT-SPACER:48'),'간격 마커 유실');assert(md.includes('DOCUMENT-PAGE-BREAK'),'쪽 나누기 유실');
   html=markdownToEditorHtml(md);const dom=parse(html);
   assert([...dom.querySelectorAll('[data-document-spacer]')].map(n=>n.getAttribute('data-document-spacer')).join(',')==='24,48','간격 순서 변경');
   assert(dom.querySelectorAll('[data-document-page-break]').length===1,'쪽 나누기 개수 변경');
   assert(dom.querySelectorAll('[data-ai-chapter-marker]').length===1,'챕터 마커 유실');
  }
 });
 check('빈 문단 HTML→Markdown 왕복',()=>{
  const html=markdownToEditorHtml(editorHtmlToMarkdown('<p>앞</p><p></p><p><br></p><p>뒤</p>'));
  assert(parse(html).querySelectorAll('p').length===4,'빈 문단 유실');
 });
 check('표·이미지 크기 유지',()=>{
  const html='<table data-table-width="100"><colgroup><col style="width:40%"><col style="width:60%"></colgroup><tbody><tr><td style="height:24px">업무</td><td>금액</td></tr></tbody></table><img src="/qa/sample.png" width="300" height="200" data-image-align="center">';
  const restored=parse(markdownToEditorHtml(editorHtmlToMarkdown(html)));
  assert(restored.querySelectorAll('td').length===2,'표 셀 유실');assert(restored.querySelectorAll('col').length===2,'열 치수 유실');assert(restored.querySelector('img')?.getAttribute('width')==='300','이미지 크기 유실');
 });
 return results;
}
function Fixture(){
 const [mode,setMode]=useState('proposal');const [json,setJson]=useState<JSONContent|null>(sample);const [body,setBody]=useState(()=>markdown(sample));const [epoch,setEpoch]=useState(0);const [results,setResults]=useState<string[]>([]);const [width,setWidth]=useState('100%');
 const chapter={number:1,title:'간격 검수',kind:'VARIABLE' as const,body,editorJson:json};
 return <main style={{padding:16,maxWidth:width,margin:'auto',background:'#f1f5f9',color:'#17253a'}}>
  <header style={{display:'flex',gap:12,flexWrap:'wrap',padding:12}}><strong>CF96 로컬 회귀 · 업무 데이터와 연결 없음</strong><button onClick={()=>setResults(contracts())}>왕복 검증 실행</button><button onClick={()=>setMode('proposal')}>제안서</button><button onClick={()=>setMode('report')}>보고서</button><button onClick={()=>{setJson(null);setEpoch(x=>x+1);}}>Markdown으로 다시 열기</button><button onClick={()=>{setJson(sample);setBody(markdown(sample));setEpoch(x=>x+1);}}>샘플 초기화</button><select aria-label="검증 화면 폭" value={width} onChange={e=>setWidth(e.target.value)}>{['100%','1920px','1440px','1280px','800px','390px'].map(v=><option key={v}>{v}</option>)}</select></header>
  <output style={{whiteSpace:'pre-wrap',display:'block'}} aria-label="회귀 결과">{results.join('\n')}</output>
  <div className="document-review-split">
   <StructuredDocumentEditor key={`${mode}-${epoch}`} documentKey={`qa-${epoch}`} pageMode={mode==='proposal'?'a4-portrait':'standard'} label="회귀 편집기" value={body} editorJson={json} onChange={(md,doc)=>{setBody(md);setJson(doc);}}/>
   <DocumentPreviewPane width={mode==='proposal'?794:1123} title="출력 미리보기">{mode==='proposal'?<ProposalFinalChapterPages item={chapter} startPage={3} onPageCount={noCount}/>:<ReportFinalDocumentPreview title="보고서 검증" caseNumber="QA-96" caseTitle="로컬 검증" content={body} editorJson={json}/>}</DocumentPreviewPane>
  </div>
  <details><summary>저장될 Markdown</summary><pre aria-label="저장 본문">{body}</pre></details>
 </main>;
}
const fixtureRoot=createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(()=>fixtureRoot.unmount());
fixtureRoot.render(<Fixture/>);
