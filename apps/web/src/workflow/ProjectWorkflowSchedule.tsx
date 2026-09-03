import React, { useEffect, useMemo, useState } from 'react';
import { Button, Dialog } from '@claim-studio/ui';
import { apiRequest } from '../api';
import { claimTypeLabel } from '../claim-types';
import {
  WORKFLOW_STAGES,
  workflowStageFromRoute,
  type WorkflowProject,
  type WorkflowStageId
} from './workflow-model';
import { scheduleDayInfo } from './schedule-holidays';

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const PROJECT_SCHEDULE_CODES: readonly string[] = ['KICKOFF', 'SITE_SURVEY', 'TAKEOFF_COST', 'REPORT_WRITING'];

interface ProjectArchiveReadiness {
  complete: boolean;
  manifestSha256: string;
  checkedAt: string;
  checklist: Array<{ code: string; label: string; complete: boolean; detail: string }>;
}

const isoDate = (year: number, monthIndex: number, day: number) => `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const monthBarStyle = (startDate: string | null | undefined, endDate: string | null | undefined, year: number, monthIndex: number, dayCount: number): React.CSSProperties | undefined => {
  if (!startDate || !endDate) return undefined;
  const monthStart = isoDate(year, monthIndex, 1);
  const monthEnd = isoDate(year, monthIndex, dayCount);
  if (endDate < monthStart || startDate > monthEnd) return undefined;
  const visibleStart = Math.max(1, Number((startDate < monthStart ? monthStart : startDate).slice(8, 10)));
  const visibleEnd = Math.min(dayCount, Number((endDate > monthEnd ? monthEnd : endDate).slice(8, 10)));
  return {
    left: `${((visibleStart - 1) / dayCount) * 100}%`,
    width: `${((visibleEnd - visibleStart + 1) / dayCount) * 100}%`
  };
};

interface ProjectTimelineDay {
  iso: string;
  year: number;
  monthIndex: number;
  day: number;
}

interface ProjectTimelineMonth {
  key: string;
  label: string;
  dayCount: number;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function validIsoDate(value: string | null | undefined): value is string {
  if (!value || !ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function buildProjectTimeline(project: WorkflowProject, fallbackYear: number, fallbackMonthIndex: number): { days: ProjectTimelineDay[]; months: ProjectTimelineMonth[] } {
  const startCandidates = [project.start, ...project.stages.map((stage) => stage.startDate)].filter(validIsoDate).sort();
  const endCandidates = [project.end, ...project.stages.map((stage) => stage.endDate)].filter(validIsoDate).sort();
  const fallbackStart = isoDate(fallbackYear, fallbackMonthIndex, 1);
  const fallbackEnd = isoDate(fallbackYear, fallbackMonthIndex, new Date(fallbackYear, fallbackMonthIndex + 1, 0).getDate());
  const startIso = startCandidates[0] ?? fallbackStart;
  const endIso = endCandidates.at(-1) ?? fallbackEnd;
  const safeStart = endIso >= startIso ? startIso : fallbackStart;
  const safeEnd = endIso >= startIso ? endIso : fallbackEnd;
  const [startYear, startMonth, startDay] = safeStart.split('-').map(Number);
  const [endYear, endMonth, endDay] = safeEnd.split('-').map(Number);
  const cursor = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const endTime = Date.UTC(endYear, endMonth - 1, endDay);
  const days: ProjectTimelineDay[] = [];
  while (cursor.getTime() <= endTime && days.length < 3_660) {
    days.push({
      iso: `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`,
      year: cursor.getUTCFullYear(),
      monthIndex: cursor.getUTCMonth(),
      day: cursor.getUTCDate()
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const months: ProjectTimelineMonth[] = [];
  for (const day of days) {
    const key = `${day.year}-${String(day.monthIndex + 1).padStart(2, '0')}`;
    const current = months.at(-1);
    if (current?.key === key) current.dayCount += 1;
    else months.push({ key, label: `${day.year}년 ${day.monthIndex + 1}월`, dayCount: 1 });
  }
  return { days, months };
}

function timelineBarStyle(startDate: string | null | undefined, endDate: string | null | undefined, days: ProjectTimelineDay[]): React.CSSProperties | undefined {
  if (!validIsoDate(startDate) || !validIsoDate(endDate) || days.length === 0) return undefined;
  const firstIso = days[0].iso;
  const lastIso = days.at(-1)!.iso;
  if (endDate < firstIso || startDate > lastIso) return undefined;
  const visibleStart = startDate < firstIso ? firstIso : startDate;
  const visibleEnd = endDate > lastIso ? lastIso : endDate;
  const startIndex = days.findIndex((day) => day.iso === visibleStart);
  const endIndex = days.findIndex((day) => day.iso === visibleEnd);
  if (startIndex < 0 || endIndex < startIndex) return undefined;
  return { left: `${startIndex * 44}px`, width: `${(endIndex - startIndex + 1) * 44}px` };
}

const statusLabel = (status: 'DONE' | 'IN_PROGRESS' | 'PLANNED') => ({
  DONE: '완료', IN_PROGRESS: '진행 중', PLANNED: '예정'
}[status]);

const awardLabel = (status: WorkflowProject['awardStatus']) => ({
  WON: '수주 확정', PENDING: '회신 대기', LOST: '미수주'
}[status]);

const actionForStage = (stageId: WorkflowStageId, project: WorkflowProject) => {
  const projectId = encodeURIComponent(project.id);
  const caseId = encodeURIComponent(project.caseId);
  switch (stageId) {
    case 1: return { label: '제안서 작성 열기', path: `/proposals/editor?caseId=${caseId}&projectId=${projectId}` };
    case 2: return { label: '프로젝트 접수 열기', path: `/workflow/award?caseId=${caseId}&projectId=${projectId}` };
    case 3: return { label: '착수회의·회의록 열기', path: `/meetings?caseId=${caseId}&projectId=${projectId}` };
    case 4: return { label: '현장자료 업로드 열기', path: `/cases/files?caseId=${caseId}&projectId=${projectId}` };
    case 5: return { label: '수량산출·내역 화면 열기', path: `/workflow/quantity?projectId=${projectId}` };
    case 6: return { label: 'AI 보고서 스튜디오 열기', path: `/reports/studio?caseId=${caseId}&projectId=${projectId}` };
  }
};

interface ProjectWorkflowScheduleProps {
  routeId: string;
  onNavigate: (path: string) => void;
}

export const ProjectWorkflowSchedule: React.FC<ProjectWorkflowScheduleProps> = ({ routeId, onNavigate }) => {
  const [viewMode, setViewMode] = useState<'month' | '30days'>('month');
  const [monthCursor, setMonthCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [projects, setProjects] = useState<WorkflowProject[]>([]);
  const [liveError, setLiveError] = useState('');
  const [projectPrintOpen, setProjectPrintOpen] = useState(false);
  const focusedStageId = workflowStageFromRoute(routeId);
  const routeParams = new URLSearchParams(window.location.search);
  const requestedProjectId = routeParams.get('projectId');
  const erpSyncStatus = routeParams.get('erpSync');
  const [erpState, setErpState] = useState(erpSyncStatus ?? '');
  const [erpRetryBusy, setErpRetryBusy] = useState(false);
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === requestedProjectId) ?? projects[0],
    [projects, requestedProjectId]
  );
  const showOverview = routeId === 'PROJ-01';
  const focusedStage = WORKFLOW_STAGES.find((stage) => stage.id === focusedStageId);
  const isProjectDialogOpen = showOverview && Boolean(requestedProjectId);
  const calendarYear = monthCursor.getFullYear();
  const calendarMonthIndex = monthCursor.getMonth();
  const calendarDays = useMemo(
    () => Array.from({ length: new Date(calendarYear, calendarMonthIndex + 1, 0).getDate() }, (_, index) => index + 1),
    [calendarMonthIndex, calendarYear]
  );
  const calendarDayDetails = useMemo(
    () => new Map(calendarDays.map((day) => [day, scheduleDayInfo(calendarYear, calendarMonthIndex, day)])),
    [calendarDays, calendarMonthIndex, calendarYear]
  );
  const now = new Date();
  const todayDay = now.getFullYear() === calendarYear && now.getMonth() === calendarMonthIndex ? now.getDate() : undefined;

  const loadProjects = async () => {
    try {
      const result = await apiRequest<{ projects: WorkflowProject[]; dataBasis: string }>('/api/project-workflow/schedule');
      setProjects(result.projects); setLiveError('');
    } catch (reason) {
      setLiveError(reason instanceof Error ? reason.message : '프로젝트를 불러오지 못했습니다.');
    }
  };

  useEffect(() => {
    let active = true;
    apiRequest<{ projects: WorkflowProject[]; dataBasis: string }>('/api/project-workflow/schedule')
      .then((result) => { if (active) { setProjects(result.projects); setLiveError(''); } })
      .catch((reason) => { if (active) setLiveError(reason instanceof Error ? reason.message : '프로젝트를 불러오지 못했습니다.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => { setErpState(erpSyncStatus ?? ''); }, [erpSyncStatus]);

  useEffect(() => {
    if (!isProjectDialogOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onNavigate('/projects/schedule');
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isProjectDialogOpen, onNavigate]);

  if (!selectedProject) return <section className="workflow-page" aria-label="프로젝트 일정표">
    <header className="workflow-hero"><div><span className="workflow-kicker">CLAIM DELIVERY WORKFLOW</span><h2>프로젝트 통합 일정표</h2><p>제안서부터 보고서 작성까지 실제 업무 기록을 연결합니다.</p></div></header>
    {liveError ? <p className="error-box" role="alert">{liveError}</p> : <p className="empty-box">등록된 프로젝트를 불러오는 중이거나 아직 프로젝트 의뢰가 없습니다.</p>}
  </section>;

  const openProjectDialog = (project: WorkflowProject) => {
    onNavigate(`/projects/schedule?projectId=${encodeURIComponent(project.id)}`);
  };

  const navigateAction = (stageId: WorkflowStageId) => {
    const action = actionForStage(stageId, selectedProject);
    if (action.path.startsWith('#')) {
      document.querySelector(action.path)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    onNavigate(action.path);
  };

  const retryErpSync = async () => {
    setErpRetryBusy(true);
    try {
      const result = await apiRequest<{ erpSync: { status: 'PENDING' | 'SYNCED' | 'FAILED' } }>(`/api/project-workflow/projects/${encodeURIComponent(selectedProject.caseId)}/erp-sync`, { method:'POST' });
      setErpState(result.erpSync.status);
      setLiveError('');
    } catch (reason) {
      setLiveError(reason instanceof Error ? reason.message : 'ERP 프로젝트 등록을 재시도하지 못했습니다.');
    } finally { setErpRetryBusy(false); }
  };

  const openSchedulePrint = (projectId = '') => {
    const month = `${calendarYear}-${String(calendarMonthIndex + 1).padStart(2, '0')}`;
    const query = new URLSearchParams({ month, lang: 'ko', colorMode: 'color' });
    if (projectId) query.set('projectId', projectId);
    // noopener deliberately returns null even when the tab opens successfully.
    window.open(`/print/projects/month-a4?${query}`, '_blank', 'noopener,noreferrer');
    setProjectPrintOpen(false);
  };

  return (
    <section className="workflow-page" aria-labelledby="workflow-page-title">
      {!showOverview && <nav className="project-context-strip" aria-label="현재 프로젝트 경로">
        <button type="button" onClick={() => onNavigate('/projects/schedule')}>프로젝트 워크</button>
        <span aria-hidden="true">›</span>
        <button type="button" onClick={() => onNavigate('/projects/schedule')}>프로젝트 일정표</button>
        <span aria-hidden="true">›</span>
        <div><strong>{selectedProject.code}</strong><b>{selectedProject.name}</b></div>
        <em>{focusedStage ? `${focusedStage.id}단계 · ${focusedStage.name}` : '전체 단계 워크플로우'}</em>
        <i aria-label={`전체 공정률 ${selectedProject.progress}%`}><span style={{ width: `${selectedProject.progress}%` }} /></i>
        <small>{selectedProject.progress}%</small>
      </nav>}
      <header className="workflow-hero">
        <div>
          <span className="workflow-kicker">CLAIM DELIVERY WORKFLOW</span>
          <h2 id="workflow-page-title">{showOverview ? '프로젝트 통합 일정표' : `${selectedProject.code} · 단계별 워크플로우`}</h2>
          <p>{showOverview
            ? '제안서부터 보고서 작성까지 프로젝트별 일정과 투입 팀을 한 화면에서 확인합니다.'
            : '작성된 제안서를 연결한 뒤 수주 확정, 착수회의, 현장조사, 산출, 보고서 작성으로 이어집니다.'}</p>
        </div>
        <div className="workflow-hero-actions">
          {!showOverview && <Button variant="secondary" onClick={() => onNavigate('/projects/schedule')}>← 전체 프로젝트</Button>}
          <span className="workflow-live-badge">실시간 프로젝트 · 신규 의뢰 자동 반영</span>
        </div>
      </header>

      {erpState && <div className={`erp-sync-banner is-${erpState.toLowerCase()}`} role="status">
        <strong>{erpState === 'SYNCED' ? 'ERP 프로젝트 등록 완료' : erpState === 'FAILED' ? '프로젝트 접수 완료 · ERP 재전송 대기' : '프로젝트 접수 완료 · ERP 연결 설정 대기'}</strong>
        <span>{erpState === 'SYNCED' ? 'ERP 본체에 수주 프로젝트가 등록되었습니다.' : '접수 기록은 안전하게 저장되었습니다. ERP 주소·인증키를 연결하면 같은 프로젝트 번호로 중복 없이 전송됩니다.'}</span>
        {erpState !== 'SYNCED' && <button type="button" disabled={erpRetryBusy} onClick={() => void retryErpSync()}>{erpRetryBusy ? 'ERP 확인 중…' : 'ERP 등록 다시 시도'}</button>}
      </div>}

      {liveError && <p className="error-box" role="alert">{liveError}</p>}

      {showOverview ? (
        <>
          <section className="schedule-control-panel" aria-label="일정표 보기 및 휴일 설정">
            <div className="schedule-toolbar">
              <div><strong>{calendarYear}년 {calendarMonthIndex + 1}월</strong><span>저장된 기준 일정만 표시</span></div>
              <div className="schedule-toolbar-actions">
                <Button className="schedule-print-launch" size="sm" onClick={() => openSchedulePrint()}>전체 일정표 출력</Button>
                <Button size="sm" variant="secondary" aria-expanded={projectPrintOpen} aria-controls="project-print-select" onClick={() => setProjectPrintOpen((open) => !open)}>프로젝트별 일정표 출력</Button>
                <Button size="sm" variant={viewMode === '30days' ? 'primary' : 'secondary'} onClick={() => setViewMode('30days')}>30일</Button>
                <Button size="sm" variant={viewMode === 'month' ? 'primary' : 'secondary'} onClick={() => setViewMode('month')}>월별 보기</Button>
                <Button size="sm" variant="secondary" onClick={() => setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>‹ 이전</Button>
                <Button size="sm" variant="secondary" onClick={() => setMonthCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>오늘</Button>
                <Button size="sm" variant="secondary" onClick={() => setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>다음 ›</Button>
              </div>
            </div>

            {projectPrintOpen && <label className="schedule-project-print-picker" htmlFor="project-print-select">출력할 프로젝트
              <select id="project-print-select" defaultValue="" onChange={(event) => { if (event.target.value) openSchedulePrint(event.target.value); }}>
                <option value="" disabled>프로젝트를 선택하세요</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}
              </select>
            </label>}

            <div className="schedule-holiday-guide" aria-label="한국과 베트남 휴일 표시 안내">
              <strong>한국 본사 · VIETQS 휴일 캘린더</strong>
              <span>날짜 칸의 무늬와 마우스 설명으로 어느 지사의 휴일인지 확인하세요.</span>
              <div><i className="legend-korean-holiday" />한국 공휴일</div>
              <div><i className="legend-vietnam-holiday" />베트남 휴일</div>
              <div><i className="legend-shared-holiday" />양국 공통 휴일</div>
            </div>
          </section>

          <div className="schedule-board" role="table" aria-label="프로젝트 월간 일정표">
            <div className="schedule-board-header" role="row">
              <div className="schedule-left-heading" role="columnheader">프로젝트 정보 <span>공정률</span></div>
              <div className="schedule-pm-cell is-heading" role="columnheader">담당 PM</div>
              <div className="schedule-days" role="row">
                {calendarDays.map((day) => {
                  const weekday = DAY_LABELS[new Date(calendarYear, calendarMonthIndex, day).getDay()];
                  const detail = calendarDayDetails.get(day)!;
                  return <div key={day} title={detail.label} className={`schedule-day ${detail.className} ${day === todayDay ? 'is-today' : ''}`} role="columnheader" aria-label={`${detail.iso} ${weekday}요일 · ${detail.label}`}><strong>{day}</strong><small>{weekday}</small>{detail.holidays.length > 0 && <b aria-hidden="true">{detail.hasKoreanHoliday && detail.hasVietnamHoliday ? 'KR·VN' : detail.hasKoreanHoliday ? 'KR' : 'VN'}</b>}</div>;
                })}
              </div>
            </div>
            {projects.map((project) => (
              <div className="schedule-project-row" role="row" key={project.id}>
                <button className="schedule-project-info" role="cell" onClick={() => openProjectDialog(project)} aria-haspopup="dialog">
                  <span className={`award-dot award-${project.awardStatus.toLowerCase()}`} aria-hidden="true" />
                  <span className="schedule-project-copy"><strong>{project.name}{project.deliveryStatus === 'DELIVERED' && <em className="schedule-delivered-badge">납품완료</em>}</strong><small>{project.code} · {claimTypeLabel(project.claimType)} · {project.deliveryStatus === 'DELIVERED' ? 'Drive 최종 납품본 보관' : awardLabel(project.awardStatus)} · {project.responsiblePm ? `PM ${project.responsiblePm.name}` : 'PM 미지정'}</small></span>
                  <span className="schedule-progress"><b>{project.progress}%</b><i><em style={{ width: `${project.progress}%` }} /></i></span>
                </button>
                <div className="schedule-pm-cell" role="cell">{project.responsiblePm?.name ?? '미지정'}</div>
                <div className="schedule-track" role="cell" aria-label={`${project.name} ${project.start}부터 ${project.end}까지`}>
                  {calendarDays.map((day) => <span key={day} title={calendarDayDetails.get(day)?.label} className={`schedule-grid-cell ${calendarDayDetails.get(day)?.className ?? ''} ${day === todayDay ? 'is-today' : ''}`} />)}
                  {(() => {
                    const explicitStages = project.stages.filter((stage) => stage.scheduleExplicit && stage.startDate && stage.endDate);
                    const startDate = explicitStages.map((stage) => stage.startDate as string).sort()[0];
                    const endDate = explicitStages.map((stage) => stage.endDate as string).sort().at(-1);
                    const style = monthBarStyle(startDate, endDate, calendarYear, calendarMonthIndex, calendarDays.length);
                    return style ? <button
                    className="project-range-bar"
                    style={style}
                    onClick={() => openProjectDialog(project)}
                    aria-label={`${project.name} 프로젝트 상세 팝업 열기`}
                    aria-haspopup="dialog"
                  >
                    <span>{project.name}</span><b>{project.progress}%</b>
                  </button> : <span className="schedule-unscheduled">{explicitStages.length ? '이 달 일정 없음' : 'PM 일정 입력 필요'}</span>;
                  })()}
                </div>
              </div>
            ))}
          </div>

          <div className="schedule-legend" aria-label="일정표 범례">
            <span><i className="legend-project" />프로젝트 기간</span>
            <span><i className="legend-today" />오늘</span>
            <span><i className="legend-weekend" />주말</span>
            <span><i className="legend-korean-holiday" />한국 공휴일</span>
            <span><i className="legend-vietnam-holiday" />베트남 휴일</span>
            <span>프로젝트를 클릭하면 1~6단계 세부 작업과 팀 배정이 열립니다.</span>
          </div>

          <div className="workflow-summary" aria-label="프로젝트 일정 요약">
            <article><span>전체 프로젝트</span><strong>{projects.length}</strong><small>실제 단계 기록만 표시</small></article>
            <article><span>수주 검토</span><strong>{projects.filter((project) => project.awardStatus === 'PENDING').length}</strong><small>의뢰·제안서 회신 대기</small></article>
            <article><span>팀 배정 프로젝트</span><strong>{projects.filter((project) => project.stages.some((stage) => stage.stageId === 5 && stage.status !== 'PLANNED')).length}</strong><small>실제 수량산출·내역 투입 기록</small></article>
            <article><span>보고서 작성 대기</span><strong>{projects.filter((project) => project.stages.some((stage) => stage.stageId === 6 && stage.status !== 'DONE')).length}</strong><small>전담 작성자 5명</small></article>
          </div>

          <aside className="schedule-manager-callout" aria-label="PM과 일정 설정 사용 방법">
            <span aria-hidden="true">PM</span>
            <div><strong>프로젝트별 담당 PM·기준 일정 설정</strong><p>캘린더 프로젝트의 PM·일정 설정 팝업에서 담당 PM 지정과 착수회의·현장조사·물량산출·보고서 작성의 시작일·종료일, 프로젝트 특이사항을 바로 저장하고 수정할 수 있습니다.</p></div>
          </aside>

          {isProjectDialogOpen && (
            <div
              className="project-detail-modal-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) onNavigate('/projects/schedule');
              }}
            >
              <section
                className="project-detail-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="project-detail-modal-title"
                aria-describedby="project-detail-modal-description"
              >
                <header className="project-detail-modal__header">
                  <div>
                    <span>SELECTED PROJECT · 1~6단계 워크플로우</span>
                    <h3 id="project-detail-modal-title">{selectedProject.code} · {selectedProject.name}</h3>
                    <p id="project-detail-modal-description">현재 선택한 프로젝트의 일정, 단계별 담당자, 투입 팀을 확인합니다.</p>
                  </div>
                  <div className="project-detail-modal__identity" aria-label="선택 프로젝트 요약">
                    <b>{awardLabel(selectedProject.awardStatus)}</b>
                    <strong>{selectedProject.progress}%</strong>
                    <small>{selectedProject.start && selectedProject.end ? `${selectedProject.start} ~ ${selectedProject.end}` : '프로젝트 일정 미입력'}</small>
                  </div>
                  <button type="button" className="project-detail-modal__close" onClick={() => onNavigate('/projects/schedule')} autoFocus aria-label="프로젝트 상세 팝업 닫기">×</button>
                </header>
                <div className="project-detail-modal__body">
                  <section className="project-modal-highlights" aria-label={`${selectedProject.name} 프로젝트 특이사항`}><b>프로젝트 특이사항</b><div>{selectedProject.highlights.map((highlight)=><em key={highlight.label} data-tone={highlight.tone}>{highlight.label}</em>)}</div></section>
                  <ProjectDetail
                    project={selectedProject}
                    focusedStageId={focusedStageId}
                    onNavigate={onNavigate}
                    onAction={navigateAction}
                    onReload={loadProjects}
                    onClose={() => onNavigate('/projects/schedule')}
                    calendar={{ year: calendarYear, monthIndex: calendarMonthIndex, days: calendarDays, todayDay }}
                  />
                </div>
              </section>
            </div>
          )}
        </>
      ) : (
        <ProjectDetail
          project={selectedProject}
          focusedStageId={focusedStageId}
          onNavigate={onNavigate}
          onAction={navigateAction}
          onReload={loadProjects}
          calendar={{ year: calendarYear, monthIndex: calendarMonthIndex, days: calendarDays, todayDay }}
        />
      )}
    </section>
  );
};

const ProjectDetail: React.FC<{
  project: WorkflowProject;
  focusedStageId?: WorkflowStageId;
  onNavigate: (path: string) => void;
  onAction: (stageId: WorkflowStageId) => void;
  onReload: () => Promise<void>;
  onClose?: () => void;
  calendar: { year: number; monthIndex: number; days: number[]; todayDay?: number };
}> = ({ project, focusedStageId, onNavigate, onAction, onReload, onClose, calendar }) => {
  const openProjectPrint = () => {
    const firstStageDate = project.stages.find((item)=>item.scheduleExplicit&&item.startDate)?.startDate?.slice(0,7);
    const month = firstStageDate ?? `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
    window.open(`/print/projects/month-a4?month=${month}&lang=ko&colorMode=color&projectId=${encodeURIComponent(project.id)}`, '_blank', 'noopener,noreferrer');
  };
  const selectedStage = WORKFLOW_STAGES.find((stage) => stage.id === focusedStageId);
  const timeline = useMemo(() => buildProjectTimeline(project, calendar.year, calendar.monthIndex), [calendar.monthIndex, calendar.year, project]);
  const timelineWidth = timeline.days.length * 44;
  const timelineStyle = { '--detail-timeline-width': `${timelineWidth}px`, '--detail-day-count': timeline.days.length } as React.CSSProperties;
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const [pmOptions, setPmOptions] = useState<Array<{ id: string; displayName: string; email: string }>>([]);
  const [pmId, setPmId] = useState(project.responsiblePm?.id ?? '');
  const [scheduleBusy, setScheduleBusy] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleNotice, setScheduleNotice] = useState('');
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveReadiness, setArchiveReadiness] = useState<ProjectArchiveReadiness | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveReason, setArchiveReason] = useState('납품 완료 및 Google Drive 보관 상태 확인 후 일정표에서 보관 처리');
  const [drafts, setDrafts] = useState<Record<string, { startDate: string; endDate: string; status: string; noteText: string; reasonText: string }>>(() => Object.fromEntries(
    project.stages.filter((stage) => Number(stage.stageId) >= 3).map((stage) => [stage.stageCode ?? '', { startDate: stage.startDate ?? '', endDate: stage.endDate ?? '', status: stage.scheduleStatus ?? 'PLANNED', noteText: stage.scheduleNote ?? '', reasonText: '' }])
  ));

  useEffect(() => {
    let active = true;
    apiRequest<{ users: Array<{ id: string; displayName: string; email: string }> }>(`/api/project-workflow/pm-options?caseId=${encodeURIComponent(project.caseId)}`)
      .then((result) => { if (active) setPmOptions(result.users); })
      .catch(() => { if (active) setPmOptions([]); });
    return () => { active = false; };
  }, [project.caseId]);

  useEffect(() => {
    setPmId(project.responsiblePm?.id ?? '');
    setDrafts(Object.fromEntries(
      project.stages
        .filter((stage) => Number(stage.stageId) >= 3)
        .map((stage) => [stage.stageCode ?? '', {
          startDate: stage.startDate ?? '',
          endDate: stage.endDate ?? '',
          status: stage.scheduleStatus ?? 'PLANNED',
          noteText: stage.scheduleNote ?? '',
          reasonText: ''
        }])
    ));
  }, [project]);

  const savePm = async () => {
    if (!pmId) return;
    setScheduleBusy('pm'); setScheduleError(''); setScheduleNotice('');
    try {
      await apiRequest(`/api/project-workflow/projects/${encodeURIComponent(project.caseId)}/profile`, { method: 'PUT', body: JSON.stringify({ responsiblePmId: pmId, expectedProfileVersion: project.profileVersion ?? 0 }) });
      setScheduleNotice('담당 PM을 저장했습니다. 이제 PM이 단계별 일정을 직접 관리합니다.'); await onReload();
    } catch (reason) { setScheduleError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setScheduleBusy(''); }
  };

  const ensurePmAssigned = async () => {
    if (!pmId) throw new Error('담당 PM을 먼저 선택해 주세요.');
    if (project.responsiblePm?.id === pmId) return;
    await apiRequest(`/api/project-workflow/projects/${encodeURIComponent(project.caseId)}/profile`, {
      method: 'PUT',
      body: JSON.stringify({ responsiblePmId: pmId, expectedProfileVersion: project.profileVersion ?? 0 })
    });
  };

  const saveStage = async (stageCode: string, expectedVersion: number) => {
    const draft = drafts[stageCode]; if (!draft?.startDate || !draft.endDate) return;
    if (draft.endDate < draft.startDate) { setScheduleError('종료일은 시작일보다 빠를 수 없습니다.'); return; }
    setScheduleBusy(stageCode); setScheduleError(''); setScheduleNotice('');
    try {
      await ensurePmAssigned();
      await apiRequest(`/api/project-workflow/projects/${encodeURIComponent(project.caseId)}/stages/${stageCode}`, { method: 'PUT', body: JSON.stringify({ startDate: draft.startDate, endDate: draft.endDate, status: draft.status, noteText: draft.noteText, expectedVersion }) });
      setScheduleNotice('일정을 저장했습니다. 착수회의·현장조사·물량산출 화면과 프로젝트 캘린더에 같은 날짜가 즉시 반영됩니다.'); await onReload();
    } catch (reason) { setScheduleError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setScheduleBusy(''); }
  };

  const saveAllStages = async () => {
    const items = project.stages.filter((stage) => stage.stageCode && PROJECT_SCHEDULE_CODES.includes(stage.stageCode));
    const filled = items.filter((stage) => {
      const draft = drafts[stage.stageCode ?? ''];
      return Boolean(draft?.startDate || draft?.endDate);
    });
    if (!pmId) { setScheduleError('담당 PM을 먼저 선택해 주세요.'); return; }
    if (!filled.length) { setScheduleError('저장할 단계의 시작일과 종료일을 입력해 주세요.'); return; }
    const invalid = filled.find((stage) => {
      const draft = drafts[stage.stageCode ?? ''];
      return !draft?.startDate || !draft.endDate || draft.endDate < draft.startDate;
    });
    if (invalid) { setScheduleError('입력한 모든 단계의 시작일·종료일을 확인해 주세요.'); return; }
    if (!window.confirm('입력한 단계 일정을 저장하고 프로젝트 캘린더와 각 업무 화면에 반영할까요?')) return;
    setScheduleBusy('all'); setScheduleError(''); setScheduleNotice('');
    try {
      await ensurePmAssigned();
      await apiRequest(`/api/project-workflow/projects/${encodeURIComponent(project.caseId)}/stages`, {
        method: 'PUT',
        body: JSON.stringify({
          items: filled.map((stage) => {
            const stageCode = stage.stageCode ?? '';
            const draft = drafts[stageCode];
            return { stageCode, startDate: draft.startDate, endDate: draft.endDate, status: draft.status, noteText: draft.noteText, expectedVersion: stage.scheduleVersion ?? 0 };
          })
        })
      });
      setScheduleNotice(`${filled.length}개 단계 일정을 저장 완료했습니다. 모든 업무 화면이 이 기준 일정을 함께 사용합니다.`);
      await onReload();
    } catch (reason) { setScheduleError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setScheduleBusy(''); }
  };

  const requestChange = async (stageCode: string, expectedVersion: number) => {
    const draft = drafts[stageCode]; if (!draft?.startDate || !draft.endDate || draft.reasonText.trim().length < 2) return;
    setScheduleBusy(`request:${stageCode}`); setScheduleError(''); setScheduleNotice('');
    try {
      await apiRequest(`/api/project-workflow/projects/${encodeURIComponent(project.caseId)}/change-requests`, { method: 'POST', headers: { 'Idempotency-Key': `schedule-${project.caseId}-${stageCode}-${expectedVersion}-${draft.startDate}-${draft.endDate}` }, body: JSON.stringify({ stageCode, proposedStartDate: draft.startDate, proposedEndDate: draft.endDate, reasonText: draft.reasonText, expectedScheduleVersion: expectedVersion }) });
      setScheduleNotice('일정 변경 메모를 담당 PM에게 보냈습니다. PM 승인 전까지 기준 일정은 바뀌지 않습니다.'); await onReload();
    } catch (reason) { setScheduleError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setScheduleBusy(''); }
  };

  const decideChange = async (requestId: string, decision: 'APPROVED' | 'REJECTED') => {
    setScheduleBusy(`decision:${requestId}`); setScheduleError(''); setScheduleNotice('');
    try {
      await apiRequest(`/api/project-workflow/change-requests/${encodeURIComponent(requestId)}/decision`, { method: 'POST', body: JSON.stringify({ decision, reviewNote: decision === 'APPROVED' ? '담당 PM 일정 반영 승인' : '담당 PM 일정 변경 반려' }) });
      setScheduleNotice(decision === 'APPROVED' ? '승인한 날짜로 프로젝트 일정이 자동 변경됐습니다.' : '변경 요청을 반려했습니다.'); await onReload();
    } catch (reason) { setScheduleError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setScheduleBusy(''); }
  };

  const openArchiveDialog = async () => {
    setArchiveDialogOpen(true); setArchiveReadiness(null); setArchiveBusy(true); setScheduleError('');
    try {
      const result = await apiRequest<{ readiness: ProjectArchiveReadiness }>(`/api/project-workflow/projects/${encodeURIComponent(project.caseId)}/archive-readiness`);
      setArchiveReadiness(result.readiness);
    } catch (reason) { setScheduleError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setArchiveBusy(false); }
  };

  const hideDeliveredProject = async () => {
    if (!archiveReadiness?.complete) return;
    setArchiveBusy(true); setScheduleError('');
    try {
      await apiRequest(`/api/project-workflow/projects/${encodeURIComponent(project.caseId)}/schedule-visibility`, {
        method: 'POST',
        body: JSON.stringify({ reasonCode: 'DELIVERED_ARCHIVED', reasonText: archiveReason.trim(), manifestSha256: archiveReadiness.manifestSha256, expectedVersion: project.scheduleVisibilityVersion ?? 0 })
      });
      setArchiveDialogOpen(false);
      await onReload();
      onClose?.();
    } catch (reason) {
      setScheduleError(reason instanceof Error ? reason.message : String(reason));
      try {
        const latest = await apiRequest<{ readiness: ProjectArchiveReadiness }>(`/api/project-workflow/projects/${encodeURIComponent(project.caseId)}/archive-readiness`);
        setArchiveReadiness(latest.readiness);
      } catch { /* keep the original actionable error */ }
    } finally { setArchiveBusy(false); }
  };

  return (
    <>
      <div className="project-workflow-summary">
        <div><span>거래처</span><strong>{project.client}</strong></div>
        <div><span>업무 유형</span><strong>{claimTypeLabel(project.claimType)}</strong></div>
        <div><span>수주·납품 상태</span><strong>{project.deliveryStatus === 'DELIVERED' ? '납품완료' : awardLabel(project.awardStatus)}</strong></div>
        <div><span>전체 공정률</span><strong>{project.progress}%</strong></div>
        <div><span>프로젝트 기간</span><strong>{project.start && project.end ? `${project.start} ~ ${project.end}` : '일정 입력 필요'}</strong></div>
      </div>

      <section className="project-schedule-manager" aria-labelledby="project-schedule-manager-title">
        <header><div><span>RESPONSIBLE PM · EXPLICIT SCHEDULE</span><h3 id="project-schedule-manager-title">담당 PM과 단계별 기준 일정</h3><p>아래에 저장한 날짜만 캘린더와 직원 홈 알림의 기준이 됩니다. 자동으로 만든 임의 날짜는 사용하지 않습니다.</p></div><strong>{project.responsiblePm?.name ?? 'PM 미지정'}</strong></header>
        <div className="project-pm-control"><label>프로젝트 담당 PM<select value={pmId} onChange={(event) => setPmId(event.target.value)}><option value="">담당 PM 선택</option>{pmOptions.map((option) => <option value={option.id} key={option.id}>{option.displayName} · {option.email}</option>)}</select></label><Button onClick={() => void savePm()} disabled={!pmId || scheduleBusy === 'pm'}>{scheduleBusy === 'pm' ? '저장 중…' : project.responsiblePm ? '담당 PM 변경' : '담당 PM 지정'}</Button></div>
        {!project.responsiblePm && <p className="schedule-policy-note">담당 PM을 선택한 뒤 아래 날짜를 입력하고 <strong>전체 일정 저장 완료</strong>를 누르세요. PM 지정과 일정 저장을 한 번에 처리합니다.</p>}
        <div className="project-stage-editor-list">
          {project.stages.filter((stage) => stage.stageCode && ['KICKOFF','SITE_SURVEY','TAKEOFF_COST','REPORT_WRITING'].includes(stage.stageCode)).map((item) => {
            const stage = WORKFLOW_STAGES.find((candidate) => candidate.id === item.stageId);
            const code = item.stageCode ?? '';
            const draft = drafts[code] ?? { startDate:'',endDate:'',status:'PLANNED',noteText:'',reasonText:'' };
            const setDraft = (next: Partial<typeof draft>) => setDrafts((current) => ({ ...current, [code]: { ...draft, ...next } }));
            return <article key={code} style={{ '--stage-accent': stage?.color } as React.CSSProperties}>
              <header><span className="stage-number" style={{ background: stage?.color }}>{item.stageId}</span><div><strong>{stage?.name}</strong><small>{item.scheduleExplicit ? `저장된 기준 일정 · v${item.scheduleVersion}` : '일정 미입력'}</small></div><em>{item.owner}</em></header>
              <div className="project-stage-fields"><label>시작일<input type="date" value={draft.startDate} onChange={(event) => setDraft({ startDate:event.target.value })} /></label><label>종료일<input type="date" value={draft.endDate} min={draft.startDate} onChange={(event) => setDraft({ endDate:event.target.value })} /></label><label>상태<select value={draft.status} onChange={(event) => setDraft({ status:event.target.value })}><option value="PLANNED">예정</option><option value="IN_PROGRESS">진행 중</option><option value="COMPLETED">완료</option><option value="DELAYED">지연</option></select></label><label className="project-stage-note">일정 메모<input value={draft.noteText} maxLength={5000} placeholder="현장·팀·마감 특이사항" onChange={(event) => setDraft({ noteText:event.target.value })} /></label></div>
              {project.canManageSchedule ? <div className="project-stage-actions"><Button className="stage-schedule-save-button" size="sm" onClick={() => void saveStage(code,item.scheduleVersion ?? 0)} disabled={!pmId || !draft.startDate || !draft.endDate || Boolean(scheduleBusy)}>{scheduleBusy === code ? '저장 중…' : item.scheduleExplicit ? '수정 내용 저장' : '일정 저장'}</Button></div> : <div className="project-change-request"><label>일정 변경 사유<input value={draft.reasonText} maxLength={5000} placeholder="담당 PM에게 보낼 변경 사유를 입력하세요" onChange={(event) => setDraft({ reasonText:event.target.value })} /></label><Button size="sm" variant="secondary" onClick={() => void requestChange(code,item.scheduleVersion ?? 0)} disabled={!project.responsiblePm || !draft.startDate || !draft.endDate || draft.reasonText.trim().length < 2 || scheduleBusy === `request:${code}`}>PM에게 변경 승인 요청</Button></div>}
            </article>;
          })}
        </div>
        {Boolean(project.pendingChangeRequests?.length) && <section className="pending-schedule-requests"><h4>담당 PM 승인 대기</h4>{project.pendingChangeRequests?.map((request) => <article key={request.id}><div><strong>{request.requestedByName} · {WORKFLOW_STAGES.find((stage) => stage.id === ({KICKOFF:3,SITE_SURVEY:4,TAKEOFF_COST:5,REPORT_WRITING:6} as Record<string,number>)[request.stageCode])?.name}</strong><span>{request.proposedStartDate} ~ {request.proposedEndDate}</span><p>{request.reasonText}</p></div>{project.canManageSchedule && <div><Button size="sm" onClick={() => void decideChange(request.id,'APPROVED')} disabled={scheduleBusy === `decision:${request.id}`}>승인·일정 반영</Button><Button size="sm" variant="secondary" onClick={() => void decideChange(request.id,'REJECTED')} disabled={scheduleBusy === `decision:${request.id}`}>반려</Button></div>}</article>)}</section>}
        {scheduleNotice && <p className="notice-box" role="status">{scheduleNotice}</p>}{scheduleError && <p className="error-box" role="alert">{scheduleError}</p>}
        {project.canManageSchedule && <footer className="project-schedule-completion-actions">{project.canRemoveFromSchedule && <Button className="schedule-archive-button" variant="secondary" onClick={() => void openArchiveDialog()} disabled={Boolean(scheduleBusy)}>Drive 확인 후 일정표 보관</Button>}<Button variant="secondary" onClick={openProjectPrint}>이 프로젝트 상세 일정 출력</Button><Button variant="secondary" onClick={() => onReload()} disabled={Boolean(scheduleBusy)}>최신 일정 다시 불러오기</Button><Button className="schedule-complete-button" onClick={() => void saveAllStages()} disabled={!pmId || Boolean(scheduleBusy)}>{scheduleBusy === 'all' ? '전체 일정 저장 중…' : '전체 일정 저장 완료'}</Button>{onClose && <Button className="schedule-confirm-button" variant="secondary" onClick={onClose} disabled={Boolean(scheduleBusy)}>확인하고 닫기</Button>}</footer>}
      </section>

      {selectedStage && (
        <article className="focused-stage-card" style={{ borderColor: selectedStage.color }}>
          <span>{selectedStage.eyebrow}</span>
          <h3>{selectedStage.id}. {selectedStage.name}</h3>
          <p>{selectedStage.description}</p>
          <Button onClick={() => onAction(selectedStage.id)}>{actionForStage(selectedStage.id, project).label}</Button>
        </article>
      )}

      <div className="detail-schedule-board" style={timelineStyle} role="table" aria-label={`${project.name} 1단계부터 6단계까지 일정`}>
        <div className="detail-schedule-header" role="row">
          <div className="detail-schedule-label" role="columnheader"><strong>1~6단계 업무 · 담당</strong><small>{timeline.days[0]?.iso} ~ {timeline.days.at(-1)?.iso}</small></div>
          <div className="detail-calendar-header">
            <div className="schedule-months" aria-label="프로젝트 월 구분">
              {timeline.months.map((month) => <div key={month.key} style={{ width: `${month.dayCount * 44}px` }}>{month.label}</div>)}
            </div>
            <div className="schedule-days" style={{ gridTemplateColumns: `repeat(${timeline.days.length}, 44px)` }} role="row">
              {timeline.days.map((day) => {
                const detail = scheduleDayInfo(day.year, day.monthIndex, day.day);
                const weekday = DAY_LABELS[new Date(Date.UTC(day.year, day.monthIndex, day.day)).getUTCDay()];
                return <div key={day.iso} title={detail.label} className={`schedule-day ${detail.className} ${day.iso === todayIso ? 'is-today' : ''}`} role="columnheader" aria-label={`${detail.iso} ${weekday}요일 · ${detail.label}`}><strong>{day.day}</strong><small>{weekday}</small>{detail.holidays.length > 0 && <b aria-hidden="true">{detail.hasKoreanHoliday && detail.hasVietnamHoliday ? 'KR·VN' : detail.hasKoreanHoliday ? 'KR' : 'VN'}</b>}</div>;
              })}
            </div>
          </div>
        </div>
        {WORKFLOW_STAGES.map((stage) => {
          const item = project.stages.find((candidate) => candidate.stageId === stage.id);
          if (!item) return null;
          return (
            <div className={`workflow-stage-row ${focusedStageId === stage.id ? 'is-focused' : ''}`} role="row" key={stage.id}>
              <button className="workflow-stage-info" role="cell" onClick={() => onNavigate(`${stage.path}?projectId=${encodeURIComponent(project.id)}`)}>
                <span className="stage-number" style={{ background: stage.color }}>{stage.id}</span>
                <span><strong>{stage.name}</strong><small>{item.owner}</small><em>{item.detail}</em></span>
                <b className={`stage-status status-${item.status.toLowerCase()}`}>{statusLabel(item.status)}</b>
              </button>
              <div className="schedule-track" role="cell">
                {timeline.days.map((day) => {
                  const detail = scheduleDayInfo(day.year, day.monthIndex, day.day);
                  return <span key={day.iso} title={detail.label} className={`schedule-grid-cell ${detail.className} ${day.iso === todayIso ? 'is-today' : ''}`} />;
                })}
                {item.scheduleExplicit && timelineBarStyle(item.startDate, item.endDate, timeline.days) ? <button
                  className={`stage-range-bar status-${item.status.toLowerCase()}`}
                  style={{ ...timelineBarStyle(item.startDate, item.endDate, timeline.days), backgroundColor: stage.color }}
                  onClick={() => onNavigate(`${stage.path}?projectId=${encodeURIComponent(project.id)}`)}
                >
                  <span>{item.startDate ?? `${item.startDay}일`} ~ {item.endDate ?? `${item.endDay}일`}</span>
                </button>
                : <span className="schedule-unscheduled">{item.scheduleExplicit ? '표시 범위 밖 일정' : '일정 미입력'}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog isOpen={archiveDialogOpen} title="납품완료 프로젝트를 일정표에서 보관할까요?" onClose={() => !archiveBusy && setArchiveDialogOpen(false)}>
        <div className="schedule-archive-dialog">
          <p>이 작업은 프로젝트나 파일을 물리 삭제하지 않습니다. Drive 보관 원장과 최종 납품본을 다시 확인한 뒤 일정표에서만 숨기며, 담당 PM·관리자 감사기록을 남깁니다.</p>
          {archiveBusy && !archiveReadiness ? <p className="notice-box">Google Drive 보관 원장을 확인하고 있습니다…</p> : <ul>{archiveReadiness?.checklist.map((item) => <li key={item.code} data-complete={item.complete}><span aria-hidden="true">{item.complete ? '✓' : '!'}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div></li>)}</ul>}
          <label>보관 사유<textarea value={archiveReason} maxLength={1000} onChange={(event) => setArchiveReason(event.target.value)} /></label>
          {archiveReadiness && !archiveReadiness.complete && <p className="error-box">완료되지 않은 항목이 있습니다. Drive 연결·업로드·최종 납품본 보관을 마친 뒤 다시 확인해 주세요.</p>}
          <footer><Button variant="secondary" onClick={() => setArchiveDialogOpen(false)} disabled={archiveBusy}>취소</Button><Button className="schedule-archive-confirm" onClick={() => void hideDeliveredProject()} disabled={archiveBusy || !archiveReadiness?.complete || archiveReason.trim().length < 2}>{archiveBusy ? '확인 중…' : '확인 완료 · 일정표에서 보관'}</Button></footer>
        </div>
      </Dialog>

    </>
  );
};
