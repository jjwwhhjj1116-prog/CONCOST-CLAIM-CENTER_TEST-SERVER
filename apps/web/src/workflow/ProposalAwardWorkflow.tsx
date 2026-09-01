import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../api';
import { StatusFeedbackState } from '../layout/StatusFeedbackState';
import type { UserRole } from '../routes/Router';

type AwardStatus = 'PENDING' | 'WON' | 'LOST';
type VerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'CONFLICT';

interface CaseOption {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  version: number;
}

interface ProposalLink {
  id: string;
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  caseStatus: string;
  caseVersion: number;
  proposalNumber: string;
  proposalTitle: string;
  revisionLabel: string;
  clientName: string;
  sentAt: string;
  responseDueOn: string | null;
  proposedAmountKrw: number | null;
  documentUrl: string | null;
  documentSha256: string | null;
  verificationStatus: VerificationStatus;
  awardStatus: AwardStatus;
  awardDecidedAt: string | null;
  awardDecidedByName: string | null;
  contractAmountKrw: number | null;
  projectStartOn: string | null;
  projectEndOn: string | null;
  version: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  isPerformanceProject: boolean;
  reportEvidenceEligible: boolean;
}

interface AwardDecision {
  id: string;
  decision: AwardStatus;
  decisionNote: string;
  decidedAt: string;
  contractAmountKrw: number | null;
  projectStartOn: string | null;
  projectEndOn: string | null;
  expectedLinkVersion: number;
  createdAt: string;
  decidedByName: string;
}

interface LinkForm {
  caseId: string;
  proposalNumber: string;
  proposalTitle: string;
  revisionLabel: string;
  clientName: string;
  sentAt: string;
  responseDueOn: string;
  documentUrl: string;
  documentSha256: string;
  verificationStatus: VerificationStatus;
}

interface DecisionForm {
  decision: 'WON' | 'LOST';
}

type ReceptionStatus = 'READY' | 'PENDING' | 'WON' | 'COMPLETED' | 'LOST';

interface ProposalReception {
  proposalId: string;
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  caseStatus: string;
  caseVersion: number;
  proposalTitle: string;
  proposalVersion: number;
  versionNumber: number;
  clientName: string;
  documentSha256: string;
  confirmedAt: string;
  proposalNumber: string;
  revisionLabel: string;
  receptionStatus: ReceptionStatus;
  proposalLinkId: string | null;
  linkVersion: number | null;
  effectiveStateVersion: number | null;
  awardDecidedAt: string | null;
  awardDecidedByName: string | null;
  catalogVersion: number;
  driveArchiveUrl: string | null;
  driveArchivedAt: string | null;
}

const MUTATION_ROLES: readonly UserRole[] = ['admin', 'ceo', 'director', 'pm', 'staff', 'reviewer'];
const awardLabel: Record<AwardStatus, string> = { PENDING: '회신 대기', WON: '수주 확정', LOST: '미수주' };
const verificationLabel: Record<VerificationStatus, string> = { UNVERIFIED: '원문 미확인', VERIFIED: '원문 검증', CONFLICT: '자료 충돌' };
const isReceptionReady = (status: ReceptionStatus): boolean => status === 'READY' || status === 'PENDING';
const isReceptionWon = (status: ReceptionStatus): boolean => status === 'WON' || status === 'COMPLETED';
const receptionLabel = (status: ReceptionStatus): string => isReceptionReady(status) ? '접수 예정' : isReceptionWon(status) ? '수주 확정' : '접수 취소';
const receptionTone = (status: ReceptionStatus): 'pending' | 'won' | 'lost' => isReceptionReady(status) ? 'pending' : isReceptionWon(status) ? 'won' : 'lost';

function localDateTime(value = new Date()): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function blankLink(caseId = ''): LinkForm {
  return {
    caseId, proposalNumber: '', proposalTitle: '', revisionLabel: 'V1', clientName: '', sentAt: localDateTime(),
    responseDueOn: '', documentUrl: '', documentSha256: '', verificationStatus: 'UNVERIFIED'
  };
}

function blankDecision(): DecisionForm {
  return { decision: 'WON' };
}

function stableKey(store: Map<string, string>, prefix: string, payload: unknown): { fingerprint: string; key: string } {
  const fingerprint = `${prefix}:${JSON.stringify(payload)}`;
  const existing = store.get(fingerprint);
  if (existing) return { fingerprint, key: existing };
  const key = `${prefix}:${crypto.randomUUID()}`;
  store.set(fingerprint, key);
  return { fingerprint, key };
}

function dateLabel(value: string | null, withTime = false): string {
  if (!value) return '미정';
  return new Intl.DateTimeFormat('ko-KR', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(value));
}

function errorMessage(reason: unknown): string {
  if (reason instanceof ApiError && reason.status === 409) return '다른 화면에서 프로젝트 또는 제안서가 변경되었습니다. 최신 데이터를 다시 불러오세요.';
  if (reason instanceof ApiError && reason.status === 403) return '이 프로젝트의 제안서·수주 정보를 변경할 권한이 없습니다.';
  return reason instanceof Error ? reason.message : '요청을 처리하지 못했습니다.';
}

export function ProposalAwardWorkflow({ routeId, roles, onNavigate }: { routeId: 'WF-01' | 'WF-02' | 'WF-07'; roles: UserRole[]; onNavigate: (path: string) => void }): React.ReactElement {
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [proposals, setProposals] = useState<ProposalLink[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<ProposalLink | null>(null);
  const [decisions, setDecisions] = useState<AwardDecision[]>([]);
  const [linkForm, setLinkForm] = useState<LinkForm>(blankLink());
  const [decisionForm, setDecisionForm] = useState<DecisionForm>(blankDecision());
  const [showLinkForm, setShowLinkForm] = useState(routeId === 'WF-01');
  const [query, setQuery] = useState('');
  const [awardFilter, setAwardFilter] = useState<AwardStatus | ''>(routeId === 'WF-02' ? 'PENDING' : '');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [receptions, setReceptions] = useState<ProposalReception[]>([]);
  const [selectedReceptionId, setSelectedReceptionId] = useState('');
  const [receptionQuery, setReceptionQuery] = useState('');
  const [receptionLoading, setReceptionLoading] = useState(routeId === 'WF-02' || routeId === 'WF-07');
  const keysRef = useRef(new Map<string, string>());
  const detailEpoch = useRef(0);
  const canMutate = roles.some((role) => MUTATION_ROLES.includes(role));
  const isAdmin = roles.includes('admin');

  const loadCases = useCallback(async () => {
    const result = await apiRequest<{ cases: CaseOption[] }>('/api/cases?limit=100&q=');
    setCases(result.cases);
    setLinkForm((current) => current.caseId ? current : { ...current, caseId: result.cases[0]?.id ?? '' });
  }, []);

  const loadProposals = useCallback(async (preferredId?: string) => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (query.trim()) params.set('q', query.trim());
      if (awardFilter) params.set('awardStatus', awardFilter);
      const result = await apiRequest<{ proposals: ProposalLink[] }>(`/api/proposal-workflow?${params}`);
      setProposals(result.proposals);
      const preferred = preferredId || selectedId;
      setSelectedId(result.proposals.some((item) => item.id === preferred) ? preferred : (result.proposals[0]?.id ?? ''));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  }, [awardFilter, query, selectedId]);

  const loadReceptions = useCallback(async (preferredId?: string) => {
    setReceptionLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      const result = await apiRequest<{ receptions: ProposalReception[] }>(`/api/proposal-workflow/receptions?${params}`);
      setReceptions(result.receptions);
      setSelectedReceptionId((current) => {
        const preferred = preferredId || current;
        const preferredItem = result.receptions.find((item) => item.proposalId === preferred);
        if (preferredItem && (routeId === 'WF-07' || isReceptionReady(preferredItem.receptionStatus) || isReceptionWon(preferredItem.receptionStatus))) return preferred;
        return result.receptions.find((item) => isReceptionReady(item.receptionStatus))?.proposalId
          ?? result.receptions.find((item) => isReceptionWon(item.receptionStatus))?.proposalId
          ?? (routeId === 'WF-07' ? result.receptions[0]?.proposalId ?? '' : '');
      });
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setReceptionLoading(false); }
  }, [query, routeId]);

  useEffect(() => {
    if (routeId === 'WF-02' || routeId === 'WF-07') void loadReceptions();
    else void Promise.all([loadCases(), loadProposals()]).catch((reason) => setError(errorMessage(reason)));
  }, []);

  useEffect(() => {
    if (!selectedId) { setSelected(null); setDecisions([]); return; }
    const epoch = ++detailEpoch.current;
    void apiRequest<{ proposal: ProposalLink; decisions: AwardDecision[] }>(`/api/proposal-workflow/links/${encodeURIComponent(selectedId)}`)
      .then((result) => {
        if (epoch !== detailEpoch.current) return;
        setSelected(result.proposal); setDecisions(result.decisions); setDecisionForm(blankDecision());
      })
      .catch((reason) => { if (epoch === detailEpoch.current) setError(errorMessage(reason)); });
  }, [selectedId]);

  const summary = useMemo(() => ({
    total: proposals.length,
    pending: proposals.filter((item) => item.awardStatus === 'PENDING').length,
    won: proposals.filter((item) => item.awardStatus === 'WON').length,
    evidence: proposals.filter((item) => item.reportEvidenceEligible).length
  }), [proposals]);

  const submitLink = async () => {
    const activeCase = cases.find((item) => item.id === linkForm.caseId);
    if (!activeCase) { setError('연동할 프로젝트를 선택하세요.'); return; }
    setBusy('link'); setError(''); setNotice('');
    const payload = {
      caseId: linkForm.caseId,
      proposalNumber: linkForm.proposalNumber.trim(), proposalTitle: linkForm.proposalTitle.trim(), revisionLabel: linkForm.revisionLabel.trim(),
      clientName: linkForm.clientName.trim(), sentAt: new Date(linkForm.sentAt).toISOString(), responseDueOn: linkForm.responseDueOn || null,
      proposedAmountKrw: null,
      documentUrl: linkForm.documentUrl.trim() || null, documentSha256: linkForm.documentSha256.trim() || null,
      verificationStatus: linkForm.verificationStatus, expectedCaseVersion: activeCase.version
    };
    const stable = stableKey(keysRef.current, `proposal-link-${activeCase.id}`, payload);
    try {
      const result = await apiRequest<{ proposal: ProposalLink }>('/api/proposal-workflow/links', { method: 'POST', headers: { 'Idempotency-Key': stable.key }, body: JSON.stringify(payload) });
      keysRef.current.delete(stable.fingerprint);
      setLinkForm(blankLink(activeCase.id)); setShowLinkForm(false); setNotice('확정 제안서를 프로젝트에 연동했습니다.');
      await loadCases(); await loadProposals(result.proposal.id); setSelectedId(result.proposal.id);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(''); }
  };

  const submitDecision = async () => {
    if (!selected || selected.awardStatus !== 'PENDING') return;
    setBusy('decision'); setError(''); setNotice('');
    const payload = {
      decision: decisionForm.decision,
      expectedLinkVersion: selected.version, expectedCaseVersion: selected.caseVersion
    };
    const stable = stableKey(keysRef.current, `award-${selected.id}`, payload);
    try {
      const result = await apiRequest<{ proposal: ProposalLink; erpSync?: { status: 'PENDING' | 'SYNCED' | 'FAILED' } }>(`/api/proposal-workflow/links/${encodeURIComponent(selected.id)}/decision`, { method: 'POST', headers: { 'Idempotency-Key': stable.key }, body: JSON.stringify(payload) });
      keysRef.current.delete(stable.fingerprint); setNotice(result.proposal.awardStatus === 'WON' ? '프로젝트 접수를 확정했습니다. 일정표에서 단계별 기준 일정을 입력하세요.' : '접수 취소 결정을 이력에 고정했습니다.');
      await loadCases(); await loadProposals(result.proposal.id); setSelected(result.proposal); setDecisionForm(blankDecision());
      if (result.proposal.awardStatus === 'WON') onNavigate(`/projects/schedule?projectId=${encodeURIComponent(`project-${result.proposal.caseId}`)}&edit=1&erpSync=${encodeURIComponent(result.erpSync?.status ?? 'PENDING')}`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(''); }
  };

  const selectedReception = receptions.find((item) => item.proposalId === selectedReceptionId
    && (routeId === 'WF-07' || isReceptionReady(item.receptionStatus) || isReceptionWon(item.receptionStatus))) ?? null;

  useEffect(() => {
    if (routeId !== 'WF-02' || !selectedReceptionId) return;
    const needle = receptionQuery.trim().toLocaleLowerCase('ko-KR');
    if (!needle) return;
    const selectedItem = receptions.find((item) => item.proposalId === selectedReceptionId);
    const searchable = selectedItem
      ? `${selectedItem.caseNumber} ${selectedItem.caseTitle} ${selectedItem.proposalNumber} ${selectedItem.proposalTitle} ${selectedItem.clientName}`.toLocaleLowerCase('ko-KR')
      : '';
    if (!selectedItem || !searchable.includes(needle)) setSelectedReceptionId('');
  }, [receptionQuery, receptions, routeId, selectedReceptionId]);

  const submitReception = async (decision: 'WON' | 'LOST') => {
    if (!selectedReception || !isReceptionReady(selectedReception.receptionStatus)) return;
    const prompt = decision === 'WON'
      ? `${selectedReception.caseNumber} · ${selectedReception.caseTitle}\n\n이 제안서의 수주를 확인하고 프로젝트를 접수할까요?\n접수 후 바로 프로젝트 일정표로 이동합니다.`
      : `${selectedReception.caseNumber} · ${selectedReception.caseTitle}\n\n이 제안서를 접수 취소 처리할까요?\n취소 이력은 보존되며 수행 프로젝트로 전환되지 않습니다.`;
    if (!window.confirm(prompt)) return;
    const payload = {
      proposalId: selectedReception.proposalId,
      decision,
      expectedProposalVersion: selectedReception.proposalVersion,
      expectedCaseVersion: selectedReception.caseVersion
    };
    const stable = stableKey(keysRef.current, `reception-${selectedReception.proposalId}`, payload);
    setBusy('reception'); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ reception: ProposalReception; erpSync?: { status: 'PENDING' | 'SYNCED' | 'FAILED' } | null }>('/api/proposal-workflow/receptions', {
        method: 'POST', headers: { 'Idempotency-Key': stable.key }, body: JSON.stringify(payload)
      });
      keysRef.current.delete(stable.fingerprint);
      if (decision === 'WON') {
        setNotice('프로젝트 접수가 완료되었습니다. 단계별 기준 일정을 입력하세요.');
        onNavigate(`/projects/schedule?projectId=${encodeURIComponent(`project-${result.reception.caseId}`)}&edit=1&erpSync=${encodeURIComponent(result.erpSync?.status ?? 'PENDING')}`);
        return;
      }
      setNotice('접수 취소가 저장되었습니다. 제안서와 취소 이력은 그대로 보존됩니다.');
      await loadReceptions(selectedReception.proposalId);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(''); }
  };

  const adjustReception = async (item: ProposalReception) => {
    if (!canMutate || !['WON','LOST'].includes(item.receptionStatus)) return;
    const decision = isReceptionWon(item.receptionStatus) ? 'LOST' : 'WON';
    const reason = window.prompt(decision === 'LOST' ? '수주 확정을 취소하는 사유를 입력하세요. 기존 제안서·일정·이력은 삭제되지 않습니다.' : '프로젝트를 다시 수주 확정하는 사유를 입력하세요.');
    if (reason === null) return;
    if (reason.trim().length < 2) { setError('상태 변경 사유를 2자 이상 입력하세요.'); return; }
    const payload = { decision, reason: reason.trim(), expectedStateVersion: item.effectiveStateVersion ?? 1, expectedCaseVersion: item.caseVersion };
    const stable = stableKey(keysRef.current, `reception-adjust-${item.proposalId}`, payload);
    setBusy(`adjust:${item.proposalId}`); setError(''); setNotice('');
    try {
      await apiRequest(`/api/proposal-workflow/receptions/${encodeURIComponent(item.proposalId)}/status`, { method:'POST', headers:{'Idempotency-Key':stable.key}, body:JSON.stringify(payload) });
      keysRef.current.delete(stable.fingerprint);
      setNotice(decision === 'LOST' ? '수주 확정을 취소했습니다. 원본 자료와 일정 이력은 보존됩니다.' : '프로젝트를 다시 수주 확정했습니다.');
      await loadReceptions(item.proposalId);
    } catch (reasonValue) { setError(errorMessage(reasonValue)); }
    finally { setBusy(''); }
  };

  const projectCatalogAction = async (item: ProposalReception, action: 'ARCHIVE_TO_DRIVE' | 'ADMIN_DELETE') => {
    if (!isAdmin) return;
    if (action === 'ADMIN_DELETE' && !window.confirm(`${item.caseNumber} 프로젝트를 DB관리 목록에서 삭제할까요?\n원본 제안서·수주 이력·일정은 보존됩니다.`)) return;
    setBusy(`catalog:${item.proposalId}`); setError(''); setNotice('');
    try {
      const result = await apiRequest<{catalog:{driveArchiveUrl?:string|null}}>(`/api/proposal-catalog/${encodeURIComponent(item.proposalId)}`, { method:'POST', body:JSON.stringify({action,expectedVersion:item.catalogVersion}) });
      setNotice(action === 'ARCHIVE_TO_DRIVE' ? '프로젝트 제안서·접수 스냅샷을 Google Drive에 보관했습니다.' : '프로젝트를 DB관리 목록에서 삭제했습니다. 감사 원본은 보존됩니다.');
      if (action === 'ARCHIVE_TO_DRIVE' && result.catalog.driveArchiveUrl) window.open(result.catalog.driveArchiveUrl,'_blank','noopener,noreferrer');
      await loadReceptions();
    } catch (reasonValue) { setError(errorMessage(reasonValue)); }
    finally { setBusy(''); }
  };

  if (routeId === 'WF-07') {
    if (receptionLoading && receptions.length === 0) return <StatusFeedbackState type="loading" message="프로젝트 접수 전체 이력을 불러오고 있습니다." />;
    const readyCount = receptions.filter((item) => isReceptionReady(item.receptionStatus)).length;
    const wonCount = receptions.filter((item) => isReceptionWon(item.receptionStatus)).length;
    const lostCount = receptions.filter((item) => item.receptionStatus === 'LOST').length;
    return (
      <section className="route-view proposal-flow reception-flow reception-database" aria-labelledby="project-database-title">
        <header className="proposal-flow-hero reception-hero">
          <div><span>ADMIN · PROJECT DATABASE</span><h2 id="project-database-title">프로젝트 DB관리</h2><p>접수 이력을 보존하면서 수주 상태를 정정하고, 프로젝트 스냅샷을 Drive에 보관하거나 목록에서 삭제할 수 있습니다.</p></div>
          <div className="proposal-flow-actions"><button type="button" className="is-secondary" onClick={() => onNavigate('/workflow/award')}>프로젝트 접수 열기</button></div>
        </header>
        <div className="reception-kpis" aria-label="프로젝트 DB 전체 현황">
          <article><span>접수 예정</span><strong>{readyCount}</strong><small>확정 제안서</small></article>
          <article><span>수주 확정</span><strong>{wonCount}</strong><small>수행 프로젝트</small></article>
          <article><span>접수 취소</span><strong>{lostCount}</strong><small>보존 이력</small></article>
        </div>
        <form className="reception-database-search" onSubmit={(event) => { event.preventDefault(); void loadReceptions(); }}>
          <label><span>프로젝트·제안서 통합 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="프로젝트 번호, 프로젝트명, 제안서명, 클라이언트" /></label>
          <button type="submit" disabled={receptionLoading}>검색</button>
        </form>
        {error && <div className="proposal-flow-error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadReceptions()}>최신 데이터 다시 불러오기</button></div>}
        <section className="reception-database-card" aria-label="프로젝트 접수 전체 이력">
          <header><div><small>READ ONLY · ADMIN</small><h3>프로젝트 접수 전체 이력</h3></div><strong>{receptions.length}건</strong></header>
          {receptions.length === 0 ? <div className="reception-empty"><strong>저장된 프로젝트 접수 이력이 없습니다.</strong><span>확정 제안서가 접수 단계로 넘어오면 이곳에 보존됩니다.</span></div> : <div className="reception-database-table-wrap"><table className="reception-database-table"><thead><tr><th>상태</th><th>프로젝트</th><th>제안서</th><th>클라이언트</th><th>제안서 확정</th><th>결정 담당·시각</th><th>버전</th><th>관리</th></tr></thead><tbody>{receptions.map((item) => <tr key={item.proposalId}><td><span className={`proposal-award is-${receptionTone(item.receptionStatus)}`}>{receptionLabel(item.receptionStatus)}</span></td><td><strong>{item.caseNumber}</strong><small>{item.caseTitle}</small></td><td><strong>{item.proposalNumber} · {item.revisionLabel}</strong><small>{item.proposalTitle}</small></td><td>{item.clientName || '미입력'}</td><td>{dateLabel(item.confirmedAt, true)}</td><td>{item.awardDecidedAt ? <><strong>{item.awardDecidedByName ?? '담당자'}</strong><small>{dateLabel(item.awardDecidedAt, true)}</small></> : <small>결정 전</small>}</td><td>제안서 v{item.versionNumber}<br/><small>DB v{item.proposalVersion}</small></td><td><div className="reception-database-actions">{['WON','LOST'].includes(item.receptionStatus)&&<button type="button" className="is-secondary" disabled={!canMutate||Boolean(busy)} onClick={()=>void adjustReception(item)}>{isReceptionWon(item.receptionStatus)?'수주 취소':'수주 재확정'}</button>}<button type="button" className="is-drive" disabled={!isAdmin||Boolean(busy)} onClick={()=>void projectCatalogAction(item,'ARCHIVE_TO_DRIVE')}>{item.driveArchiveUrl?'Drive 다시 보관':'Google Drive 보관'}</button>{item.driveArchiveUrl&&<a href={item.driveArchiveUrl} target="_blank" rel="noreferrer">보관본 열기</a>}<button type="button" className="is-delete" disabled={!isAdmin||Boolean(busy)} onClick={()=>void projectCatalogAction(item,'ADMIN_DELETE')}>관리자 삭제</button></div></td></tr>)}</tbody></table></div>}
        </section>
      </section>
    );
  }

  if (routeId === 'WF-02') {
    if (receptionLoading && receptions.length === 0) return <StatusFeedbackState type="loading" message="확정 제안서를 불러오고 있습니다." />;
    const readyItemsAll = receptions.filter((item) => isReceptionReady(item.receptionStatus));
    const wonItemsAll = receptions.filter((item) => isReceptionWon(item.receptionStatus));
    const receptionNeedle = receptionQuery.trim().toLocaleLowerCase('ko-KR');
    const matchesReceptionQuery = (item: ProposalReception) => !receptionNeedle || `${item.caseNumber} ${item.caseTitle} ${item.proposalNumber} ${item.proposalTitle} ${item.clientName}`.toLocaleLowerCase('ko-KR').includes(receptionNeedle);
    const readyItems = readyItemsAll.filter(matchesReceptionQuery);
    const wonItems = wonItemsAll.filter(matchesReceptionQuery);
    const lostCount = receptions.filter((item) => item.receptionStatus === 'LOST').length;
    return (
      <section className="route-view proposal-flow reception-flow" aria-labelledby="proposal-reception-title">
        <header className="proposal-flow-hero reception-hero">
          <div><span>PROJECT RECEPTION · ONE CLICK</span><h2 id="proposal-reception-title">확정 제안서를 수주 프로젝트로 접수합니다.</h2><p><b>접수 예정 프로젝트</b>에서 제안서를 고른 뒤 수주 확정 또는 접수 취소만 누르세요. 별도 항목은 다시 입력하지 않습니다.</p></div>
          <div className="proposal-flow-actions"><button type="button" className="is-secondary" onClick={() => onNavigate('/proposals/editor')}>제안서 작성 열기</button></div>
        </header>

        <div className="reception-kpis" aria-label="프로젝트 접수 현황">
          <article><span>접수 예정</span><strong>{readyItemsAll.length}</strong><small>결정 대기 프로젝트</small></article>
          <article><span>수주 확정</span><strong>{wonItemsAll.length}</strong><small>수행 프로젝트</small></article>
          <article><span>접수 취소</span><strong>{lostCount}</strong><small>DB 이력 보존</small></article>
        </div>

        {error && <div className="proposal-flow-error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadReceptions()}>최신 데이터 다시 불러오기</button></div>}
        {notice && <div className="proposal-flow-notice" role="status">{notice}</div>}

        <label className="reception-list-search"><span>접수 프로젝트 빠른 검색</span><input type="search" value={receptionQuery} onChange={(event) => setReceptionQuery(event.target.value)} placeholder="프로젝트 번호·명칭·제안서·클라이언트"/><small>{receptionNeedle ? `검색 결과 ${readyItems.length + wonItems.length}건` : `전체 ${readyItemsAll.length + wonItemsAll.length}건`}</small></label>

        <div className="reception-status-columns">
          <section className="reception-status-list is-ready" aria-labelledby="reception-ready-title"><header><div><small>AWAITING DECISION</small><h3 id="reception-ready-title">접수 예정 프로젝트</h3></div><strong>{readyItems.length}</strong></header>{readyItems.length === 0 ? <p>{receptionNeedle ? '검색 조건에 맞는 접수 예정 프로젝트가 없습니다.' : '수주 여부를 결정할 확정 제안서가 없습니다.'}</p> : <div className="reception-status-list__body">{readyItems.map((item) => {const active=selectedReceptionId===item.proposalId;return <button type="button" key={item.proposalId} aria-pressed={active} className={active?'is-active':''} onClick={() => { setSelectedReceptionId(item.proposalId); setError(''); setNotice(''); }}><span className="proposal-award is-pending">접수 예정</span><strong>{item.caseNumber} · {item.caseTitle}</strong><small>{item.proposalNumber} · {item.revisionLabel} · {item.clientName}</small>{active&&<em>✓ 선택됨</em>}</button>;})}</div>}</section>
          <section className="reception-status-list is-won" aria-labelledby="reception-won-title"><header><div><small>ACTIVE PROJECTS</small><h3 id="reception-won-title">수주 확정 프로젝트</h3></div><strong>{wonItems.length}</strong></header>{wonItems.length === 0 ? <p>{receptionNeedle ? '검색 조건에 맞는 수주 확정 프로젝트가 없습니다.' : '아직 수주 확정된 프로젝트가 없습니다.'}</p> : <div className="reception-status-list__body">{wonItems.map((item) => {const active=selectedReceptionId===item.proposalId;return <button type="button" key={item.proposalId} aria-pressed={active} className={active?'is-active':''} onClick={() => { setSelectedReceptionId(item.proposalId); setError(''); setNotice(''); }}><span className="proposal-award is-won">수주 확정</span><strong>{item.caseNumber} · {item.caseTitle}</strong><small>{item.awardDecidedByName ?? '담당자'} · {dateLabel(item.awardDecidedAt, true)}</small>{active&&<em>✓ 선택됨</em>}</button>;})}</div>}</section>
        </div>

        {(readyItemsAll.length > 0 || wonItemsAll.length > 0) ? <section className="reception-card">
          <div className="reception-step"><span>{selectedReception && isReceptionWon(selectedReception.receptionStatus) ? '✓' : '01'}</span><div><small>{selectedReception && isReceptionWon(selectedReception.receptionStatus) ? '수주 확정 프로젝트' : '확정 제안서 선택'}</small><h3>{selectedReception && isReceptionWon(selectedReception.receptionStatus) ? '프로젝트 접수가 완료되었습니다.' : '수주 여부를 확인하세요.'}</h3><p>제안서 작성 4단계에서 확정된 제안서 정보가 그대로 연결됩니다.</p></div></div>
          {selectedReception && <div className="reception-summary">
            <div className="reception-summary-title"><span className={`proposal-award is-${receptionTone(selectedReception.receptionStatus)}`}>{receptionLabel(selectedReception.receptionStatus)}</span><div><small>{selectedReception.proposalNumber} · {selectedReception.revisionLabel}</small><h3>{selectedReception.proposalTitle}</h3></div></div>
            <dl><div><dt>프로젝트</dt><dd>{selectedReception.caseNumber} · {selectedReception.caseTitle}</dd></div><div><dt>클라이언트</dt><dd>{selectedReception.clientName}</dd></div><div><dt>제안서 확정일</dt><dd>{dateLabel(selectedReception.confirmedAt, true)}</dd></div><div><dt>현재 프로젝트 상태</dt><dd>{selectedReception.caseStatus}</dd></div></dl>
            {isReceptionReady(selectedReception.receptionStatus) ? <div className="reception-actions"><button type="button" className="is-cancel" disabled={!canMutate || busy === 'reception'} onClick={() => void submitReception('LOST')}>접수 취소</button><button type="button" className="is-confirm" disabled={!canMutate || busy === 'reception'} onClick={() => void submitReception('WON')}>{busy === 'reception' ? '접수 저장 중…' : '✓ 수주 확인 · 프로젝트 접수'}</button></div> : <div className="reception-complete is-won"><strong>프로젝트 접수가 완료되었습니다.</strong><span>{selectedReception.awardDecidedByName ?? '담당자'} · {dateLabel(selectedReception.awardDecidedAt, true)}</span><button type="button" onClick={() => onNavigate(`/projects/schedule?projectId=${encodeURIComponent(`project-${selectedReception.caseId}`)}`)}>프로젝트 일정표 열기 →</button></div>}
          </div>}
        </section> : <section className="reception-card"><div className="reception-empty"><strong>접수 예정 또는 수주 확정 프로젝트가 없습니다.</strong><span>제안서 작성에서 담당자 검수를 마치고 4단계 ‘제안서 확정’을 먼저 완료하세요.</span><button type="button" onClick={() => onNavigate('/proposals/editor')}>제안서 작성으로 이동</button></div></section>}
      </section>
    );
  }

  if (loading && proposals.length === 0 && cases.length === 0) return <StatusFeedbackState type="loading" message="연동 제안서와 수주 결정을 불러오고 있습니다." />;

  return (
    <section className="route-view proposal-flow" aria-labelledby="proposal-flow-title">
      <header className="proposal-flow-hero">
        <div>
          <span>BUSINESS DEVELOPMENT · LIVE WORKFLOW</span>
          <h2 id="proposal-flow-title">{routeId === 'WF-01' ? '작성된 제안서를 프로젝트에 연결합니다.' : '수주 여부를 확정하고 수행 프로젝트로 전환합니다.'}</h2>
          <p>확정된 제안서를 연결하고 수주 또는 취소만 결정합니다. 수주가 확인된 프로젝트만 착수회의 이후 단계와 일정표·ERP 등록으로 넘어갑니다.</p>
        </div>
        <div className="proposal-flow-actions">
          <button type="button" className="is-secondary" onClick={() => onNavigate('/proposals/editor')}>제안서 작성 열기</button>
          {canMutate && <button type="button" onClick={() => setShowLinkForm(true)}>+ 제안서 연동</button>}
        </div>
      </header>

      <div className="proposal-flow-rule"><strong>수행 프로젝트 전환 규칙</strong><span>회신 대기 중에는 착수하지 않습니다. <b>수주 확정</b>을 기록한 경우에만 프로젝트 상태가 계약 단계로 전환됩니다.</span></div>

      {routeId === 'WF-01' && <div className="proposal-flow-kpis" aria-label="제안서·수주 요약">
        <article><span>LINKED</span><strong>{summary.total}</strong><small>연동 제안서</small></article>
        <article><span>AWAITING</span><strong>{summary.pending}</strong><small>회신 대기</small></article>
        <article><span>WON</span><strong>{summary.won}</strong><small>수행 프로젝트</small></article>
        <article><span>VERIFIED</span><strong>{summary.evidence}</strong><small>보고서 근거 가능</small></article>
      </div>}

      {routeId === 'WF-01' && <form className="proposal-flow-search" onSubmit={(event) => { event.preventDefault(); void loadProposals(); }}>
        <label><span>통합 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제안번호, 거래처, 프로젝트" /></label>
        <label><span>수주 상태</span><select value={awardFilter} onChange={(event) => setAwardFilter(event.target.value as AwardStatus | '')}><option value="">전체</option><option value="PENDING">회신 대기</option><option value="WON">수주 확정</option><option value="LOST">미수주</option></select></label>
        <button type="submit">검색</button>
      </form>}

      {error && <div className="proposal-flow-error" role="alert"><span>{error}</span><button type="button" onClick={() => void Promise.all([loadCases(), loadProposals()])}>최신 데이터 다시 불러오기</button></div>}
      {notice && <div className="proposal-flow-notice" role="status">{notice}</div>}

      <div className="proposal-flow-layout">
        <aside className="proposal-flow-list" aria-label="프로젝트에 연결된 제안서 목록">
          <header><strong>연결된 제안서</strong><span>{proposals.length}건</span></header>
          {proposals.length === 0 ? <div className="proposal-flow-empty"><strong>연결된 제안서가 없습니다.</strong><span>제안서를 확정한 뒤 이 프로젝트에 연결하세요.</span></div> : proposals.map((item) => (
            <button type="button" key={item.id} className={selectedId === item.id ? 'is-active' : ''} onClick={() => { setShowLinkForm(false); setSelectedId(item.id); setNotice(''); }}>
              <span className={`proposal-award is-${item.awardStatus.toLowerCase()}`}>{awardLabel[item.awardStatus]}</span>
              <strong>{item.proposalNumber} · {item.revisionLabel}</strong>
              <span title={item.proposalTitle}>{item.proposalTitle}</span>
              <small>{item.clientName} · {item.caseNumber}</small>
              <small>회신기한 {item.responseDueOn || '미정'}</small>
            </button>
          ))}
        </aside>

        <main className="proposal-flow-detail">
          {showLinkForm ? (
            <section className="proposal-flow-panel">
              <div className="proposal-flow-heading"><div><span>STEP 1 · PROPOSAL LINK</span><h3>제안서 연동</h3></div><small>작성 완료한 제안서를 프로젝트에 연결합니다.</small></div>
              <div className="proposal-flow-form">
                <label className="span-2"><span>연동 프로젝트</span><select value={linkForm.caseId} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, caseId: event.target.value }))}>{cases.map((item) => <option key={item.id} value={item.id}>{item.caseNumber} · {item.title} · {item.status}</option>)}</select></label>
                <label><span>제안번호</span><input value={linkForm.proposalNumber} maxLength={100} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, proposalNumber: event.target.value }))} placeholder="PROP-2026-001" /></label>
                <label><span>제안서 버전</span><input value={linkForm.revisionLabel} maxLength={80} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, revisionLabel: event.target.value }))} placeholder="V1" /></label>
                <label className="span-2"><span>제안서 제목</span><input value={linkForm.proposalTitle} maxLength={500} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, proposalTitle: event.target.value }))} /></label>
                <label><span>거래처</span><input value={linkForm.clientName} maxLength={300} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, clientName: event.target.value }))} /></label>
                <label><span>제안서 확정일</span><input type="datetime-local" value={linkForm.sentAt} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, sentAt: event.target.value }))} /></label>
                <label><span>회신 기한</span><input type="date" value={linkForm.responseDueOn} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, responseDueOn: event.target.value }))} /></label>
                <label className="span-2"><span>확정본 HTTPS URL</span><input type="url" value={linkForm.documentUrl} maxLength={1200} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, documentUrl: event.target.value }))} placeholder="https://..." /></label>
                <label className="span-2"><span>확정본 무결성 확인값</span><input value={linkForm.documentSha256} maxLength={64} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, documentSha256: event.target.value }))} placeholder="확정 파일의 64자리 확인값" /></label>
                <label><span>원문 검증</span><select value={linkForm.verificationStatus} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, verificationStatus: event.target.value as VerificationStatus }))}><option value="UNVERIFIED">원문 미확인</option><option value="VERIFIED">URL·SHA 검증</option><option value="CONFLICT">자료 충돌</option></select></label>
              </div>
              <div className="proposal-flow-submit"><button type="button" className="is-secondary" onClick={() => setShowLinkForm(false)}>취소</button><button type="button" disabled={!canMutate || busy === 'link'} onClick={() => void submitLink()}>{busy === 'link' ? '저장 중…' : '제안서 연동'}</button></div>
            </section>
          ) : selected ? (
            <>
              <section className="proposal-flow-head">
                <div><span>{selected.caseNumber} · {selected.clientName}</span><h3>{selected.proposalTitle}</h3><p>{selected.proposalNumber} · {selected.revisionLabel}</p></div>
                <div><span className={`proposal-award is-${selected.awardStatus.toLowerCase()}`}>{awardLabel[selected.awardStatus]}</span><small>{verificationLabel[selected.verificationStatus]}</small></div>
              </section>
              <section className="proposal-flow-panel proposal-snapshot">
                <div className="proposal-flow-heading"><div><span>LINKED PROPOSAL SNAPSHOT</span><h3>연동된 제안서</h3></div><small>이 제안서가 수주됐는지 취소됐는지만 결정하세요.</small></div>
                <dl><div><dt>제안서 확정일</dt><dd>{dateLabel(selected.sentAt, true)}</dd></div><div><dt>회신 기한</dt><dd>{selected.responseDueOn || '미정'}</dd></div><div><dt>프로젝트</dt><dd>{selected.caseNumber} · {selected.caseTitle}</dd></div><div><dt>현재 상태</dt><dd>{selected.caseStatus}</dd></div><div><dt>원문 검증</dt><dd>{verificationLabel[selected.verificationStatus]}</dd></div><div><dt>연동 담당</dt><dd>{selected.createdByName}</dd></div></dl>
                {selected.documentUrl ? <a href={selected.documentUrl} target="_blank" rel="noreferrer">확정 원문 열기 ↗</a> : <p className="proposal-flow-muted">원문 URL이 없어 보고서 확정 근거로는 사용할 수 없습니다.</p>}
                {selected.documentSha256 && <code>{selected.documentSha256}</code>}
              </section>

              {selected.awardStatus === 'PENDING' ? (
                <section className="proposal-flow-panel">
                  <div className="proposal-flow-heading"><div><span>STEP 2 · PROJECT INTAKE</span><h3>프로젝트 접수 확정·취소</h3></div><small>제안서 결과만 선택하세요. PM과 기간은 다음 일정표에서 정합니다.</small></div>
                  <div className="proposal-decision-switch" role="group" aria-label="프로젝트 접수 여부"><button type="button" className={decisionForm.decision === 'WON' ? 'is-selected' : ''} onClick={() => setDecisionForm((current) => ({ ...current, decision: 'WON' }))}>프로젝트 접수 확정</button><button type="button" className={decisionForm.decision === 'LOST' ? 'is-selected is-lost' : ''} onClick={() => setDecisionForm((current) => ({ ...current, decision: 'LOST' }))}>접수 취소</button></div>
                  <div className="proposal-reception-summary"><strong>{decisionForm.decision === 'WON' ? '이 제안서가 수주되었습니다.' : '이 제안서는 취소되었습니다.'}</strong><span>{decisionForm.decision === 'WON' ? '확정하면 ERP 프로젝트 등록을 요청하고 바로 일정표를 엽니다. PM과 일정은 일정표에서 지정합니다.' : '확정하면 제안 이력은 보존되고 수행 프로젝트로 전환되지 않습니다.'}</span></div>
                  <div className="proposal-flow-submit"><span>금액·PM·기간은 이 화면에서 입력하지 않습니다.</span><button type="button" disabled={!canMutate || busy === 'decision'} onClick={() => void submitDecision()}>{busy === 'decision' ? '확정 중…' : decisionForm.decision === 'WON' ? '수주 확정·ERP 등록 요청' : '접수 취소 확정'}</button></div>
                </section>
              ) : (
                <section className={`proposal-flow-panel proposal-result is-${selected.awardStatus.toLowerCase()}`}><span>FINAL INTAKE RESULT</span><h3>{awardLabel[selected.awardStatus]}</h3><p>{selected.awardStatus === 'WON' ? '수행 프로젝트로 전환 완료 · ERP 등록 기록 생성' : '수행 프로젝트 전환 없음'}</p><small>{selected.awardDecidedByName} · {dateLabel(selected.awardDecidedAt, true)}</small>{selected.awardStatus === 'WON' && <button type="button" onClick={() => onNavigate(`/projects/schedule?projectId=${encodeURIComponent(`project-${selected.caseId}`)}`)}>프로젝트 일정 입력·수정 →</button>}</section>
              )}

              {decisions.length > 0 && <section className="proposal-flow-panel"><div className="proposal-flow-heading"><div><span>AUDIT TRAIL</span><h3>수주 결정 이력</h3></div></div><ol className="proposal-decision-history">{decisions.map((item) => <li key={item.id}><span className={`proposal-award is-${item.decision.toLowerCase()}`}>{awardLabel[item.decision]}</span><div><strong>{item.decisionNote}</strong><small>{item.decidedByName} · {dateLabel(item.decidedAt, true)}</small></div></li>)}</ol></section>}
            </>
          ) : <div className="proposal-flow-welcome"><span>PROPOSAL → AWARD → PROJECT</span><h3>연동된 제안서를 선택하세요.</h3><p>수주 확정된 프로젝트만 일정표와 ERP 등록 단계로 넘어갑니다.</p></div>}
        </main>
      </div>
    </section>
  );
}
