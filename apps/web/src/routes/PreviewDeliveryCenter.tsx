import { Button, Card, Select } from '@claim-studio/ui';
import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api';
import { CaseEvidencePanel } from '../evidence/CaseEvidencePanel';

interface CaseSummary { id:string; caseNumber:string; title:string; claimType:string; status:string }
interface FinalOutput { id:string; format:'DOCX'|'PDF'; fileName:string; contentSha256:string; byteSize:number; createdAt:string }
interface Finalization {
  id:string; caseId:string; caseNumber:string; caseTitle:string; reportVersion:number; reportTitle:string;
  finalizedBy:{id:string;name:string}; finalizedAt:string; approvedBy:string; approvedAt:string; outputs:FinalOutput[];
}

function formatBytes(value:number):string {
  return value<1_000_000?`${(value/1_000).toFixed(1)} KB`:`${(value/1_000_000).toFixed(1)} MB`;
}

export function PreviewDeliveryCenter({ onNavigate }:{ onNavigate:(path:string)=>void }):React.ReactElement {
  const queryCaseId = new URLSearchParams(window.location.search).get('caseId') ?? '';
  const [cases,setCases]=useState<CaseSummary[]>([]);
  const [finalizations,setFinalizations]=useState<Finalization[]>([]);
  const [selectedCaseId,setSelectedCaseId]=useState(queryCaseId);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  useEffect(()=>{
    let active=true;
    Promise.all([
      apiRequest<{cases:CaseSummary[]}>('/api/cases?scope=project-work&limit=100&q='),
      apiRequest<{finalizations:Finalization[]}>('/api/report-finalizations')
    ]).then(([caseResult,finalResult])=>{
      if(!active)return;
      setCases(caseResult.cases); setFinalizations(finalResult.finalizations);
      setSelectedCaseId((current)=>caseResult.cases.some((entry)=>entry.id===current)?current:finalResult.finalizations[0]?.caseId??caseResult.cases[0]?.id??'');
    }).catch((reason)=>active&&setError(reason instanceof Error?reason.message:'납품 정보를 불러오지 못했습니다.')).finally(()=>active&&setLoading(false));
    return()=>{active=false};
  },[]);

  const selected=cases.find((entry)=>entry.id===selectedCaseId)??null;
  const selectedFinalizations=useMemo(()=>finalizations.filter((entry)=>entry.caseId===selectedCaseId),[finalizations,selectedCaseId]);

  const download=async(output:FinalOutput)=>{
    setError('');
    try{
      const response=await fetch(`/api/report-outputs/${encodeURIComponent(output.id)}/download`);
      if(!response.ok)throw new Error('확정 납품본 다운로드에 실패했습니다.');
      const url=URL.createObjectURL(await response.blob()); const anchor=document.createElement('a');
      anchor.href=url; anchor.download=output.fileName; anchor.click(); URL.revokeObjectURL(url);
    }catch(reason){setError(reason instanceof Error?reason.message:'확정 납품본 다운로드에 실패했습니다.');}
  };

  return <section className="route-view preview-delivery-center" aria-labelledby="delivery-center-title">
    <header className="quality-center-hero"><div><span>FINAL DELIVERY LOCATOR</span><h2 id="delivery-center-title">프로젝트별 최종 결과물과<br/>보관 위치를 바로 찾습니다.</h2><p>사람 승인을 거쳐 확정된 DOCX·PDF와 회사 Google Drive에 올린 최종 납품본을 한 프로젝트에서 확인합니다.</p></div><div><strong>{finalizations.length}</strong><span>확정 이력</span></div></header>
    <Card title="납품 프로젝트 선택"><div className="inline-form"><Select searchable searchPlaceholder="프로젝트 번호·이름 검색" label="프로젝트" value={selectedCaseId} onChange={(event)=>setSelectedCaseId(event.target.value)} options={cases.map((entry)=>({value:entry.id,label:`${entry.caseNumber} · ${entry.title}`}))}/>{selected&&<span className="preview-pill">{selected.claimType} · {selected.status}</span>}</div></Card>
    {loading&&<p className="quality-feedback">납품본 위치를 확인하는 중입니다.</p>}{error&&<p className="error-box" role="alert">{error}</p>}
    {!loading&&selected&&<div className="quality-center-grid">
      <article className="quality-center-card"><header><div><span>IMMUTABLE FINAL OUTPUT</span><h3>시스템 승인·확정본</h3></div><em>{selectedFinalizations.length}건</em></header>
        {selectedFinalizations.length?<ul className="delivery-finalization-list">{selectedFinalizations.map((item)=><li key={item.id}><div><strong>{item.reportTitle} · v{item.reportVersion}</strong><span>승인 {item.approvedBy} · 확정 {item.finalizedBy.name}</span><small>{new Date(item.finalizedAt).toLocaleString('ko-KR')}</small></div><div>{item.outputs.length?item.outputs.map((output)=><Button key={output.id} size="sm" variant="secondary" onClick={()=>void download(output)}>{output.format} · {formatBytes(output.byteSize)}</Button>):<button type="button" onClick={()=>onNavigate(`/reports/studio?caseId=${encodeURIComponent(item.caseId)}`)}>출력 파일 생성 화면 열기</button>}</div></li>)}</ul>:<div className="quality-empty"><strong>아직 승인·확정된 보고서가 없습니다.</strong><p>보고서 작성 완료 → 검토·승인 → 최종 확정 순서로 진행하세요.</p><Button size="sm" onClick={()=>onNavigate(`/reports/studio?caseId=${encodeURIComponent(selectedCaseId)}`)}>보고서 작성 열기</Button></div>}
      </article>
      <article className="quality-center-card"><header><div><span>COMPANY DRIVE DELIVERY</span><h3>회사 Drive 최종 납품본</h3></div><em>FINAL_DELIVERABLE</em></header><p>거래처에 실제 보낸 파일을 올리면 프로젝트 아래 최종납품본(업로더_날짜) 폴더에 저장됩니다. 목록에서 저장 폴더명과 업로더를 함께 확인하세요.</p><CaseEvidencePanel caseId={selectedCaseId} defaultCategory="FINAL_DELIVERABLE" allowedCategories={['FINAL_DELIVERABLE']} compact onNavigate={onNavigate}/></article>
    </div>}
  </section>;
}
