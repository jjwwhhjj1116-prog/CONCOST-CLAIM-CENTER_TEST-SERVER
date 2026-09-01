import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Select, Table, Timeline } from '@claim-studio/ui';
import { ApiError, apiDownload, apiRequest } from '../api';
import { AiGenerationProgressModal, type AiGenerationStatus } from '../components/AiGenerationProgressModal';
import { StatusFeedbackState, type StatusFeedbackType } from '../layout/StatusFeedbackState';
import { CLAIM_TYPES } from '../routes/Router';

interface CaseCategory { major: string; middle: string; minor: string }
interface Party { id: string; name: string; role: string; contact?: string | null }
interface Schedule {
  id: string; title: string; type: string; date: string; location?: string | null;
  dDayInfo?: { dDayStr: string; isOverdue: boolean; isToday: boolean; diffDays: number };
}
interface Activity {
  id: string; title: string; description?: string | null; createdAt: string;
  actor?: { id: string; name: string };
}
interface CaseRecord {
  id: string; caseNumber: string; title: string; description?: string | null; claimType: string;
  clientLegalPosition?: 'VICTIM' | 'SUSPECT' | 'OTHER' | 'UNSPECIFIED'; clientPositionDetail?: string | null;
  status: string; version: number; category?: CaseCategory | null; parties: Party[]; schedules: Schedule[];
  activityTimeline?: Activity[];
}
interface Kpi {
  totalCases: number;
  inProgressCount: number;
  reviewingDocsCount: number;
  todayTasksCount: number;
  delayedCount: number;
  recentCases: Array<Pick<CaseRecord, 'id' | 'caseNumber' | 'title' | 'claimType' | 'status'> & { updatedAt: string }>;
  upcomingSchedules: Array<Schedule & { case: { id: string; caseNumber: string; title: string } }>;
  projectScheduleReminders: Array<{ id:string;caseId:string;caseNumber:string;caseTitle:string;stageCode:string;stageLabel:string;startDate:string;endDate:string;status:string;noteText:string;responsiblePmName:string;overdue:boolean;dDayInfo:{dDayStr:string} }>;
  projectNotifications: Array<{ id:string;caseId:string;caseNumber:string;notificationType:string;title:string;message:string;createdAt:string }>;
}

interface DocumentVersion {
  id: string; versionNumber: number; originalName: string; displayName: string; fileSize: number;
  mimeType: string; sha256: string; isFinal: boolean; uploadedBy?: { name: string; email?: string }; createdAt?: string;
}
interface CaseDocument {
  id: string; title: string; category?: string; source: string; currentVersionId?: string; finalVersionId?: string;
  scheduleId?: string; reportSectionId?: string; version: number;
  versions: DocumentVersion[]; createdAt: string;
}

interface MeetingActionItem {
  id: string; title: string; assignee?: { name: string }; schedule?: { title: string; date: string }; dueDate?: string; status: string;
}
interface MeetingRecord {
  id: string; title: string; meetingDate: string; location?: string; attendees?: string;
  rawText?: string; summary?: string; decisions?: string; status: 'DRAFT' | 'FINAL'; version: number;
  createdBy?: { name: string }; actionItems: MeetingActionItem[]; createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  INQUIRY: '문의', PROPOSAL: '제안', ESTIMATE: '견적', CONTRACT: '계약', MATERIAL_RECEIVED: '자료접수',
  ANALYSIS: '분석', REPORT_DRAFTING: '보고서 작성', SUBMITTED: '제출', LITIGATION: '소송 진행',
  JUDGEMENT: '판결', SUCCESS_FEE: '성공보수 정산', CLOSED: '종결'
};
const STATUS_SEQUENCE = Object.keys(STATUS_LABELS).filter((status) => status !== 'SUCCESS_FEE');

function ErrorBox({ error }: { error: string }): React.ReactElement {
  return <div className="error-box" role="alert">{error}</div>;
}

function feedbackType(error: unknown): StatusFeedbackType {
  if (error instanceof ApiError && error.status === 403) return 'forbidden';
  if (error instanceof ApiError && error.status === 409) return 'conflict';
  if ((typeof navigator !== 'undefined' && !navigator.onLine) || error instanceof TypeError) return 'offline';
  return 'error';
}

function RequestFailure({ error, onRetry }: { error: unknown; onRetry: () => void }): React.ReactElement {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <StatusFeedbackState
      type={feedbackType(error)}
      message={message}
      actionLabel="최신 데이터 다시 불러오기"
      onAction={onRetry}
    />
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('파일을 읽지 못했습니다.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma < 0) reject(new Error('파일 인코딩에 실패했습니다.'));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function fileMimeType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.toLowerCase().split('.').pop();
  const known: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    hwp: 'application/x-hwp',
    txt: 'text/plain',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg'
  };
  return extension ? known[extension] ?? 'application/octet-stream' : 'application/octet-stream';
}

function DashboardPage({ onNavigate }: { onNavigate: (path: string) => void }): React.ReactElement {
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [error, setError] = useState<unknown>(null);
  const loadDashboard = useCallback(async () => {
    setError(null);
    try { setKpi(await apiRequest<Kpi>('/api/dashboard/kpi')); }
    catch (reason) { setError(reason); }
  }, []);
  useEffect(() => { void loadDashboard(); }, [loadDashboard]);
  if (error) return <RequestFailure error={error} onRetry={() => void loadDashboard()} />;
  if (!kpi) return <StatusFeedbackState type="loading" message="대시보드 업무 현황을 동기화하고 있습니다." />;
  /* original loading label retained below for source traceability */
  if (false) return <p role="status">대시보드 데이터를 불러오는 중입니다.</p>;
  const cards = [
    { label: '오늘 일정', value: kpi.todayTasksCount, tone: 'blue', hint: '오늘 처리할 기일과 회의' },
    { label: '기한 경과', value: kpi.delayedCount, tone: 'red', hint: '확인이 필요한 지난 일정' },
    { label: '진행 중 사건', value: kpi.inProgressCount, tone: 'cyan', hint: `전체 ${kpi.totalCases}건 중 진행 중` },
    { label: '검토 대기', value: kpi.reviewingDocsCount, tone: 'amber', hint: '승인 또는 의견이 필요한 문서' }
  ];
  return <div className="dashboard-page">
    <section className="dashboard-hero">
      <div>
        <span className="workspace-eyebrow">CLAIM OPERATIONS</span>
        <h3>오늘의 클레임 업무를 시작하세요</h3>
        <p>사건 일정, 보고서 검토, 최종 출력까지 우선순위가 높은 업무를 한 화면에서 확인합니다.</p>
      </div>
      <div className="dashboard-quick-actions" aria-label="빠른 실행">
        <Button onClick={() => onNavigate('/cases/new')}>+ 새 사건 등록</Button>
        <Button variant="secondary" onClick={() => onNavigate('/cases')}>사건 목록</Button>
        <Button variant="secondary" onClick={() => onNavigate('/reports/studio')}>보고서 작성</Button>
      </div>
    </section>

    <section className="workspace-flow" aria-labelledby="workspace-flow-title">
      <div className="workspace-flow-heading"><div><span className="workspace-eyebrow">CORE WORKFLOW</span><h4 id="workspace-flow-title">하나의 사건이 최종 보고서가 되는 5단계</h4></div><span>업무 기록 자동저장</span></div>
      <div className="workspace-flow-grid">
        {[
          ['01', '사건 등록', '기본정보와 클레임 유형을 등록합니다.', '/cases/new'],
          ['02', '자료 정리', '사건별 자료와 근거를 한곳에서 관리합니다.', '/cases/files'],
          ['03', '보고서 작성', '작성 내용이 자동 저장됩니다.', '/reports/studio'],
          ['04', '결재·승인', '제출된 버전을 독립 검토자가 승인합니다.', '/approval'],
          ['05', '최종 출력', '승인본에서 DOCX·PDF를 생성합니다.', '/reports/studio']
        ].map(([step, title, description, path]) => <button key={step} onClick={() => onNavigate(path)}><span>{step}</span><strong>{title}</strong><small>{description}</small></button>)}
      </div>
    </section>

    <div className="dashboard-kpi-grid" aria-label="사건관리 핵심 지표">{cards.map((card) => (
      <article className={`dashboard-kpi dashboard-kpi--${card.tone}`} key={card.label}>
        <span>{card.label}</span>
        <strong className="kpi-value" data-kpi={card.label}>{card.value}</strong>
        <small>{card.hint}</small>
      </article>
    ))}</div>

    <div className="dashboard-columns">
      <Card title="최근 업데이트 사건">
        {kpi.recentCases.length ? <ul className="dashboard-work-list">{kpi.recentCases.map((record) => (
          <li key={record.id}>
            <button onClick={() => onNavigate(`/cases/detail?caseId=${encodeURIComponent(record.id)}`)}>
              <span><strong>{record.title}</strong><small>{record.caseNumber} · {record.claimType}</small></span>
              <span className="dashboard-status">{STATUS_LABELS[record.status] ?? record.status}</span>
            </button>
          </li>
        ))}</ul> : <p className="empty-box">최근 사건이 없습니다.</p>}
      </Card>
      <Card title="다가오는 일정">
        {kpi.upcomingSchedules.length ? <ul className="dashboard-work-list">{kpi.upcomingSchedules.map((schedule) => (
          <li key={schedule.id}>
            <button onClick={() => onNavigate(`/cases/schedule?caseId=${encodeURIComponent(schedule.case.id)}`)}>
              <span><strong>{schedule.title}</strong><small>{schedule.case.caseNumber} · {new Date(schedule.date).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></span>
              <span className="dashboard-status">{schedule.dDayInfo?.dDayStr ?? schedule.type}</span>
            </button>
          </li>
        ))}</ul> : <p className="empty-box">예정된 일정이 없습니다.</p>}
      </Card>
    </div>
    <div className="dashboard-columns">
      <Card title="내 프로젝트 단계 일정 · PM 기준 일정">
        {kpi.projectScheduleReminders.length ? <ul className="dashboard-work-list">{kpi.projectScheduleReminders.map((schedule) => <li key={schedule.id}><button onClick={() => onNavigate(`/projects/schedule?projectId=${encodeURIComponent(`project-${schedule.caseId}`)}`)}><span><strong>{schedule.stageLabel} · {schedule.caseTitle}</strong><small>{schedule.caseNumber} · {schedule.startDate} ~ {schedule.endDate} · PM {schedule.responsiblePmName}{schedule.noteText ? ` · ${schedule.noteText}` : ''}</small></span><span className={`dashboard-status${schedule.overdue?' is-overdue':''}`}>{schedule.overdue?'기한 경과':schedule.dDayInfo?.dDayStr}</span></button></li>)}</ul> : <p className="empty-box">PM이 저장한 단계 일정이 없습니다. 프로젝트 일정표에서 일정을 입력하세요.</p>}
      </Card>
      <Card title={`프로젝트 알림 · ${kpi.projectNotifications.length}건`}>
        {kpi.projectNotifications.length ? <ul className="dashboard-work-list">{kpi.projectNotifications.map((notification) => <li key={notification.id}><button onClick={() => onNavigate(`/projects/schedule?projectId=${encodeURIComponent(`project-${notification.caseId}`)}`)}><span><strong>{notification.title}</strong><small>{notification.message}</small></span><span className="dashboard-status">확인</span></button></li>)}</ul> : <p className="empty-box">새 일정 변경 알림이 없습니다.</p>}
      </Card>
    </div>
  </div>;
}

function CaseListPage({ onNavigate }: { onNavigate: (path: string) => void }): React.ReactElement {
  const [query, setQuery] = useState('');
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async (q = query) => {
    setLoading(true); setError(null);
    try {
      const result = await apiRequest<{ cases: CaseRecord[]; total: number }>(`/api/cases?limit=100&q=${encodeURIComponent(q)}`);
      setCases(result.cases); setTotal(result.total);
    } catch (reason) { setError(reason); }
    finally { setLoading(false); }
  }, [query]);
  useEffect(() => { void load(''); }, []);

  const columns = useMemo(() => [
    { key: 'caseNumber', header: '사건번호' },
    { key: 'title', header: '사건명', render: (row: CaseRecord) => <span className="text-ellipsis table-title" title={row.title}>{row.title}</span> },
    { key: 'claimType', header: '유형' },
    { key: 'status', header: '상태', render: (row: CaseRecord) => STATUS_LABELS[row.status] ?? row.status },
    { key: 'action', header: '작업', render: (row: CaseRecord) => <Button size="sm" onClick={() => onNavigate(`/cases/detail?caseId=${encodeURIComponent(row.id)}`)}>상세 보기</Button> }
  ], [onNavigate]);

  return <div className="content-stack">
    <Card title={`접근 가능한 사건 ${total}건`}>
      <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void load(); }}>
        <Input label="사건명·사건번호·관계자 통합 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Button type="submit">검색</Button>
        <Button type="button" variant="secondary" onClick={() => onNavigate('/cases/new')}>새 사건 등록</Button>
      </form>
    </Card>
    {error ? (
      <RequestFailure error={error} onRetry={() => void load()} />
    ) : loading ? (
      <StatusFeedbackState type="loading" message="접근 가능한 사건 목록을 불러오고 있습니다." />
    ) : cases.length ? (
      <Table columns={columns} data={cases} keyField="id" />
    ) : (
      <StatusFeedbackState
        type="empty"
        title="검색 결과가 없습니다"
        message="검색어를 바꾸거나 새 사건을 등록해 주세요."
        actionLabel="검색 조건 초기화"
        onAction={() => { setQuery(''); void load(''); }}
      />
    )}
  </div>;
}

function CaseCreatePage({ onNavigate }: { onNavigate: (path: string) => void }): React.ReactElement {
  const [title, setTitle] = useState('');
  const [claimType, setClaimType] = useState('TYPE-01');
  const [description, setDescription] = useState('');
  const [clientLegalPosition, setClientLegalPosition] = useState<'VICTIM' | 'SUSPECT' | 'OTHER'>('VICTIM');
  const [clientPositionDetail, setClientPositionDetail] = useState('');
  const [intakeFile, setIntakeFile] = useState<File | null>(null);
  const [intakeDraft, setIntakeDraft] = useState<{title:string;claimType:string;clientLegalPosition:'VICTIM'|'SUSPECT'|'OTHER';clientPositionDetail:string;description:string;reviewChecklist:string[]}|null>(null);
  const [aiGeneration, setAiGeneration] = useState<{status:AiGenerationStatus;error?:string}|null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [reviewChecks, setReviewChecks] = useState<boolean[]>([]);
  const [createdCase, setCreatedCase] = useState<CaseRecord | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [intakeSourceIdempotencyKey, setIntakeSourceIdempotencyKey] = useState(() => crypto.randomUUID());
  const reviewChecklist = intakeDraft ? (intakeDraft.reviewChecklist.length ? intakeDraft.reviewChecklist : ['사건명·업무 유형이 원문과 일치합니다.', '클라이언트 지위와 입장이 원문과 일치합니다.', '사건 설명의 사실·수치·확인 필요 항목을 대조했습니다.']) : [];
  const reviewChecklistComplete = reviewChecklist.length > 0 && reviewChecklist.every((_item, index) => reviewChecks[index]);
  const invalidateReview = () => {
    if (!intakeDraft) return;
    setReviewConfirmed(false);
    setReviewChecks(reviewChecklist.map(() => false));
  };
  const openReview = () => {
    if (!intakeDraft) {
      setError('먼저 AI 자동 작성을 완료해 초안을 만들어 주세요.');
      return;
    }
    setError('');
    setReviewOpen(true);
  };
  const generateDraft = async () => {
    if (!intakeFile) { setError('먼저 녹음·TXT·CSV·Excel(.xlsx) 자료를 선택해 주세요.'); return; }
    setError(''); setReviewConfirmed(false); setReviewOpen(false); setAiGeneration({status:'running'});
    try {
      const form = new FormData();
      form.set('file', intakeFile); form.set('title', title); form.set('claimType', claimType); form.set('clientLegalPosition', clientLegalPosition); form.set('clientPositionDetail', clientPositionDetail); form.set('description', description);
      const result = await apiRequest<{draft:{title:string;claimType:string;clientLegalPosition:'VICTIM'|'SUSPECT'|'OTHER';clientPositionDetail:string;description:string;reviewChecklist:string[]}}>('/api/cases/intake-source/draft', { method:'POST', body:form, timeoutMs:105_000 });
      setIntakeDraft(result.draft); setTitle(result.draft.title); setClaimType(result.draft.claimType); setClientLegalPosition(result.draft.clientLegalPosition); setClientPositionDetail(result.draft.clientPositionDetail); setDescription(result.draft.description); setReviewChecks(Array.from({length:Math.max(3,result.draft.reviewChecklist.length)},()=>false)); setAiGeneration({status:'complete'});
    } catch (reason) { setAiGeneration({status:'error',error:reason instanceof Error?reason.message:String(reason)}); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      if (intakeFile && !intakeDraft) {
        setError('첨부 자료의 AI 자동 작성을 먼저 완료해 주세요. AI를 사용하지 않을 경우 첨부 파일을 지우고 수동으로 저장할 수 있습니다.');
        return;
      }
      if (intakeFile && !reviewConfirmed) {
        setError('3단계 사람 검수가 필요합니다. 열린 검수창에서 확인 항목을 모두 체크하고 “검수 완료”를 눌러 주세요.');
        setReviewOpen(true);
        return;
      }
      const result = createdCase ? { case: createdCase } : await apiRequest<{ case: CaseRecord }>('/api/cases', {
        method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ title, claimType, description, clientLegalPosition, clientPositionDetail, category: { major: '건설 클레임', middle: claimType, minor: '사건 업무' } })
      });
      setCreatedCase(result.case);
      let driveArchivePending = false;
      if (intakeFile) {
        const form = new FormData(); form.set('file', intakeFile); form.set('useReviewedCaseDescription','true');
        const sourceResult = await apiRequest<{storage?:{status:string}}>(`/api/cases/${encodeURIComponent(result.case.id)}/intake-source`, { method: 'POST', headers: { 'Idempotency-Key': intakeSourceIdempotencyKey }, body: form });
        driveArchivePending = Boolean(sourceResult.storage?.status && sourceResult.storage.status !== 'SAVED');
        setIntakeSourceIdempotencyKey(crypto.randomUUID());
      }
      setIdempotencyKey(crypto.randomUUID());
      onNavigate(`/proposals/editor?caseId=${encodeURIComponent(result.case.id)}&from=intake${driveArchivePending?'&intakeStorage=pending':''}`);
    } catch (reason) {
      setIntakeSourceIdempotencyKey(crypto.randomUUID());
      setError(`${createdCase ? '의뢰는 저장되었습니다. 첨부 자료 보관을 다시 시도해 주세요. · ' : ''}${reason instanceof Error ? reason.message : String(reason)}`);
    }
    finally { setSaving(false); }
  };
  return <div className="case-create-page">
    <AiGenerationProgressModal isOpen={Boolean(aiGeneration)} status={aiGeneration?.status??'running'} title="Gemini가 의뢰 자료를 읽고 있습니다" description="녹음·TXT·CSV·Excel 원문에서 사건명, 클레임 유형, 클라이언트 지위와 사건 설명 초안을 작성합니다." stages={['파일 형식·원문 확인','사건 사실·당사자 구분','기본정보·사건 설명 작성','사람 검수 항목 생성']} completeMessage="AI 초안 작성이 완료되었습니다. 확인을 누른 뒤 원문과 반드시 대조해 주세요." errorMessage={aiGeneration?.error} confirmLabel="초안 열고 검수하기" timeoutHintSeconds={90} onConfirm={()=>{setAiGeneration(null);setReviewOpen(true);}} onClose={()=>setAiGeneration(null)}/>
    {reviewOpen&&intakeDraft&&<div className="case-intake-review-overlay" role="presentation"><section className="case-intake-review-dialog" role="dialog" aria-modal="true" aria-labelledby="case-intake-review-title"><span className="gemini-star" aria-hidden="true">✦</span><div><small>GEMINI AI DRAFT · HUMAN REVIEW REQUIRED</small><h2 id="case-intake-review-title">3단계 · 자동작성 결과 검수</h2><p>현재 입력 화면의 내용을 첨부 원문과 대조하세요. 수정한 내용까지 아래에 실시간으로 반영됩니다.</p></div><dl><div><dt>사건명</dt><dd>{title}</dd></div><div><dt>유형·클라이언트 지위</dt><dd>{claimType} · {clientLegalPosition}</dd></div><div className="wide"><dt>클라이언트 입장</dt><dd>{clientPositionDetail || '입력 없음'}</dd></div><div className="wide"><dt>사건 설명 현재본</dt><dd>{description}</dd></div></dl><fieldset className="case-intake-review-checklist"><legend>원문과 대조한 항목을 모두 체크하세요.</legend>{reviewChecklist.map((item,index)=><label key={`${item}-${index}`}><input type="checkbox" checked={Boolean(reviewChecks[index])} onChange={(event)=>setReviewChecks((current)=>{const next=[...current];next[index]=event.target.checked;return next;})}/><span>{item}</span></label>)}</fieldset><div className="case-intake-review-actions"><Button variant="secondary" type="button" onClick={()=>{setReviewOpen(false);setReviewConfirmed(false);}}>← 입력 화면에서 수정</Button><Button className="gemini-action-button" type="button" disabled={!reviewChecklistComplete} onClick={()=>{setReviewConfirmed(true);setReviewOpen(false);setError('');}}>✓ 확인 항목 전체 체크 · 검수 완료</Button></div>{!reviewChecklistComplete&&<p className="case-intake-review-help" role="status">위 확인 항목을 모두 체크하면 검수 완료 버튼이 활성화됩니다.</p>}</section></div>}
    <section className="workspace-hero case-create-hero"><div><span className="workspace-eyebrow">NEW PROJECT INTAKE</span><h3>새 프로젝트 의뢰를 등록합니다.</h3><p>저장하면 해당 의뢰가 선택된 제안서 작성 화면으로 바로 이어집니다.</p></div><div className="case-create-number"><strong>01</strong><span>INTAKE → PROPOSAL</span></div></section>
    <Card title="사건 기본정보" className="case-create-card">
      <form className="case-create-form" onSubmit={(event) => void submit(event)}>
        <Input label="사건명" value={title} maxLength={500} required placeholder="예: 공동주택 공사비 적정성 검토" onChange={(event) => { setTitle(event.target.value); invalidateReview(); }} />
        <Select required label="클레임 업무 유형" value={claimType} options={[...CLAIM_TYPES]} onChange={(event) => { setClaimType(event.target.value); invalidateReview(); }} />
        <Select required label="우리 클라이언트의 법적 지위" value={clientLegalPosition} options={[{value:'VICTIM',label:'피해자·원고 측'},{value:'SUSPECT',label:'피의자·피고 측'},{value:'OTHER',label:'기타 이해관계인'}]} onChange={(event) => { setClientLegalPosition(event.target.value as 'VICTIM'|'SUSPECT'|'OTHER'); invalidateReview(); }} />
        <Input label="클라이언트 입장 상세" value={clientPositionDetail} maxLength={2000} required={clientLegalPosition === 'OTHER'} placeholder="예: 원고 조합, 피고 시공사, 감정 신청인" onChange={(event) => { setClientPositionDetail(event.target.value); invalidateReview(); }} />
        <label className="case-description-field" htmlFor="case-description"><span>사건 설명 · 반드시 클라이언트 관점으로 작성 <i className="ui-required-mark">*</i></span><textarea required id="case-description" value={description} maxLength={5000} placeholder="우리 클라이언트가 무엇을 주장하고 어떤 피해·책임 쟁점을 다투는지, 확보 자료와 함께 입력하세요." onChange={(event) => { setDescription(event.target.value); invalidateReview(); }} /></label>
        <section className="case-intake-assistant"><div className="case-intake-assistant__heading"><span className="gemini-star" aria-hidden="true">✦</span><div><strong>Gemini AI 의뢰 자동작성</strong><small>회의록·녹음·TXT·CSV·Excel(.xlsx)의 문장과 셀을 읽어 위 기본정보와 사건 설명 초안을 채웁니다.</small></div></div><label className="case-intake-audio" htmlFor="case-intake-source"><span>분석할 의뢰 자료 · 회의록 / 녹음 / TXT / CSV / Excel</span><input id="case-intake-source" type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/ogg,audio/webm,text/plain,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.mp3,.m4a,.wav,.ogg,.webm,.txt,.csv,.xlsx" onChange={(event) => {setIntakeFile(event.target.files?.[0] ?? null);setIntakeDraft(null);setReviewConfirmed(false);setReviewChecks([]);setReviewOpen(false);}} /><small>{intakeFile ? `${intakeFile.name} · ${(intakeFile.size/1024/1024).toFixed(1)}MB · “AI 자동 작성”을 눌러 초안을 만든 뒤 반드시 검수하세요.` : '지원 형식: 회의록 XLSX·CSV·TXT / 녹음 MP3·M4A·WAV·OGG·WEBM / 최대 10MB'}</small></label><div className="case-intake-assistant__actions"><Button type="button" className="gemini-action-button" size="lg" disabled={!intakeFile||aiGeneration?.status==='running'} onClick={()=>void generateDraft()}><span className="gemini-button-star" aria-hidden="true">✦</span> {intakeDraft?'AI 초안 다시 작성':'AI 자동 작성'}</Button>{intakeDraft&&<Button type="button" className="case-intake-review-open" size="lg" onClick={openReview}>{reviewConfirmed?'✓ 검수 완료 내용 다시 확인':'3단계 · 검수 완료하기'}</Button>}<span className={reviewConfirmed?'is-reviewed':'is-pending'}>{reviewConfirmed?'✓ 원문 대조·검수 완료':'AI 초안 작성 후 사람 검수가 필요합니다.'}</span></div></section>
        {intakeFile&&<section className="case-intake-flow" aria-label="프로젝트 의뢰 진행 단계"><header><b>현재 진행 단계</b><span>{reviewConfirmed?'검수 완료 · 저장 가능':intakeDraft?'3단계 사람 검수가 필요합니다':'AI 초안 작성이 필요합니다'}</span></header><ol><li className={intakeFile?'is-complete':''}><b>1</b><span>자료 선택<small>{intakeFile.name}</small></span></li><li className={intakeDraft?'is-complete':'is-current'}><b>2</b><span>AI 초안 작성<small>{intakeDraft?'작성 완료':'AI 자동 작성 버튼을 누르세요'}</small></span></li><li className={reviewConfirmed?'is-complete':intakeDraft?'is-current':''}><b>3</b><span>사람 검수<small>{reviewConfirmed?'검수 완료':intakeDraft?'검수 완료하기 버튼을 누르세요':'초안 작성 후 활성화'}</small></span></li><li className={reviewConfirmed?'is-current':''}><b>4</b><span>저장·제안서 이동<small>{reviewConfirmed?'아래 저장 버튼 활성화':'검수 완료 후 활성화'}</small></span></li></ol>{intakeDraft&&!reviewConfirmed&&<Button type="button" className="case-intake-review-open" size="lg" onClick={openReview}>3단계 검수 화면 열기</Button>}</section>}
        <div className="case-create-summary"><span>저장 후 다음 단계</span><p>분류 정보와 담당자를 함께 저장한 뒤, 이 프로젝트가 선택된 제안서 작성 1단계로 이동합니다.</p></div>
        {error && <ErrorBox error={error} />}
        <div className="case-create-actions"><div className="case-create-action-status"><b>{!intakeFile?'수동 입력 저장 가능':reviewConfirmed?'✓ 검수 완료 · 저장 가능':intakeDraft?'검수 완료 후 저장 가능':'AI 초안 작성 후 검수 필요'}</b><small>필수 단계가 끝나면 오른쪽 저장 버튼이 활성화됩니다.</small></div><Button type="button" variant="secondary" onClick={() => onNavigate('/dashboard')}>취소</Button><Button type="submit" isLoading={saving} disabled={Boolean(intakeFile)&&(!intakeDraft||!reviewConfirmed)}>의뢰 저장 후 제안서 작성</Button></div>
      </form>
    </Card>
  </div>;
}

function MaterialsPage(): React.ReactElement {
  const caseId = new URLSearchParams(window.location.search).get('caseId') ?? 'CASE-SYN-001';
  const [documents, setDocuments] = useState<CaseDocument[]>([]);
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('RECEIVED');
  const [category, setCategory] = useState('EVIDENCE');
  const [scheduleId, setScheduleId] = useState('');
  const [reportSectionId, setReportSectionId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [versionFiles, setVersionFiles] = useState<Record<string, File | null>>({});
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await apiRequest<{ documents: CaseDocument[] }>(`/api/cases/${encodeURIComponent(caseId)}/documents`);
      setDocuments(res.documents);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError('업로드할 파일을 선택하세요.'); return; }
    setUploading(true); setError('');
    try {
      const base64 = await fileToBase64(file);
      await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/documents`, {
        method: 'POST',
        body: JSON.stringify({
          title, source, category, scheduleId: scheduleId || null, reportSectionId: reportSectionId || null,
          filename: file.name, fileBase64: base64, mimeType: fileMimeType(file)
        })
      });
      setTitle(''); setFile(null); setScheduleId(''); setReportSectionId(''); await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setUploading(false); }
  };

  const handleNewVersion = async (doc: CaseDocument) => {
    const nextFile = versionFiles[doc.id];
    if (!nextFile) { setError('새 버전 파일을 선택하세요.'); return; }
    setError('');
    try {
      await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(doc.id)}/versions`, {
        method: 'POST',
        body: JSON.stringify({ filename: nextFile.name, fileBase64: await fileToBase64(nextFile), mimeType: fileMimeType(nextFile), version: doc.version })
      });
      setVersionFiles((current) => ({ ...current, [doc.id]: null }));
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const handleFinalize = async (docId: string, versionId: string) => {
    setError('');
    try {
      await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(docId)}/finalize`, {
        method: 'POST', body: JSON.stringify({ versionId, version: documents.find((doc) => doc.id === docId)?.version })
      });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const handleDownload = async (docId: string, versionId: string) => {
    setError('');
    try {
      const result = await apiDownload(`/api/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(docId)}/versions/${encodeURIComponent(versionId)}/download`);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = result.filename; anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  return <div className="content-stack">
    <Card title="신규 자료/문서 업로드 (v01)">
      <form className="form-stack" onSubmit={(e) => void handleUpload(e)}>
        <Input label="문서 제목" value={title} required onChange={(e) => setTitle(e.target.value)} />
        <Select label="출처 구분" value={source} onChange={(e) => setSource(e.target.value)} options={[
          { value: 'RECEIVED', label: '수신' }, { value: 'AUTHORED', label: '작성' }, { value: 'SUBMITTED', label: '제출' }
        ]} />
        <Select label="문서 카테고리" value={category} onChange={(e) => setCategory(e.target.value)} options={[
          { value: 'PROPOSAL', label: '제안서' }, { value: 'EVIDENCE', label: '증거자료' }, { value: 'CONTRACT', label: '계약서' }, { value: 'ETC', label: '기타' }
        ]} />
        <Input label="첨부 파일 선택" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Input label="연결 기일 ID (선택)" value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} />
        <Input label="연결 보고서 장 ID (선택)" value={reportSectionId} onChange={(e) => setReportSectionId(e.target.value)} />
        {error && <ErrorBox error={error} />}
        <Button type="submit" isLoading={uploading}>문서 업로드</Button>
      </form>
    </Card>

    <Card title={`사건 문서 및 버전 이력 (${documents.length}건)`}>
      {loading ? <p role="status">자료실을 불러오는 중입니다.</p> : documents.length === 0 ? <p className="empty-box">등록된 문서가 없습니다.</p> : (
        <ul className="doc-list">{documents.map((doc) => (
          <li key={doc.id} className="doc-item">
            <div>
              <strong>{doc.title}</strong> ({doc.source} · {doc.category})
              <p className="muted">연결 기일: {doc.scheduleId || '없음'} · 연결 보고서 장: {doc.reportSectionId || '없음'}</p>
              <ul className="version-sublist">
                {doc.versions.map((ver) => (
                  <li key={ver.id}>
                    {ver.displayName} (v{String(ver.versionNumber).padStart(2, '0')})
                    {ver.isFinal && <span className="badge badge-final"> [최종본]</span>}
                    <span className="muted"> · 원본명 {ver.originalName} · {ver.mimeType} · {ver.fileSize} bytes · 무결성 확인 {ver.sha256.slice(0, 12)}… · {ver.uploadedBy?.name ?? '알 수 없음'}</span>
                    <Button size="sm" variant="secondary" onClick={() => void handleDownload(doc.id, ver.id)}>다운로드</Button>
                    {!ver.isFinal && <Button size="sm" variant="secondary" onClick={() => void handleFinalize(doc.id, ver.id)}>최종본 지정</Button>}
                  </li>
                ))}
              </ul>
              <Input label={`새 버전 파일 - ${doc.title}`} type="file" onChange={(event) => setVersionFiles((current) => ({ ...current, [doc.id]: event.target.files?.[0] ?? null }))} />
              <Button size="sm" onClick={() => void handleNewVersion(doc)}>새 버전 업로드</Button>
            </div>
          </li>
        ))}</ul>
      )}
    </Card>
  </div>;
}

function MeetingEditor({ meeting, caseId, reload, onError }: {
  meeting: MeetingRecord; caseId: string; reload: () => Promise<void>; onError: (message: string) => void;
}): React.ReactElement {
  const [summary, setSummary] = useState(meeting.summary ?? '');
  const [decisions, setDecisions] = useState(meeting.decisions ?? '');
  const [actionTitle, setActionTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const mutate = async (work: () => Promise<unknown>) => {
    setSaving(true); onError('');
    try { await work(); await reload(); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };
  const base = `/api/cases/${encodeURIComponent(caseId)}/meetings/${encodeURIComponent(meeting.id)}`;
  return <li className="meeting-item">
    <div>
      <strong>{meeting.title}</strong> ({new Date(meeting.meetingDate).toLocaleString('ko-KR')}) - <span className={`badge status-${meeting.status}`}>{meeting.status}</span>
      <p className="muted">장소: {meeting.location || '없음'} · 참석자: {meeting.attendees || '없음'} · 작성자: {meeting.createdBy?.name || '알 수 없음'}</p>
      <details><summary>보존된 회의 원문 보기</summary><pre className="meeting-transcript">{meeting.rawText || '원문 없음'}</pre></details>
      {meeting.status === 'DRAFT' ? <div className="form-stack">
        <Input label={`핵심 요약 - ${meeting.title}`} value={summary} onChange={(event) => setSummary(event.target.value)} />
        <Input label={`결정사항 - ${meeting.title}`} value={decisions} onChange={(event) => setDecisions(event.target.value)} />
        <div className="action-row">
          <Button size="sm" isLoading={saving} onClick={() => void mutate(() => apiRequest(base, {
            method: 'PATCH', body: JSON.stringify({ summary, decisions, version: meeting.version })
          }))}>요약·결정사항 저장</Button>
          <Button size="sm" variant="secondary" isLoading={saving} onClick={() => void mutate(() => apiRequest(`${base}/finalize`, {
            method: 'POST', body: JSON.stringify({ version: meeting.version })
          }))}>회의록 확정 (FINAL)</Button>
        </div>
        <fieldset className="form-stack">
          <legend>회의 할 일 연결</legend>
          <Input label={`할 일 제목 - ${meeting.title}`} value={actionTitle} onChange={(event) => setActionTitle(event.target.value)} />
          <Input label={`담당자 ID - ${meeting.title}`} value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} />
          <Input label={`연결 기일 ID - ${meeting.title}`} value={scheduleId} onChange={(event) => setScheduleId(event.target.value)} />
          <Input label={`할 일 기한 - ${meeting.title}`} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          <Button size="sm" isLoading={saving} onClick={() => void mutate(async () => {
            await apiRequest(`${base}/action-items`, { method: 'POST', body: JSON.stringify({
              title: actionTitle, assigneeId: assigneeId || null, scheduleId: scheduleId || null,
              dueDate: dueDate ? new Date(`${dueDate}T00:00:00.000Z`).toISOString() : null
            }) });
            setActionTitle(''); setAssigneeId(''); setScheduleId(''); setDueDate('');
          })}>할 일 추가</Button>
        </fieldset>
      </div> : <p className="muted">확정본은 원문·요약·결정사항·할 일을 변경할 수 없습니다.</p>}
      <ul aria-label={`${meeting.title} 할 일 목록`}>
        {meeting.actionItems.length === 0 ? <li>등록된 할 일이 없습니다.</li> : meeting.actionItems.map((item) => (
          <li key={item.id}>{item.title} · 담당 {item.assignee?.name ?? '미지정'} · 기일 {item.schedule?.title ?? '미연결'} · {item.status}</li>
        ))}
      </ul>
    </div>
  </li>;
}

function MeetingsPage(): React.ReactElement {
  const caseId = new URLSearchParams(window.location.search).get('caseId') ?? 'CASE-SYN-001';
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [title, setTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [location, setLocation] = useState('');
  const [attendees, setAttendees] = useState('');
  const [rawText, setRawText] = useState('');
  const [summary, setSummary] = useState('');
  const [decisions, setDecisions] = useState('');
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await apiRequest<{ meetings: MeetingRecord[] }>(`/api/cases/${encodeURIComponent(caseId)}/meetings`);
      setMeetings(res.meetings);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const transcript = transcriptFile ? await transcriptFile.text() : rawText;
      await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/meetings`, {
        method: 'POST',
        body: JSON.stringify({
          title, meetingDate: new Date(meetingDate).toISOString(), location, attendees, rawText: transcript, summary, decisions
        })
      });
      setTitle(''); setMeetingDate(''); setLocation(''); setAttendees(''); setRawText(''); setTranscriptFile(null); setSummary(''); setDecisions('');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  };

  return <div className="content-stack">
    <Card title="신규 회의록 등록 (Draft)">
      <form className="form-stack" onSubmit={(e) => void handleCreate(e)}>
        <Input label="회의 제목" value={title} required onChange={(e) => setTitle(e.target.value)} />
        <Input label="회의 일시" type="datetime-local" value={meetingDate} required onChange={(e) => setMeetingDate(e.target.value)} />
        <Input label="장소" value={location} onChange={(e) => setLocation(e.target.value)} />
        <Input label="참석자" value={attendees} onChange={(e) => setAttendees(e.target.value)} />
        <Input label="회의 원문 텍스트" value={rawText} onChange={(e) => setRawText(e.target.value)} />
        <Input label="회의 원문 TXT 업로드" type="file" accept=".txt,text/plain" onChange={(event) => setTranscriptFile(event.target.files?.[0] ?? null)} />
        <Input label="핵심 요약" value={summary} onChange={(e) => setSummary(e.target.value)} />
        <Input label="의결 사항" value={decisions} onChange={(e) => setDecisions(e.target.value)} />
        {error && <ErrorBox error={error} />}
        <Button type="submit" isLoading={saving}>회의록 등록</Button>
      </form>
    </Card>

    <Card title={`회의록 목록 (${meetings.length}건)`}>
      {loading ? <p role="status">회의록을 불러오는 중입니다.</p> : meetings.length === 0 ? <p className="empty-box">등록된 회의록이 없습니다.</p> : (
        <ul className="meeting-list">{meetings.map((meeting) => (
          <MeetingEditor key={meeting.id} meeting={meeting} caseId={caseId} reload={load} onError={setError} />
        ))}</ul>
      )}
    </Card>
  </div>;
}

function CaseDetailPage({ section, onNavigate, previewMode = false }: { section: 'overview' | 'parties' | 'schedules'; onNavigate: (path: string) => void; previewMode?: boolean }): React.ReactElement {
  const caseId = new URLSearchParams(window.location.search).get('caseId');
  const [record, setRecord] = useState<CaseRecord | null>(null);
  const [error, setError] = useState('');
  const [partyName, setPartyName] = useState('');
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [scheduleType, setScheduleType] = useState('COURT');
  const [scheduleDate, setScheduleDate] = useState('');
  const load = useCallback(async () => {
    setError('');
    if (!caseId) { setRecord(null); return; }
    try { setRecord((await apiRequest<{ case: CaseRecord }>(`/api/cases/${encodeURIComponent(caseId)}`)).case); }
    catch (reason) { setError(reason instanceof ApiError && reason.status === 403 ? '403 사건 접근 권한이 없습니다.' : reason instanceof Error ? reason.message : String(reason)); }
  }, [caseId]);
  useEffect(() => { void load(); }, [load]);
  if (!caseId) return <StatusFeedbackState type="empty" title="사건을 먼저 선택해 주세요" message="사건 목록에서 업무를 진행할 사건을 선택하면 개요·일정·관계자 화면이 열립니다." actionLabel="사건 목록으로 이동" onAction={() => onNavigate('/cases')} />;
  if (error) return <ErrorBox error={error} />;
  if (!record) return <p role="status">사건 상세를 불러오는 중입니다.</p>;

  const addParty = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    try {
      await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/parties`, { method: 'POST', body: JSON.stringify({ name: partyName, role: 'OTHER' }) });
      setPartyName(''); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const addSchedule = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    try {
      await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/schedules`, {
        method: 'POST', body: JSON.stringify({ title: scheduleTitle, type: scheduleType, date: new Date(scheduleDate).toISOString() })
      });
      setScheduleTitle(''); setScheduleDate(''); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const advanceStatus = async () => {
    const index = STATUS_SEQUENCE.indexOf(record.status);
    const toStatus = STATUS_SEQUENCE[index + 1];
    if (!toStatus) return;
    try {
      await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/status`, {
        method: 'POST', body: JSON.stringify({ toStatus, reason: 'UI workflow transition', version: record.version })
      });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  return <div className="content-stack">
    <Card title={`${record.caseNumber} · ${record.title}`}>
      <p><strong>유형:</strong> {record.claimType} · <strong>상태:</strong> {STATUS_LABELS[record.status] ?? record.status} · <strong>버전:</strong> {record.version}</p>
      <p><strong>분류:</strong> {record.category ? `${record.category.major} > ${record.category.middle} > ${record.category.minor}` : '미분류'}</p>
      <div className="action-row">
        <Button size="sm" variant={section === 'overview' ? 'primary' : 'secondary'} onClick={() => onNavigate(`/cases/detail?caseId=${caseId}`)}>개요</Button>
        <Button size="sm" variant={section === 'schedules' ? 'primary' : 'secondary'} onClick={() => onNavigate(`/cases/schedule?caseId=${caseId}`)}>일정</Button>
        <Button size="sm" variant={section === 'parties' ? 'primary' : 'secondary'} onClick={() => onNavigate(`/cases/parties?caseId=${caseId}`)}>관계자</Button>
        <Button size="sm" variant="secondary" onClick={() => onNavigate(`/cases/files?caseId=${caseId}`)}>자료실</Button>
        <Button size="sm" variant="secondary" onClick={() => onNavigate(`/reports/studio?caseId=${caseId}`)}>보고서 작성</Button>
        {!previewMode && <Button size="sm" variant="secondary" onClick={() => onNavigate(`/meetings?caseId=${caseId}`)}>회의록</Button>}
      </div>
    </Card>
    {error && <ErrorBox error={error} />}
    {section === 'overview' && <>
      <Card title="사건 생애주기"><Button onClick={() => void advanceStatus()} disabled={record.status === 'CLOSED'}>다음 단계로 이동</Button></Card>
      <Card title="활동 타임라인"><Timeline items={(record.activityTimeline ?? []).map((item) => ({ id: item.id, title: item.title, timestamp: new Date(item.createdAt).toLocaleString('ko-KR'), description: item.description ?? undefined }))} /></Card>
    </>}
    {section === 'parties' && <Card title={`관계자 ${record.parties.length}명`}>
      <ul>{record.parties.map((party) => <li key={party.id}>{party.name} · {party.role} · {party.contact ?? '연락처 없음'}</li>)}</ul>
      <form className="inline-form" onSubmit={(event) => void addParty(event)}><Input label="새 관계자 이름" value={partyName} required onChange={(event) => setPartyName(event.target.value)} /><Button type="submit">관계자 추가</Button></form>
    </Card>}
    {section === 'schedules' && <Card title={`기일 ${record.schedules.length}건`}>
      <ul>{record.schedules.slice(0, 20).map((schedule) => <li key={schedule.id}>{schedule.dDayInfo?.dDayStr ?? ''} · {schedule.type} · {schedule.title}</li>)}</ul>
      {record.schedules.length > 20 && <p className="muted">최근 20건을 표시합니다. 전체 {record.schedules.length}건</p>}
      <form className="inline-form" onSubmit={(event) => void addSchedule(event)}>
        <Input label="새 기일 제목" value={scheduleTitle} required onChange={(event) => setScheduleTitle(event.target.value)} />
        <Select label="기일 유형" value={scheduleType} onChange={(event) => setScheduleType(event.target.value)} options={[{ value: 'COURT', label: '법원' }, { value: 'CLIENT', label: '고객' }, { value: 'INTERNAL', label: '내부' }]} />
        <Input label="기일 일시" type="datetime-local" value={scheduleDate} required onChange={(event) => setScheduleDate(event.target.value)} />
        <Button type="submit">기일 추가</Button>
      </form>
    </Card>}
  </div>;
}

export function CaseManagement({ routeId, onNavigate, previewMode = false }: { routeId: string; onNavigate: (path: string) => void; previewMode?: boolean }): React.ReactElement {
  if (routeId === 'DASH-01') return <DashboardPage onNavigate={onNavigate} />;
  if (routeId === 'CASE-01') return <CaseListPage onNavigate={onNavigate} />;
  if (routeId === 'CASE-02') return <CaseCreatePage onNavigate={onNavigate} />;
  if (routeId === 'CASE-03') return <CaseDetailPage section="overview" onNavigate={onNavigate} previewMode={previewMode} />;
  if (routeId === 'CASE-04') return <CaseDetailPage section="schedules" onNavigate={onNavigate} previewMode={previewMode} />;
  if (routeId === 'CASE-05') return <CaseDetailPage section="parties" onNavigate={onNavigate} previewMode={previewMode} />;
  if (routeId === 'CASE-06') return <MaterialsPage />;
  if (routeId === 'MEET-01') return <MeetingsPage />;
  return <CaseDetailPage section="parties" onNavigate={onNavigate} />;
}
