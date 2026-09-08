import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../api';
import '../styles/CompactLibrary.css';

interface ReportWorkspace {
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  claimType: string;
  reportTitle: string;
  version: number;
  wizardStep: number;
  selectedChapterId: string | null;
  updatedAt: string;
  updatedByName: string;
  contentLength: number;
}

const STEP_LABELS = ['프로젝트·템플릿 확인', '목차 기획', '챕터별 AI 작성', '사람 검토·수정', '검토·승인·출력'] as const;

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function errorLabel(reason: unknown): string {
  if (reason instanceof ApiError && reason.status === 403) return '배정받은 프로젝트의 보고서만 볼 수 있습니다.';
  return reason instanceof Error ? reason.message : '저장된 보고서를 불러오지 못했습니다.';
}

export function ReportLibraryView({ mode, onNavigate }: { mode: 'projects' | 'database'; onNavigate: (path: string) => void }): React.ReactElement {
  const [workspaces, setWorkspaces] = useState<ReportWorkspace[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canDelete, setCanDelete] = useState(false);
  const [deleting, setDeleting] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const deletePending = useRef(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void apiRequest<{ workspaces: ReportWorkspace[]; canDelete?: boolean }>('/api/report-workspaces')
      .then((result) => { if (active) { setWorkspaces(result.workspaces); setCanDelete(result.canDelete === true); } })
      .catch((reason) => { if (active) setError(errorLabel(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  const deleteReport = async (workspace: ReportWorkspace) => {
    if (!canDelete || deletePending.current) return;
    if (!window.confirm(`${workspace.caseNumber} · ${workspace.caseTitle}\n보고서: ${workspace.reportTitle}\n\n이 보고서를 목록에서 삭제 처리할까요?\n프로젝트·Drive 원본 자료와 기존 버전 이력은 보존됩니다. 삭제 후에는 이어쓰기와 자동저장이 중지됩니다.`)) return;
    deletePending.current = true; setDeleting(workspace.caseId); setActionError(''); setNotice('');
    try {
      await apiRequest(`/api/report-workspaces/${encodeURIComponent(workspace.caseId)}/delete`, { method: 'POST', body: JSON.stringify({ expectedVersion: workspace.version }) });
      setWorkspaces(current => current.filter(item => item.caseId !== workspace.caseId));
      setNotice(`${workspace.caseNumber} 보고서를 목록에서 삭제 처리했습니다. 프로젝트·원본 자료와 기존 버전 이력은 보존됩니다.`);
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : '삭제하지 못했습니다. 다시 시도해 주세요.'); }
    finally { deletePending.current = false; setDeleting(''); }
  };

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('ko-KR');
    if (!keyword) return workspaces;
    return workspaces.filter((workspace) => [workspace.caseNumber, workspace.caseTitle, workspace.reportTitle, workspace.claimType, workspace.updatedByName]
      .some((value) => value.toLocaleLowerCase('ko-KR').includes(keyword)));
  }, [query, workspaces]);

  const completed = workspaces.filter((workspace) => workspace.wizardStep >= 5).length;
  const editing = workspaces.filter((workspace) => workspace.wizardStep < 5).length;

  return (
    <section className={`proposal-library report-library${mode === 'projects' ? ' compact-library' : ''}`} aria-labelledby="report-library-title">
      <header className="proposal-library__hero report-library__hero">
        <div>
          <span>{mode === 'projects' ? 'PROJECT REPORTS · WORKSPACE VIEW' : 'D1 REPORT VERSION LEDGER'}</span>
          <h2 id="report-library-title">{mode === 'projects' ? '프로젝트별 보고서 목록' : '보고서 DB관리'}</h2>
          <p>{mode === 'projects'
            ? '프로젝트별 저장 보고서와 현재 작성 단계를 모아 보고, 마지막으로 저장한 지점에서 즉시 이어서 작업합니다.'
            : '보고서 제목·버전·진행 단계·최근 편집자·저장 시각을 D1 기준으로 확인하는 관리자용 보고서 원장입니다.'}</p>
        </div>
        <div className="proposal-library__actions">
          <button type="button" onClick={() => onNavigate('/reports/studio')}>새 보고서 작성</button>
        </div>
      </header>

      <div className="proposal-library__summary" aria-label="저장 보고서 요약">
        <article><span>저장 프로젝트</span><strong>{workspaces.length}</strong><small>보고서 작업공간</small></article>
        <article><span>작성 진행 중</span><strong>{editing}</strong><small>1~4단계</small></article>
        <article><span>출력 단계</span><strong>{completed}</strong><small>5단계 도달</small></article>
        <article><span>전체 버전</span><strong>{workspaces.reduce((sum, item) => sum + item.version, 0)}</strong><small>프로젝트별 버전 합계</small></article>
      </div>

      <div className="proposal-library__filters report-library__filters">
        <label>통합 검색<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="프로젝트·보고서 제목·유형·작성자" /></label>
      </div>

      {error && <div className="proposal-library__message is-error" role="alert">{error}</div>}
      {actionError && <div className="report-delete-message is-error" role="alert">{actionError}<button type="button" disabled={Boolean(deleting)} onClick={() => { setActionError(''); setReload(value => value + 1); }}>목록 새로고침</button></div>}
      {notice && <div className="report-delete-message" role="status">{notice}</div>}
      {loading && <div className="proposal-library__message" role="status">보고서 작업공간을 불러오고 있습니다.</div>}
      {!loading && !error && filtered.length === 0 && <div className="proposal-library__empty"><strong>조건에 맞는 저장 보고서가 없습니다.</strong><span>보고서 작성 화면에서 첫 저장을 하면 이곳에 자동으로 나타납니다.</span><button type="button" onClick={() => onNavigate('/reports/studio')}>첫 보고서 작성하기</button></div>}

      {!loading && !error && mode === 'projects' && filtered.length > 0 && <div className="compact-record-list" aria-label="프로젝트별 보고서 목록">
        {filtered.map((workspace) => {
          const stepTitle = STEP_LABELS[Math.max(0, Math.min(4, workspace.wizardStep - 1))];
          return <article key={workspace.caseId} className="compact-record">
            <div className="compact-record__main"><span>{workspace.caseNumber} · {workspace.claimType}</span><h3 title={`${workspace.caseTitle}\n${workspace.reportTitle}`}>{workspace.reportTitle}</h3><small>{workspace.updatedByName} · {dateLabel(workspace.updatedAt)} · v{workspace.version} · 본문 {workspace.contentLength.toLocaleString('ko-KR')}자</small></div>
            <div className="compact-record__state"><em className="status-verified">STEP {workspace.wizardStep}</em><span>{stepTitle}</span></div>
            <div className="compact-record__actions"><button type="button" onClick={() => onNavigate(`/reports/studio?caseId=${encodeURIComponent(workspace.caseId)}`)}>저장 지점에서 이어쓰기</button></div>
          </article>;
        })}
      </div>}

      {!loading && !error && mode === 'database' && filtered.length > 0 && <div className="proposal-db-card report-db-card">
        <div className="proposal-db-card__note"><strong>D1 보고서 원장</strong><span>현재본은 자동 저장하며 각 저장 이력과 SHA-256은 보고서 작성 화면의 버전·근거 이력에서 확인합니다.</span></div>
        <div className="proposal-db-table" role="region" aria-label="보고서 데이터베이스 원장" tabIndex={0}>
          <table><thead><tr><th>프로젝트</th><th>보고서</th><th>진행 단계</th><th>버전·본문</th><th>최근 편집</th><th>작업</th></tr></thead><tbody>
            {filtered.map((workspace) => <tr key={workspace.caseId}>
              <td><strong>{workspace.caseNumber}</strong><span>{workspace.caseTitle}</span><small>{workspace.claimType}</small></td>
              <td><strong>{workspace.reportTitle}</strong><span>{workspace.selectedChapterId ?? '선택 챕터 없음'}</span></td>
              <td><em className="status-verified">STEP {workspace.wizardStep}</em><span>{STEP_LABELS[Math.max(0, Math.min(4, workspace.wizardStep - 1))]}</span></td>
              <td><strong>v{workspace.version}</strong><span>{workspace.contentLength.toLocaleString('ko-KR')}자</span></td>
              <td><strong>{workspace.updatedByName}</strong><span>{dateLabel(workspace.updatedAt)}</span></td>
              <td><div className="report-db-actions"><button type="button" disabled={Boolean(deleting)} onClick={() => onNavigate(`/reports/studio?caseId=${encodeURIComponent(workspace.caseId)}`)}>열기</button>{canDelete && <button type="button" className="is-danger" disabled={Boolean(deleting)} onClick={() => void deleteReport(workspace)}>{deleting === workspace.caseId ? '삭제 중…' : '삭제'}</button>}</div></td>
            </tr>)}
          </tbody></table>
        </div>
      </div>}
    </section>
  );
}
