import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ReportBodyPages} from '../src/documents/ReportBodyPages';
import {downloadFinalDocument,createHwpx} from '../src/documents/final-document-export';
import {unzipSync} from 'fflate';
import html2canvas from 'html2canvas';
import '../src/documents/StructuredDocumentEditor.css';
import '../src/preview-theme.css';
import '../src/theme-system.css';
import '../src/documents/DocumentReviewWorkspace.css';

const sampleImage='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="560" height="180"><rect width="560" height="180" fill="#e8f2f7"/><rect x="30" y="25" width="160" height="130" fill="#183a70"/><circle cx="280" cy="90" r="64" fill="#24a1bc"/><path d="M360 155L440 25L520 155Z" fill="#dc8548"/></svg>');
const pageBreak='<div data-document-page-break="true"></div>';
const html=[
 '<h2>CF114 보고서 출력 검수</h2><p>첫 페이지 시작. 본 자료는 실서비스 데이터 없이 작성한 검수용 합성 문서입니다. 한글 본문과 쪽 경계의 원문 보존을 확인합니다.</p><ol start="3"><li><p>상위 세 번째 항목</p><ol start="9">'+Array.from({length:4},(_,i)=>`<li>하위 ${i+9}번 항목. ${'도면과 산출 근거를 대조하고 검토 내용을 기록합니다. '.repeat(2)}</li>`).join('')+'</ol></li><li>상위 네 번째 항목과 첫 페이지 끝.</li></ol>',
 '<h2>산출 수량 대조와 검토 이미지</h2><table style="width:100%;table-layout:fixed"><thead><tr><th>공종</th><th>확인 위치</th><th>수량</th></tr></thead><tbody><tr><td rowspan="2">철근</td><td>지하 1층</td><td>120</td></tr><tr><td>지상 1층</td><td>145</td></tr><tr><td>콘크리트</td><td colspan="2">도면 A-203 대조 완료</td></tr><tr><td>마감</td><td>동측 외벽</td><td>320</td></tr></tbody></table><p>병합 셀과 열 순서를 유지해야 합니다.</p><p><img src="'+sampleImage+'" alt="CF114 사각형 원 삼각형 검수 이미지" width="360" height="116" style="width:360px;height:116px"/></p><p>두 번째 페이지 끝.</p>',
 '<h2>검토 결과와 후속 확인</h2>'+Array.from({length:7},(_,i)=>`<p>확인 문단 ${i+1}. ${'근거가 확인된 수량과 미확인 범위를 구분합니다. 저장된 본문은 출력 단계에서 누락되거나 중복되지 않아야 합니다. '}</p>`).join('')+'<p><strong>마지막 페이지 마지막 문장 CF114 END.</strong></p>'
].join(pageBreak);
const header=<header><h2>프로젝트 기술 검토 보고서</h2><p>CF114 합성 검수 프로젝트 · 2026년 9월 7일</p></header>;
const save=async(name:string,bytes:Uint8Array|Blob|string)=>{const response=await fetch(`http://127.0.0.1:3021/${name}`,{method:'POST',body:bytes as BodyInit});if(!response.ok)throw Error(await response.text());};
function App(){const ref=useRef<HTMLDivElement>(null);const[result,setResult]=useState('준비');
 const inspectLists=async()=>{let info:unknown;await html2canvas(ref.current!.querySelector<HTMLElement>('[data-export-page]')!,{windowWidth:1400,logging:false,onclone:doc=>{info=[...doc.querySelectorAll('.report-paginated-sheet ol')].map(list=>({style:doc.defaultView!.getComputedStyle(list).listStyleType,padding:doc.defaultView!.getComputedStyle(list).paddingLeft,display:doc.defaultView!.getComputedStyle(list.querySelector('li')!).display,text:list.textContent?.slice(0,40)}));}});setResult(JSON.stringify(info,null,2));};
 const run=async()=>{setResult('생성 중');const pending:Promise<void>[]=[];const captures=new Map<string,Uint8Array>();const nativeClick=HTMLAnchorElement.prototype.click;
   HTMLAnchorElement.prototype.click=function(){if(this.download.startsWith('cf114-report.')&&this.href.startsWith('blob:')){const name=this.download;pending.push(fetch(this.href).then(res=>res.arrayBuffer()).then(async data=>{const bytes=new Uint8Array(data);captures.set(name,bytes);await save(name,bytes);}));return;}nativeClick.call(this);};
   try{
     const pdf=await downloadFinalDocument({root:ref.current!,format:'pdf',fileName:'cf114-report',orientation:'landscape',onProgress:setResult});
     const docx=await downloadFinalDocument({root:ref.current!,format:'docx',fileName:'cf114-report',orientation:'landscape',onProgress:setResult});
     await Promise.all(pending);
     // HWP uses this exact intermediate createHwpx before binary conversion.
     // Reuse the actual captured DOCX page JPEGs rather than a substitute renderer.
     const archive=unzipSync(captures.get('cf114-report.docx')!);const images=Object.entries(archive).filter(([name])=>name.startsWith('word/media/')&&name.endsWith('.jpg'));
     const pages=[];for(const[,bytes]of images){const bitmap=await createImageBitmap(new Blob([bytes]));pages.push({bytes,width:bitmap.width,height:bitmap.height});bitmap.close();}
     const hwpx=createHwpx(pages,'CF114 출력 검수','landscape');await save('cf114-report.hwpx',hwpx);
     const sheets=[...ref.current!.querySelectorAll<HTMLElement>('[data-export-page]')].map(page=>({width:page.offsetWidth,height:page.offsetHeight,overflow:page.dataset.pageFitOverflow,text:page.innerText}));
     const results={pdf,docx,hwpx:{byteSize:hwpx.length,pageCount:pages.length},sheets};await save('export-results.json',JSON.stringify(results,null,2));setResult(JSON.stringify(results,null,2));
   }catch(error){setResult(String(error));}finally{HTMLAnchorElement.prototype.click=nativeClick;}
 };
 return <><button onClick={()=>void run()} style={{padding:'12px 24px',margin:20}}>실제 출력 3종 생성</button><button onClick={()=>void inspectLists()}>캡처 목록 검사</button><pre id="result" style={{maxHeight:300,overflow:'auto',whiteSpace:'pre-wrap'}}>{result}</pre><div ref={ref} className="report-final-export-source"><article className="report-final-document" data-export-document-revision="cf114-synthetic-v1"><ReportBodyPages html={html} header={header}/></article></div></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
