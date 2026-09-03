import React from 'react';
import { createRoot } from 'react-dom/client';
import { WorkflowOperations } from '../src/workflow/WorkflowOperations';
import { minutesFieldDefaults } from '../../cloudflare/src/company-minutes';
import '../src/preview-theme.css';
import '../src/theme-system.css';
import '../src/workflow/WorkflowOperations.css';
const params=new URLSearchParams(location.search);
const caseRow={id:'case-1',caseNumber:'CF103-검수',title:'격리 검수 프로젝트',claimType:'TYPE-01',status:'CONTRACT',version:1,clientName:'검수 조합'};
const original={meetingAt:'2026-09-03T01:00:00.000Z',location:'본사 회의실',agenda:'착수회의',participantUnits:['김담당'],rawNotes:'현장 확인 후 다음 주 보고합니다.',summaryText:'',timeline:[],status:'DRAFTED',version:1,updatedAt:'2026-09-03T01:00:00Z',updatedByName:'검수 담당자',minutesFields:{...minutesFieldDefaults,author:'검수 담당자',clientName:'검수 조합'}};
const payload={case:caseRow,kickoff:{...original},siteSurveys:[{...original,id:'survey-1',surveyDate:'2026-09-03',scopeText:'외벽 조사',leadUnit:'조사팀',folderPath:'검수/현장조사',photoCount:0,audioCount:0,documentCount:0,outputStatus:'DRAFTED',outputVersion:1},{...original,id:'survey-2',surveyDate:'2026-09-04',scopeText:'내부 조사',leadUnit:'조사팀',folderPath:'검수/현장조사',photoCount:0,audioCount:0,documentCount:0,outputStatus:'DRAFTED',outputVersion:1,minutesFields:{...minutesFieldDefaults,clientName:'다른 날짜 조합'}}],allocations:[],events:[],googleDrive:{connected:true,deferredByUser:false,uploadEnabled:true}};
window.fetch=async(input,init)=>{
  const path=new URL(String(input),location.origin).pathname;
  const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  if(path==='/api/cases') return response({cases:[caseRow]});
  if(path==='/api/project-workflow/schedule')return response({projects:[]});
  if(path.endsWith('/evidence'))return response({files:[],storagePolicy:'GOOGLE_DRIVE_REQUIRED',googleDriveConnected:true});
  if(path.endsWith('/workflow/kickoff')&&init?.method==='PUT'){const value=JSON.parse(String(init.body));payload.kickoff={...payload.kickoff,...value,version:payload.kickoff.version+1};return response(payload);}
  if(path.endsWith('/workflow/site-survey')&&init?.method==='PUT'){const value=JSON.parse(String(init.body));payload.siteSurveys=payload.siteSurveys.map(row=>row.surveyDate===value.surveyDate?{...row,...value,version:row.version+1,outputVersion:row.outputVersion+1}:row);return response(payload);}
  if(path.endsWith('/workflow')) return response(payload);
  return response({error:`미허용 검수 요청 ${path}`},404);
};
createRoot(document.getElementById('root')!).render(<WorkflowOperations routeId={params.has('survey')?'WF-04':'WF-03'} roles={['admin']} onNavigate={()=>{}}/>);
