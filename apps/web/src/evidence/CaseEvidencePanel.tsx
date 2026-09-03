import { fetchEvidenceUpload } from './upload-evidence';
import { Button } from '@claim-studio/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

export type CaseEvidenceCategory =
  | 'INTAKE_REFERENCE' | 'PROPOSAL_REFERENCE' | 'KICKOFF_MATERIAL' | 'MEETING_MINUTES'
  | 'MEETING_RECORDING' | 'SITE_PHOTO' | 'SITE_RECORDING' | 'SITE_DOCUMENT'
  | 'TAKEOFF_SOURCE' | 'COST_BREAKDOWN' | 'REPORT_REFERENCE' | 'COURT_DOCUMENT'
  | 'FINAL_DELIVERABLE';

interface CaseEvidenceFile {
  id: string;
  category: CaseEvidenceCategory;
  originalName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  storageProvider: 'D1_TEMPORARY' | 'GOOGLE_DRIVE';
  uploadedBy: string;
  uploadedAt: string;
  downloadUrl: string;
  driveUrl: string | null;
  displayName?: string;
  versionNumber?: number;
  isLatest?: boolean;
  changeSummary?: string[];
}

const categoryCopy: Record<CaseEvidenceCategory, { title: string; description: string; icon: string; phase: string }> = {
  INTAKE_REFERENCE: { title: '의뢰·발주처 자료', description: '의뢰서, 발주처 제공 원본, 계약 전 자료', icon: 'IN', phase: '의뢰' },
  PROPOSAL_REFERENCE: { title: '제안서 근거자료', description: '제안 범위·견적·발송본의 근거', icon: 'PR', phase: '제안' },
  KICKOFF_MATERIAL: { title: '착수회의 제공자료', description: '착수 시 전달받은 도서와 참고자료', icon: 'KO', phase: '착수' },
  MEETING_MINUTES: { title: '회의록', description: '착수·실무·협의 회의록과 메모', icon: 'MN', phase: '착수' },
  MEETING_RECORDING: { title: '회의 녹음', description: '회의 음성 원본 MP3·M4A·WAV', icon: 'AU', phase: '착수' },
  SITE_PHOTO: { title: '현장조사 사진', description: '현장 사진, 촬영 위치·시점 원본', icon: 'PH', phase: '현장' },
  SITE_RECORDING: { title: '현장조사 녹음', description: '현장 설명·인터뷰·구술 기록', icon: 'SR', phase: '현장' },
  SITE_DOCUMENT: { title: '현장조사 기타자료', description: '조사표, 도면, 측정값, 기타 원본', icon: 'SD', phase: '현장' },
  TAKEOFF_SOURCE: { title: '산출자료', description: '도면, 실측표, 산출근거, 검토용 원본', icon: 'Σ', phase: '산출' },
  COST_BREAKDOWN: { title: '내역자료', description: '계약내역, 공사비 내역, 단가·금액 검토표', icon: '₩', phase: '산출' },
  REPORT_REFERENCE: { title: '보고서 근거자료', description: '본문·부록·검토의견 작성 근거', icon: 'RP', phase: '보고' },
  COURT_DOCUMENT: { title: '법원·소송자료', description: '소장, 준비서면, 결정·판결 관련 자료', icon: 'CT', phase: '법원' },
  FINAL_DELIVERABLE: { title: '최종 납품본', description: '승인된 최종 보고서와 납품 패키지', icon: 'OK', phase: '납품' }
};
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.hwpx,.txt,.csv,.png,.jpg,.jpeg,.webp,.mp3,.m4a,.wav,.ogg,.webm';

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function CaseEvidencePanel({ caseId, defaultCategory = 'TAKEOFF_SOURCE', allowedCategories, compact = false, onNavigate }: { caseId: string; defaultCategory?: CaseEvidenceCategory; allowedCategories?: readonly CaseEvidenceCategory[]; compact?: boolean; onNavigate: (path: string) => void }): React.ReactElement {
  const categoryKey = allowedCategories?.join('|') ?? 'ALL';
  const visibleCategories = allowedCategories?.length ? allowedCategories : Object.keys(categoryCopy) as CaseEvidenceCategory[];
  const initialCategory = visibleCategories.includes(defaultCategory) ? defaultCategory : visibleCategories[0] ?? defaultCategory;
  const [category, setCategory] = useState<CaseEvidenceCategory>(initialCategory);
  const [files, setFiles] = useState<CaseEvidenceFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [storagePolicy, setStoragePolicy] = useState<'GOOGLE_DRIVE_REQUIRED' | 'D1_TEST_FALLBACK'>('D1_TEST_FALLBACK');
  const [googleDriveConnected, setGoogleDriveConnected] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [draggingCategory, setDraggingCategory] = useState<CaseEvidenceCategory | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const keysRef = useRef(new Map<string, string>());
  const caseIdRef = useRef(caseId);
  const loadSequenceRef = useRef(0);
  const uploadBusyRef = useRef(false);
  const load = useCallback(async () => {
    if (!caseId) { setFiles([]); return; }
    const requestCaseId = caseId;
    const sequence = ++loadSequenceRef.current;
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(requestCaseId)}/evidence`, { headers: { Accept: 'application/json' } });
      const payload = await response.json() as { files?: CaseEvidenceFile[]; error?: string; storagePolicy?: 'GOOGLE_DRIVE_REQUIRED' | 'D1_TEST_FALLBACK'; googleDriveConnected?: boolean };
      if (!response.ok) throw new Error(payload.error ?? '프로젝트 자료를 불러오지 못했습니다.');
      if (sequence !== loadSequenceRef.current || caseIdRef.current !== requestCaseId) return;
      setFiles(payload.files ?? []);
      setStoragePolicy(payload.storagePolicy ?? 'D1_TEST_FALLBACK');
      setGoogleDriveConnected(Boolean(payload.googleDriveConnected));
    } catch (reason) { if (sequence === loadSequenceRef.current && caseIdRef.current === requestCaseId) setError(reason instanceof Error ? reason.message : '프로젝트 자료를 불러오지 못했습니다.'); }
    finally { if (sequence === loadSequenceRef.current && caseIdRef.current === requestCaseId) setLoading(false); }
  }, [caseId]);

  useEffect(() => { caseIdRef.current = caseId; loadSequenceRef.current += 1; setFiles([]); setCategory(initialCategory); setNotice(''); setError(''); setUploading(0); setDragging(false); setDraggingCategory(null); setGoogleDriveConnected(false); }, [caseId, categoryKey, initialCategory]);
  useEffect(() => { void load(); }, [load]);

  const upload = async (incoming: FileList | File[], requestedCategory: CaseEvidenceCategory = category) => {
    const selected = Array.from(incoming);
    if (!caseId || !selected.length || uploadBusyRef.current) return;
    if (storagePolicy === 'GOOGLE_DRIVE_REQUIRED' && !googleDriveConnected) { setError('관리자 설정에서 회사 Google Drive 계정을 먼저 연결해 주세요.'); return; }
    const targetCaseId = caseId;
    const targetCategory = requestedCategory;
    uploadBusyRef.current = true;
    setCategory(targetCategory);
    setUploading(selected.length); setError(''); setNotice('');
    let completed = 0;
    for (const file of selected) {
      if (caseIdRef.current !== targetCaseId) break;
      const fingerprint = `${targetCaseId}:${targetCategory}:${file.name}:${file.size}:${file.lastModified}`;
      const key = keysRef.current.get(fingerprint) ?? `case-evidence-${crypto.randomUUID()}`;
      keysRef.current.set(fingerprint, key);
      try {
        const form = new FormData();
        form.set('file', file); form.set('category', targetCategory);
        const response = await fetchEvidenceUpload(`/api/cases/${encodeURIComponent(targetCaseId)}/evidence`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: form }, { isCurrent: () => caseIdRef.current === targetCaseId });
        const payload = await response.json() as { file?: CaseEvidenceFile; error?: string; code?: string };
        if (caseIdRef.current !== targetCaseId) break;
        if (['DUPLICATE_EXACT', 'UPLOAD_CANCELLED'].includes(payload.code ?? '')) { keysRef.current.delete(fingerprint); continue; }
        if (!response.ok || !payload.file) throw new Error(payload.error ?? `${file.name}: 업로드에 실패했습니다.`);
        keysRef.current.delete(fingerprint);
        completed += 1;
        await load();
      } catch (reason) { if (caseIdRef.current === targetCaseId) setError(reason instanceof Error ? reason.message : `${file.name}: 업로드에 실패했습니다.`); }
      finally { if (caseIdRef.current === targetCaseId) setUploading((count) => Math.max(0, count - 1)); }
    }
    uploadBusyRef.current = false;
    if (completed && caseIdRef.current === targetCaseId) setNotice(`${categoryCopy[targetCategory].title} 파일 ${completed}개를 프로젝트 자료실에 저장했습니다.`);
    if (inputRef.current) inputRef.current.value = '';
  };

  const download = async (file: CaseEvidenceFile) => {
    setError('');
    try {
      const response = await fetch(`/api/cases/evidence/${encodeURIComponent(file.id)}/download`);
      if (!response.ok) throw new Error('파일 무결성 확인 또는 다운로드에 실패했습니다.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.displayName ?? file.originalName; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '파일 다운로드에 실패했습니다.'); }
  };

  const categoryFiles = files.filter((file) => file.category === category);
  const latestFiles = categoryFiles.filter((file) => file.isLatest !== false);
  const archivedFiles = categoryFiles.filter((file) => file.isLatest === false);
  const visibleFiles = compact ? latestFiles.slice(0, 6) : latestFiles;
  const fileRow = (file: CaseEvidenceFile) => <li key={file.id}><b aria-hidden="true">{categoryCopy[file.category].icon}</b><div><strong title={file.originalName}>{file.originalName}</strong><small>v{file.versionNumber ?? 1} · {new Date(file.uploadedAt).toLocaleString('ko-KR')} · {file.uploadedBy} · {formatBytes(file.byteSize)}</small>{Boolean(file.changeSummary?.length) && <details className="evidence-change-summary"><summary title={file.changeSummary?.join('\n')}>Gemini 변경 요약</summary><ul>{file.changeSummary?.map((text, index) => <li key={index}>{text}</li>)}</ul></details>}</div><span className={`evidence-version-badge ${file.isLatest === false ? 'is-archive' : 'is-latest'}`}>{file.isLatest === false ? '이전 버전 / ARCHIVE' : '최신본 / FINAL'}</span><div className="case-evidence-file-actions"><Button size="sm" variant="secondary" onClick={() => void download(file)}>스튜디오 권한으로 다운로드</Button></div></li>;
  const uploadDisabled = Boolean(uploading) || (storagePolicy === 'GOOGLE_DRIVE_REQUIRED' && !googleDriveConnected);
  return <section className={`case-evidence-panel${compact ? ' is-compact' : ''}`} aria-label="프로젝트 통합 자료실">
    {!compact && <h3>프로젝트 자료 → 회사 Google Drive에 업로드하세요</h3>}
    <div className="case-evidence-categories" role="tablist" aria-label="자료 구분">
      {visibleCategories.map((value) => <button key={value} type="button" role="tab" aria-selected={category === value} className={`${category === value ? 'is-active' : ''}${draggingCategory === value ? ' is-drop-target' : ''}`} onClick={() => setCategory(value)} onDragEnter={(event) => { event.preventDefault(); if (!uploadDisabled) setDraggingCategory(value); }} onDragOver={(event) => { event.preventDefault(); if (!uploadDisabled) setDraggingCategory(value); }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDraggingCategory(null); }} onDrop={(event) => { event.preventDefault(); setDraggingCategory(null); if (!uploadDisabled && event.dataTransfer.files.length) void upload(event.dataTransfer.files, value); }}><b aria-hidden="true">{categoryCopy[value].icon}</b><span><i>{categoryCopy[value].phase}</i><strong>{categoryCopy[value].title}</strong><small>{categoryCopy[value].description} · 여기에 바로 드롭</small></span><em>{files.filter((file) => file.category === value).length}</em></button>)}
    </div>
    <div className={`case-evidence-dropzone${dragging ? ' is-dragging' : ''}${uploadDisabled ? ' is-disabled' : ''}`} onDragEnter={(event) => { event.preventDefault(); if (!uploadDisabled) setDragging(true); }} onDragOver={(event) => { event.preventDefault(); if (!uploadDisabled) setDragging(true); }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); if (!uploadDisabled && event.dataTransfer.files) void upload(event.dataTransfer.files); }}>
      <input ref={inputRef} type="file" multiple accept={ACCEPT} disabled={uploadDisabled} onChange={(event) => event.target.files && void upload(event.target.files)} />
      <span aria-hidden="true">⇧</span><div><strong>{categoryCopy[category].title} → 회사 Google Drive에 업로드하세요</strong><small>{uploading ? `${uploading}개 파일 저장 중… · ` : uploadDisabled ? '회사 Google Drive 연결이 필요합니다 · ' : '파일을 끌어다 놓거나 선택하세요 · '}문서·사진·녹음파일 최대 10MB · CONCOST 자료실/20_클레임센터/프로젝트명/자료종류(업로더_날짜)에 저장합니다.{storagePolicy === 'D1_TEST_FALLBACK' && ' Drive 연결 전에는 임시 보관됩니다.'}</small></div><Button disabled={uploadDisabled} onClick={() => inputRef.current?.click()}>파일 선택</Button>
    </div>
    <p className="case-evidence-storage-note"><strong>{storagePolicy === 'GOOGLE_DRIVE_REQUIRED' ? '회사 Google Drive 저장' : '임시 보관'}</strong> {storagePolicy === 'GOOGLE_DRIVE_REQUIRED' ? googleDriveConnected ? '회사 계정 연결 완료 · 개인 Google 계정 공유 없이 소관 부서(클레임센터·경영지원본부), 관리자 또는 해당 프로젝트에 배정된 회원이 스튜디오 로그인으로 이용합니다.' : '업로드가 잠겨 있습니다. 관리자에게 회사 Drive 연결을 요청하세요.' : '회사 Drive 연결 전에는 업로드 자료를 임시 보관합니다.'} {googleDriveConnected && <button type="button" className="case-evidence-drive-link" onClick={() => onNavigate(`/cases/files?caseId=${encodeURIComponent(caseId)}`)}>스튜디오 자료실에서 보기 →</button>}</p>
    {notice && <p className="notice-box" role="status">{notice}</p>}{error && <p className="error-box" role="alert">{error} <button type="button" onClick={() => void load()}>다시 확인</button></p>}
    <div className="case-evidence-list"><header><div><span>PROJECT EVIDENCE</span><h3>{categoryCopy[category].title} 목록</h3></div><div><em>{categoryFiles.length} FILES</em>{compact && <Button size="sm" variant="secondary" onClick={() => onNavigate(`/cases/files?caseId=${encodeURIComponent(caseId)}`)}>자료실 전체 보기</Button>}</div></header>
      {loading ? <p className="case-evidence-empty">자료 목록을 불러오는 중입니다.</p> : visibleFiles.length ? <ul>{visibleFiles.map(fileRow)}</ul> : <p className="case-evidence-empty">아직 저장된 최신 자료가 없습니다. 위 영역에 첫 자료를 올려 주세요.</p>}
      {archivedFiles.length > 0 && <details className="evidence-archive"><summary>이전 버전 / ARCHIVE · {archivedFiles.length}개</summary><ul>{archivedFiles.map(fileRow)}</ul></details>}
    </div>
  </section>;
}
