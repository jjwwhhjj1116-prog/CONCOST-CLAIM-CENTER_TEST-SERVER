import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Dialog, Input, Select, StatusBadge, type StatusType } from '@claim-studio/ui';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { apiRequest } from '../api';
import { AiGenerationProgressModal, type AiGenerationStatus } from '../components/AiGenerationProgressModal';
import { RhwpEditorDialog } from '../documents/RhwpEditorDialog';
import { DocumentToolMenus } from '../documents/DocumentToolMenus';
import { FileFormatIcon } from '../documents/FileFormatIcon';
import { downloadFinalDocument, type FinalDocumentFormat } from '../documents/final-document-export';
import { StructuredDocumentEditor, renderStructuredDocumentHtml, type StructuredDocumentEditorHandle, type StructuredSelection } from '../documents/StructuredDocumentEditor';
import { registerNavigationBlocker, type PendingNavigation } from '../navigation-guard';
import {
  proposalChapterWorkbook,
  proposalStudioWorkbook as proposalWorkbook,
  readProposalChapterWorkbook,
  readProposalStudioWorkbook as readProposalWorkbook,
} from './proposal-excel';

export interface ProposalViewProps { routeId:string; roles:readonly string[]; userEmail?:string; onNavigate:(path:string)=>void }
interface CaseItem { id:string; caseNumber:string; title:string; description?:string|null; claimType:string; status:string }
interface ProposalTemplate { id:string; name:string; claimType:string; description:string; bodyTemplate:string; placeholdersJson:string }
interface ProposalChapter { number:number; title:string; kind:'VARIABLE'|'FIXED'; moduleCode?:string; body:string; editorJson?:import('@tiptap/core').JSONContent|null; excludedCompanyAssetKeys?:string[] }
interface CompanyModule { code:string; chapterNumber:number; title:string; category:string; bodyMarkdown:string; isActive:boolean; version:number; updatedAt:string }
interface CompanyAsset { assetKey:string;chapterNumber:number;displayOrder:number;title:string;altText:string;mimeType:string|null;fileName:string|null;sha256:string|null;width:number|null;height:number|null;hasContent:boolean;isActive:boolean;version:number;updatedAt:string|null }
interface TemplateSource { id:string; sourceName:string; sourceFormat:string; sourceDate:string; isDefault:boolean; analysisStatus:string; chapterMapJson:string; version:number }
type ProposalTemplateCategory='REDEVELOPMENT_FINANCE'|'REDEVELOPMENT_COST'|'CLAIM_LITIGATION'|'PRICE_ESCALATION'|'PUBLIC_SUPPORT'|'GENERAL_CLAIM';
interface ProposalTemplateType { id:ProposalTemplateCategory;label:string;description:string;representativeSourceId:string;representativeSourceName:string;sourceCount:number;promptReady:boolean }
interface ProposalVersion { id:string; versionNumber:number; bodyText:string; structuredInputsJson:string; generationMode:string; providerId:string|null; modelId:string|null; inputSha256:string; sourceDocumentVersionIdsJson:string|null; sha256:string; isApproved:boolean; createdAt:string; createdBy?:{id:string;name:string} }
interface ProposalReview { id:string; action:string; comment:string|null; createdAt:string; reviewer:{id:string;name:string} }
interface ProposalExport { id:string;versionId:string;format:string;fileName:string;sha256:string;sanitizationCount:number;createdAt:string }
interface Proposal { id:string;caseId:string;templateId:string;title:string;status:string;currentVersionId:string|null;approvedVersionId:string|null;version:number;template?:ProposalTemplate;versions?:ProposalVersion[];reviews?:ProposalReview[];exports?:ProposalExport[] }
interface StudioInputs { clientName:string;projectTitle:string;subtitle:string;submissionDate:string;keyIssues:string;objective:string;planNotes:string;exclusions:string;chapters:ProposalChapter[];includedModuleCodes:string[];templateSourceId?:string;templateSourceName?:string }

const chapterTitles=['제안(용역)의 목적','당 현장의 핵심 쟁점 분석','업무 수행 내용 및 추진 계획','전문가 현황','당사의 강점','조직도 및 업무 영역','도시정비사업 공사비검증 실적','한국부동산원 공사비검증 실적','건설 클레임·소송·기술감정 실적','자격 증명자료','용역 조건 및 제안 범위','맺음말'];
const blankChapters=():ProposalChapter[]=>chapterTitles.map((title,index)=>({number:index+1,title,kind:index>=3?'FIXED':'VARIABLE',body:'[작성 필요]'}));
const repairLegacyProposalChapterMixup=(chapters:ProposalChapter[],objective:string,keyIssues:string,planNotes:string):ProposalChapter[]=>{
  const variableBodies=[objective,keyIssues,planNotes].map((value)=>value.trim()).filter(Boolean);
  const firstThree=chapters.slice(0,3).map((chapter)=>chapter.body.trim());
  const comparable=(value:string)=>value.toLocaleLowerCase('ko-KR').replace(/[\s\p{P}\p{S}]+/gu,'');
  const corruptedBodySignatures=new Set([...variableBodies,...firstThree].map(comparable).filter(Boolean));
  const variablesWereDuplicated=new Set(firstThree).size<3;
  return chapters.map((chapter)=>{
    if(variablesWereDuplicated&&chapter.number<=3){const restored=variableBodies[chapter.number-1];return restored?{...chapter,body:restored,editorJson:null}:chapter;}
    const comparableBody=comparable(chapter.body);const copiedVariableBody=corruptedBodySignatures.has(comparableBody)||(variablesWereDuplicated&&[...corruptedBodySignatures].some((signature)=>signature.length>30&&comparableBody.includes(signature)));
    if(chapter.number>=4&&chapter.number<=11&&copiedVariableBody)return{...chapter,body:'[작성 필요]',editorJson:null,excludedCompanyAssetKeys:[]};
    if(variablesWereDuplicated&&chapter.number===6){
      const body=chapter.body.replace(/!\[[^\]]*\]\([^)]*CH06_(?:ORG_CHART|BUSINESS_AREAS)[^)]*\)\s*/gu,'');
      return{...chapter,body,editorJson:null};
    }
    return chapter;
  });
};
const parseArray=(value:string|null|undefined):string[]=>{try{const parsed:unknown=JSON.parse(value??'[]');return Array.isArray(parsed)&&parsed.every((item)=>typeof item==='string')?parsed:[];}catch{return[];}};
const statusBadge=(status:string):StatusType=>['draft','in_review','approved','rejected'].includes(status.toLowerCase())?status.toLowerCase() as StatusType:'unwritten';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

async function proposalImageForUpload(source:File):Promise<File>{
  if(!['image/jpeg','image/png','image/webp'].includes(source.type))throw new Error('JPG, PNG 또는 WebP 원본 이미지만 삽입할 수 있습니다.');
  const bitmap=await createImageBitmap(source);
  const scale=Math.min(1,6000/bitmap.width,6000/bitmap.height);
  if(source.type==='image/jpeg'&&scale===1&&source.size<=8_000_000){bitmap.close();return source;}
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext('2d');if(!context){bitmap.close();throw new Error('브라우저에서 원본 이미지를 처리하지 못했습니다.');}
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const toJpeg=(quality:number)=>new Promise<Blob|null>((resolve)=>canvas.toBlob(resolve,'image/jpeg',quality));
  let blob=await toJpeg(.96);if(blob&&blob.size>8_000_000)blob=await toJpeg(.9);
  if(!blob||blob.size>8_000_000)throw new Error('이미지가 너무 큽니다. 긴 변 6000px 이하 원본을 사용해 주세요.');
  return new File([blob],source.name.replace(/\.(?:png|webp)$/iu,'.jpg'),{type:'image/jpeg',lastModified:source.lastModified});
}

const proposalAssetAnchor:Record<string,RegExp>={
  CH04_EXPERT_PROFILE:/대표이사|전문가 현황|현동명/u,
  CH06_ORG_CHART:/조직도|조직 구성|조직 체계/u,
  CH06_BUSINESS_AREAS:/업무 영역/u,
  CH10_DEGREE:/학위/u,
  CH10_APPRAISER:/감정사|자격증/u,
  CH10_PUBLICATIONS:/저서|논문/u
};
function proposalChapterWithCompanyImages(chapter:ProposalChapter,assets:readonly CompanyAsset[]):ProposalChapter{
  const excluded=new Set(chapter.excludedCompanyAssetKeys??[]);
  const chapterAssets=assets.filter((asset)=>asset.chapterNumber===chapter.number&&asset.hasContent&&asset.isActive&&asset.assetKey!=='BRAND_LOGO'&&!excluded.has(asset.assetKey)).sort((a,b)=>a.displayOrder-b.displayOrder);
  if(!chapterAssets.length)return chapter;
  const lines=chapter.body.replaceAll('\r\n','\n').split('\n');const editorSnapshot=chapter.editorJson?JSON.stringify(chapter.editorJson):'';let changed=false;
  for(const asset of chapterAssets){
    const sourceBase=`/api/proposal-studio/assets/${asset.assetKey}`;
    if(chapter.body.includes(sourceBase)){
      // Legacy versions can contain the company image in Markdown while their
      // saved Tiptap JSON predates it. Because the editor prioritizes JSON,
      // rebuild that stale document from the authoritative chapter body.
      if(chapter.editorJson&&!editorSnapshot.includes(sourceBase))changed=true;
      continue;
    }
    const image=`![${asset.altText}](${sourceBase}?v=${asset.version} "${asset.title.replaceAll('"','')}")`;
    const anchor=proposalAssetAnchor[asset.assetKey];const index=anchor?lines.findIndex((line)=>anchor.test(line)):-1;
    if(index>=0)lines.splice(index+1,0,'',image,'');else lines.push('',image);
    changed=true;
  }
  return changed?{...chapter,body:lines.join('\n'),editorJson:null}:chapter;
}
function repairDuplicatedCompanyModules(chapters:ProposalChapter[],modules:readonly CompanyModule[],assets:readonly CompanyAsset[]):ProposalChapter[]{
  const signature=(value:string)=>value.replace(proposalImageTokenPattern,'').toLocaleLowerCase('ko-KR').replace(/[\s\p{P}\p{S}]+/gu,'');
  const counts=new Map<string,number>();
  for(const chapter of chapters){
    if(chapter.number<4||chapter.number>12)continue;
    const bodySignature=signature(chapter.body);if(bodySignature)counts.set(bodySignature,(counts.get(bodySignature)??0)+1);
  }
  return chapters.map((chapter)=>{
    let source=chapter;
    const module=modules.find((candidate)=>candidate.isActive&&candidate.chapterNumber===chapter.number);
    const bodySignature=signature(chapter.body);
    const isCorruptedDuplicate=chapter.number>=4&&chapter.number<=12&&Boolean(bodySignature)&&(counts.get(bodySignature)??0)>1;
    const isMissingFixedBody=chapter.number>=4&&chapter.number<=12&&(!bodySignature||chapter.body.trim()==='[작성 필요]');
    if(module&&(isCorruptedDuplicate||isMissingFixedBody))source={...chapter,title:module.title,kind:'FIXED',moduleCode:module.code,body:module.bodyMarkdown,editorJson:null,excludedCompanyAssetKeys:[]};
    return proposalChapterWithCompanyImages(source,assets);
  });
}
const proposalImageTokenPattern=/!\[[^\]]*\]\((?:<)?[^\s)>]+(?:>)?(?:\s+["'][^"']*["'])?\)|<img\b[^>]*\bsrc\s*=\s*(?:"[^"]+"|'[^']+'|[^\s>]+)[^>]*>/giu;
const proposalImageSource=(token:string):string=>{
  const markdown=token.match(/^!\[[^\]]*\]\((?:<)?([^\s)>]+)(?:>)?/iu);
  if(markdown?.[1])return markdown[1];
  const html=token.match(/\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/iu);
  return html?.[1]??html?.[2]??html?.[3]??'';
};
const normalizedProposalImageSource=(source:string):string=>source.trim().replace(/[?#].*$/u,'');
const deduplicateProposalImages=(body:string):string=>{
  const seen=new Set<string>();
  return body.replace(proposalImageTokenPattern,(token)=>{
    const source=normalizedProposalImageSource(proposalImageSource(token));
    if(!source)return token;
    if(seen.has(source))return '';
    seen.add(source);return token;
  });
};
const renderProposalBodyHtml=(body:string,assets:readonly CompanyAsset[],hydrateCompanyAssets:boolean):string=>{
  const source=hydrateCompanyAssets?proposalChapterWithCompanyImages({number:assets[0]?.chapterNumber??0,title:'',kind:'FIXED',body},assets).body:body;
  const rendered=marked.parse(deduplicateProposalImages(source),{async:false,gfm:true,breaks:true});
  return DOMPurify.sanitize(typeof rendered==='string'?rendered:'',{
    ADD_ATTR:['data-image-align','data-table-width','data-table-align','data-table-density','colspan','rowspan','style','target','rel','width','height']
  });
};
function ProposalRichContent({body,editorJson,assets=[],hydrateCompanyAssets=true}:{body:string;editorJson?:import('@tiptap/core').JSONContent|null;assets?:CompanyAsset[];hydrateCompanyAssets?:boolean}):React.ReactElement{
  const visible=assets.filter((asset)=>asset.hasContent&&asset.isActive).sort((a,b)=>a.displayOrder-b.displayOrder);
  const structuredHtml=editorJson?renderStructuredDocumentHtml(editorJson):'';
  const html=structuredHtml
    ? DOMPurify.sanitize(deduplicateProposalImages(structuredHtml),{ADD_ATTR:['data-image-align','data-table-width','data-table-align','data-table-density','colspan','rowspan','style','target','rel','width','height']})
    : renderProposalBodyHtml(body,visible,hydrateCompanyAssets);
  return <article className="proposal-rich-content structured-editor__preview" dangerouslySetInnerHTML={{__html:html}}/>;
}

function ProposalFinalDocumentPreview({projectTitle,subtitle,clientName,submissionDate,chapters}:{projectTitle:string;subtitle:string;clientName:string;submissionDate:string;chapters:ProposalChapter[]}):React.ReactElement{
  return <article className="proposal-final-document" aria-label="확정 전 제안서 전체 합본 미리보기" data-export-document-title={projectTitle} data-export-document-kind="PROPOSAL">
    <section className="proposal-final-cover" data-export-page data-page-number="1"><img className="proposal-template-logo" src="/api/proposal-studio/assets/BRAND_LOGO?v=1" alt="주식회사 컨코스트"/><span>CONCOST CLAIM CENTER STUDIO</span><h3>{projectTitle}</h3><p>{subtitle}</p><dl><div><dt>제출처</dt><dd>{clientName}</dd></div><div><dt>제출일</dt><dd>{submissionDate}</dd></div><div><dt>제안사</dt><dd>주식회사 컨코스트 · 클레임센터</dd></div></dl><b>건설 클레임 전문용역 제안서</b></section>
    <section className="proposal-final-toc" data-export-page data-page-number="2"><span>TABLE OF CONTENTS</span><h3>목 차</h3><ol>{chapters.map((item)=><li key={item.number}><b>{String(item.number).padStart(2,'0')}</b><span>{item.title}</span></li>)}</ol></section>
    {chapters.map((item)=><section className="proposal-final-chapter" data-export-page data-page-number={item.number+2} data-chapter-number={item.number} key={item.number}><header><span>CHAPTER {String(item.number).padStart(2,'0')}</span><h3>{item.number}. {item.title}</h3></header><ProposalRichContent body={item.body} editorJson={item.editorJson}/></section>)}
  </article>;
}

export const ProposalView:React.FC<ProposalViewProps>=({routeId,roles,userEmail='',onNavigate})=>{
  const requestedCaseId=new URLSearchParams(window.location.search).get('caseId')??'';
  const fromIntake=new URLSearchParams(window.location.search).get('from')==='intake';
  const intakeStoragePending=new URLSearchParams(window.location.search).get('intakeStorage')==='pending';
  const [cases,setCases]=useState<CaseItem[]>([]); const [selectedCaseId,setSelectedCaseId]=useState(requestedCaseId);
  const [templates,setTemplates]=useState<ProposalTemplate[]>([]); const [selectedTemplateId,setSelectedTemplateId]=useState('');
  const [,setProposals]=useState<Proposal[]>([]); const [activeProposal,setActiveProposal]=useState<Proposal|null>(null);
  const [modules,setModules]=useState<CompanyModule[]>([]); const [sources,setSources]=useState<TemplateSource[]>([]); const [companyAssets,setCompanyAssets]=useState<CompanyAsset[]>([]);
  const [templateTypes,setTemplateTypes]=useState<ProposalTemplateType[]>([]); const [selectedTemplateType,setSelectedTemplateType]=useState<ProposalTemplateCategory>('REDEVELOPMENT_FINANCE');
  const [selectedTemplateSourceId,setSelectedTemplateSourceId]=useState('');
  const [step,setStep]=useState(1); const [draftMethod,setDraftMethod]=useState<'AI'|'MANUAL'>('AI'); const [selectedChapter,setSelectedChapter]=useState(1); const [templatePreview,setTemplatePreview]=useState(false); const [confirmProposalOpen,setConfirmProposalOpen]=useState(false);
  const [clientName,setClientName]=useState(''); const [projectTitle,setProjectTitle]=useState(''); const [subtitle,setSubtitle]=useState('건설 클레임 전문용역 제안'); const [submissionDate,setSubmissionDate]=useState(today());
  const [keyIssues,setKeyIssues]=useState(''); const [objective,setObjective]=useState(''); const [planNotes,setPlanNotes]=useState(''); const [exclusions,setExclusions]=useState('해당 없음');
  const [chapters,setChapters]=useState<ProposalChapter[]>(blankChapters); const [includedModuleCodes,setIncludedModuleCodes]=useState<string[]>([]); const [sourceDocumentVersionIds,setSourceDocumentVersionIds]=useState('');
  const [errorMessage,setErrorMessage]=useState<string|null>(null); const [successMessage,setSuccessMessage]=useState<string|null>(null); const [busy,setBusy]=useState(false);
  const [mailRecipient,setMailRecipient]=useState(''); const [mailSubject,setMailSubject]=useState(''); const [mailBody,setMailBody]=useState('안녕하세요.\n\n요청하신 기술용역 제안서를 첨부하여 보내드립니다.\n검토 후 회신 부탁드립니다.\n\n감사합니다.');
  const [aiGeneration,setAiGeneration]=useState<{kind:'draft'|'improve';status:AiGenerationStatus;error?:string}|null>(null);
  const [proposalSelection,setProposalSelection]=useState<StructuredSelection|null>(null); const [proposalImproveInstruction,setProposalImproveInstruction]=useState('사실과 수치는 유지하고 수주 제안서 문체로 더 명확하고 설득력 있게 다듬어 주세요.');
  const [proposalImprovement,setProposalImprovement]=useState<{from:number;to:number;original:string;replacement:string}|null>(null);
  const [hwpEditorOpen,setHwpEditorOpen]=useState(false); const [hwpSourceFile,setHwpSourceFile]=useState<File|null>(null); const [hwpApplyChapter,setHwpApplyChapter]=useState<number|null>(null);
  const [selectedModuleCode,setSelectedModuleCode]=useState(''); const [moduleTitle,setModuleTitle]=useState(''); const [moduleBody,setModuleBody]=useState(''); const [moduleActive,setModuleActive]=useState(true);
  const [dirty,setDirty]=useState(false); const [pendingNavigation,setPendingNavigation]=useState<PendingNavigation|null>(null); const [stepValidationMessage,setStepValidationMessage]=useState(''); const [canResumeReviewerEdits,setCanResumeReviewerEdits]=useState(false);
  const excelInputRef=useRef<HTMLInputElement>(null); const chapterExcelInputRef=useRef<HTMLInputElement>(null); const proposalImageInputRef=useRef<HTMLInputElement>(null); const proposalEditorRef=useRef<StructuredDocumentEditorHandle|null>(null); const finalPreviewRef=useRef<HTMLDivElement>(null);
  const canEdit=roles.some((role)=>['ceo','director','pm','admin'].includes(role)); const canManageModules=roles.includes('admin');

  const applyVersion=useCallback((version:ProposalVersion|undefined,caseRow?:CaseItem)=>{
    if(!version){setChapters(blankChapters());setDraftMethod('AI');return;}
    try{
      const parsed=JSON.parse(version.structuredInputsJson) as Partial<StudioInputs>&Record<string,unknown>;
      if(Array.isArray(parsed.chapters)&&parsed.chapters.length===12){
        const parsedKeyIssues=String(parsed.keyIssues??'');const parsedObjective=String(parsed.objective??'');const parsedPlanNotes=String(parsed.planNotes??'');
        setClientName(String(parsed.clientName??''));setProjectTitle(String(parsed.projectTitle??caseRow?.title??''));setSubtitle(String(parsed.subtitle??'건설 클레임 전문용역 제안'));setSubmissionDate(String(parsed.submissionDate??today()));
        setKeyIssues(parsedKeyIssues);setObjective(parsedObjective);setPlanNotes(parsedPlanNotes);setExclusions(String(parsed.exclusions??'해당 없음'));
        const repairedChapters=repairLegacyProposalChapterMixup(parsed.chapters as ProposalChapter[],parsedObjective,parsedKeyIssues,parsedPlanNotes);const savedModuleCodes=Array.isArray(parsed.includedModuleCodes)?parsed.includedModuleCodes.filter((item):item is string=>typeof item==='string'):[];const closingWasIncluded=!repairedChapters[11].body.includes('현재 제안서에서 제외');setChapters(repairedChapters);setIncludedModuleCodes(closingWasIncluded?[...new Set([...savedModuleCodes,'CH12_CLOSING'])]:savedModuleCodes);if(typeof parsed.templateSourceId==='string')setSelectedTemplateSourceId(parsed.templateSourceId);
      }else{
        const next=blankChapters();next[0].body=`${String(parsed.background??'')}\n\n${String(parsed.objective??'')}`.trim();next[2].body=String(parsed.method??'');next[11].body=`${String(parsed.expectedOutcome??'')}\n\n제외사항: ${String(parsed.exclusions??'')}`;
        setClientName('');setProjectTitle(`${caseRow?.title??'프로젝트'} 기술용역 제안서`);setObjective(String(parsed.objective??''));setPlanNotes(String(parsed.method??''));setExclusions(String(parsed.exclusions??'해당 없음'));setChapters(next);
      }
      setSourceDocumentVersionIds(parseArray(version.sourceDocumentVersionIdsJson).join(', '));
      setDraftMethod(version.generationMode==='AI'?'AI':'MANUAL');
    }catch{setChapters(blankChapters());}
  },[]);

  const loadProposalDetail=useCallback(async(cId:string,pId:string)=>{const response=await apiRequest<{proposal:Proposal}>(`/api/cases/${cId}/proposals/${pId}`);setActiveProposal(response.proposal);applyVersion(response.proposal.versions?.[0],cases.find((item)=>item.id===cId));setDirty(false);setCanResumeReviewerEdits(false);},[applyVersion,cases]);
  const loadCaseData=useCallback(async(cId:string)=>{if(!cId)return;const caseRow=cases.find((item)=>item.id===cId);const query=caseRow?`?claimType=${caseRow.claimType}`:'';try{const [templateResult,proposalResult]=await Promise.all([apiRequest<{templates:ProposalTemplate[]}>(`/api/proposal-templates${query}`),apiRequest<{proposals:Proposal[]}>(`/api/cases/${cId}/proposals`)]);setTemplates(templateResult.templates??[]);setSelectedTemplateId(templateResult.templates?.[0]?.id??'');setProposals(proposalResult.proposals??[]);if(proposalResult.proposals?.length)await loadProposalDetail(cId,proposalResult.proposals[0].id);else{setActiveProposal(null);setProjectTitle(`${caseRow?.title??''} 기술용역 제안서`);setObjective(caseRow?.description??'');setChapters(blankChapters());setStep(1);setDirty(false);}}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'제안서 데이터를 불러오지 못했습니다.');}},[cases,loadProposalDetail]);
  useEffect(()=>{void Promise.all([apiRequest<{cases:CaseItem[]}>('/api/cases?scope=proposal-authoring&limit=100&q='),apiRequest<{modules:CompanyModule[];sources:TemplateSource[];assets:CompanyAsset[];templateTypes:ProposalTemplateType[]}>('/api/proposal-studio/config')]).then(([res,config])=>{const availableTypes=config.templateTypes??[];const preferredType=availableTypes.find((type)=>type.id==='REDEVELOPMENT_FINANCE')??availableTypes[0];setCases(res.cases??[]);setModules(config.modules??[]);setSources(config.sources??[]);setTemplateTypes(availableTypes);setCompanyAssets(config.assets??[]);if(preferredType){setSelectedTemplateType(preferredType.id);setSelectedTemplateSourceId((current)=>current||preferredType.representativeSourceId);}else setSelectedTemplateSourceId((current)=>current||config.sources?.find((source)=>source.isDefault)?.id||config.sources?.[0]?.id||'');setIncludedModuleCodes((config.modules??[]).filter((module)=>module.isActive).map((module)=>module.code));setSelectedCaseId((current)=>{const preferred=current||requestedCaseId;return res.cases.some((item) => item.id === preferred)?preferred:res.cases?.[0]?.id??'';});}).catch((reason:Error)=>setErrorMessage(reason.message));},[]);
  useEffect(()=>{if(selectedCaseId)void loadCaseData(selectedCaseId);},[selectedCaseId,loadCaseData]);
  useEffect(()=>{const selected=modules.find((module)=>module.code===selectedModuleCode)??modules[0];if(!selected)return;if(selected.code!==selectedModuleCode)setSelectedModuleCode(selected.code);setModuleTitle(selected.title);setModuleBody(selected.bodyMarkdown);setModuleActive(selected.isActive);},[modules,selectedModuleCode]);
  useEffect(()=>{if(activeProposal?.status!=='DRAFT'||!modules.length)return;setChapters((current)=>current.map((item)=>{if(item.kind!=='FIXED'||!item.body.trim().startsWith('[작성 필요]'))return item;const canonical=modules.find((module)=>module.chapterNumber===item.number&&module.isActive);return canonical?{...item,title:canonical.title,moduleCode:canonical.code,body:canonical.bodyMarkdown,editorJson:null}:item;}));},[activeProposal?.id,activeProposal?.status,modules]);
  useEffect(()=>{if(activeProposal?.status!=='DRAFT'||!companyAssets.length||!modules.length)return;setChapters((current)=>{const next=repairDuplicatedCompanyModules(current,modules,companyAssets);return next.some((chapter,index)=>chapter!==current[index])?next:current;});},[activeProposal?.id,activeProposal?.currentVersionId,activeProposal?.status,companyAssets,modules]);
  useEffect(()=>{const onImageDeleted=(event:Event)=>{const detail=(event as CustomEvent<{documentKey?:string;src?:string}>).detail;if(detail.documentKey!==`proposal-${activeProposal?.id}-${selectedChapter}`||!detail.src)return;const companyKey=detail.src.match(/\/api\/proposal-studio\/assets\/([A-Z0-9_]+)/u)?.[1];if(!companyKey)return;setChapters((current)=>current.map((item)=>item.number===selectedChapter?{...item,excludedCompanyAssetKeys:[...new Set([...(item.excludedCompanyAssetKeys??[]),companyKey])]}:item));setDirty(true);setSuccessMessage(`${selectedChapter}장에서 선택한 회사 기본 이미지를 이 제안서에서 제외했습니다. 중앙 기본값 최신본을 다시 가져오면 복원할 수 있습니다.`);};window.addEventListener('structured-editor:image-deleted',onImageDeleted);return()=>window.removeEventListener('structured-editor:image-deleted',onImageDeleted);},[activeProposal?.id,selectedChapter]);
  useEffect(()=>{if(projectTitle.trim()&&!mailSubject.trim())setMailSubject(`[컨코스트] ${projectTitle} 제안서 송부`);},[projectTitle,mailSubject]);
  useEffect(()=>{const type=templateTypes.find((item)=>item.representativeSourceId===selectedTemplateSourceId);if(type&&type.id!==selectedTemplateType)setSelectedTemplateType(type.id);},[selectedTemplateSourceId,selectedTemplateType,templateTypes]);
  useEffect(()=>registerNavigationBlocker((navigation)=>{const current=`${window.location.pathname}${window.location.search}`;if(!dirty||navigation.path===current)return false;setPendingNavigation(navigation);return true;}),[dirty]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(dirty)event.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);

  const createProposal=async()=>{if(!selectedCaseId||!selectedTemplateId||!selectedTemplateSourceId)return;setBusy(true);setErrorMessage(null);try{const result=await apiRequest<{proposal:Proposal}>(`/api/cases/${selectedCaseId}/proposals`,{method:'POST',body:JSON.stringify({templateId:selectedTemplateId,sourceId:selectedTemplateSourceId})});await loadCaseData(selectedCaseId);await loadProposalDetail(selectedCaseId,result.proposal.id);setStep(1);setSuccessMessage('선택한 실무 템플릿으로 12개 챕터 제안서 작업공간을 만들었습니다. 1단계 입력부터 진행하세요.');onNavigate(`/proposals/editor?caseId=${encodeURIComponent(selectedCaseId)}`);}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'제안서를 만들지 못했습니다.');}finally{setBusy(false);}};
  const preparedChapters=()=>chapters.map((chapter)=>chapter.number===1?{...chapter,body:objective}:chapter.number===2?{...chapter,body:keyIssues}:chapter.number===3?{...chapter,body:planNotes}:chapter);
  const chooseDraftMethod=(method:'AI'|'MANUAL')=>{setDraftMethod(method);if(method==='MANUAL')setChapters((current)=>current.map((chapter)=>{if(chapter.number===1&&(!chapter.body.trim()||chapter.body==='[작성 필요]'))return{...chapter,body:objective};if(chapter.number===2&&(!chapter.body.trim()||chapter.body==='[작성 필요]'))return{...chapter,body:keyIssues};if(chapter.number===3&&(!chapter.body.trim()||chapter.body==='[작성 필요]'))return{...chapter,body:planNotes};return chapter;}));};
  const saveVersion=async(generationMode:'MANUAL'|'AI',nextStep:3|4=4)=>{
    if(!activeProposal||!selectedCaseId)return;
    if(![clientName,projectTitle,subtitle,submissionDate,keyIssues,objective,planNotes].every((value)=>value.trim())){setErrorMessage('1단계의 클라이언트·프로젝트 정보와 핵심 쟁점·목적·수행 메모를 모두 입력하세요.');return;}
    setBusy(true);setErrorMessage(null);if(generationMode==='AI')setAiGeneration({kind:'draft',status:'running'});
    try{
      let target=activeProposal;
      let forked=false;
      if(activeProposal.status!=='DRAFT'){
        const created=await apiRequest<{proposal:Proposal}>(`/api/cases/${selectedCaseId}/proposals`,{method:'POST',body:JSON.stringify({templateId:activeProposal.templateId,sourceId:selectedTemplateSourceId})});
        target=created.proposal;forked=true;
      }
      const submittedChapters=generationMode==='AI'?preparedChapters():chapters;
      await apiRequest(`/api/cases/${selectedCaseId}/proposals/${target.id}/versions`,{method:'POST',timeoutMs:generationMode==='AI'?330_000:30_000,body:JSON.stringify({clientName,projectTitle,subtitle,submissionDate,keyIssues,objective,planNotes,exclusions,chapters:submittedChapters,includedModuleCodes,templateSourceId:selectedTemplateSourceId,generationMode,sourceDocumentVersionIds:sourceDocumentVersionIds.split(',').map((item)=>item.trim()).filter(Boolean),version:target.version})});
      await loadCaseData(selectedCaseId);await loadProposalDetail(selectedCaseId,target.id);setDirty(false);if(generationMode==='AI')setAiGeneration({kind:'draft',status:'complete'});else{setCanResumeReviewerEdits(nextStep===3);setStep(nextStep);}
      setSuccessMessage(`${forked?'기존 확정본은 보존하고 편집용 새 초안을 만들었습니다. ':''}${generationMode==='AI'?'Gemini가 1·2·3장 최초 초안을 만들고 4~12장 중앙 기본값의 편집 복사본을 결합했습니다. 이제 모든 장을 사람이 직접 수정할 수 있습니다.':nextStep===3?'수동·외부 LLM 초안을 저장했습니다. 이제 3단계 편집기에서 1~12장 전체를 검수·수정하세요.':'사람이 수정한 12개 챕터를 그대로 새 버전으로 저장했습니다.'}`);
    }catch(reason){const message=reason instanceof Error?reason.message:'제안서 버전을 저장하지 못했습니다.';if(generationMode==='AI')setAiGeneration({kind:'draft',status:'error',error:message});else setErrorMessage(message);}finally{setBusy(false);}
  };
  const confirmProposal=async()=>{if(!activeProposal||!selectedCaseId)return;setBusy(true);try{await apiRequest(`/api/cases/${selectedCaseId}/proposals/${activeProposal.id}/reviews`,{method:'POST',body:JSON.stringify({action:'CONFIRM',comment:'4단계 전체 합본 미리보기 확인 후 작성자가 최종 확정함',versionId:activeProposal.currentVersionId,version:activeProposal.version})});await loadProposalDetail(selectedCaseId,activeProposal.id);setConfirmProposalOpen(false);setSuccessMessage('제안서 확정 완료. 현재 미리보기 그대로 DOCX·PDF·HWP 내려받기가 활성화됐고 확정본으로 보관되었습니다.');}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'제안서 상태를 바꾸지 못했습니다.');}finally{setBusy(false);}};
  const download=async(format:FinalDocumentFormat)=>{if(!activeProposal||!selectedCaseId||!finalPreviewRef.current)return;setBusy(true);setErrorMessage(null);try{const result=await downloadFinalDocument({root:finalPreviewRef.current,format,fileName:`${cases.find((item)=>item.id===selectedCaseId)?.caseNumber??'CONCOST'}_${projectTitle}_v${activeProposal.version}`,onProgress:(message)=>setSuccessMessage(message)});setSuccessMessage(`${format.toUpperCase()} 확정본 ${result.pageCount}페이지 내려받기 완료 · 화면 미리보기와 동일한 A4 출력본입니다.`);}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'제안서를 내려받지 못했습니다.');}finally{setBusy(false);}};
  const exportExcel=()=>{const selected=cases.find((item)=>item.id===selectedCaseId);const bytes=proposalWorkbook({clientName,projectTitle,subtitle,submissionDate,keyIssues,objective,planNotes,exclusions},`${selected?.caseNumber??''} · ${selected?.title??''}`,templates.find((item)=>item.id===selectedTemplateId)?.name??'컨코스트 12챕터');const payload=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;const url=URL.createObjectURL(new Blob([payload],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`${selected?.caseNumber??'PROJECT'}_제안서_입력양식.xlsx`;anchor.click();URL.revokeObjectURL(url);setSuccessMessage('Excel 양식을 내보냈습니다. C열 작성 후 다시 가져오면 1단계에 반영됩니다.');};
  const importExcel=async(file?:File)=>{if(!file)return;setBusy(true);try{const values=await readProposalWorkbook(file);setClientName(values.clientName);setProjectTitle(values.projectTitle);setSubtitle(values.subtitle);setSubmissionDate(values.submissionDate);setKeyIssues(values.keyIssues);setObjective(values.objective);setPlanNotes(values.planNotes);setExclusions(values.exclusions);setDirty(true);setStep(1);setSuccessMessage('작성 Excel 가져오기 완료. C열의 8개 항목을 1단계에 반영했습니다. 화면 확인 후 초안 작성 방식을 선택하세요.');}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'Excel을 읽지 못했습니다.');}finally{setBusy(false);if(excelInputRef.current)excelInputRef.current.value='';}};
  const exportChapterExcel=()=>{const selected=cases.find((item)=>item.id===selectedCaseId);const current=chapters[selectedChapter-1];if(!current)return;const bytes=proposalChapterWorkbook({chapterNumber:current.number,chapterTitle:current.title,chapterBody:current.body},`${selected?.caseNumber??''} · ${selected?.title??''}`);const payload=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;const url=URL.createObjectURL(new Blob([payload],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`${selected?.caseNumber??'PROJECT'}_제안서_${String(current.number).padStart(2,'0')}장_편집.xlsx`;anchor.click();URL.revokeObjectURL(url);setSuccessMessage(`${current.number}장 전용 Excel을 내보냈습니다. 본문을 수정한 뒤 같은 장에서 다시 가져오세요.`);};
  const importChapterExcel=async(file?:File)=>{if(!file)return;setBusy(true);try{const imported=await readProposalChapterWorkbook(file);if(imported.chapterNumber!==selectedChapter)throw new Error(`이 파일은 ${imported.chapterNumber}장 전용입니다. 목차에서 ${imported.chapterNumber}장을 선택한 뒤 가져오세요.`);setChapters((current)=>current.map((item)=>item.number===selectedChapter?{...item,title:imported.chapterTitle,body:imported.chapterBody,editorJson:null}:item));if(selectedChapter===1)setObjective(imported.chapterBody);if(selectedChapter===2)setKeyIssues(imported.chapterBody);if(selectedChapter===3)setPlanNotes(imported.chapterBody);setDirty(true);setSuccessMessage(`${selectedChapter}장 Excel 본문을 현재 담당자 검수 편집기에 반영했습니다. 검수 완료를 눌러 버전에 저장하세요.`);}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'현재 챕터 Excel을 읽지 못했습니다.');}finally{setBusy(false);if(chapterExcelInputRef.current)chapterExcelInputRef.current.value='';}};
  const openChapterHwp=()=>{setHwpApplyChapter(selectedChapter);setHwpSourceFile(null);setHwpEditorOpen(true);};
  const applyHwpContentToChapter=async(content:string)=>{const target=hwpApplyChapter;if(!target)return;setChapters((current)=>current.map((item)=>item.number===target?{...item,body:content,editorJson:null}:item));if(target===1)setObjective(content);if(target===2)setKeyIssues(content);if(target===3)setPlanNotes(content);setSelectedChapter(target);setDirty(true);setHwpEditorOpen(false);setHwpSourceFile(null);setSuccessMessage(`${target}장에 HWP/HWPX 편집기의 현재 내용을 반영했습니다. 검수 완료를 눌러 제안서 버전에 저장하세요.`);};
  const saveCompanyModule=async()=>{const selected=modules.find((module)=>module.code===selectedModuleCode);if(!selected||!canManageModules)return;setBusy(true);setErrorMessage(null);try{const response=await apiRequest<{module:CompanyModule;sanitizationCount:number}>(`/api/proposal-studio/modules/${selected.code}`,{method:'PUT',body:JSON.stringify({title:moduleTitle,bodyMarkdown:moduleBody,isActive:moduleActive,version:selected.version})});setModules((current)=>current.map((module)=>module.code===response.module.code?response.module:module));if(response.module.isActive){setIncludedModuleCodes((current)=>[...new Set([...current,response.module.code])]);setChapters((current)=>current.map((item)=>item.number===response.module.chapterNumber?proposalChapterWithCompanyImages({...item,title:response.module.title,kind:'FIXED',moduleCode:response.module.code,body:response.module.bodyMarkdown,editorJson:null,excludedCompanyAssetKeys:[]},companyAssets):item));}setSuccessMessage(`관리자 회사 DB 모듈 v${response.module.version} 저장 완료 · 현재 제안서 ${response.module.chapterNumber}장에도 적용했습니다${response.sanitizationCount?` · 금액 ${response.sanitizationCount}건 비공개 처리`:''}. 검수 완료를 누르면 제안서 버전에 보존됩니다.`);}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'회사 DB 모듈을 저장하지 못했습니다.');}finally{setBusy(false);}};
  const uploadCompanyAsset=async(asset:CompanyAsset,file?:File)=>{if(!file||!canManageModules)return;if(file.type!=='image/jpeg'){setErrorMessage('회사 공통 이미지는 JPG로 변환한 뒤 등록하세요. DOCX와 PDF에 동일하게 삽입됩니다.');return;}setBusy(true);setErrorMessage(null);try{const form=new FormData();form.append('file',file);const response=await apiRequest<{asset:CompanyAsset}>(`/api/proposal-studio/assets/${asset.assetKey}`,{method:'PUT',body:form});setCompanyAssets((current)=>current.map((item)=>item.assetKey===response.asset.assetKey?response.asset:item));setSuccessMessage(`${asset.title} 이미지를 보호 DB에 저장했습니다. 제안서 화면과 DOCX·PDF에 함께 반영됩니다.`);}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'회사 이미지를 저장하지 못했습니다.');}finally{setBusy(false);}};
  const uploadProposalImage=async(file?:File)=>{if(!file||!activeProposal||!selectedCaseId||!canEdit)return;setBusy(true);setErrorMessage(null);try{const normalized=await proposalImageForUpload(file);const title=file.name.replace(/\.[^.]+$/u,'').slice(0,160)||`${selectedChapter}장 원본 이미지`;const form=new FormData();form.append('file',normalized);form.append('chapterNumber',String(selectedChapter));form.append('title',title);form.append('altText',`${selectedChapter}장 ${title}`);const response=await apiRequest<{asset:{id:string;title:string;altText:string;url:string}}>(`/api/cases/${selectedCaseId}/proposals/${activeProposal.id}/assets`,{method:'POST',body:form});proposalEditorRef.current?.insertImage({src:response.asset.url,alt:response.asset.altText,title:response.asset.title});setSuccessMessage(`${selectedChapter}장 현재 커서 위치에 원본 이미지 “${response.asset.title}”을 삽입했습니다. 검수 완료를 누르면 이 위치가 제안서 버전에 저장됩니다.`);}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'제안서 원본 이미지를 삽입하지 못했습니다.');}finally{setBusy(false);if(proposalImageInputRef.current)proposalImageInputRef.current.value='';}};
  const setCompanyModuleIncluded=(module:CompanyModule,included:boolean)=>{setIncludedModuleCodes((current)=>included?[...new Set([...current,module.code])]:current.filter((code)=>code!==module.code));setChapters((current)=>current.map((item)=>item.number!==module.chapterNumber?item:included?proposalChapterWithCompanyImages({...item,title:module.title,kind:'FIXED',moduleCode:module.code,body:module.bodyMarkdown,editorJson:null,excludedCompanyAssetKeys:[]},companyAssets):{...item,title:module.title,kind:'FIXED',moduleCode:module.code,body:'[이 회사 공통 모듈은 현재 제안서에서 제외되었습니다.]',editorJson:null,excludedCompanyAssetKeys:[]}));setSelectedChapter(module.chapterNumber);setDirty(true);setSuccessMessage(included?`${module.chapterNumber}장 공통 기본 모듈 v${module.version}을 현재 편집본에 불러왔습니다.`:`${module.chapterNumber}장 공통 기본 모듈을 현재 제안서에서 제외했습니다.`);};
  const applyLatestCompanyModules=()=>{const activeModules=modules.filter((module)=>module.isActive&&module.chapterNumber>=4&&module.chapterNumber<=12);setIncludedModuleCodes(activeModules.map((module)=>module.code));setChapters((current)=>current.map((item)=>{if(item.number<4||item.number>12)return item;const module=activeModules.find((candidate)=>candidate.chapterNumber===item.number);return module?proposalChapterWithCompanyImages({...item,title:module.title,kind:'FIXED',moduleCode:module.code,body:module.bodyMarkdown,editorJson:null,excludedCompanyAssetKeys:[]},companyAssets):{...item,body:'[이 회사 공통 모듈은 현재 제안서에서 제외되었습니다.]',editorJson:null};}));setDirty(true);setSuccessMessage(`회사 공통 기본 모듈 ${activeModules.length}개(4~12장) 최신본을 현재 제안서 편집 복사본에 반영했습니다. 검수 완료를 누르면 새 버전으로 보존됩니다.`);};

  const improveProposalSelection=async(instruction=proposalImproveInstruction,selectionOverride?:StructuredSelection)=>{const selection=selectionOverride??proposalEditorRef.current?.getSelection()??proposalSelection;if(!activeProposal||!selectedCaseId||!selection?.text.trim()||busy)return;setBusy(true);setErrorMessage(null);setAiGeneration({kind:'improve',status:'running'});try{const response=await apiRequest<{content:string}>('/api/proposal-studio/improve',{method:'POST',body:JSON.stringify({caseId:selectedCaseId,proposalId:activeProposal.id,chapterNumber:selectedChapter,content:selection.text,instruction:instruction.trim(),expectedProposalVersion:activeProposal.version})});proposalEditorRef.current?.dismissSelectionMenu();setProposalImprovement({from:selection.from,to:selection.to,original:selection.text,replacement:response.content.trim()});setAiGeneration(null);}catch(reason){const message=reason instanceof Error?reason.message:'선택 문장을 개선하지 못했습니다.';setAiGeneration({kind:'improve',status:'error',error:message});}finally{setBusy(false);}};
  const applyProposalImprovement=()=>{if(!proposalImprovement)return;proposalEditorRef.current?.replaceRange(proposalImprovement.from,proposalImprovement.to,proposalImprovement.replacement);setProposalSelection(null);setProposalImprovement(null);};

  const selectedCase=cases.find((item)=>item.id===selectedCaseId);const currentVersion=activeProposal?.versions?.[0];const hasAiDraft=Boolean(activeProposal?.versions?.some((version)=>version.generationMode==='AI'));const chapter=chapters[selectedChapter-1]??chapters[0];const selectedTemplateSource=sources.find((source)=>source.id===selectedTemplateSourceId);const selectedProposalType=templateTypes.find((item)=>item.id===selectedTemplateType);
  const step1Fields=[['클라이언트명',clientName],['프로젝트 제목',projectTitle],['제안서 부제',subtitle],['제출일',submissionDate],['핵심 쟁점',keyIssues],['제안 목적·의뢰 배경',objective],['수행 계획 메모',planNotes]] as const;
  const step1Missing=step1Fields.filter(([,value])=>!value.trim()).map(([label])=>label);
  const firstThreeComplete=chapters.slice(0,3).every((item)=>item.body.trim()&&item.body.trim()!=='[작성 필요]');
  const allChaptersComplete=chapters.every((item)=>item.body.trim()&&item.body.trim()!=='[작성 필요]');
  const goToProposalStep=(target:number)=>{if(target<step){if(target<2)setCanResumeReviewerEdits(false);setStep(target);setStepValidationMessage('');return;}if(target>=2&&step1Missing.length){setCanResumeReviewerEdits(false);setStepValidationMessage(`1단계 필수 입력을 완료하세요: ${step1Missing.join(', ')}`);setStep(1);return;}if(target>=3&&(!firstThreeComplete||(dirty&&!canResumeReviewerEdits))){setStepValidationMessage(firstThreeComplete?'초안의 변경 내용을 먼저 저장해야 담당자 검수로 이동할 수 있습니다.':'1~3장 초안을 작성하고 저장해야 담당자 검수로 이동할 수 있습니다.');setStep(2);return;}if(target>=4&&(!allChaptersComplete||dirty||!currentVersion)){setStepValidationMessage(allChaptersComplete?'담당자 검수의 변경 내용을 저장한 뒤 전체 미리보기로 이동하세요.':'1~12장 내용을 모두 확인·작성해야 전체 미리보기로 이동할 수 있습니다.');setStep(3);return;}if(target===3)setCanResumeReviewerEdits(true);setStepValidationMessage('');setStep(target);};
  const chooseProposalType=(category:ProposalTemplateCategory)=>{const type=templateTypes.find((item)=>item.id===category);if(!type)return;setSelectedTemplateType(category);setSelectedTemplateSourceId(type.representativeSourceId);setSuccessMessage(`${type.label} 대표 템플릿과 유형별 1~3장 작성 지침을 적용했습니다.`);};
  const stepOneDocumentTools=<DocumentToolMenus groups={[
    {id:'excel',label:'Excel',actions:[
      {id:'export',label:'입력 양식 내보내기',onClick:exportExcel},
      {id:'import',label:'작성 Excel 가져오기',onClick:()=>excelInputRef.current?.click(),disabled:busy},
    ]},
  ]}/>;
  const stepThreeDocumentTools=<DocumentToolMenus groups={[
    {id:'excel',label:'현재 장 Excel',actions:[
      {id:'export',label:`${selectedChapter}장 내보내기`,onClick:exportChapterExcel},
      {id:'import',label:`${selectedChapter}장 가져오기`,onClick:()=>chapterExcelInputRef.current?.click(),disabled:busy||!canEdit},
    ]},
    {id:'hwp',label:'HWP',actions:[
      {id:'edit',label:`HWP/HWPX 가져오기·편집 · ${selectedChapter}장에 적용`,onClick:openChapterHwp,disabled:busy||!canEdit},
    ]},
  ]}/>;
  return <div className="proposal-view-container proposal-studio-v2" onInputCapture={(event)=>{const target=event.target as HTMLElement;if(target.closest('.proposal-stage'))setDirty(true);}} onChangeCapture={(event)=>{const target=event.target as HTMLElement;if(target.closest('.proposal-stage')&&target.matches('input, textarea, select, [contenteditable="true"]'))setDirty(true);}}>
    <AiGenerationProgressModal isOpen={Boolean(aiGeneration)} status={aiGeneration?.status??'running'} title={aiGeneration?.kind==='improve'?'Gemini가 선택한 제안서 문장을 개선하고 있습니다':'Gemini가 제안서 최초 초안을 작성하고 있습니다'} description={aiGeneration?.kind==='improve'?'사실과 수치는 유지하면서 문장 구조와 제안서 설득력을 다듬습니다. 원문은 확인 전까지 유지됩니다.':'의뢰·회의록·1단계 입력을 확인해 2장→1장→3장 순서로 초안을 작성하고 회사 고정 모듈을 결합합니다.'} stages={aiGeneration?.kind==='improve'?['선택 문장 확인','사실·수치 보존','제안서 문체 개선','비교본 준비']:['의뢰·회의록·입력 근거 확인','2장→1장→3장 순차 초안 작성','회사 공통 4~12장 최신본 병합','금액 마스킹·편집본 저장']} completeMessage={aiGeneration?.kind==='improve'?'개선안이 준비되었습니다. 원문과 비교한 뒤 적용하세요.':'최초 AI 초안이 완료되었습니다. 이제 3단계에서 모든 문장을 직접 검수·수정하세요.'} errorMessage={aiGeneration?.error} confirmLabel={aiGeneration?.kind==='improve'?'편집 화면으로':'확인하고 담당자 검수로'} timeoutHintSeconds={aiGeneration?.kind==='draft'?330:90} retryLabel="Gemini 초안 다시 작성" onRetry={aiGeneration?.kind==='draft'?()=>void saveVersion('AI'):undefined} onConfirm={()=>{const kind=aiGeneration?.kind;setAiGeneration(null);if(kind==='draft')goToProposalStep(3);}} onClose={()=>setAiGeneration(null)}/>
    <RhwpEditorDialog isOpen={hwpEditorOpen} sourceFile={hwpSourceFile} suggestedName={`${projectTitle||'클레임센터_제안서'}${hwpApplyChapter?`_${String(hwpApplyChapter).padStart(2,'0')}장`:''}.hwp`} documentLabel={hwpApplyChapter?`프로젝트 제안서 ${hwpApplyChapter}장`:'프로젝트 제안서 최종본'} onApplyContent={hwpApplyChapter?applyHwpContentToChapter:undefined} applyLabel={hwpApplyChapter?`현재 HWP 내용을 ${hwpApplyChapter}장에 적용`:undefined} onClose={()=>{setHwpEditorOpen(false);setHwpSourceFile(null);setHwpApplyChapter(null);}}/>
    {errorMessage&&<Dialog isOpen title="제안서 작업 확인" onClose={()=>setErrorMessage(null)}><p className="error-text">{errorMessage}</p></Dialog>}
    <Dialog isOpen={Boolean(pendingNavigation)} title="작성 중인 제안서를 두고 이동할까요?" onClose={()=>setPendingNavigation(null)}><p>저장하지 않은 입력 또는 편집 내용이 있습니다. 이동하면 이 변경은 사라질 수 있습니다.</p><div className="action-row"><Button variant="secondary" onClick={()=>setPendingNavigation(null)}>계속 작성</Button><Button variant="danger" onClick={()=>{const navigation=pendingNavigation;setPendingNavigation(null);setDirty(false);navigation?.proceed();}}>변경 버리고 이동</Button></div></Dialog>
    {templatePreview&&<Dialog isOpen title="유형별 대표 제안서 구조" onClose={()=>setTemplatePreview(false)}><div className="proposal-template-dialog"><p><b>{selectedProposalType?.label??'컨코스트 표준 제안서'}</b><br/>{selectedProposalType?.description} 1·2·3장은 이 유형의 관리자 지침으로 작성하고, 4~12장은 모든 유형에서 같은 회사 공통 기본 모듈 최신본을 사용합니다.</p><ol>{chapterTitles.map((title,index)=><li key={title}><b>{index+1}. {title}</b><span>{index<3?`${selectedProposalType?.label??'선택 유형'} 지침 → 담당자 전면 편집`:'관리자 승인 회사 공통 기본 모듈 자동 병합'}</span></li>)}</ol><h4>6개 제안서 유형 · 대표 템플릿</h4><ul>{templateTypes.map((type)=><li key={type.id}><button type="button" className={type.id===selectedTemplateType?'is-selected':''} onClick={()=>chooseProposalType(type.id)}><b>{type.label}</b> · {type.representativeSourceName}<small>{type.description} · 1~3장 지침 {type.promptReady?'준비 완료':'관리자 확인 필요'}</small></button></li>)}</ul></div></Dialog>}
    {confirmProposalOpen&&<Dialog isOpen title="제안서를 최종 확정할까요?" onClose={()=>!busy&&setConfirmProposalOpen(false)} hideDefaultAction><div className="proposal-confirm-dialog"><p>갑지·목차·12개 챕터와 이미지가 현재 미리보기 그대로 확정됩니다. 확정 후 DOCX·PDF·HWP 직접 내려받기가 활성화되고 이 버전은 확정본으로 보관됩니다.</p><strong>확정 후 내용을 바꾸려면 기존 확정본을 보존한 채 새 편집 버전을 만들어야 합니다.</strong><div className="dialog-actions"><Button variant="secondary" onClick={()=>setConfirmProposalOpen(false)} disabled={busy}>아니요 · 다시 확인</Button><Button onClick={()=>void confirmProposal()} disabled={busy||activeProposal?.status!=='DRAFT'}>네 · 제안서 확정</Button></div></div></Dialog>}
    {proposalImprovement&&<Dialog isOpen title="Gemini 제안서 문장 개선안 비교" size="wide" hideDefaultAction onClose={()=>setProposalImprovement(null)}><div className="report-improvement-compare proposal-improvement-compare"><section><span>원문 · 그대로 보존 중</span><p>{proposalImprovement.original}</p></section><section><span>Gemini 개선안 · 적용 전</span><p>{proposalImprovement.replacement}</p></section><p className="notice-box">원문의 사실·숫자·날짜·고유명사와 의미를 보존한 개선안만 표시합니다. 두 내용을 나란히 확인한 뒤 적용하세요.</p><div className="action-row"><Button variant="secondary" onClick={()=>setProposalImprovement(null)}>취소 · 원문 유지</Button><Button className="proposal-action-confirm" onClick={applyProposalImprovement}>검토 완료 · 개선안 적용</Button></div></div></Dialog>}
    {intakeStoragePending&&<div className="proposal-storage-warning" role="status"><div><b>의뢰 저장 완료 · 제안서 작성 가능</b><span>Google Drive 연결이 만료되어 첨부 원본만 보관 대기 중입니다. 제안서 작성은 계속할 수 있으며, 관리자가 Drive를 다시 연결한 뒤 원본 보관을 재시도하세요.</span></div><Button variant="secondary" onClick={()=>onNavigate('/settings?section=admin')}>Google Drive 다시 연결</Button></div>}
    {successMessage&&<div className="proposal-success" role="status"><b>완료</b><span>{successMessage}</span><button type="button" onClick={()=>setSuccessMessage(null)}>닫기</button></div>}
    <Card title="현재 프로젝트 · 제안서 유형"><div className="proposal-project-bar proposal-project-template-bar"><Select label="작업할 프로젝트" value={selectedCaseId} onChange={(event)=>setSelectedCaseId(event.target.value)} options={cases.map((item)=>({value:item.id,label:`${item.caseNumber} · ${item.title}`}))}/><Select label="제안서 유형" value={selectedTemplateType} onChange={(event)=>chooseProposalType(event.target.value as ProposalTemplateCategory)} options={templateTypes.map((type)=>({value:type.id,label:type.label}))}/><label className="proposal-field proposal-representative-template"><span>유형 대표 템플릿</span><input readOnly value={selectedProposalType?.representativeSourceName??selectedTemplateSource?.sourceName??''}/></label><Button className="proposal-template-preview-button" onClick={()=>setTemplatePreview(true)}>유형별 완제품 보기</Button></div>{selectedCase&&<div className="proposal-project-context"><b>{fromIntake?'방금 등록한 프로젝트':'현재 프로젝트'}</b><strong>{selectedCase.caseNumber} · {selectedCase.title}</strong><span>{selectedCase.claimType} · {selectedCase.status}</span></div>}</Card>
    {(routeId==='PROP-01'||(!activeProposal && selectedCaseId))&&<Card title={routeId==='PROP-01'?'제안서 유형 선택':'제안서 작성 1단계 · 유형별 대표 템플릿'}><div className="proposal-template-pick"><Select label="제안서 6개 유형" value={selectedTemplateType} onChange={(event)=>chooseProposalType(event.target.value as ProposalTemplateCategory)} options={templateTypes.map((type)=>({value:type.id,label:type.label}))}/><label className="proposal-field proposal-representative-template"><span>고정 대표 템플릿</span><input readOnly value={selectedProposalType?.representativeSourceName??''}/></label><Button variant="secondary" onClick={()=>setTemplatePreview(true)}>유형 구성 확인</Button><Button onClick={()=>void createProposal()} disabled={!canEdit||busy||!selectedTemplateId||!selectedTemplateSourceId}>이 유형으로 제안서 시작</Button></div><p className="muted">선택한 유형의 대표 템플릿과 관리자 승인 1~3장 지침이 함께 적용됩니다. 4~12장은 유형과 관계없이 회사 공통 기본 모듈 최신본으로 고정됩니다.</p></Card>}
    {activeProposal&&<Card title={`${activeProposal.title} · 4단계 제안서 스튜디오`} className="proposal-step-card">
      <div className="proposal-status-row"><StatusBadge status={statusBadge(activeProposal.status)}/><span>저장 버전 v{currentVersion?.versionNumber??1}</span><span>편집 버전 {activeProposal.version}</span>{currentVersion?.generationMode==='AI'&&<StatusBadge status="ai_draft"/>}</div>
      <nav className="proposal-four-steps" aria-label="제안서 4단계">{[['01','입력','클라이언트·쟁점'],['02','제안서 초안 작성','AI 또는 수동 선택'],['03','담당자 검수','12챕터 직접 편집'],['04','전체 미리보기·확정','갑지·목차·합본']].map((item,index)=>{const target=index+1;const unlocked=target===1||target===2&&!step1Missing.length||target===3&&!step1Missing.length&&firstThreeComplete&&(!dirty||canResumeReviewerEdits)||target===4&&!step1Missing.length&&allChaptersComplete&&!dirty&&Boolean(currentVersion);return <button key={item[0]} className={`proposal-step-button ${step===target?'active':''}`} aria-disabled={!unlocked} onClick={()=>goToProposalStep(target)}><b>{item[0]}</b><span>{item[1]}</span><small>{unlocked?item[2]:'앞 단계 완료 후 열림'}</small></button>;})}</nav>
      {stepValidationMessage&&<p className="proposal-step-validation" role="alert">{stepValidationMessage}</p>}
      <input ref={excelInputRef} hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event)=>void importExcel(event.target.files?.[0])}/>
      <input ref={chapterExcelInputRef} hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event)=>void importChapterExcel(event.target.files?.[0])}/>
      {step===1&&<div className="proposal-stage proposal-stage-input">
        <header className="workflow-stage-title"><div><b>STEP 1</b><h3>클라이언트와 프로젝트 사실을 입력하세요.</h3><p>연한 노란색은 반드시 확인·입력해야 하는 항목입니다. 모르면 추측하지 말고 ‘확인 필요’라고 적으세요.</p></div>{stepOneDocumentTools}</header>
        <div className="proposal-input-grid">
          <Input required label="클라이언트명" value={clientName} onChange={(event)=>{setClientName(event.target.value);setDirty(true);}}/>
          <Input required label="프로젝트 제목" value={projectTitle} onChange={(event)=>{setProjectTitle(event.target.value);setDirty(true);}}/>
          <Input required label="제안서 부제" value={subtitle} onChange={(event)=>{setSubtitle(event.target.value);setDirty(true);}}/>
          <Input required label="제출일" type="date" value={submissionDate} onChange={(event)=>{setSubmissionDate(event.target.value);setDirty(true);}}/>
          <label className="proposal-field proposal-step1-textarea"><span>핵심 쟁점 3~5개 <i className="ui-required-mark">*</i></span><textarea required aria-required="true" value={keyIssues} onChange={(event)=>{setKeyIssues(event.target.value);setDirty(true);}} placeholder="계약조건, 물가변동 기준일, 단가조정 등 확인된 사실"/></label>
          <label className="proposal-field proposal-step1-textarea"><span>제안 목적·의뢰 배경 <i className="ui-required-mark">*</i></span><textarea required aria-required="true" value={objective} onChange={(event)=>{setObjective(event.target.value);setDirty(true);}}/></label>
          <label className="proposal-field proposal-step1-textarea"><span>수행 계획 메모 <i className="ui-required-mark">*</i></span><textarea required aria-required="true" value={planNotes} onChange={(event)=>{setPlanNotes(event.target.value);setDirty(true);}}/></label>
          <label className="proposal-field proposal-step1-textarea is-optional"><span>제외·추가 확인 사항</span><textarea value={exclusions} onChange={(event)=>{setExclusions(event.target.value);setDirty(true);}}/></label>
        </div>
        <div className="proposal-next"><Button className="workflow-next-action" onClick={()=>goToProposalStep(2)}>입력 완료 · 초안 작성 방식 선택 →</Button></div>
      </div>}
      {step===2&&<div className="proposal-stage proposal-ai-stage">
        <header className="workflow-stage-title"><div><b>STEP 2</b><h3>제안서 초안 작성 방식을 선택하세요.</h3><p>Gemini 자동작성과 수동 작성 중 하나를 선택합니다. 다른 LLM에서 만든 내용도 직접 붙여넣을 수 있으며 3단계 검수·확정 흐름은 동일합니다.</p></div></header>
        <div className="proposal-draft-methods" role="radiogroup" aria-label="제안서 초안 작성 방식">
          <button type="button" role="radio" aria-checked={draftMethod==='AI'} className={draftMethod==='AI'?'is-selected is-ai':''} onClick={()=>chooseDraftMethod('AI')}><span>✦ AI 자동작성</span><b>Gemini로 1~3장 초안 생성</b><small>1단계 입력과 프로젝트 근거를 사용합니다. API 연결이 필요합니다.</small></button>
          <button type="button" role="radio" aria-checked={draftMethod==='MANUAL'} className={draftMethod==='MANUAL'?'is-selected is-manual':''} onClick={()=>chooseDraftMethod('MANUAL')}><span>⌨ 수동·외부 LLM</span><b>직접 작성 또는 결과 붙여넣기</b><small>API 키 없이 작성하며 HWP·ChatGPT·Claude 등 외부 초안도 사용할 수 있습니다.</small></button>
        </div>
        {draftMethod==='AI'?<><div className="proposal-ai-map"><div><b>Gemini 최초 초안</b><strong>01 · 02 · 03장</strong><span>목적, 핵심 쟁점, 수행계획 · 프로젝트당 1회</span></div><div><b>회사 공통 기본 모듈 병합</b><strong>04 ~ 12장</strong><span>전문가, 강점, 조직, 실적, 자격, 용역조건, 맺음말</span></div><div><b>보안 검증</b><strong>금액 마스킹</strong><span>AI 응답과 저장값의 민감정보 검증</span></div></div><label className="proposal-field"><span>근거 자료 버전 ID (선택, 쉼표 구분)</span><textarea value={sourceDocumentVersionIds} onChange={(event)=>{setSourceDocumentVersionIds(event.target.value);setDirty(true);}} placeholder="DOCVER-..."/></label>{hasAiDraft&&<p className="proposal-ai-once-complete" role="status"><b>✓ 최초 AI 초안 생성 완료</b><span>이제 3단계에서 사람이 직접 수정하세요. 기존 초안은 AI로 다시 덮어쓸 수 없습니다.</span></p>}</>:<section className="proposal-manual-draft"><header><div><b>API 없이 초안 작성</b><span>아래 1~3장을 직접 쓰거나 다른 LLM 결과를 붙여넣으세요. 저장 후 구조화 편집기로 이어집니다.</span></div></header>{chapters.slice(0,3).map((item)=><label key={item.number} className="proposal-field"><span>{item.number}. {item.title}</span><textarea value={item.body==='[작성 필요]'?'':item.body} onChange={(event)=>{setChapters((current)=>current.map((chapter)=>chapter.number===item.number?{...chapter,body:event.target.value,editorJson:null}:chapter));setDirty(true);}} placeholder={`${item.title} 내용을 직접 작성하거나 외부 LLM 결과를 붙여넣으세요.`}/></label>)}</section>}
        <div className="proposal-next"><Button variant="secondary" onClick={()=>goToProposalStep(1)}>← 입력 수정</Button>{draftMethod==='AI'?(hasAiDraft?<Button className="workflow-next-action" onClick={()=>goToProposalStep(3)}>담당자 검수·편집으로 →</Button>:<Button className="gemini-action-button" onClick={()=>void saveVersion('AI')} disabled={busy||!canEdit}><span className="gemini-button-star" aria-hidden="true">✦</span> AI 자동작성 시작 · Gemini</Button>):<Button className="proposal-action-confirm workflow-next-action" onClick={()=>void saveVersion('MANUAL',3)} disabled={busy||!canEdit||chapters.slice(0,3).some((item)=>!item.body.trim()||item.body==='[작성 필요]')}>수동 초안 저장 · 담당자 검수로 →</Button>}</div>
      </div>}
      {step===3&&<div className="proposal-stage proposal-editor-stage">
        <header className="workflow-stage-title"><div><b>STEP 3</b><h3>목차를 눌러 1~12장 전체를 직접 검수·수정하세요.</h3><p>모든 장에서 제목·글꼴·크기·색상·목록·표·원본 이미지·검색/치환을 사용할 수 있습니다. 4~12장은 중앙 기본값의 제안서별 복사본이므로 여기서 수정해도 회사 공통 원본은 바뀌지 않습니다.</p></div>{stepThreeDocumentTools}</header>
        <div className="proposal-company-module-banner"><div><b>중앙 공통 기본 모듈 · 4~12장</b><span>전문가·회사 강점·조직·실적·자격·용역조건·맺음말의 저장된 최신 승인본을 현재 제안서 복사본에 즉시 적용합니다.</span></div><Button variant="secondary" onClick={applyLatestCompanyModules} disabled={busy}>4~12장 공통 기본값 전체 적용</Button></div>
        <div className="proposal-editor-grid">
          <aside className="proposal-toc" aria-label="12개 챕터 목차">{chapters.map((item)=><button key={item.number} className={selectedChapter===item.number?'active':''} onClick={()=>{setSelectedChapter(item.number);setProposalSelection(null);}}><b>{String(item.number).padStart(2,'0')}</b><span>{item.title}</span><small>{item.number<=3?'프로젝트 초안 편집':'공통 기본값 · 제안서별 편집'}</small></button>)}</aside>
          <main className="proposal-chapter-editor">
            <div><span>HUMAN REVIEW & EDIT · CHAPTER 01~12</span><h3>{chapter.number}. {chapter.title}</h3></div>
            <StructuredDocumentEditor key={`proposal-${activeProposal.id}-${chapter.number}`} ref={proposalEditorRef} compact documentKey={`proposal-${activeProposal.id}-${chapter.number}`} label={`${chapter.number}. ${chapter.title}`} value={chapter.body} editorJson={chapter.editorJson} readOnly={!canEdit} onSelectionChange={setProposalSelection} selectionAssistant={{busy,disabled:!canEdit,onImprove:(mode,selection)=>void improveProposalSelection(mode==='professional'?'문법과 맞춤법을 바로잡고 전문적인 건설 클레임 제안서 문체로 다듬어 주세요. 사실과 수치는 유지하세요.':mode==='concise'?'중복을 줄이고 비전문가도 이해할 수 있게 간결하고 명확하게 고쳐 주세요. 사실과 수치는 유지하세요.':proposalImproveInstruction,selection)}} onChange={(next,json)=>{setChapters((current)=>current.map((item)=>item.number===chapter.number?{...item,body:next,editorJson:json}:item));setDirty(true);}}/>
            <section className="proposal-chapter-insert-tools"><div><b>현재 {chapter.number}장에 자료 삽입</b><span>커서를 원하는 위치에 둔 뒤 표 또는 원본 이미지 파일을 넣으세요. 화면 캡처가 아니라 원본 해상도로 저장됩니다.</span></div><div className="action-row"><Button className="proposal-action-table" onClick={()=>proposalEditorRef.current?.insertTable()} disabled={!canEdit||busy}>▦ 표 삽입</Button><input ref={proposalImageInputRef} hidden type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={(event)=>void uploadProposalImage(event.target.files?.[0])}/><Button className="proposal-action-image" onClick={()=>{proposalEditorRef.current?.focus();proposalImageInputRef.current?.click();}} disabled={!canEdit||busy}>▧ 원본 이미지 삽입</Button></div></section>
            <section className="proposal-writing-assistant"><div><b>✦ Gemini 문장 개선</b><span>문장을 드래그한 뒤 개선안을 원문과 비교해서 적용합니다.</span></div><input value={proposalImproveInstruction} maxLength={2000} onChange={(event)=>setProposalImproveInstruction(event.target.value)} aria-label="제안서 문장 개선 요청"/><div className="action-row"><Button className="report-action-ai" disabled={!proposalSelection||busy} onClick={()=>void improveProposalSelection('문법과 맞춤법을 바로잡고 전문적인 건설 클레임 제안서 문체로 다듬어 주세요. 사실과 수치는 유지하세요.')}>✦ 전문적으로</Button><Button className="report-action-ai" disabled={!proposalSelection||busy} onClick={()=>void improveProposalSelection('중복을 줄이고 비전문가도 이해할 수 있게 간결하고 명확하게 고쳐 주세요. 사실과 수치는 유지하세요.')}>✦ 간결하게</Button><Button className="report-action-ai" disabled={!proposalSelection||busy||proposalImproveInstruction.trim().length<3} onClick={()=>void improveProposalSelection()}>✦ 맞춤 요청</Button></div></section>
            {chapter.number>=4&&<p className="proposal-copy-notice">이 장은 중앙 공통 모듈을 복사해 온 현재 제안서 전용 편집본입니다. 실적·자격·조직도·맺음말을 자유롭게 수정하고 표와 원본 이미지를 추가할 수 있습니다.</p>}
          </main>
          <aside className="proposal-module-panel"><h4>회사 공통 모듈 · 4~12장</h4><p>선택하면 저장된 최신 본문이 현재 장에 즉시 표시됩니다.</p>{modules.map((module)=><label key={module.code}><input type="checkbox" checked={includedModuleCodes.includes(module.code)} onChange={(event)=>setCompanyModuleIncluded(module,event.target.checked)}/><span><b>{module.chapterNumber}. {module.title}</b><small>중앙 승인본 v{module.version} · {includedModuleCodes.includes(module.code)?'적용 중':'제외'}</small></span></label>)}</aside>
        </div>
        {canManageModules&&<>
          <section className="proposal-admin-module-editor"><div><b>관리자 · 회사 공통 기본 모듈 DB 편집</b><span>4~12장 신규 제안서의 기본값을 관리합니다. 저장하면 현재 제안서의 같은 장에도 즉시 적용되며, 개별 제안서 편집 내용은 중앙 DB에 역반영되지 않습니다.</span></div><Select label="편집할 기본 챕터" value={selectedModuleCode} onChange={(event)=>setSelectedModuleCode(event.target.value)} options={modules.map((module)=>({value:module.code,label:`${module.chapterNumber}. ${module.title} · v${module.version}`}))}/><Input label="챕터 제목" value={moduleTitle} onChange={(event)=>setModuleTitle(event.target.value)}/><div className="proposal-admin-body-grid"><label className="proposal-field"><span>관리자 승인 원문 · Markdown 표 지원</span><textarea value={moduleBody} onChange={(event)=>setModuleBody(event.target.value)}/></label><section><b>완제품 구조 미리보기</b><ProposalRichContent body={moduleBody} assets={companyAssets.filter((asset)=>asset.chapterNumber===modules.find((module)=>module.code===selectedModuleCode)?.chapterNumber)}/></section></div><label className="proposal-module-active"><input type="checkbox" checked={moduleActive} onChange={(event)=>setModuleActive(event.target.checked)}/><span>신규 제안서에 이 모듈 사용</span></label><Button onClick={()=>void saveCompanyModule()} disabled={busy||!moduleTitle.trim()||!moduleBody.trim()}>공통 DB 새 버전 저장 · 현재 장 적용</Button></section>
          <section className="proposal-admin-asset-manager"><header><div><b>관리자 · 회사 기본 이미지 DB</b><span>조직도·전문가 프로필·자격 증명·저서 이미지의 신규 제안서 기본값입니다. 개별 제안서에는 위의 원본 이미지 삽입 버튼으로 별도 자료를 추가하세요.</span></div><StatusBadge status={companyAssets.some((asset)=>asset.hasContent)?'completed':'unwritten'}/></header><div className="proposal-admin-asset-grid">{companyAssets.filter((asset)=>asset.assetKey!=='BRAND_LOGO').map((asset)=><article key={asset.assetKey}><div className="proposal-admin-asset-preview">{asset.hasContent?<img src={`/api/proposal-studio/assets/${asset.assetKey}?v=${asset.version}`} alt={asset.altText}/>:<span>원본 이미지<br/>등록 대기</span>}</div><div><b>{asset.chapterNumber}장 · {asset.title}</b><small>{asset.hasContent?`${asset.width}×${asset.height}px · 보호 DB v${asset.version}`:'260728 HWP 원본 JPG를 등록하세요.'}</small></div><label className="proposal-admin-asset-upload"><span>{asset.hasContent?'기본 이미지 교체':'HWP 원본 JPG 등록'}</span><input type="file" accept=".jpg,.jpeg,image/jpeg" disabled={busy} onChange={(event)=>void uploadCompanyAsset(asset,event.target.files?.[0])}/></label></article>)}</div></section>
        </>}
        <div className="proposal-next"><Button variant="secondary" onClick={()=>goToProposalStep(2)}>← 초안 작성 방식</Button><Button className="proposal-action-confirm" onClick={()=>void saveVersion('MANUAL')} disabled={busy||!canEdit}>검수 완료 · 전체 합본 미리보기 →</Button></div>
      </div>}
      {step===4&&<section className="proposal-finalization-workspace">
        <header><div><b>STEP 4 · 전체 합본 미리보기</b><h3>갑지부터 목차·맺음말까지 모두 확인하세요.</h3><p>아래 화면이 DOCX·PDF·HWP에 반영될 최종 순서입니다. 내용이 다르면 3단계로 돌아가 수정하고, 맞으면 제안서를 확정하세요.</p></div><StatusBadge status={activeProposal.status==='APPROVED'?'approved':'in_review'}/></header>
        <div className={`proposal-finalization-status is-${activeProposal.status.toLowerCase()}`}><b>{activeProposal.status==='APPROVED'?'✓ 제안서 확정·보관 완료':'확정 전 전체 내용 확인 중'}</b><span>{activeProposal.status==='APPROVED'?'아래 3종 내려받기 버튼이 활성화되었습니다. 확정본은 변경 이력과 함께 보관됩니다.':'갑지·목차·12개 챕터·이미지를 마지막으로 확인한 뒤 확정하세요.'}</span></div>
        <div ref={finalPreviewRef} className="proposal-final-export-source"><ProposalFinalDocumentPreview projectTitle={projectTitle} subtitle={subtitle} clientName={clientName} submissionDate={submissionDate} chapters={chapters}/></div>
        {activeProposal.status==='APPROVED'&&<section className="proposal-mail-preview" aria-labelledby="proposal-mail-title"><header><div><b>EMAIL DELIVERY · FRONTEND PREVIEW</b><h3 id="proposal-mail-title">제안서 이메일 발송 준비</h3><p>수신자와 본문을 미리 작성하는 화면입니다. 회사 메일 서버는 아직 연결하지 않아 실제 발송은 되지 않습니다.</p></div><span>메일 서버 연동 예정</span></header><div className="proposal-mail-grid"><label><span>보내는 사람</span><input value={userEmail||'현재 로그인 회사 계정'} readOnly/></label><label><span>받는 사람</span><input type="email" value={mailRecipient} onChange={(event)=>setMailRecipient(event.target.value)} placeholder="client@example.com"/></label><label className="wide"><span>제목</span><input value={mailSubject} onChange={(event)=>setMailSubject(event.target.value)}/></label><label className="wide"><span>메일 내용</span><textarea value={mailBody} onChange={(event)=>setMailBody(event.target.value)}/></label></div><div className="proposal-mail-attachment"><b>첨부 예정</b><span>{projectTitle} · 확정 DOCX/PDF/HWP</span><button type="button" disabled title="회사 메일 발송 백엔드 연결 후 활성화됩니다.">메일 서버 연결 후 발송 가능</button></div></section>}
        <div className="proposal-finalization-actions"><Button className="proposal-action-revise" onClick={()=>setStep(3)} disabled={busy}>← 수정 · 3단계로</Button>{activeProposal.status==='APPROVED'?<><Button className="final-export-button is-docx" aria-label="확정 제안서 Word DOCX 내려받기" title="미리보기와 동일한 DOCX 내려받기" onClick={()=>void download('docx')} disabled={busy}><FileFormatIcon format="docx"/><span>Word DOCX</span></Button><Button className="final-export-button is-pdf" aria-label="확정 제안서 PDF 내려받기" title="미리보기와 동일한 PDF 내려받기" onClick={()=>void download('pdf')} disabled={busy}><FileFormatIcon format="pdf"/><span>PDF</span></Button><Button className="final-export-button is-hwp" aria-label="확정 제안서 HWP 내려받기" title="편집기를 열지 않고 확정 HWP 내려받기" onClick={()=>void download('hwp')} disabled={busy}><FileFormatIcon format="hwp"/><span>HWP</span></Button><Button onClick={()=>onNavigate('/workflow/award?caseId='+encodeURIComponent(selectedCaseId))}>프로젝트 접수로 →</Button></>:<Button className="proposal-action-confirm" onClick={()=>setConfirmProposalOpen(true)} disabled={busy||!canEdit||activeProposal.status!=='DRAFT'}>제안서 확정</Button>}</div>
      </section>}
    </Card>}
  </div>;
};
