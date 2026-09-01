import { Button, Card, Select, StatusBadge } from '@claim-studio/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../api';
import { StatusFeedbackState } from '../layout/StatusFeedbackState';

type ProviderKind = 'OPENAI' | 'ANTHROPIC' | 'GEMINI';
type TaskKind = 'OUTLINE_PLANNING' | 'CHAPTER_WRITING' | 'FACT_CHECK';
interface AiProvider { providerKind: ProviderKind; label: string; secretName: string; connected: boolean; models: Array<{ code: string; label: string }> }
interface AiRoute { taskKind: TaskKind; providerKind: ProviderKind; modelCode: string; reasoningEffort: string; version: number; updatedAt: string; updatedByName: string; connected: boolean }
interface AiConfig { providers: AiProvider[]; routes: AiRoute[] }
interface ChapterPrompt { id: string; chapterCode: string; title: string; agentCode: string; rolePrompt: string; instructionPrompt: string; ordinal: number; version: number; updatedAt: string; updatedBy: string; sourceCategoryCodes: string[]; sourceAnalysisNote: string; sourceAnalysisVersion: number }
interface PromptSet { claimType: string; name: string; status: string; systemPrompt: string; chapters: ChapterPrompt[] }
interface TypeGuideline { claimType: string; typeName: string; targetWork: string; tocBlueprint: string; stage1Prompt: string; stage2Prompt: string; sourceFileName: string; sourceSha256: string; status: string; version: number; updatedAt: string; updatedByName: string }
interface GuidelinePackage { packageId: string; packageName: string; schemaVersion: string; effectiveFrom: string; sourceZipSha256: string; reportTemplateZipSha256: string; proposalTemplateZipSha256: string; typeCount: number; chapterCount: number; moduleCount: number; outputProfileCount: number; installedAt: string; installedByName: string }
interface TemplateLibraryFile { id: string; originalName: string; fileExtension: string; byteSize: number; sha256: string; uploadedAt: string; uploadedByName: string; viewMode: 'INLINE' | 'DOWNLOAD'; contentUrl: string }
interface TemplateLibraryCategory { id: string; categoryCode: string; displayName: string; primaryClaimType: string; secondaryClaimTypes: string[]; expectedSourceCount: number; uploadedSourceCount: number; analysisSummary: string; outline: string[]; analysisVersion: number; files: TemplateLibraryFile[] }
interface AdminPromptPayload { aiConfig: AiConfig; promptSets: PromptSet[]; typeGuidelines: TypeGuideline[]; guidelinePackage?: GuidelinePackage | null; templateLibrary: TemplateLibraryCategory[] }

const TASK_LABELS: Record<TaskKind, { title: string; detail: string }> = {
  OUTLINE_PLANNING: { title: '목차 기획', detail: '보고서 구조와 챕터별 계획을 설계합니다.' },
  CHAPTER_WRITING: { title: '챕터 본문 작성', detail: '확정 목차와 사건 근거로 실제 보고서 문장을 작성합니다.' },
  FACT_CHECK: { title: '사실·근거 확인', detail: '수치·날짜·출처의 누락과 충돌을 점검합니다.' }
};

export function PreviewAiAdmin(): React.ReactElement {
  const [payload, setPayload] = useState<AdminPromptPayload | null>(null);
  const [routeDrafts, setRouteDrafts] = useState<Record<string, AiRoute>>({});
  const [selectedType, setSelectedType] = useState('TYPE-01');
  const [selectedChapter, setSelectedChapter] = useState('');
  const [rolePrompt, setRolePrompt] = useState('');
  const [instructionPrompt, setInstructionPrompt] = useState('');
  const [guidelineDraft, setGuidelineDraft] = useState({ targetWork: '', tocBlueprint: '', stage1Prompt: '', stage2Prompt: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [templateCategoryCode, setTemplateCategoryCode] = useState('REF-01');
  const [templateImporting, setTemplateImporting] = useState(false);
  const [templateImportProgress, setTemplateImportProgress] = useState('');
  const templateImportKeys = useRef(new Map<string, string>());
  const templateFolderInput = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const next = await apiRequest<AdminPromptPayload>('/api/admin/report-prompts');
      const templateLibrary = next.templateLibrary ?? [];
      setPayload({ ...next, templateLibrary }); setRouteDrafts(Object.fromEntries(next.aiConfig.routes.map((route) => [route.taskKind, route])));
      setTemplateCategoryCode((current) => templateLibrary.some((category) => category.categoryCode === current) ? current : templateLibrary[0]?.categoryCode ?? 'REF-01');
      const type = next.promptSets.some((entry) => entry.claimType === selectedType) ? selectedType : next.promptSets[0]?.claimType ?? '';
      setSelectedType(type);
      setSelectedChapter((current) => next.promptSets.find((entry) => entry.claimType === type)?.chapters.some((chapter) => chapter.id === current) ? current : next.promptSets.find((entry) => entry.claimType === type)?.chapters[0]?.id ?? '');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  const promptSet = useMemo(() => payload?.promptSets.find((entry) => entry.claimType === selectedType) ?? null, [payload, selectedType]);
  const typeGuideline = useMemo(() => payload?.typeGuidelines?.find((entry) => entry.claimType === selectedType) ?? null, [payload, selectedType]);
  const chapter = useMemo(() => promptSet?.chapters.find((entry) => entry.id === selectedChapter) ?? null, [promptSet, selectedChapter]);
  useEffect(() => { setRolePrompt(chapter?.rolePrompt ?? ''); setInstructionPrompt(chapter?.instructionPrompt ?? ''); }, [chapter?.id, chapter?.version]);
  useEffect(() => { setGuidelineDraft(typeGuideline ? { targetWork: typeGuideline.targetWork, tocBlueprint: typeGuideline.tocBlueprint, stage1Prompt: typeGuideline.stage1Prompt, stage2Prompt: typeGuideline.stage2Prompt } : { targetWork: '', tocBlueprint: '', stage1Prompt: '', stage2Prompt: '' }); }, [typeGuideline?.claimType, typeGuideline?.version]);

  const provider = (kind: ProviderKind) => payload?.aiConfig.providers.find((item) => item.providerKind === kind);
  const changeRoute = (task: TaskKind, change: Partial<AiRoute>) => setRouteDrafts((current) => {
    const base = current[task]; if (!base) return current;
    const next = { ...base, ...change };
    if (change.providerKind) next.modelCode = provider(change.providerKind)?.models[0]?.code ?? '';
    return { ...current, [task]: next };
  });

  const saveRoute = async (task: TaskKind) => {
    const route = routeDrafts[task]; if (!payload || !route) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ settings: AiRoute; aiConfig: AiConfig }>('/api/admin/report-prompts/settings', { method: 'PUT', body: JSON.stringify({ taskKind: task, providerKind: route.providerKind, modelCode: route.modelCode, reasoningEffort: route.reasoningEffort, expectedVersion: route.version }) });
      setPayload({ ...payload, aiConfig: result.aiConfig });
      setRouteDrafts(Object.fromEntries(result.aiConfig.routes.map((item) => [item.taskKind, item])));
      setNotice(`${TASK_LABELS[task].title} 모델을 ${result.settings.providerKind} · ${result.settings.modelCode}로 저장했습니다.`);
    } catch (reason) { setError(reason instanceof ApiError && reason.status === 409 ? '다른 관리자가 설정을 변경했습니다. 새로고침 후 다시 시도하세요.' : reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };

  const changeType = (value: string) => { const next = payload?.promptSets.find((entry) => entry.claimType === value); setSelectedType(value); setSelectedChapter(next?.chapters[0]?.id ?? ''); setNotice(''); setError(''); };
  const savePrompt = async () => {
    if (!payload || !chapter) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ prompt: { rolePrompt: string; instructionPrompt: string; version: number; updatedAt: string } }>(`/api/admin/report-prompts/${selectedType}/${chapter.chapterCode}`, { method: 'PUT', body: JSON.stringify({ rolePrompt, instructionPrompt, expectedVersion: chapter.version }) });
      setPayload({ ...payload, promptSets: payload.promptSets.map((set) => set.claimType !== selectedType ? set : { ...set, chapters: set.chapters.map((item) => item.id !== chapter.id ? item : { ...item, ...result.prompt, updatedBy: '현재 관리자' }) }) });
      setNotice(`${chapter.chapterCode} 프롬프트 v${result.prompt.version}을 저장했습니다.`);
    } catch (reason) { setError(reason instanceof ApiError && reason.status === 409 ? '다른 관리자가 프롬프트를 변경했습니다. 새로고침 후 다시 시도하세요.' : reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };

  const saveTypeGuideline = async () => {
    if (!payload || !typeGuideline) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ guideline: TypeGuideline }>(`/api/admin/report-guidelines/${selectedType}`, { method: 'PUT', body: JSON.stringify({ ...guidelineDraft, expectedVersion: typeGuideline.version }) });
      setPayload({ ...payload, typeGuidelines: payload.typeGuidelines.map((item) => item.claimType === selectedType ? result.guideline : item) });
      setNotice(`${selectedType} 유형별 작성 지침 v${result.guideline.version}을 저장했습니다.`);
    } catch (reason) { setError(reason instanceof ApiError && reason.status === 409 ? '다른 관리자가 유형별 지침을 변경했습니다. 새로고침 후 다시 시도하세요.' : reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };

  const importTemplateFolder = async (incoming: FileList | null) => {
    if (!incoming?.length || !payload) return;
    const files = Array.from(incoming).filter((file) => /\.(?:pdf|hwp|hwpx|xlsx)$/iu.test(file.name));
    if (!files.length) { setError('선택한 폴더에 PDF·HWP·HWPX·XLSX 보고서 템플릿이 없습니다.'); return; }
    setTemplateImporting(true); setError(''); setNotice('');
    let completed = 0;
    let failed = 0;
    for (const file of files) {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
      const detectedCode = relativePath.split('/').map((part) => part.match(/^(0[1-9])\./u)?.[1]).find(Boolean);
      const categoryCode = detectedCode ? `REF-${detectedCode}` : templateCategoryCode;
      const fingerprint = `${categoryCode}:${relativePath || file.name}:${file.size}:${file.lastModified}`;
      const requestKey = templateImportKeys.current.get(fingerprint) ?? `template-${crypto.randomUUID()}`;
      templateImportKeys.current.set(fingerprint, requestKey);
      setTemplateImportProgress(`${completed + failed + 1}/${files.length} · ${file.name}`);
      try {
        const form = new FormData(); form.set('categoryCode', categoryCode); form.set('file', file);
        const response = await fetch('/api/admin/report-templates/import', { method: 'POST', credentials: 'include', headers: { 'Idempotency-Key': requestKey }, body: form });
        const result = await response.json() as { categories?: TemplateLibraryCategory[]; error?: string };
        if (!response.ok || !result.categories) throw new Error(result.error ?? `${file.name} 등록에 실패했습니다.`);
        templateImportKeys.current.delete(fingerprint);
        setPayload((current) => current ? { ...current, templateLibrary: result.categories as TemplateLibraryCategory[] } : current);
        completed += 1;
      } catch (reason) { failed += 1; setError(reason instanceof Error ? reason.message : `${file.name} 등록에 실패했습니다.`); }
    }
    setTemplateImportProgress(''); setTemplateImporting(false);
    if (templateFolderInput.current) templateFolderInput.current.value = '';
    if (completed) setNotice(`회사 Google Drive 보고서 템플릿 라이브러리에 ${completed}개 원본을 등록했습니다.${failed ? ` ${failed}개는 오류를 확인해 주세요.` : ''}`);
  };

  if (loading) return <StatusFeedbackState type="loading" message="관리자 전용 AI 라우팅과 프롬프트를 불러오고 있습니다." />;
  if (!payload) return <StatusFeedbackState type="error" title="AI 설정을 불러오지 못했습니다" message={error || 'D1 마이그레이션 상태를 확인해 주세요.'} actionLabel="다시 시도" onAction={() => void load()} />;
  const connectedCount = payload.aiConfig.providers.filter((item) => item.connected).length;

  return <div className="content-stack report-ai-admin" aria-label="관리자 전용 보고서 AI 설정">
    <Card title="REPORT AI · MULTI-MODEL ROUTER">
      <div className="report-ai-admin__header"><div><p className="eyebrow">ADMIN CONTROL PLANE</p><h2>업무별 AI 모델 라우팅</h2><p className="muted">목차 기획·본문 작성·사실확인을 각각 다른 공급자와 모델로 운영합니다. 공용 키는 내 설정에서 AES-256-GCM 암호화 저장하며 원문은 다시 표시되지 않습니다.</p></div><StatusBadge status={connectedCount ? 'approved' : 'review'} /></div>
      <div className="report-ai-admin__providers">{payload.aiConfig.providers.map((item) => <div key={item.providerKind} data-connected={item.connected}><strong>{item.label}</strong><span>{item.connected ? 'CONNECTED' : 'SECRET REQUIRED'}</span><small>{item.secretName} · 키 값 비공개</small></div>)}</div>
      <div className="report-ai-admin__routes">{(['OUTLINE_PLANNING','CHAPTER_WRITING','FACT_CHECK'] as TaskKind[]).map((task) => {
        const route = routeDrafts[task]; if (!route) return null;
        const selectedProvider = provider(route.providerKind);
        const canonical = payload.aiConfig.routes.find((item) => item.taskKind === task);
        const dirty = canonical?.providerKind !== route.providerKind || canonical?.modelCode !== route.modelCode || canonical?.reasoningEffort !== route.reasoningEffort;
        return <section key={task}><header><div><h3>{TASK_LABELS[task].title}</h3><p>{TASK_LABELS[task].detail}</p></div><span data-connected={Boolean(selectedProvider?.connected)}>{selectedProvider?.connected ? '사용 가능' : '키 연결 필요'}</span></header><div className="report-ai-admin__settings"><Select label="AI 공급자" value={route.providerKind} onChange={(event) => changeRoute(task, { providerKind: event.target.value as ProviderKind })} options={payload.aiConfig.providers.map((item) => ({ value: item.providerKind, label: item.label }))} /><Select label="모델" value={route.modelCode} onChange={(event) => changeRoute(task, { modelCode: event.target.value })} options={(selectedProvider?.models ?? []).map((item) => ({ value: item.code, label: item.label }))} /><Select label="추론 강도" value={route.reasoningEffort} onChange={(event) => changeRoute(task, { reasoningEffort: event.target.value })} options={['minimal','low','medium','high','xhigh','max'].map((value) => ({ value, label: value.toUpperCase() }))} /><Button onClick={() => void saveRoute(task)} disabled={saving || !dirty}>{saving ? '저장 중…' : '이 역할 저장'}</Button></div><small>v{route.version} · {route.updatedByName} · {new Date(route.updatedAt).toLocaleString('ko-KR')}</small></section>;
      })}</div>
      <div className="notice-box">현재 권장 구성: 목차는 ChatGPT, 본문은 Gemini로 먼저 검증하고 Claude API Key 연결 후 Claude Sonnet/Opus로 교체, 사실확인은 Gemini.</div>
    </Card>
    <Card title="보고서 유형별 작성 지침 · 관리자 전용">
      {payload.guidelinePackage && <div className="notice-box" role="status"><strong>{payload.guidelinePackage.packageName} · v{payload.guidelinePackage.schemaVersion} 적용 완료</strong><br />주유형 {payload.guidelinePackage.typeCount}개 · 챕터 {payload.guidelinePackage.chapterCount}개 · 쟁점 모듈 {payload.guidelinePackage.moduleCount}개 · 출력 프로필 {payload.guidelinePackage.outputProfileCount}개 · SHA-256 {payload.guidelinePackage.sourceZipSha256.slice(0, 16)}…</div>}
      <div className="report-ai-admin__settings"><Select label="보고서 유형" value={selectedType} onChange={(event) => changeType(event.target.value)} options={payload.promptSets.map((entry) => ({ value: entry.claimType, label: `${entry.claimType} · ${entry.name}` }))} /></div>
      {typeGuideline ? <div className="form-stack report-ai-admin__type-guideline">
        <div className="report-ai-admin__guideline-meta"><div><span>APPROVED TWO-STAGE AUTHORING POLICY</span><strong>{typeGuideline.claimType} · {typeGuideline.typeName}</strong><small>지침 v{typeGuideline.version} · {typeGuideline.updatedByName} · {new Date(typeGuideline.updatedAt).toLocaleString('ko-KR')}</small></div><div><span>IMPORT SOURCE</span><strong>{typeGuideline.sourceFileName}</strong><small>SHA-256 {typeGuideline.sourceSha256.slice(0, 16)}…</small></div></div>
        <label htmlFor="type-target-work">대상 업무와 적용 범위</label><textarea id="type-target-work" value={guidelineDraft.targetWork} maxLength={3000} onChange={(event) => setGuidelineDraft((current) => ({ ...current, targetWork: event.target.value }))} />
        <label htmlFor="type-toc-blueprint">승인 목차 블루프린트</label><textarea id="type-toc-blueprint" className="report-ai-admin__blueprint" value={guidelineDraft.tocBlueprint} maxLength={30000} onChange={(event) => setGuidelineDraft((current) => ({ ...current, tocBlueprint: event.target.value }))} />
        <div className="report-ai-admin__stage-grid"><section><span>STAGE 1 · 목차 생성</span><label htmlFor="type-stage1-prompt">목차 기획 프롬프트</label><textarea id="type-stage1-prompt" value={guidelineDraft.stage1Prompt} maxLength={20000} onChange={(event) => setGuidelineDraft((current) => ({ ...current, stage1Prompt: event.target.value }))} /></section><section><span>STAGE 2 · 챕터 작성</span><label htmlFor="type-stage2-prompt">본문 공통 프롬프트</label><textarea id="type-stage2-prompt" value={guidelineDraft.stage2Prompt} maxLength={30000} onChange={(event) => setGuidelineDraft((current) => ({ ...current, stage2Prompt: event.target.value }))} /></section></div>
        <div className="notice-box">이 지침은 목차 AI와 모든 챕터 작성·Gemini 문장개선에 공통 적용됩니다. 실제 사건 근거보다 우선하지 않으며, 관리자만 새 버전을 저장할 수 있습니다.</div>
        <div className="action-row"><Button onClick={() => void saveTypeGuideline()} disabled={saving || guidelineDraft.targetWork.trim().length < 10 || guidelineDraft.tocBlueprint.trim().length < 20 || guidelineDraft.stage1Prompt.trim().length < 50 || guidelineDraft.stage2Prompt.trim().length < 50}>{saving ? '저장 중…' : '유형별 지침 새 버전 저장'}</Button><span className="muted">이전 버전은 D1 append-only 이력으로 보존됩니다.</span></div>
      </div> : <div className="error-box">CF33 유형별 작성 지침 마이그레이션이 필요합니다.</div>}
    </Card>
    <Card title="챕터별 역할·작성 지침">
      <div className="report-ai-admin__settings"><Select label="보고서 유형" value={selectedType} onChange={(event) => changeType(event.target.value)} options={payload.promptSets.map((entry) => ({ value: entry.claimType, label: `${entry.claimType} · ${entry.name}` }))} /><Select label="챕터" value={selectedChapter} disabled={!promptSet?.chapters.length} onChange={(event) => setSelectedChapter(event.target.value)} options={(promptSet?.chapters ?? []).map((entry) => ({ value: entry.id, label: `${entry.chapterCode} · ${entry.title}` }))} /></div>
      {chapter ? <div className="form-stack report-ai-admin__editor"><div className="notice-box"><strong>{chapter.agentCode} · {chapter.chapterCode} {chapter.title}</strong><br />프롬프트 v{chapter.version} · {chapter.updatedBy}</div><div className="report-ai-admin__source-basis"><strong>원본 분석 근거 · 관리자 지침 연계 · v{chapter.sourceAnalysisVersion || 1}</strong><span>{chapter.sourceCategoryCodes.length ? chapter.sourceCategoryCodes.join(' · ') : `${typeGuideline?.sourceFileName ?? '관리자 지침'} 기반`}</span><p>{chapter.sourceAnalysisNote || '관리자가 승인한 유형별 작성 지침과 현재 프로젝트 근거만 사용합니다.'}</p></div><label htmlFor="chapter-role-prompt">챕터 작성자 역할</label><textarea id="chapter-role-prompt" value={rolePrompt} maxLength={5000} onChange={(event) => setRolePrompt(event.target.value)} /><label htmlFor="chapter-instruction-prompt">챕터 작성 지시</label><textarea id="chapter-instruction-prompt" value={instructionPrompt} maxLength={10000} onChange={(event) => setInstructionPrompt(event.target.value)} /><div className="action-row"><Button onClick={() => void savePrompt()} disabled={saving || rolePrompt.trim().length < 20 || instructionPrompt.trim().length < 20}>{saving ? '저장 중…' : '챕터 지침 새 버전 저장'}</Button><span className="muted">변경 이력은 D1에 append-only로 보존됩니다.</span></div></div> : <p className="empty-box">편집할 챕터가 없습니다.</p>}
      {notice && <p className="notice-box" role="status">{notice}</p>}{error && <p className="error-box" role="alert">{error}</p>}
    </Card>
    <Card title="원본 보고서 템플릿 라이브러리 · 회사 Google Drive">
      <div className="template-library-admin__intro"><div><p className="eyebrow">PRIVATE SOURCE LIBRARY · 32 ORIGINAL FILES</p><h2>원본 폴더를 그대로 등록하고, 분석 근거와 함께 관리합니다.</h2><p className="muted">원본은 공개 Git·정적 웹 자산에 포함하지 않습니다. 관리자만 등록하며 로그인 사용자는 보고서 작성 화면에서 PDF를 열람하고 HWP·HWPX·XLSX를 내려받을 수 있습니다.</p></div><strong>{payload.templateLibrary.reduce((sum, category) => sum + category.uploadedSourceCount, 0)}/{payload.templateLibrary.reduce((sum, category) => sum + category.expectedSourceCount, 0)}<small>GOOGLE DRIVE REGISTERED</small></strong></div>
      <div className="template-library-admin__actions"><Select label="단일 파일 기본 분류" value={templateCategoryCode} onChange={(event) => setTemplateCategoryCode(event.target.value)} options={payload.templateLibrary.map((category) => ({ value: category.categoryCode, label: `${category.categoryCode} · ${category.displayName}` }))} /><input ref={(node) => { templateFolderInput.current = node; if (node) node.setAttribute('webkitdirectory', ''); }} type="file" multiple hidden accept=".pdf,.hwp,.hwpx,.xlsx" onChange={(event) => void importTemplateFolder(event.target.files)} /><Button onClick={() => templateFolderInput.current?.click()} disabled={templateImporting}>{templateImporting ? templateImportProgress || '원본 등록 중…' : '원본 32개 폴더 선택·등록'}</Button></div>
      <div className="template-library-admin__grid">{payload.templateLibrary.map((category) => <article key={category.id} data-complete={category.uploadedSourceCount >= category.expectedSourceCount}><header><span>{category.categoryCode} · {category.primaryClaimType}</span><strong>{category.displayName}</strong><em>{category.uploadedSourceCount}/{category.expectedSourceCount}</em></header><p>{category.analysisSummary}</p><ol>{category.outline.map((item) => <li key={item}>{item}</li>)}</ol>{category.files.length ? <details><summary>등록 원본 {category.files.length}개 보기</summary><ul>{category.files.map((file) => <li key={file.id}><a href={file.contentUrl} target={file.viewMode === 'INLINE' ? '_blank' : undefined} rel="noreferrer">{file.originalName}</a><small>{(file.byteSize / 1024 / 1024).toFixed(1)} MB · SHA {file.sha256.slice(0, 12)}…</small></li>)}</ul></details> : <small className="template-library-admin__empty">아직 Drive 원본 미등록 · 구조 분석과 프롬프트는 적용됨</small>}</article>)}</div>
    </Card>
  </div>;
}
