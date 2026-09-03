import React from 'react';
import { createRoot } from 'react-dom/client';
import { ProposalView } from '../src/proposals/ProposalView';
import { ProjectWorkflowSchedule } from '../src/workflow/ProjectWorkflowSchedule';
import { ProjectSchedulePrint } from '../src/workflow/ProjectSchedulePrint';
import { qaProjects, qaProposal } from './cf102-data';
import '../src/workflow/ProjectWorkflowSchedule.css';
import '../src/workflow/ProjectSchedulePrint.css';
import '../src/documents/StructuredDocumentEditor.css';
import '../src/preview-theme.css';
import '../src/theme-system.css';

const params=new URLSearchParams(location.search);
if(params.has('approved')) { qaProposal.status='APPROVED'; qaProposal.approvedVersionId='version-1'; }
const template={id:'template-1',name:'검수 템플릿',claimType:'TYPE-01',description:'',bodyTemplate:'',placeholdersJson:'[]'};
window.fetch=async(input,init)=>{
  const path=new URL(String(input),location.origin).pathname;
  const response=(body:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}));
  if(path==='/api/project-workflow/schedule')return response({projects:qaProjects});
  if(path==='/api/project-workflow/pm-options')return response({users:[{id:'pm-1',displayName:'현동명',email:'qa@example.test'}]});
  if(path==='/api/cases')return response({cases:qaProjects.map(p=>({id:p.caseId,caseNumber:p.code,title:p.name,claimType:p.claimType,status:'INQUIRY',clientName:p.client}))});
  if(path==='/api/proposal-studio/config')return response({modules:[],assets:[],sources:[{id:'source-1',sourceName:'검수 템플릿',isDefault:true}],templateTypes:[{id:'REDEVELOPMENT_FINANCE',label:'검수 제안 유형',representativeSourceId:'source-1',representativeSourceName:'검수 템플릿',sourceCount:1,promptReady:true}]});
  if(path==='/api/proposal-templates')return response({templates:[template]});
  if(path.endsWith('/reviews')&&init?.method==='POST'){
    if(params.has('fail'))return response({error:'CF102 의도된 확정 실패 · 이동하면 안 됨'},409);
    qaProposal.status='APPROVED';qaProposal.approvedVersionId='version-1';return response({proposal:qaProposal});
  }
  if(path.match(/^\/api\/cases\/case-\d\/proposals$/))return response({proposals:[qaProposal]});
  if(path.endsWith('/proposals/proposal-1'))return response({proposal:qaProposal});
  return response({error:`CF102 mock에서 허용하지 않은 요청: ${path}`},404);
};
const navigate=(path:string)=>{document.querySelector('#qa-navigation')!.textContent=`이동 요청: ${path}`;};
// Keep all print launches inside the isolated fixture; never reach a real API.
window.open=((url?:string|URL)=>{navigate(String(url));return null;}) as typeof window.open;
const view=params.get('view')??'proposal';
createRoot(document.getElementById('root')!).render(view==='print'?<ProjectSchedulePrint currentSearch={`?month=2026-09&${params}`} userName="검수 담당자" onClose={()=>navigate('닫기')}/>:view==='schedule'?<ProjectWorkflowSchedule routeId="PROJ-01" onNavigate={navigate}/>:<ProposalView routeId="PROP-02" roles={['pm']} userEmail="qa@example.test" onNavigate={navigate}/>);
