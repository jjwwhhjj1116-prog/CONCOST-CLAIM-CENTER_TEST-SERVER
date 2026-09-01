import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest } from '../api';

interface IntakeRecord {
  id:string; caseNumber:string; title:string; description:string|null; claimType:string; status:string; version:number;
  clientLegalPosition:string; clientPositionDetail:string|null; createdAt:string; updatedAt:string; createdByName:string;
  listHidden:boolean; dbDeleted:boolean; catalogVersion:number; driveArchiveUrl:string|null; driveArchivedAt:string|null; driveArchivedByName:string|null;
}

const statusLabel:Record<string,string>={ INQUIRY:'의뢰 접수',PROPOSAL:'제안 진행',CONTRACTED:'수주 확정',KICKOFF:'착수',IN_PROGRESS:'수행 중',REPORT_DRAFTING:'보고서 작성',REVIEW:'검토',DELIVERED:'납품',CLOSED:'완료' };

export function IntakeLibraryView({ mode,onNavigate }:{ mode:'projects'|'database'; onNavigate:(path:string)=>void }):React.ReactElement {
  const [records,setRecords]=useState<IntakeRecord[]>([]); const [query,setQuery]=useState(''); const [loading,setLoading]=useState(true); const [busy,setBusy]=useState(''); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const load=async()=>{ setLoading(true);setError('');try{const params=new URLSearchParams({ mode,q:query.trim() });const result=await apiRequest<{intakes:IntakeRecord[]}>(`/api/cases/catalog?${params}`);setRecords(result.intakes);}catch(reason){setError(reason instanceof ApiError&&reason.status===403?'관리자만 프로젝트 의뢰 DB관리 원장을 볼 수 있습니다.':reason instanceof Error?reason.message:String(reason));}finally{setLoading(false);} };
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),query?250:0);return()=>window.clearTimeout(timer);},[mode,query]);
  const stats=useMemo(()=>({ total:records.length,inquiry:records.filter((row)=>row.status==='INQUIRY').length,proposal:records.filter((row)=>row.status==='PROPOSAL').length,archived:records.filter((row)=>row.driveArchivedAt).length }),[records]);
  const action=async(record:IntakeRecord,code:'HIDE_FROM_LIST'|'RESTORE_TO_LIST'|'ARCHIVE_TO_DRIVE'|'ADMIN_DELETE')=>{
    if(code==='ADMIN_DELETE'&&!window.confirm(`${record.caseNumber} 의뢰를 관리자 DB 화면에서 삭제 처리할까요? 감사 행동 이력은 남습니다.`))return;
    setBusy(`${record.id}:${code}`);setError('');setNotice('');
    try{await apiRequest(`/api/cases/${record.id}/catalog`,{method:'POST',body:JSON.stringify({action:code,expectedVersion:record.catalogVersion})});setNotice(code==='HIDE_FROM_LIST'?'일반 목록에서 숨겼습니다. 관리자 보관 이력에는 그대로 남습니다.':code==='RESTORE_TO_LIST'?'일반 목록에 복원했습니다.':code==='ARCHIVE_TO_DRIVE'?'현재 의뢰 감사본을 회사 Google Drive에 보관했습니다.':'관리자 DB에서 삭제 처리했습니다.');await load();}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy('');}
  };
  return <section className="intake-library" aria-labelledby="intake-library-title">
    <header className="intake-library__hero"><div><span>{mode==='projects'?'PROJECT INTAKE LIST':'ADMIN · INTAKE DATABASE'}</span><h2 id="intake-library-title">{mode==='projects'?'프로젝트 의뢰 목록':'프로젝트 의뢰 DB관리'}</h2><p>{mode==='projects'?'작성된 프로젝트 의뢰를 제안서 작성 전 단계에서 검색·확인합니다. 목록에서 숨겨도 관리자 원장에서는 보존됩니다.':'의뢰 원본을 관리자만 관리합니다. Drive 보관은 현재 시점의 감사 JSON을 회사 프로젝트 폴더에 저장합니다.'}</p></div><div className="action-row"><button type="button" onClick={()=>onNavigate('/cases/new')}>+ 새 프로젝트 의뢰서</button>{mode==='projects'&&<button type="button" className="is-secondary" onClick={()=>onNavigate('/proposals/editor')}>선택 프로젝트로 제안서 작성</button>}</div></header>
    <div className="intake-library__summary"><article><span>현재 표시</span><strong>{stats.total}</strong></article><article><span>의뢰 접수</span><strong>{stats.inquiry}</strong></article><article><span>제안 진행</span><strong>{stats.proposal}</strong></article><article><span>Drive 보관</span><strong>{stats.archived}</strong></article></div>
    <label className="intake-library__search">프로젝트 의뢰 검색<input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="의뢰번호·프로젝트명·사건 설명"/></label>
    {notice&&<p className="notice-box" role="status">{notice}</p>}{error&&<p className="error-box" role="alert">{error}</p>}{loading&&<p className="empty-box">프로젝트 의뢰 목록을 불러오고 있습니다.</p>}
    {!loading&&!error&&!records.length&&<p className="empty-box">표시할 프로젝트 의뢰가 없습니다.</p>}
    {!loading&&records.length>0&&<div className="intake-record-list">{records.map((record)=><article key={record.id}><header><div><span>{record.caseNumber} · {record.claimType}</span><h3>{record.title}</h3></div><em>{statusLabel[record.status]??record.status}</em></header><p>{record.description||'사건 설명 미입력'}</p><dl><div><dt>클라이언트 지위</dt><dd>{record.clientLegalPosition}{record.clientPositionDetail?` · ${record.clientPositionDetail}`:''}</dd></div><div><dt>작성</dt><dd>{record.createdByName} · {new Date(record.createdAt).toLocaleString('ko-KR')}</dd></div>{record.driveArchivedAt&&<div><dt>Drive 감사본</dt><dd>{new Date(record.driveArchivedAt).toLocaleString('ko-KR')} · {record.driveArchivedByName}</dd></div>}</dl><footer><button type="button" onClick={()=>onNavigate(`/cases/new?caseId=${encodeURIComponent(record.id)}`)}>의뢰 열기</button><button type="button" onClick={()=>onNavigate(`/proposals/editor?caseId=${encodeURIComponent(record.id)}`)}>제안서 작성</button>{mode==='projects'?<button type="button" className="is-danger" disabled={Boolean(busy)} onClick={()=>void action(record,'HIDE_FROM_LIST')}>목록에서 숨기기</button>:<><button type="button" disabled={Boolean(busy)} onClick={()=>void action(record,'RESTORE_TO_LIST')}>{record.listHidden?'일반 목록 복원':'목록 표시 중'}</button><button type="button" className="is-drive" disabled={Boolean(busy)} onClick={()=>void action(record,'ARCHIVE_TO_DRIVE')}>Google Drive 보관</button>{record.driveArchiveUrl&&<a href={record.driveArchiveUrl} target="_blank" rel="noreferrer">보관본 열기</a>}<button type="button" className="is-danger" disabled={Boolean(busy)} onClick={()=>void action(record,'ADMIN_DELETE')}>관리자 삭제</button></>}</footer></article>)}</div>}
  </section>;
}
