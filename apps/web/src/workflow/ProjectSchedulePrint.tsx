import React, { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api';
import { claimTypeLabel } from '../claim-types';
import { scheduleDayInfo } from './schedule-holidays';
import { WORKFLOW_STAGES, type WorkflowProject } from './workflow-model';

type PrintLanguage = 'ko' | 'vi';
type PrintColorMode = 'color' | 'mono';

interface ProjectSchedulePrintProps {
  currentSearch: string;
  userName: string;
  onClose: () => void;
}

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const ROWS_PER_PAGE = 8;

const isoMonth = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const validMonth = (value: string | null): string => {
  if (value && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value)) return value;
  return isoMonth(new Date());
};

const monthBarStyle = (
  startDate: string | undefined,
  endDate: string | undefined,
  month: string,
  dayCount: number
): React.CSSProperties | undefined => {
  if (!startDate || !endDate) return undefined;
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(dayCount).padStart(2, '0')}`;
  if (endDate < monthStart || startDate > monthEnd) return undefined;
  const visibleStart = Number((startDate < monthStart ? monthStart : startDate).slice(8, 10));
  const visibleEnd = Number((endDate > monthEnd ? monthEnd : endDate).slice(8, 10));
  return {
    left: `${((visibleStart - 1) / dayCount) * 100}%`,
    width: `${((visibleEnd - visibleStart + 1) / dayCount) * 100}%`
  };
};

const scheduledRange = (project: WorkflowProject): { start?: string; end?: string } => {
  const stages = project.stages.filter((stage) => stage.scheduleExplicit && stage.startDate && stage.endDate);
  return {
    start: stages.map((stage) => stage.startDate as string).sort()[0],
    end: stages.map((stage) => stage.endDate as string).sort().at(-1)
  };
};

export function projectScheduleMonths(project: WorkflowProject | undefined, fallbackMonth: string): string[] {
  const validDate = (value: string | null | undefined): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
  const stages = project?.stages.filter((stage) => stage.scheduleExplicit && validDate(stage.startDate) && validDate(stage.endDate) && stage.endDate >= stage.startDate) ?? [];
  const dates = stages.flatMap((stage) => [stage.startDate!, stage.endDate!]).sort();
  if (!dates.length) return [fallbackMonth];
  const [startYear, startMonth] = dates[0].split('-').map(Number);
  const [endYear, endMonth] = dates.at(-1)!.split('-').map(Number);
  const first = startYear * 12 + startMonth - 1;
  const last = endYear * 12 + endMonth - 1;
  return Array.from({ length: last - first + 1 }, (_, offset) => {
    const index = first + offset;
    return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`;
  });
}

export function schedulePrintPages(projects: WorkflowProject[], selectedProjectId: string, month: string): Array<{ month: string; projects: WorkflowProject[] }> {
  if (selectedProjectId) {
    const project = projects.find((item) => item.id === selectedProjectId);
    return projectScheduleMonths(project, month).map((pageMonth) => ({ month: pageMonth, projects: project ? [project] : [] }));
  }
  return Array.from({ length: Math.max(1, Math.ceil(projects.length / ROWS_PER_PAGE)) }, (_, index) => ({ month, projects: projects.slice(index * ROWS_PER_PAGE, (index + 1) * ROWS_PER_PAGE) }));
}

const replacePrintQuery = (month: string, lang: PrintLanguage, colorMode: PrintColorMode, projectId: string) => {
  const query = new URLSearchParams({ month, lang, colorMode });
  if (projectId) query.set('projectId', projectId);
  window.history.replaceState(null, '', `/print/projects/month-a4?${query.toString()}`);
};

export function ProjectSchedulePrint({ currentSearch, userName, onClose }: ProjectSchedulePrintProps): React.ReactElement {
  const initialQuery = useMemo(() => new URLSearchParams(currentSearch), [currentSearch]);
  const selectedProjectId = initialQuery.get('projectId') ?? '';
  const [month, setMonth] = useState(() => validMonth(initialQuery.get('month')));
  const [language, setLanguage] = useState<PrintLanguage>(() => initialQuery.get('lang') === 'vi' ? 'vi' : 'ko');
  const [colorMode, setColorMode] = useState<PrintColorMode>(() => initialQuery.get('colorMode') === 'mono' ? 'mono' : 'color');
  const [projects, setProjects] = useState<WorkflowProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfGuide, setPdfGuide] = useState(false);

  const [year, monthNumber] = month.split('-').map(Number);
  const monthIndex = monthNumber - 1;
  const pages = useMemo(() => schedulePrintPages(projects, selectedProjectId, month), [projects, selectedProjectId, month]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiRequest<{ projects: WorkflowProject[] }>('/api/project-workflow/schedule')
      .then((result) => {
        if (!active) return;
        setProjects(selectedProjectId ? result.projects.filter((project) => project.id === selectedProjectId) : result.projects);
        setError('');
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : '프로젝트 일정을 불러오지 못했습니다.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedProjectId]);

  const updateMonth = (nextMonth: string) => {
    const safeMonth = validMonth(nextMonth);
    setMonth(safeMonth);
    replacePrintQuery(safeMonth, language, colorMode, selectedProjectId);
  };

  const updateLanguage = (nextLanguage: PrintLanguage) => {
    setLanguage(nextLanguage);
    replacePrintQuery(month, nextLanguage, colorMode, selectedProjectId);
  };

  const updateColorMode = (nextMode: PrintColorMode) => {
    setColorMode(nextMode);
    replacePrintQuery(month, language, nextMode, selectedProjectId);
  };

  const moveMonth = (offset: number) => {
    updateMonth(isoMonth(new Date(year, monthIndex + offset, 1)));
  };

  const printDocument = (asPdf = false) => {
    setPdfGuide(asPdf);
    window.setTimeout(() => window.print(), asPdf ? 120 : 0);
  };

  const todayText = new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'long', timeStyle: 'short'
  }).format(new Date());

  return <main className={`schedule-print-root is-${colorMode}`}>
    <header className="schedule-print-toolbar" aria-label="일정표 출력 설정">
      <div className="schedule-print-toolbar__title">
        <span aria-hidden="true">▦</span>
        <div><strong>프로젝트 일정표 출력</strong><small>A4 가로 · 현재 저장 일정 기준</small></div>
      </div>
      <div className="schedule-print-toolbar__controls">
        {!selectedProjectId && <><button type="button" onClick={() => moveMonth(-1)}>‹ 이전</button>
        <label>출력 월<input type="month" value={month} onChange={(event) => updateMonth(event.target.value)} /></label>
        <button type="button" onClick={() => moveMonth(1)}>다음 ›</button></>}
        {selectedProjectId && <span>전체 저장 기간 · 월별 1페이지</span>}
        <div className="schedule-print-toggle" aria-label="언어 선택">
          <button type="button" className={language === 'ko' ? 'is-active' : ''} onClick={() => updateLanguage('ko')}>한국어</button>
          <button type="button" className={language === 'vi' ? 'is-active' : ''} onClick={() => updateLanguage('vi')}>Tiếng Việt</button>
        </div>
        <div className="schedule-print-toggle" aria-label="색상 선택">
          <button type="button" className={colorMode === 'color' ? 'is-active' : ''} onClick={() => updateColorMode('color')}>컬러</button>
          <button type="button" className={colorMode === 'mono' ? 'is-active' : ''} onClick={() => updateColorMode('mono')}>흑백</button>
        </div>
        <button type="button" className="schedule-print-toolbar__pdf" onClick={() => printDocument(true)} disabled={loading || Boolean(error) || !projects.length}>PDF 저장</button>
        <button type="button" className="schedule-print-toolbar__print" onClick={() => printDocument(false)} disabled={loading || Boolean(error) || !projects.length}>인쇄</button>
        <button type="button" onClick={onClose}>닫기</button>
      </div>
    </header>

    {pdfGuide && <aside className="schedule-print-pdf-guide" role="status">
      인쇄 창의 <b>대상</b>에서 <b>PDF로 저장</b>, 레이아웃은 <b>가로</b>, 배율은 <b>페이지에 맞춤</b>을 선택하세요.
      <button type="button" onClick={() => setPdfGuide(false)}>확인</button>
    </aside>}
    {loading && <p className="schedule-print-status">프로젝트 일정을 불러오는 중입니다…</p>}
    {error && <p className="schedule-print-status is-error" role="alert">{error}</p>}

    <section className="schedule-print-pages" aria-label={selectedProjectId ? '프로젝트 전체 기간 월별 상세 일정표' : `${year}년 ${monthNumber}월 프로젝트 일정표`}>
      {!loading && !error && pages.map(({ month: pageMonth, projects: pageProjects }, pageIndex) => {
        const [year, monthNumber] = pageMonth.split('-').map(Number);
        const monthIndex = monthNumber - 1;
        const dayCount = new Date(year, monthNumber, 0).getDate();
        const days = Array.from({ length: dayCount }, (_, index) => index + 1);
        const project = pageProjects[0];
        return <article className={`schedule-print-sheet ${selectedProjectId ? 'is-detail' : 'is-overview'}`} key={`${pageMonth}-${pageIndex}`}>
        <header className="schedule-print-sheet__header">
          <div className="schedule-print-brand"><span>CONCOST</span><b>CLAIM CENTER STUDIO</b></div>
          <div><small>PROJECT DELIVERY · MONTHLY SCHEDULE</small><h1>{year}년 {monthNumber}월 {selectedProjectId ? '프로젝트 상세 일정표' : '프로젝트 통합 일정표'}</h1><p>{selectedProjectId && projects[0] ? `${projects[0].code} · ${projects[0].name} · PM ${projects[0].responsiblePm?.name ?? '미지정'}` : '수주 확정 프로젝트의 단계별 기준 일정 · 한국 본사 / VIETQS 휴일 통합'}</p></div>
          <dl><div><dt>출력 기준</dt><dd>{todayText}</dd></div><div><dt>출력자</dt><dd>{userName}</dd></div><div><dt>페이지</dt><dd>{pageIndex + 1} / {pages.length}</dd></div></dl>
        </header>

        {selectedProjectId && project ? <section className="schedule-print-identity" aria-label="프로젝트 정보">
          <h2>{project.name}</h2><p>{project.code} · 담당 PM: <strong>{project.responsiblePm?.name ?? '미지정'}</strong></p>
        </section> : !selectedProjectId && <section className="schedule-print-kpis" aria-label="일정 요약">
          <div><span>전체 프로젝트</span><strong>{projects.length}</strong></div>
          <div><span>수주 확정</span><strong>{projects.filter((project) => project.awardStatus === 'WON').length}</strong></div>
          <div><span>PM 미지정</span><strong>{projects.filter((project) => !project.responsiblePm).length}</strong></div>
          <div><span>일정 미입력</span><strong>{projects.filter((project) => !scheduledRange(project).start).length}</strong></div>
        </section>}

        <div className="schedule-print-calendar" role="table">
          <div className="schedule-print-calendar__head" role="row">
            <div role="columnheader">{selectedProjectId ? '단계 / 담당' : '프로젝트 / PM'}</div>
            {!selectedProjectId && <div className="schedule-print-pm" role="columnheader">담당 PM</div>}
            <div className="schedule-print-calendar__days" style={{ gridTemplateColumns: `repeat(${dayCount}, 1fr)` }} role="row">
              {days.map((day) => {
                const info = scheduleDayInfo(year, monthIndex, day);
                return <span key={day} className={info.className} title={info.label} role="columnheader"><b>{day}</b><small>{DAY_LABELS[new Date(year, monthIndex, day).getDay()]}</small>{info.holidays.length > 0 && <i>{info.hasKoreanHoliday && info.hasVietnamHoliday ? '양국' : info.hasKoreanHoliday ? 'KR' : 'VN'}</i>}</span>;
              })}
            </div>
          </div>
          {selectedProjectId && pageProjects[0] ? pageProjects[0].stages.map((stage) => {
            const stageInfo = WORKFLOW_STAGES.find((item) => item.id === stage.stageId);
            const barStyle = stage.scheduleExplicit ? monthBarStyle(stage.startDate ?? undefined, stage.endDate ?? undefined, pageMonth, dayCount) : undefined;
            return <div className="schedule-print-calendar__row" role="row" key={`${pageProjects[0].id}-${stage.stageId}`}>
              <div className="schedule-print-project" role="cell"><strong>{stage.stageId}. {stageInfo?.name ?? stage.stageCode ?? '업무 단계'}</strong><span>{stage.owner}</span><small>{stage.scheduleExplicit ? `${stage.startDate} ~ ${stage.endDate}` : '일정 미입력'}</small></div>
              <div className="schedule-print-track" style={{ gridTemplateColumns:`repeat(${dayCount}, 1fr)` }} role="cell">
                {days.map((day)=>{const info=scheduleDayInfo(year,monthIndex,day);return <span key={day} className={info.className}/>;})}
                {barStyle ? <div className="schedule-print-range" style={barStyle} title={`${stageInfo?.name} · ${stage.owner} · ${stage.startDate} ~ ${stage.endDate}`}><span>{stageInfo?.name ?? stage.stageCode}</span></div> : <em>{stage.scheduleExplicit ? '이 달에 해당 일정 없음' : '저장 일정 없음'}</em>}
              </div>
            </div>;
          }) : pageProjects.length ? pageProjects.map((project) => {
            const range = scheduledRange(project);
            const barStyle = monthBarStyle(range.start, range.end, pageMonth, dayCount);
            return <div className="schedule-print-calendar__row" role="row" key={project.id}>
              <div className="schedule-print-project" role="cell"><strong>{project.name}</strong><span>{project.code} · {claimTypeLabel(project.claimType)}</span><small>PM {project.responsiblePm?.name ?? '미지정'} · 공정률 {project.progress}%</small></div>
              <div className="schedule-print-pm" role="cell">{project.responsiblePm?.name ?? '미지정'}</div>
              <div className="schedule-print-track" style={{ gridTemplateColumns: `repeat(${dayCount}, 1fr)` }} role="cell">
                {days.map((day) => {
                  const info = scheduleDayInfo(year, monthIndex, day);
                  return <span key={day} className={info.className} />;
                })}
                {barStyle ? <div className="schedule-print-range" style={barStyle}><span>{project.name}</span><b>{project.progress}%</b></div> : <em>이 달의 저장 일정 없음</em>}
              </div>
            </div>;
          }) : <div className="schedule-print-empty">등록된 프로젝트가 없습니다.</div>}
        </div>

        <footer className="schedule-print-sheet__footer">
          <div className="schedule-print-legends"><span><i className="legend-project" />프로젝트 기간</span><span><i className="legend-weekend" />주말</span><span><i className="legend-korean-holiday" />한국 공휴일</span><span><i className="legend-vietnam-holiday" />베트남 휴일</span><span><i className="legend-shared-holiday" />양국 공통 휴일</span></div>
          <p>※ 일정 변경은 프로젝트 일정표에 저장된 최신 일정을 반영합니다.</p>
        </footer>
      </article>;})}
    </section>
  </main>;
}
