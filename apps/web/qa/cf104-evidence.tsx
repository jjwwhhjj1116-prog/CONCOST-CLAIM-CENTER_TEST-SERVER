import React from 'react';
import { createRoot } from 'react-dom/client';
import { CaseEvidencePanel } from '../src/evidence/CaseEvidencePanel';
import '../src/preview-theme.css';
import '../src/theme-system.css';
import '../src/evidence/CaseEvidencePanel.css';
const file = { id:'00000000-0000-4000-8000-000000000104',category:'MEETING_MINUTES',originalName:'착수회의_회의록_2026-09-03.txt',mimeType:'text/plain',byteSize:1234,sha256:'a'.repeat(64),storageProvider:'GOOGLE_DRIVE',uploadedBy:'검수 담당자',uploadedAt:'2026-09-03T03:00:00Z',downloadUrl:'/api/cases/evidence/00000000-0000-4000-8000-000000000104/download',driveUrl:null,versionNumber:2,isLatest:true,changeSummary:['회의 참석자와 후속 일정 수정'] };
let files = [file,{...file,id:'00000000-0000-4000-8000-000000000105',versionNumber:1,isLatest:false,changeSummary:[]}];
window.fetch = async(input,init)=>{
  const path=new URL(String(input),location.origin).pathname;
  if(path.endsWith('/download'))return new Response('합성 자료 다운로드');
  if(init?.method==='POST'){
    const form=init.body as FormData;const incoming=form.get('file') as File;
    if(incoming.name.includes('duplicate'))return Response.json({status:'DUPLICATE_EXACT',code:'DUPLICATE_EXACT',existing_file:{name:file.originalName,uploader:file.uploadedBy,created_at:file.uploadedAt}},{status:409});
    if(!form.get('versionChoice'))return Response.json({status:'VERSION_CONFLICT_CONFIRMATION',reviewId:'synthetic-review',nextVersion:3,existing_file:{name:file.originalName,uploader:file.uploadedBy,created_at:file.uploadedAt},analysis:{change_summary:['현장 조사 일정을 다음 주로 변경','참석자 1명 추가']}},{status:409});
    const updated={...file,id:crypto.randomUUID(),originalName:incoming.name,versionNumber:form.get('versionChoice')==='REPLACE_AS_LATEST'?3:1};
    if(form.get('versionChoice')==='REPLACE_AS_LATEST')files=files.map(f=>({...f,isLatest:false}));
    files=[updated,...files];return Response.json({file:updated},{status:201});
  }
  return Response.json({files,storagePolicy:'GOOGLE_DRIVE_REQUIRED',googleDriveConnected:true});
};
function dropSynthetic(name: string) {
  const transfer = new DataTransfer(); transfer.items.add(new File(['합성 검수 원문'],name,{type:'text/plain'}));
  document.querySelector('.case-evidence-dropzone')?.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
}
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1100,margin:'24px auto',padding:16}}><p><button onClick={()=>dropSynthetic('duplicate.txt')}>합성 중복 파일 검수</button> <button onClick={()=>dropSynthetic('revised.txt')}>합성 버전 파일 검수</button></p><CaseEvidencePanel caseId="00000000-0000-4000-8000-000000000100" defaultCategory="MEETING_MINUTES" onNavigate={()=>{}}/></main>);
