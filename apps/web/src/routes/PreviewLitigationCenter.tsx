import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../api';
import { StatusFeedbackState } from '../layout/StatusFeedbackState';
import type { UserRole } from './Router';

type LitigationStage = 'FILED' | 'PLEADING' | 'APPRAISAL' | 'HEARING' | 'JUDGEMENT' | 'APPEAL' | 'CLOSED';
type VerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'CONFLICT';
type LitigationEventType = 'FILED' | 'SERVICE' | 'BRIEF' | 'APPRAISAL' | 'HEARING' | 'JUDGEMENT' | 'APPEAL' | 'CORRECTION' | 'OTHER';

interface CaseOption {
  id: string;
  caseNumber: string;
  title: string;
}

interface LitigationRecord {
  id: string;
  caseId: string;
  projectCaseNumber: string;
  projectTitle: string;
  courtName: string;
  courtCaseNumber: string;
  caseTitle: string;
  divisionName: string | null;
  partiesText: string;
  filedOn: string | null;
  currentStage: LitigationStage;
  nextHearingAt: string | null;
  verificationStatus: VerificationStatus;
  officialSourceUrl: string | null;
  sourceCheckedAt: string | null;
  sourceCheckedByName: string | null;
  version: number;
  eventCount: number;
  verifiedEventCount: number;
  reportEvidenceEligible: boolean;
  updatedAt: string;
}

interface LitigationEvent {
  id: string;
  eventType: LitigationEventType;
  occurredAt: string;
  title: string;
  detailText: string;
  verificationStatus: VerificationStatus;
  officialSourceUrl: string | null;
  sourceSha256: string | null;
  scheduleId: string | null;
  createdByName: string;
}

interface RecordForm {
  caseId: string;
  courtName: string;
  courtCaseNumber: string;
  caseTitle: string;
  divisionName: string;
  partiesText: string;
  filedOn: string;
  currentStage: LitigationStage;
  nextHearingAt: string;
  verificationStatus: VerificationStatus;
  officialSourceUrl: string;
}

interface EventForm {
  eventType: LitigationEventType;
  occurredAt: string;
  title: string;
  detailText: string;
  verificationStatus: VerificationStatus;
  officialSourceUrl: string;
  sourceSha256: string;
  createCourtSchedule: boolean;
}

const MUTATION_ROLES: readonly UserRole[] = ['admin', 'ceo', 'director', 'pm'];
const STAGES: Array<{ value: LitigationStage; label: string }> = [
  { value: 'FILED', label: '법원 접수' }, { value: 'PLEADING', label: '서면 공방' },
  { value: 'APPRAISAL', label: '감정 진행' }, { value: 'HEARING', label: '공판 진행' },
  { value: 'JUDGEMENT', label: '판결' }, { value: 'APPEAL', label: '항소' }, { value: 'CLOSED', label: '종결' }
];
const EVENT_TYPES: Array<{ value: LitigationEventType; label: string }> = [
  { value: 'FILED', label: '접수' }, { value: 'SERVICE', label: '송달' }, { value: 'BRIEF', label: '서면 제출' },
  { value: 'APPRAISAL', label: '감정' }, { value: 'HEARING', label: '공판' }, { value: 'JUDGEMENT', label: '판결' },
  { value: 'APPEAL', label: '항소' }, { value: 'CORRECTION', label: '보정' }, { value: 'OTHER', label: '기타' }
];
const STAGE_LABEL = Object.fromEntries(STAGES.map((entry) => [entry.value, entry.label])) as Record<LitigationStage, string>;
const EVENT_LABEL = Object.fromEntries(EVENT_TYPES.map((entry) => [entry.value, entry.label])) as Record<LitigationEventType, string>;

const blankRecord = (caseId = ''): RecordForm => ({
  caseId, courtName: '', courtCaseNumber: '', caseTitle: '', divisionName: '', partiesText: '', filedOn: '',
  currentStage: 'FILED', nextHearingAt: '', verificationStatus: 'UNVERIFIED', officialSourceUrl: ''
});
const blankEvent = (): EventForm => ({
  eventType: 'HEARING', occurredAt: '', title: '', detailText: '', verificationStatus: 'UNVERIFIED',
  officialSourceUrl: '', sourceSha256: '', createCourtSchedule: true
});

function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function displayDate(value: string | null, withTime = true): string {
  if (!value) return '미정';
  return new Intl.DateTimeFormat('ko-KR', withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(new Date(value));
}

function keyFor(store: Map<string, string>, prefix: string, payload: unknown): { fingerprint: string; key: string } {
  const fingerprint = `${prefix}:${JSON.stringify(payload)}`;
  const existing = store.get(fingerprint);
  if (existing) return { fingerprint, key: existing };
  const key = `${prefix}:${crypto.randomUUID()}`;
  store.set(fingerprint, key);
  return { fingerprint, key };
}

function errorMessage(reason: unknown): string {
  if (reason instanceof ApiError && reason.status === 409) return '다른 화면에서 먼저 변경되었거나 동일 사건번호가 이미 등록되었습니다. 최신 정보를 다시 불러오세요.';
  if (reason instanceof ApiError && reason.status === 403) return '이 프로젝트에 대한 등록·수정 권한이 없습니다.';
  return reason instanceof Error ? reason.message : '요청을 처리하지 못했습니다.';
}

export function PreviewLitigationCenter({ roles, onNavigate }: { roles: UserRole[]; onNavigate: (path: string) => void }): React.ReactElement {
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [records, setRecords] = useState<LitigationRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<LitigationRecord | null>(null);
  const [events, setEvents] = useState<LitigationEvent[]>([]);
  const [query, setQuery] = useState('');
  const [caseFilter, setCaseFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [recordForm, setRecordForm] = useState<RecordForm>(blankRecord());
  const [eventForm, setEventForm] = useState<EventForm>(blankEvent());
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const keysRef = useRef(new Map<string, string>());
  const detailEpoch = useRef(0);
  const canMutate = roles.some((role) => MUTATION_ROLES.includes(role));

  const loadRecords = useCallback(async (nextSelected?: string) => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (query.trim()) params.set('q', query.trim());
      if (caseFilter) params.set('caseId', caseFilter);
      if (stageFilter) params.set('stage', stageFilter);
      const result = await apiRequest<{ records: LitigationRecord[] }>(`/api/litigation-records?${params}`);
      setRecords(result.records);
      const preferred = nextSelected || selectedId;
      setSelectedId(result.records.some((entry) => entry.id === preferred) ? preferred : (result.records[0]?.id ?? ''));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  }, [caseFilter, query, selectedId, stageFilter]);

  useEffect(() => {
    void Promise.all([
      apiRequest<{ cases: CaseOption[] }>('/api/cases?scope=project-work&limit=100&q=').then((result) => {
        setCases(result.cases);
        setRecordForm((current) => current.caseId ? current : { ...current, caseId: result.cases[0]?.id ?? '' });
      }),
      loadRecords()
    ]).catch((reason) => setError(errorMessage(reason)));
  }, []);

  useEffect(() => {
    if (!selectedId) { setSelected(null); setEvents([]); return; }
    const epoch = ++detailEpoch.current;
    void apiRequest<{ record: LitigationRecord; events: LitigationEvent[] }>(`/api/litigation-records/${encodeURIComponent(selectedId)}`)
      .then((result) => {
        if (epoch !== detailEpoch.current) return;
        setSelected(result.record); setEvents(result.events);
        setRecordForm({
          caseId: result.record.caseId, courtName: result.record.courtName, courtCaseNumber: result.record.courtCaseNumber,
          caseTitle: result.record.caseTitle, divisionName: result.record.divisionName ?? '', partiesText: result.record.partiesText,
          filedOn: result.record.filedOn ?? '', currentStage: result.record.currentStage,
          nextHearingAt: toLocalInput(result.record.nextHearingAt), verificationStatus: result.record.verificationStatus,
          officialSourceUrl: result.record.officialSourceUrl ?? ''
        });
      })
      .catch((reason) => { if (epoch === detailEpoch.current) setError(errorMessage(reason)); });
  }, [selectedId]);

  const summary = useMemo(() => ({
    total: records.length,
    upcoming: records.filter((entry) => entry.nextHearingAt && new Date(entry.nextHearingAt) >= new Date()).length,
    verified: records.filter((entry) => entry.reportEvidenceEligible).length,
    conflicts: records.filter((entry) => entry.verificationStatus === 'CONFLICT').length
  }), [records]);

  const submitRecord = async (creating: boolean) => {
    setBusy(creating ? 'create' : 'update'); setError(''); setNotice('');
    const payload = {
      ...recordForm,
      divisionName: recordForm.divisionName.trim() || null,
      filedOn: recordForm.filedOn || null,
      nextHearingAt: recordForm.nextHearingAt ? new Date(recordForm.nextHearingAt).toISOString() : null,
      officialSourceUrl: recordForm.officialSourceUrl.trim() || null
    };
    try {
      let result: { record: LitigationRecord };
      if (creating) {
        const stable = keyFor(keysRef.current, 'litigation-create', payload);
        result = await apiRequest<{ record: LitigationRecord }>('/api/litigation-records', {
          method: 'POST', headers: { 'Idempotency-Key': stable.key }, body: JSON.stringify(payload)
        });
        keysRef.current.delete(stable.fingerprint);
        setShowCreate(false); setNotice('법원 사건을 프로젝트에 연결했습니다.');
      } else if (selected) {
        result = await apiRequest<{ record: LitigationRecord }>(`/api/litigation-records/${encodeURIComponent(selected.id)}`, {
          method: 'PUT', body: JSON.stringify({ ...payload, expectedVersion: selected.version })
        });
        setNotice('법원 사건 정보와 검증 상태를 갱신했습니다.');
      } else return;
      await loadRecords(result.record.id);
      setSelectedId(result.record.id);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(''); }
  };

  const submitEvent = async () => {
    if (!selected) return;
    setBusy('event'); setError(''); setNotice('');
    const payload = {
      ...eventForm,
      occurredAt: eventForm.occurredAt ? new Date(eventForm.occurredAt).toISOString() : '',
      officialSourceUrl: eventForm.officialSourceUrl.trim() || null,
      sourceSha256: eventForm.sourceSha256.trim() || null
    };
    const stable = keyFor(keysRef.current, `litigation-event-${selected.id}`, payload);
    try {
      const result = await apiRequest<{ record: LitigationRecord; events: LitigationEvent[] }>(`/api/litigation-records/${encodeURIComponent(selected.id)}/events`, {
        method: 'POST', headers: { 'Idempotency-Key': stable.key }, body: JSON.stringify(payload)
      });
      keysRef.current.delete(stable.fingerprint);
      setSelected(result.record); setEvents(result.events); setEventForm(blankEvent());
      setRecords((current) => current.map((entry) => entry.id === result.record.id ? result.record : entry));
      setNotice(eventForm.createCourtSchedule ? '소송 이력과 프로젝트 공판 일정을 함께 저장했습니다.' : '소송 이력을 타임라인에 저장했습니다.');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(''); }
  };

  if (loading && records.length === 0) return <StatusFeedbackState type="loading" message="법원 사건과 공판 일정을 불러오고 있습니다." />;

  return (
    <section className="route-view litigation-center" aria-labelledby="litigation-title">
      <header className="litigation-hero">
        <div>
          <span className="litigation-eyebrow">POST-DELIVERY · COURT CASE INTELLIGENCE</span>
          <h2 id="litigation-title">납품 이후의 법원 사건과<br />공판 일정을 놓치지 않습니다.</h2>
          <p>프로젝트에 법원 사건번호를 연결하고, 송달·공판·판결·수정 차수를 검증 가능한 타임라인으로 관리합니다.</p>
        </div>
        <button type="button" className="litigation-primary" onClick={() => { setShowCreate(true); setSelectedId(''); setRecordForm(blankRecord(cases[0]?.id)); }}>+ 법원 사건 연결</button>
      </header>

      <div className="litigation-trust-note">
        <strong>공식 외부 자동조회는 아직 연결 전입니다.</strong>
        <span>대한민국 법원 공식 원문을 담당자가 확인하고 출처 URL과 원문 무결성 확인값을 기록한 자료만 AI 보고서의 확정 근거로 사용됩니다.</span>
      </div>

      <div className="litigation-kpis" aria-label="소송 관리 요약">
        <article><span>LINKED CASES</span><strong>{summary.total}</strong><small>연결 사건</small></article>
        <article><span>UPCOMING</span><strong>{summary.upcoming}</strong><small>예정 공판</small></article>
        <article><span>VERIFIED</span><strong>{summary.verified}</strong><small>보고서 근거 가능</small></article>
        <article><span>CONFLICT</span><strong>{summary.conflicts}</strong><small>사람 확인 필요</small></article>
      </div>

      <form className="litigation-search" onSubmit={(event) => { event.preventDefault(); void loadRecords(); }}>
        <label><span>통합 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="법원 사건번호, 법원, 당사자, 프로젝트" /></label>
        <label><span>프로젝트</span><select value={caseFilter} onChange={(event) => setCaseFilter(event.target.value)}><option value="">전체 프로젝트</option>{cases.map((entry) => <option key={entry.id} value={entry.id}>{entry.caseNumber} · {entry.title}</option>)}</select></label>
        <label><span>소송 단계</span><select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="">전체 단계</option>{STAGES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
        <button type="submit">검색</button>
      </form>

      {error && <div className="litigation-error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadRecords()}>최신 데이터 다시 불러오기</button></div>}
      {notice && <div className="litigation-notice" role="status">{notice}</div>}

      <div className="litigation-layout">
        <aside className="litigation-list" aria-label="법원 사건 목록">
          <header><strong>법원 사건</strong><span>{records.length}건</span></header>
          {records.length === 0 ? <div className="litigation-empty"><strong>연결된 법원 사건이 없습니다.</strong><span>프로젝트를 선택해 첫 사건번호를 연결하세요.</span></div> : records.map((record) => (
            <button type="button" key={record.id} className={selectedId === record.id ? 'is-active' : ''} onClick={() => { setShowCreate(false); setSelectedId(record.id); setNotice(''); }}>
              <span className={`litigation-status is-${record.verificationStatus.toLowerCase()}`}>{record.verificationStatus === 'VERIFIED' ? '공식 확인' : record.verificationStatus === 'CONFLICT' ? '충돌' : '미확인'}</span>
              <strong>{record.courtCaseNumber}</strong>
              <span title={record.caseTitle}>{record.caseTitle}</span>
              <small>{record.projectCaseNumber} · {STAGE_LABEL[record.currentStage]}</small>
              <small>다음 공판 {displayDate(record.nextHearingAt)}</small>
            </button>
          ))}
        </aside>

        <main className="litigation-detail">
          {showCreate ? (
            <RecordEditor title="새 법원 사건 연결" form={recordForm} cases={cases} busy={busy === 'create'} creating canMutate={canMutate} onChange={setRecordForm} onSubmit={() => void submitRecord(true)} onCancel={() => { setShowCreate(false); setSelectedId(records[0]?.id ?? ''); }} />
          ) : selected ? (
            <>
              <section className="litigation-record-head">
                <div>
                  <span>{selected.courtName} · {selected.divisionName || '재판부 미입력'}</span>
                  <h3>{selected.courtCaseNumber}</h3>
                  <p>{selected.caseTitle}</p>
                </div>
                <div className="litigation-evidence-state">
                  <span className={`litigation-status is-${selected.verificationStatus.toLowerCase()}`}>{selected.reportEvidenceEligible ? 'REPORT EVIDENCE READY' : 'HUMAN CHECK REQUIRED'}</span>
                  <small>공식 확인 이력 {selected.verifiedEventCount}/{selected.eventCount}</small>
                  {selected.officialSourceUrl && <a href={selected.officialSourceUrl} target="_blank" rel="noreferrer">법원 공식 출처 열기 ↗</a>}
                </div>
              </section>
              <RecordEditor title="사건 기본정보" form={recordForm} cases={cases} busy={busy === 'update'} creating={false} canMutate={canMutate} version={selected.version} onChange={setRecordForm} onSubmit={() => void submitRecord(false)} />

              <section className="litigation-panel">
                <div className="litigation-section-heading"><div><span>COURT EVENT</span><h3>소송 이력 추가</h3></div><small>공판 일정은 프로젝트 캘린더에도 동시에 기록됩니다.</small></div>
                <div className="litigation-form-grid">
                  <label><span>이력 유형</span><select value={eventForm.eventType} disabled={!canMutate || busy === 'event'} onChange={(event) => setEventForm((current) => ({ ...current, eventType: event.target.value as LitigationEventType, createCourtSchedule: event.target.value === 'HEARING' }))}>{EVENT_TYPES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
                  <label><span>발생 일시</span><input type="datetime-local" value={eventForm.occurredAt} disabled={!canMutate || busy === 'event'} onChange={(event) => setEventForm((current) => ({ ...current, occurredAt: event.target.value }))} /></label>
                  <label className="span-2"><span>이력 제목</span><input value={eventForm.title} maxLength={300} disabled={!canMutate || busy === 'event'} onChange={(event) => setEventForm((current) => ({ ...current, title: event.target.value }))} placeholder="예: 제3차 변론기일" /></label>
                  <label className="span-2"><span>상세 내용</span><textarea value={eventForm.detailText} maxLength={5000} disabled={!canMutate || busy === 'event'} onChange={(event) => setEventForm((current) => ({ ...current, detailText: event.target.value }))} placeholder="법원 통지 내용, 제출 서면, 다음 조치 등을 기록하세요." /></label>
                  <label><span>근거 검증</span><select value={eventForm.verificationStatus} disabled={!canMutate || busy === 'event'} onChange={(event) => setEventForm((current) => ({ ...current, verificationStatus: event.target.value as VerificationStatus }))}><option value="UNVERIFIED">미확인</option><option value="VERIFIED">공식 원문 확인</option><option value="CONFLICT">자료 충돌</option></select></label>
                  <label><span>원문 무결성 확인값</span><input value={eventForm.sourceSha256} pattern="[0-9A-Fa-f]{64}" disabled={!canMutate || busy === 'event'} onChange={(event) => setEventForm((current) => ({ ...current, sourceSha256: event.target.value }))} placeholder="공식 원문 확인 시 64자리 값" /></label>
                  <label className="span-2"><span>법원 공식 출처 URL</span><input type="url" value={eventForm.officialSourceUrl} disabled={!canMutate || busy === 'event'} onChange={(event) => setEventForm((current) => ({ ...current, officialSourceUrl: event.target.value }))} placeholder="https://www.scourt.go.kr/..." /></label>
                </div>
                <div className="litigation-actions">
                  {eventForm.eventType === 'HEARING' && <label className="litigation-check"><input type="checkbox" checked={eventForm.createCourtSchedule} disabled={!canMutate || busy === 'event'} onChange={(event) => setEventForm((current) => ({ ...current, createCourtSchedule: event.target.checked }))} /> 프로젝트 일정표에 공판 일정 동시 등록</label>}
                  <button type="button" className="litigation-primary" disabled={!canMutate || busy === 'event' || !eventForm.occurredAt || !eventForm.title.trim() || !eventForm.detailText.trim()} onClick={() => void submitEvent()}>{busy === 'event' ? '저장 중…' : '타임라인에 저장'}</button>
                </div>
              </section>

              <section className="litigation-panel">
                <div className="litigation-section-heading"><div><span>IMMUTABLE HISTORY</span><h3>법원·소송 타임라인</h3></div><small>최대 100건 · 저장 후 원문 수정/삭제 불가</small></div>
                {events.length === 0 ? <div className="litigation-empty">아직 기록된 소송 이력이 없습니다.</div> : <ol className="litigation-timeline">{events.map((entry) => (
                  <li key={entry.id}>
                    <span className="litigation-timeline-dot" />
                    <div><header><strong>{EVENT_LABEL[entry.eventType]} · {entry.title}</strong><time>{displayDate(entry.occurredAt)}</time></header><p>{entry.detailText}</p><footer><span>{entry.createdByName}</span><span className={`litigation-status is-${entry.verificationStatus.toLowerCase()}`}>{entry.verificationStatus === 'VERIFIED' ? '공식 확인' : entry.verificationStatus === 'CONFLICT' ? '충돌' : '미확인'}</span>{entry.scheduleId && <span>캘린더 연결됨</span>}{entry.officialSourceUrl && <a href={entry.officialSourceUrl} target="_blank" rel="noreferrer">원문 ↗</a>}</footer></div>
                  </li>
                ))}</ol>}
              </section>
            </>
          ) : (
            <div className="litigation-welcome"><span>COURT CASE WORKSPACE</span><h3>관리할 법원 사건을 선택하세요.</h3><p>사건번호·공판일·판결·납품 후 수정 차수를 프로젝트 단위로 연결합니다.</p><button type="button" onClick={() => onNavigate('/cases')}>프로젝트 목록 보기</button></div>
          )}
        </main>
      </div>
    </section>
  );
}

function RecordEditor({ title, form, cases, busy, creating, canMutate, version, onChange, onSubmit, onCancel }: {
  title: string; form: RecordForm; cases: CaseOption[]; busy: boolean; creating: boolean; canMutate: boolean; version?: number;
  onChange: (value: RecordForm) => void; onSubmit: () => void; onCancel?: () => void;
}): React.ReactElement {
  const patch = <K extends keyof RecordForm>(key: K, value: RecordForm[K]) => onChange({ ...form, [key]: value });
  const officialRequired = form.verificationStatus === 'VERIFIED';
  return (
    <section className="litigation-panel">
      <div className="litigation-section-heading"><div><span>{creating ? 'LINK NEW CASE' : `OPTIMISTIC VERSION · ${version}`}</span><h3>{title}</h3></div><small>{canMutate ? 'PM 이상 역할이 저장할 수 있습니다.' : '읽기 전용 권한입니다.'}</small></div>
      <div className="litigation-form-grid">
        <label className="span-2"><span>연결 프로젝트</span><select value={form.caseId} disabled={!creating || busy || !canMutate} onChange={(event) => patch('caseId', event.target.value)}><option value="">프로젝트 선택</option>{cases.map((entry) => <option key={entry.id} value={entry.id}>{entry.caseNumber} · {entry.title}</option>)}</select></label>
        <label><span>법원명</span><input value={form.courtName} maxLength={200} disabled={busy || !canMutate} onChange={(event) => patch('courtName', event.target.value)} placeholder="서울중앙지방법원" /></label>
        <label><span>법원 사건번호</span><input value={form.courtCaseNumber} maxLength={80} disabled={busy || !canMutate} onChange={(event) => patch('courtCaseNumber', event.target.value)} placeholder="2026가합00000" /></label>
        <label className="span-2"><span>소송 사건명</span><input value={form.caseTitle} maxLength={500} disabled={busy || !canMutate} onChange={(event) => patch('caseTitle', event.target.value)} placeholder="공사대금 청구의 소" /></label>
        <label><span>재판부</span><input value={form.divisionName} maxLength={200} disabled={busy || !canMutate} onChange={(event) => patch('divisionName', event.target.value)} placeholder="민사 제00부" /></label>
        <label><span>법원 접수일</span><input type="date" value={form.filedOn} disabled={busy || !canMutate} onChange={(event) => patch('filedOn', event.target.value)} /></label>
        <label className="span-2"><span>당사자</span><input value={form.partiesText} maxLength={2000} disabled={busy || !canMutate} onChange={(event) => patch('partiesText', event.target.value)} placeholder="원고 주식회사 ○○ / 피고 주식회사 △△" /></label>
        <label><span>현재 단계</span><select value={form.currentStage} disabled={busy || !canMutate} onChange={(event) => patch('currentStage', event.target.value as LitigationStage)}>{STAGES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
        <label><span>다음 공판 일시</span><input type="datetime-local" value={form.nextHearingAt} disabled={busy || !canMutate} onChange={(event) => patch('nextHearingAt', event.target.value)} /></label>
        <label><span>출처 검증 상태</span><select value={form.verificationStatus} disabled={busy || !canMutate} onChange={(event) => patch('verificationStatus', event.target.value as VerificationStatus)}><option value="UNVERIFIED">미확인 · AI 확정 근거 제외</option><option value="VERIFIED">공식 원문 확인 · 보고서 근거 가능</option><option value="CONFLICT">자료 충돌 · 사람 확인 필요</option></select></label>
        <label><span>법원 공식 출처 URL{officialRequired ? ' · 필수' : ''}</span><input type="url" value={form.officialSourceUrl} disabled={busy || !canMutate} onChange={(event) => patch('officialSourceUrl', event.target.value)} placeholder="https://www.scourt.go.kr/..." /></label>
      </div>
      <div className="litigation-actions">
        {onCancel && <button type="button" className="litigation-secondary" onClick={onCancel}>취소</button>}
        <button type="button" className="litigation-primary" disabled={!canMutate || busy || !form.caseId || !form.courtName.trim() || !form.courtCaseNumber.trim() || !form.caseTitle.trim() || !form.partiesText.trim() || (officialRequired && !form.officialSourceUrl.trim())} onClick={onSubmit}>{busy ? '저장 중…' : creating ? '프로젝트에 연결' : '변경사항 저장'}</button>
      </div>
    </section>
  );
}
