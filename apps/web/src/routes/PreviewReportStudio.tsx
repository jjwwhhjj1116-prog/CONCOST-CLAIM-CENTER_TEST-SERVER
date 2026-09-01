import { Button, Card, Dialog, Input, Select } from '@claim-studio/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { ApiError, apiDownload, apiRequest } from '../api';
import { AiGenerationProgressModal, type AiGenerationStatus } from '../components/AiGenerationProgressModal';
import { RhwpEditorDialog } from '../documents/RhwpEditorDialog';
import { DocumentToolMenus } from '../documents/DocumentToolMenus';
import { FileFormatIcon } from '../documents/FileFormatIcon';
import { downloadFinalDocument, type FinalDocumentFormat } from '../documents/final-document-export';
import { StructuredDocumentEditor, renderStructuredDocumentHtml, type StructuredDocumentEditorHandle, type StructuredSelection } from '../documents/StructuredDocumentEditor';
import { StatusFeedbackState } from '../layout/StatusFeedbackState';
import { registerNavigationBlocker, type PendingNavigation } from '../navigation-guard';
import { readReportDocx, readReportStudioWorkbook, readSpreadsheetExcerpt, reportStudioWorkbook } from '../proposals/proposal-excel';
import { WORKFLOW_PROJECTS } from '../workflow/workflow-model';
import type { UserRole } from './Router';
import type { PreviewReportReview } from './PreviewApprovalInbox';

interface CaseSummary { id: string; caseNumber: string; title: string; claimType: string; status: string }
interface ReportDraft {
  caseId: string; title: string; content: string; version: number; createdAt: string; updatedAt: string;
  editorJson: import('@tiptap/core').JSONContent | null;
  wizardStep: number; selectedChapterId: string | null;
  updatedBy: { id: string; name: string };
}
interface ReportRevision {
  id: string; version: number; title: string; content: string; editorJson: import('@tiptap/core').JSONContent | null; contentSha256: string; savedAt: string;
  savedBy: { id: string; name: string };
}
interface ReportBackup extends ReportRevision { backupHour: string }
interface ReportPayload { draft: ReportDraft | null; revisions: ReportRevision[]; backups?: ReportBackup[] }
interface ReportChapterAssignment {
  caseId: string; chapterId: string; chapterCode: string; chapterTitle: string; assigneeId: string | null; assigneeName: string | null;
  status: 'UNASSIGNED' | 'IN_PROGRESS' | 'READY' | 'APPLIED'; draftText: string; version: number; updatedByName: string; updatedAt: string; canEdit: boolean;
}
interface ReportChapterCollaboration {
  assignments: ReportChapterAssignment[];
  members: Array<{ id: string; displayName: string; roles: string[] }>;
  canManage: boolean;
  currentUserId: string;
  reportVersion?: number;
  applied?: boolean;
}
interface ReportWorkspace {
  caseId: string; caseNumber: string; caseTitle: string; claimType: string; reportTitle: string;
  version: number; wizardStep: number; selectedChapterId: string | null; updatedAt: string;
  updatedByName: string; contentLength: number;
}
interface AuthoringChapter { id: string; chapterCode: string; title: string; agentCode: string; ordinal: number; promptVersion: number }
interface OutlineItem { chapterId: string; chapterCode: string; chapterTitle: string; promptVersion: number; planningNote: string }
interface OutlinePlan { persistenceAvailable: boolean; status: 'DRAFT' | 'CONFIRMED'; version: number; updatedAt: string | null; updatedBy: string | null; items: OutlineItem[] }
interface SourceGroup { code: 'PROPOSAL' | 'KICKOFF' | 'SITE_SURVEY' | 'QUANTITY' | 'EVIDENCE' | 'LITIGATION'; label: string; status: 'READY' | 'PARTIAL' | 'EMPTY'; itemCount: number; detail: string; route: string }
interface ReportTemplatePreview { claimType: string; templateName: string; purposeText: string; version: number; finishedExample: string }
interface TemplateLibraryFile { id: string; originalName: string; fileExtension: string; byteSize: number; sha256: string; uploadedAt: string; uploadedByName: string; viewMode: 'INLINE' | 'DOWNLOAD'; contentUrl: string }
interface TemplateLibraryCategory { id: string; categoryCode: string; displayName: string; primaryClaimType: string; secondaryClaimTypes: string[]; matchesCurrentType: boolean; expectedSourceCount: number; uploadedSourceCount: number; analysisSummary: string; outline: string[]; analysisVersion: number; files: TemplateLibraryFile[] }
interface TypeGuidelineSummary { claimType: string; typeName: string; targetWork: string; tocBlueprint: string; version: number; sourceFileName: string; sourceSha256: string }
interface AuthoringConfig { claimType: string; available: boolean; unavailableReason: string | null; aiConnected: boolean; credentialSource: 'PERSONAL' | 'ORGANIZATION' | 'ENVIRONMENT' | 'NONE'; providerLabel: string; modelLabel: string; outlineAiConnected: boolean; outlineProviderLabel: string; outlineModelLabel: string; assistantConnected: boolean; assistantCredentialSource: 'PERSONAL' | 'NONE'; assistantProviderLabel: 'GEMINI'; assistantModelLabel: string; chapters: AuthoringChapter[]; typeGuideline: TypeGuidelineSummary | null; outlinePlan: OutlinePlan; sourceGroups: SourceGroup[]; templates: ReportTemplatePreview[]; templateLibrary: TemplateLibraryCategory[] }
interface CaseLawCandidate { precId: string; courtName: string; caseNumber: string; decisionDate: string; caseName: string; holdingText: string; summaryText: string; officialUrl: string }
interface CaseLawSource extends CaseLawCandidate { id: string; chapterId: string; chapterCode: string; sourceSha256: string; fetchedAt: string; selectedAt: string; selectedByName: string }
interface CaseLawCitation { id: string; sourceId: string; generationId: string; citationText: string; validationStatus: 'VERIFIED' | 'INSUFFICIENT' | 'MISMATCH' | 'REVIEW_REQUIRED'; validationNote: string; createdAt: string }
interface CaseLawPayload { sources: CaseLawSource[]; citations: CaseLawCitation[]; apiConfigured?: boolean }
type MemoryScope = 'GLOBAL' | 'REPORT_TYPE' | 'CLAIM_TYPE' | 'CHAPTER' | 'USER_FEEDBACK';
interface FinalOutput { id: string; format: 'DOCX' | 'PDF'; fileName: string; contentSha256: string; byteSize: number; createdAt: string }
interface Finalization {
  id: string; caseId: string; reviewId: string; reportVersion: number; reportTitle: string; finalizedAt: string;
  finalizedBy: { id: string; name: string }; approvedBy: string; approvedAt: string; outputs: FinalOutput[];
}

const EDIT_ROLES: readonly UserRole[] = ['admin', 'ceo', 'director', 'pm', 'staff'];
type ReportWizardStep = 1 | 2 | 3 | 4 | 5;
const REPORT_WIZARD_STEPS: readonly {
  id: ReportWizardStep;
  title: string;
  shortHelp: string;
  tasks: readonly string[];
  doneText: string;
}[] = [
  { id: 1, title: '프로젝트·템플릿 확인', shortHelp: '어떤 프로젝트의 보고서를 만들지 먼저 고릅니다.', tasks: ['프로젝트 이름 확인', '클레임 유형 확인', 'AI가 참고할 자료 준비도 확인'], doneText: '프로젝트와 승인 템플릿이 연결되면 완료' },
  { id: 2, title: '목차 기획', shortHelp: '선택한 템플릿에서 목차를 자동 만들고 제목만 쉽게 다듬습니다.', tasks: ['AI·템플릿으로 목차 자동 만들기', '이상한 챕터 제목만 바로 수정하기', '목차 확정 누르기'], doneText: '목차 확정 표시가 나오면 완료' },
  { id: 3, title: '보고서 초안 작성', shortHelp: 'AI 자동작성, 직접 작성 또는 HWP·DOCX 전체 문서 적용을 선택합니다.', tasks: ['작성 방식 선택', '전체 문서 적용 또는 챕터 작성', 'Ctrl+S·자동저장 확인'], doneText: '전체 문서 적용 또는 모든 챕터 초안 작성 시 완료' },
  { id: 4, title: '담당자 검수·수정', shortHelp: '작성 방식과 관계없이 숫자와 근거를 담당자가 확인합니다.', tasks: ['본문을 처음부터 읽기', '틀린 숫자·표현·출처 고치기', '자동 저장 완료 표시 확인'], doneText: '수정 내용이 최신 버전으로 저장되면 완료' },
  { id: 5, title: '검토·승인·출력', shortHelp: '검토자에게 보내고 승인된 파일을 내려받습니다.', tasks: ['검토 요청 메모 작성', '독립 검토자 승인 확인', '미리보기와 동일한 DOCX·PDF·HWP 내려받기'], doneText: '승인본을 확정하면 보고서 작업 완료' }
] as const;
const CHAPTER_SOURCE_CODES: Record<string, SourceGroup['code'][]> = {
  'AGENT-01': ['PROPOSAL', 'KICKOFF'],
  'AGENT-02': ['PROPOSAL', 'LITIGATION'],
  'AGENT-03': ['SITE_SURVEY', 'EVIDENCE'],
  'AGENT-04': ['QUANTITY', 'EVIDENCE'],
  'AGENT-05': ['PROPOSAL', 'KICKOFF', 'SITE_SURVEY', 'QUANTITY', 'EVIDENCE', 'LITIGATION'],
  'AGENT-06': ['PROPOSAL', 'KICKOFF', 'SITE_SURVEY', 'QUANTITY', 'EVIDENCE', 'LITIGATION']
};

function escapedPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function reportChapterBlock(content: string, chapterCode: string): string {
  const code = escapedPattern(chapterCode);
  const match = content.match(new RegExp(`<!-- (?:AI|MANUAL)-CHAPTER:${code}:START -->\\s*([\\s\\S]*?)\\s*<!-- (?:AI|MANUAL)-CHAPTER:${code}:END -->`, 'u'));
  if (!match) return '';
  return match[1].replace(/^##\s+[^\n]+\n?/u, '').trim();
}

function replaceReportChapterBlock(content: string, chapterCode: string, chapterTitle: string, body: string): string {
  const code = escapedPattern(chapterCode);
  const block = `<!-- MANUAL-CHAPTER:${chapterCode}:START -->\n## ${chapterCode} ${chapterTitle}\n\n${body.trim()}\n<!-- MANUAL-CHAPTER:${chapterCode}:END -->`;
  const pattern = new RegExp(`<!-- (?:AI|MANUAL)-CHAPTER:${code}:START -->[\\s\\S]*?<!-- (?:AI|MANUAL)-CHAPTER:${code}:END -->`, 'u');
  return pattern.test(content) ? content.replace(pattern, block) : `${content.trim()}${content.trim() ? '\n\n' : ''}${block}`;
}

const WHOLE_DOCUMENT_START = '<!-- MANUAL-WHOLE-DOCUMENT:START -->';
const WHOLE_DOCUMENT_END = '<!-- MANUAL-WHOLE-DOCUMENT:END -->';

function wholeReportDocument(content: string): string {
  return `${WHOLE_DOCUMENT_START}\n${content.trim()}\n${WHOLE_DOCUMENT_END}`;
}

function reportPreviewHtml(content: string, editorJson: import('@tiptap/core').JSONContent | null): string {
  const structured = editorJson ? renderStructuredDocumentHtml(editorJson) : '';
  const rendered = structured || marked.parse(content, { async: false, gfm: true, breaks: true });
  return DOMPurify.sanitize(typeof rendered === 'string' ? rendered : '', {
    ADD_ATTR: ['data-image-align', 'data-table-width', 'data-table-align', 'data-table-density', 'colspan', 'rowspan', 'style', 'target', 'rel', 'width', 'height']
  });
}

function ReportFinalDocumentPreview({ caseNumber, caseTitle, title, content, editorJson }: { caseNumber: string; caseTitle: string; title: string; content: string; editorJson: import('@tiptap/core').JSONContent | null }): React.ReactElement {
  const html = reportPreviewHtml(content, editorJson);
  return <article className="report-final-document" aria-label="확정 보고서 전체 미리보기" data-export-document-title={title} data-export-document-kind="REPORT">
    <section className="report-final-cover" data-export-page data-page-number="1">
      <img className="proposal-template-logo" src="/api/proposal-studio/assets/BRAND_LOGO?v=1" alt="주식회사 컨코스트"/><span>CONCOST CLAIM CENTER STUDIO</span><h2>{title}</h2><p>{caseNumber} · {caseTitle}</p><strong>프로젝트 기술 보고서</strong>
    </section>
    <section className="report-final-body" data-export-page data-page-number="2"><header><span>FINAL REPORT</span><h2>{title}</h2><p>{caseNumber} · {caseTitle}</p></header><article className="structured-editor__preview" dangerouslySetInnerHTML={{ __html: html }} /></section>
  </article>;
}

export function PreviewReportStudio({ roles, onNavigate }: { roles: UserRole[]; onNavigate: (path: string) => void }): React.ReactElement {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [loadedCaseId, setLoadedCaseId] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [editorJson, setEditorJson] = useState<import('@tiptap/core').JSONContent | null>(null);
  const [version, setVersion] = useState(0);
  const [backups, setBackups] = useState<ReportBackup[]>([]);
  const [reviews, setReviews] = useState<PreviewReportReview[]>([]);
  const [finalizations, setFinalizations] = useState<Finalization[]>([]);
  const [reviewNote, setReviewNote] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [authoring, setAuthoring] = useState<AuthoringConfig | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [draftMethod, setDraftMethod] = useState<'AI' | 'MANUAL'>('AI');
  const [generating, setGenerating] = useState(false);
  const [improving, setImproving] = useState(false);
  const [aiGeneration, setAiGeneration] = useState<{ kind: 'outline' | 'chapter' | 'improve'; status: AiGenerationStatus; title: string; error?: string } | null>(null);
  const [improvementInstruction, setImprovementInstruction] = useState('사실과 수치는 유지하고 문장을 더 명확하고 전문적으로 다듬어 주세요.');
  const [selectedTextRange, setSelectedTextRange] = useState<StructuredSelection | null>(null);
  const [improvementPreview, setImprovementPreview] = useState<{ start: number; end: number; original: string; replacement: string } | null>(null);
  const [memoryFeedback, setMemoryFeedback] = useState('');
  const [memoryScope, setMemoryScope] = useState<MemoryScope>('CHAPTER');
  const [memoryNotice, setMemoryNotice] = useState('');
  const [submittingMemory, setSubmittingMemory] = useState(false);
  const memoryRequestKey = useRef(crypto.randomUUID());
  const [savingOutline, setSavingOutline] = useState(false);
  const [generatingOutline, setGeneratingOutline] = useState(false);
  const [outlineStatus, setOutlineStatus] = useState<'DRAFT' | 'CONFIRMED'>('DRAFT');
  const [outlineVersion, setOutlineVersion] = useState(0);
  const [outlineNotes, setOutlineNotes] = useState<Record<string, string>>({});
  const [outlineTitles, setOutlineTitles] = useState<Record<string, string>>({});
  const [outlineDirty, setOutlineDirty] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);
  const [previewTemplateCategoryCode, setPreviewTemplateCategoryCode] = useState('');
  const [activeStep, setActiveStep] = useState<ReportWizardStep>(1);
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [savedWorkspaces, setSavedWorkspaces] = useState<ReportWorkspace[]>([]);
  const [showResumePicker, setShowResumePicker] = useState(false);
  const [resumeSearch, setResumeSearch] = useState('');
  const [resumeCaseId, setResumeCaseId] = useState('');
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [navigationBusy, setNavigationBusy] = useState(false);
  const [hwpEditorOpen, setHwpEditorOpen] = useState(false);
  const [hwpSourceFile, setHwpSourceFile] = useState<File | null>(null);
  const [linkedHwpName, setLinkedHwpName] = useState('');
  const [linkingHwp, setLinkingHwp] = useState(false);
  const [quantityRange, setQuantityRange] = useState('');
  const [quantityFileName, setQuantityFileName] = useState('');
  const [quantityExcerpt, setQuantityExcerpt] = useState('');
  const [chapterCollaboration, setChapterCollaboration] = useState<ReportChapterCollaboration | null>(null);
  const [chapterDrafts, setChapterDrafts] = useState<Record<string, string>>({});
  const [chapterBusy, setChapterBusy] = useState('');
  const [chapterNotice, setChapterNotice] = useState('');
  const [finalExportMessage, setFinalExportMessage] = useState('');
  const [caseLawSources, setCaseLawSources] = useState<CaseLawSource[]>([]);
  const [caseLawCitations, setCaseLawCitations] = useState<CaseLawCitation[]>([]);
  const [caseLawIssues, setCaseLawIssues] = useState<string[]>([]);
  const [caseLawQuery, setCaseLawQuery] = useState('');
  const [caseLawResults, setCaseLawResults] = useState<CaseLawCandidate[]>([]);
  const [selectedPrecIds, setSelectedPrecIds] = useState<string[]>([]);
  const [caseLawBusy, setCaseLawBusy] = useState<'issues' | 'search' | 'select' | 'exclude' | ''>('');
  const [caseLawNotice, setCaseLawNotice] = useState('');
  const [caseLawApiConfigured, setCaseLawApiConfigured] = useState(true);
  const [useCaseLaw, setUseCaseLaw] = useState(false);
  const reportExcelInputRef = useRef<HTMLInputElement | null>(null);
  const reportDocxInputRef = useRef<HTMLInputElement | null>(null);
  const hwpInputRef = useRef<HTMLInputElement | null>(null);
  const quantityExcelInputRef = useRef<HTMLInputElement | null>(null);
  const loadSequence = useRef(0);
  const selectedCaseRef = useRef('');
  const titleRef = useRef('');
  const contentRef = useRef('');
  const reportBodyRef = useRef<StructuredDocumentEditorHandle | null>(null);
  const finalReportPreviewRef = useRef<HTMLDivElement | null>(null);
  const activeStepRef = useRef<ReportWizardStep>(1);
  const selectedChapterRef = useRef('');
  const roleEditable = roles.some((role) => EDIT_ROLES.includes(role));
  const editable = roleEditable && Boolean(chapterCollaboration?.canManage || roles.includes('admin'));
  const selectedCase = useMemo(() => cases.find((record) => record.id === selectedCaseId) ?? null, [cases, selectedCaseId]);
  const selectedWorkflowProject = useMemo(() => WORKFLOW_PROJECTS.find((project) => project.caseId === selectedCaseId) ?? null, [selectedCaseId]);
  const selectedChapter = useMemo(() => authoring?.chapters.find((chapter) => chapter.id === selectedChapterId) ?? null, [authoring, selectedChapterId]);
  const selectedChapterAssignment = useMemo(() => chapterCollaboration?.assignments.find((assignment) => assignment.chapterId === selectedChapterId) ?? null, [chapterCollaboration, selectedChapterId]);
  const selectedTemplateCategory = useMemo(() => authoring?.templateLibrary.find((category) => category.categoryCode === previewTemplateCategoryCode) ?? authoring?.templateLibrary.find((category) => category.matchesCurrentType) ?? authoring?.templateLibrary[0] ?? null, [authoring, previewTemplateCategoryCode]);
  const selectedTemplatePreview = useMemo(() => authoring?.templates.find((template) => template.claimType === selectedTemplateCategory?.primaryClaimType) ?? authoring?.templates.find((template) => template.claimType === authoring.claimType) ?? null, [authoring, selectedTemplateCategory]);
  const filteredSavedWorkspaces = useMemo(() => {
    const query = resumeSearch.trim().toLocaleLowerCase('ko-KR');
    if (!query) return savedWorkspaces;
    return savedWorkspaces.filter((workspace) => `${workspace.caseNumber} ${workspace.caseTitle} ${workspace.reportTitle} ${workspace.updatedByName}`.toLocaleLowerCase('ko-KR').includes(query));
  }, [resumeSearch, savedWorkspaces]);
  const selectedChapterSources = useMemo(() => {
    const codes = selectedChapter ? CHAPTER_SOURCE_CODES[selectedChapter.agentCode] ?? [] : [];
    return authoring?.sourceGroups.filter((group) => codes.includes(group.code)) ?? [];
  }, [authoring, selectedChapter]);
  const latestCaseLawCitationBySource = useMemo(() => {
    const latest = new Map<string, CaseLawCitation>();
    for (const citation of caseLawCitations) {
      if (!latest.has(citation.sourceId)) latest.set(citation.sourceId, citation);
    }
    return latest;
  }, [caseLawCitations]);
  const authoredChapterCodes = useMemo(() => new Set(Array.from(content.matchAll(/<!-- (?:AI|MANUAL)-CHAPTER:([^:]+):START -->/gu), (match) => match[1])), [content]);

  const loadSavedWorkspaces = useCallback(async (): Promise<ReportWorkspace[]> => {
    const result = await apiRequest<{ workspaces: ReportWorkspace[] }>('/api/report-workspaces');
    setSavedWorkspaces(result.workspaces);
    return result.workspaces;
  }, []);

  const loadDraft = useCallback(async (caseId: string) => {
    const sequence = ++loadSequence.current;
    setLoading(true); setError(''); setLoadedCaseId(''); setDirty(false); setWorkspaceDirty(false);
    try {
      const [result, reviewResult, finalizationResult, authoringResult, collaborationResult] = await Promise.all([
        apiRequest<ReportPayload>(`/api/report-drafts?caseId=${encodeURIComponent(caseId)}`),
        apiRequest<{ reviews: PreviewReportReview[] }>(`/api/report-reviews?caseId=${encodeURIComponent(caseId)}`),
        apiRequest<{ finalizations: Finalization[] }>(`/api/report-finalizations?caseId=${encodeURIComponent(caseId)}`),
        apiRequest<AuthoringConfig>(`/api/report-authoring/config?caseId=${encodeURIComponent(caseId)}`),
        apiRequest<ReportChapterCollaboration>(`/api/report-chapter-collaboration?caseId=${encodeURIComponent(caseId)}`)
      ]);
      if (sequence !== loadSequence.current || selectedCaseRef.current !== caseId) return;
      const caseRecord = cases.find((record) => record.id === caseId);
      const loadedTitle = result.draft?.title ?? `${caseRecord?.title ?? '사건'} 보고서`;
      const loadedContent = result.draft?.content ?? '';
      titleRef.current = loadedTitle;
      contentRef.current = loadedContent;
      setTitle(loadedTitle);
      setContent(loadedContent);
      setDraftMethod(loadedContent.includes('<!-- MANUAL-CHAPTER:') ? 'MANUAL' : authoringResult.aiConnected ? 'AI' : 'MANUAL');
      setEditorJson(result.draft?.editorJson ?? null);
      setVersion(result.draft?.version ?? 0);
      setSavedAt(result.draft?.updatedAt ?? null);
      setBackups(result.backups ?? []);
      setReviews(reviewResult.reviews);
      setFinalizations(finalizationResult.finalizations);
      setAuthoring(authoringResult);
      setChapterCollaboration(collaborationResult);
      setChapterDrafts(Object.fromEntries(collaborationResult.assignments.map((assignment) => [assignment.chapterId, assignment.draftText || reportChapterBlock(loadedContent, assignment.chapterCode)])));
      setChapterNotice('');
      setPreviewTemplateCategoryCode(authoringResult.templateLibrary.find((category) => category.matchesCurrentType)?.categoryCode ?? authoringResult.templateLibrary[0]?.categoryCode ?? '');
      setOutlineStatus(authoringResult.outlinePlan.status);
      setOutlineVersion(authoringResult.outlinePlan.version);
      setOutlineNotes(Object.fromEntries(authoringResult.outlinePlan.items.map((item) => [item.chapterId, item.planningNote])));
      setOutlineTitles(Object.fromEntries(authoringResult.chapters.map((chapter) => {
        const saved = authoringResult.outlinePlan.items.find((item) => item.chapterId === chapter.id)?.chapterTitle;
        return [chapter.id, saved?.trim() || chapter.title];
      })));
      setOutlineDirty(false);
      const loadedChapterId = result.draft?.selectedChapterId && authoringResult.chapters.some((chapter) => chapter.id === result.draft?.selectedChapterId)
        ? result.draft.selectedChapterId
        : authoringResult.chapters[0]?.id ?? '';
      const loadedStep = Math.min(5, Math.max(1, Number(result.draft?.wizardStep ?? 1))) as ReportWizardStep;
      selectedChapterRef.current = loadedChapterId;
      activeStepRef.current = loadedStep;
      setSelectedChapterId(loadedChapterId);
      setActiveStep(loadedStep);
      setWorkspaceDirty(false);
      setLoadedCaseId(caseId);
    } catch (reason) {
      if (sequence === loadSequence.current && selectedCaseRef.current === caseId) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (sequence === loadSequence.current && selectedCaseRef.current === caseId) setLoading(false);
    }
  }, [cases]);

  useEffect(() => {
    void (async () => {
      try {
        const [result, workspaces] = await Promise.all([
          apiRequest<{ cases: CaseSummary[] }>('/api/cases?scope=project-work&limit=100&q='),
          loadSavedWorkspaces()
        ]);
        setCases(result.cases);
        const requestedCaseId = new URLSearchParams(window.location.search).get('caseId') ?? '';
        const resumableCaseId = workspaces.find((workspace) => result.cases.some((record) => record.id === workspace.caseId))?.caseId ?? '';
        const first = result.cases.some((record) => record.id === requestedCaseId) ? requestedCaseId : resumableCaseId || result.cases[0]?.id || '';
        selectedCaseRef.current = first;
        setSelectedCaseId(first);
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); }
    })();
  }, [loadSavedWorkspaces]);

  useEffect(() => { if (selectedCaseId) void loadDraft(selectedCaseId); else setLoading(false); }, [selectedCaseId, loadDraft]);

  const saveNow = useCallback(async (saveKind: 'AUTO' | 'MANUAL' | 'NAVIGATION' = 'MANUAL'): Promise<boolean> => {
    if (!editable || saving || !selectedCaseId || loadedCaseId !== selectedCaseId || selectedCaseRef.current !== selectedCaseId) return false;
    if (!dirty && !workspaceDirty && version > 0) return true;
    const requestCaseId = selectedCaseId;
    const requestTitle = title;
    const requestContent = content;
    const requestVersion = version;
    const requestWizardStep = activeStep;
    const requestChapterId = selectedChapterId || null;
    setSaving(true); setError('');
    try {
      const result = await apiRequest<ReportPayload>(`/api/report-drafts?caseId=${encodeURIComponent(requestCaseId)}`, {
        method: 'PUT', body: JSON.stringify({ title: requestTitle, content: requestContent, editorJson, expectedVersion: requestVersion, wizardStep: requestWizardStep, selectedChapterId: requestChapterId, saveKind })
      });
      if (selectedCaseRef.current !== requestCaseId || !result.draft) return false;
      setVersion(result.draft.version);
      setSavedAt(result.draft.updatedAt);
      setBackups(result.backups ?? []);
      setDirty(titleRef.current !== requestTitle || contentRef.current !== requestContent);
      setWorkspaceDirty(activeStepRef.current !== requestWizardStep || (selectedChapterRef.current || null) !== requestChapterId);
      await loadSavedWorkspaces();
      return true;
    } catch (reason) {
      if (selectedCaseRef.current !== requestCaseId) return false;
      setError(reason instanceof ApiError && reason.status === 409 ? '다른 탭에서 보고서가 먼저 저장되었습니다. 최신본을 다시 불러온 뒤 계속 작성해 주세요.' : reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      if (selectedCaseRef.current === requestCaseId) setSaving(false);
    }
  }, [activeStep, content, dirty, editable, editorJson, loadedCaseId, loadSavedWorkspaces, saving, selectedCaseId, selectedChapterId, title, version, workspaceDirty]);

  useEffect(() => {
    if ((!dirty && !workspaceDirty) || saving) return;
    const timer = window.setTimeout(() => { void saveNow('AUTO'); }, 3000);
    return () => window.clearTimeout(timer);
  }, [activeStep, content, dirty, saveNow, saving, selectedChapterId, title, workspaceDirty]);

  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || (!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      void saveNow('MANUAL');
    };
    window.addEventListener('keydown', saveShortcut, { capture: true });
    return () => window.removeEventListener('keydown', saveShortcut, { capture: true });
  }, [saveNow]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || outlineDirty || workspaceDirty) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, outlineDirty, workspaceDirty]);

  const selectCase = (caseId: string) => {
    if (!caseId || caseId === selectedCaseId) return;
    const project = WORKFLOW_PROJECTS.find((candidate) => candidate.caseId === caseId);
    const projectQuery = project ? `&projectId=${encodeURIComponent(project.id)}` : '';
    onNavigate(`/reports/studio?caseId=${encodeURIComponent(caseId)}${projectQuery}`);
  };

  const applyCollaborationPayload = (payload: ReportChapterCollaboration) => {
    setChapterCollaboration(payload);
    setChapterDrafts((current) => Object.fromEntries(payload.assignments.map((assignment) => [
      assignment.chapterId,
      current[assignment.chapterId] ?? assignment.draftText ?? ''
    ])));
  };

  const assignChapter = async (chapterId: string, assigneeId: string) => {
    const assignment = chapterCollaboration?.assignments.find((item) => item.chapterId === chapterId);
    setChapterBusy(`assign:${chapterId}`); setError(''); setChapterNotice('');
    try {
      const payload = await apiRequest<ReportChapterCollaboration>(`/api/report-chapter-collaboration?caseId=${encodeURIComponent(selectedCaseId)}`, {
        method: 'PUT', body: JSON.stringify({ chapterId, assigneeId: assigneeId || null, expectedVersion: assignment?.version ?? 0 })
      });
      applyCollaborationPayload(payload);
      setChapterNotice(assigneeId ? '챕터 담당자를 지정했습니다. 담당자는 이 챕터만 작성·검수할 수 있습니다.' : '챕터 담당 지정을 해제했습니다.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setChapterBusy(''); }
  };

  const saveChapterCollaboration = async (action: 'SAVE' | 'MARK_READY' | 'APPLY') => {
    if (!selectedChapterAssignment) { setError('담당 PM이 현재 챕터의 담당자를 먼저 지정해야 합니다.'); return; }
    const draftText = chapterDrafts[selectedChapterAssignment.chapterId] ?? '';
    setChapterBusy(`${action}:${selectedChapterAssignment.chapterId}`); setError(''); setChapterNotice('');
    try {
      const payload = await apiRequest<ReportChapterCollaboration>(`/api/report-chapter-collaboration?caseId=${encodeURIComponent(selectedCaseId)}`, {
        method: 'POST',
        body: JSON.stringify({ action, chapterId: selectedChapterAssignment.chapterId, draftText, expectedVersion: selectedChapterAssignment.version, expectedReportVersion: version })
      });
      applyCollaborationPayload(payload);
      if (action === 'APPLY') {
        await loadDraft(selectedCaseId);
        setChapterNotice(`${selectedChapterAssignment.chapterCode} 검수본을 보고서 최신 버전에 반영했습니다. 이전 본문은 버전 이력에 보존됩니다.`);
      } else {
        setChapterNotice(action === 'MARK_READY' ? '담당자 검수를 완료했습니다. 담당 PM의 보고서 반영을 기다립니다.' : '현재 챕터 협업 초안을 새 버전으로 저장했습니다.');
      }
    } catch (reason) { setError(reason instanceof ApiError && reason.status === 409 ? '다른 회원이 먼저 수정했습니다. 최신 협업본을 다시 불러온 뒤 계속해 주세요.' : reason instanceof Error ? reason.message : String(reason)); }
    finally { setChapterBusy(''); }
  };

  const changeWizardStep = (step: ReportWizardStep) => {
    if (step === activeStep) return;
    if (step > activeStep && !stepUnlocked[step]) {
      setError('앞 단계의 필수 입력·저장·확인을 완료한 뒤 다음 단계로 이동할 수 있습니다.');
      return;
    }
    activeStepRef.current = step;
    setActiveStep(step);
    setWorkspaceDirty(true);
  };

  const changeSelectedChapter = (chapterId: string) => {
    if (chapterId === selectedChapterId) return;
    selectedChapterRef.current = chapterId;
    setSelectedChapterId(chapterId);
    setWorkspaceDirty(true);
  };

  const loadCaseLaw = useCallback(async (caseId: string, chapterId: string) => {
    if (!caseId || !chapterId) return;
    try {
      const payload = await apiRequest<CaseLawPayload>(`/api/report-authoring/case-law?caseId=${encodeURIComponent(caseId)}&chapterId=${encodeURIComponent(chapterId)}`);
      if (selectedCaseRef.current !== caseId || selectedChapterRef.current !== chapterId) return;
      setCaseLawSources(payload.sources ?? []); setCaseLawCitations(payload.citations ?? []); setCaseLawApiConfigured(payload.apiConfigured !== false);
      setUseCaseLaw((current) => current || Boolean(payload.sources?.length));
    } catch {
      if (selectedCaseRef.current === caseId && selectedChapterRef.current === chapterId) { setCaseLawSources([]); setCaseLawCitations([]); }
    }
  }, []);

  useEffect(() => {
    if (!selectedCaseId || !selectedChapterId || loadedCaseId !== selectedCaseId) return;
    setCaseLawIssues([]); setCaseLawResults([]); setSelectedPrecIds([]); setCaseLawNotice('');
    void loadCaseLaw(selectedCaseId, selectedChapterId);
  }, [loadedCaseId, loadCaseLaw, selectedCaseId, selectedChapterId]);

  const findCaseLawIssues = async () => {
    if (!selectedChapterId || caseLawBusy) return;
    setCaseLawBusy('issues'); setError(''); setCaseLawNotice('');
    try {
      const payload=await apiRequest<{suggestions:string[]}>('/api/report-authoring/case-law/issues',{method:'POST',body:JSON.stringify({caseId:selectedCaseId,chapterId:selectedChapterId,chapterText:reportChapterBlock(content,selectedChapter?.chapterCode??'')})});
      setCaseLawIssues(payload.suggestions); if(payload.suggestions[0])setCaseLawQuery(payload.suggestions[0]);
      setCaseLawNotice(payload.suggestions.length?'현재 챕터와 프로젝트에서 검색할 법률 쟁점 후보를 만들었습니다.':'자동 추출할 쟁점이 부족합니다. 검색어를 직접 입력해 주세요.');
    } catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setCaseLawBusy('');}
  };

  const searchCaseLaw = async (queryOverride?:string) => {
    const query=(queryOverride??caseLawQuery).trim();if(query.length<2||caseLawBusy)return;
    setCaseLawBusy('search');setError('');setCaseLawNotice('');setCaseLawQuery(query);
    try{const payload=await apiRequest<{results:CaseLawCandidate[]}>('/api/report-authoring/case-law/search',{method:'POST',body:JSON.stringify({caseId:selectedCaseId,chapterId:selectedChapterId,query})});setCaseLawResults(payload.results);setSelectedPrecIds([]);setCaseLawNotice(payload.results.length?`공식 판례 ${payload.results.length}건을 찾았습니다. 사용할 판례를 1~3건 선택하세요.`:'공식 검색 결과가 없습니다. 쟁점을 더 구체적으로 바꿔 보세요.');}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setCaseLawBusy('');}
  };

  const saveCaseLawSelection = async () => {
    if(selectedPrecIds.length<1||selectedPrecIds.length>3||caseLawBusy)return;
    setCaseLawBusy('select');setError('');setCaseLawNotice('');
    try{const payload=await apiRequest<CaseLawPayload>('/api/report-authoring/case-law/select',{method:'POST',body:JSON.stringify({caseId:selectedCaseId,chapterId:selectedChapterId,precIds:selectedPrecIds})});setCaseLawSources(payload.sources);setCaseLawCitations(payload.citations);setUseCaseLaw(true);setCaseLawNotice('선택 판례의 원문·공식 링크·조회시각·무결성 확인값을 근거 이력에 보존했습니다.');}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setCaseLawBusy('');}
  };

  const excludeCaseLaw = async (sourceId:string) => {
    if(caseLawBusy)return;setCaseLawBusy('exclude');setError('');
    try{const payload=await apiRequest<CaseLawPayload>(`/api/report-authoring/case-law/${encodeURIComponent(sourceId)}`,{method:'PUT',body:JSON.stringify({action:'EXCLUDE'})});setCaseLawSources(payload.sources);setCaseLawCitations(payload.citations);setUseCaseLaw(Boolean(payload.sources.length));setCaseLawNotice('선택 판례를 이번 챕터 근거에서 제외했습니다. 원본 스냅샷은 감사 이력으로 보존됩니다.');}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setCaseLawBusy('');}
  };

  const withProjectContext = (route: string) => {
    if (!selectedWorkflowProject) return route;
    const target = new URL(route, window.location.origin);
    target.searchParams.set('projectId', selectedWorkflowProject.id);
    target.searchParams.set('caseId', selectedWorkflowProject.caseId);
    return `${target.pathname}${target.search}`;
  };

  const saveOutline = async (status: 'DRAFT' | 'CONFIRMED'): Promise<boolean> => {
    if (!editable || !authoring?.available || !authoring.outlinePlan.persistenceAvailable || savingOutline || loadedCaseId !== selectedCaseId) return false;
    const requestCaseId = selectedCaseId;
    setSavingOutline(true); setError('');
    try {
      const result = await apiRequest<{ outlinePlan: OutlinePlan }>('/api/report-authoring/outline', {
        method: 'PUT',
        body: JSON.stringify({
          caseId: requestCaseId,
          status,
          expectedVersion: outlineVersion,
          items: authoring.chapters.map((chapter) => ({ chapterId: chapter.id, chapterCode: chapter.chapterCode, chapterTitle: outlineTitles[chapter.id]?.trim() || chapter.title, promptVersion: chapter.promptVersion, planningNote: outlineNotes[chapter.id]?.trim() ?? '' }))
        })
      });
      if (selectedCaseRef.current !== requestCaseId) return false;
      setOutlineStatus(result.outlinePlan.status); setOutlineVersion(result.outlinePlan.version); setOutlineDirty(false);
      setAuthoring((current) => current ? { ...current, outlinePlan: result.outlinePlan } : current);
      return true;
    } catch (reason) {
      if (selectedCaseRef.current === requestCaseId) setError(reason instanceof ApiError && reason.status === 409 ? '목차 또는 관리자 템플릿이 변경되었습니다. 최신본을 다시 불러와 목차를 확인해 주세요.' : reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally { if (selectedCaseRef.current === requestCaseId) setSavingOutline(false); }
  };

  useEffect(() => registerNavigationBlocker((navigation) => {
    const current = `${window.location.pathname}${window.location.search}`;
    if (!editable || !selectedCaseId || loadedCaseId !== selectedCaseId || navigation.path === current || (!dirty && !outlineDirty && !workspaceDirty)) return false;
    setPendingNavigation(navigation);
    return true;
  }), [dirty, editable, loadedCaseId, outlineDirty, selectedCaseId, workspaceDirty]);

  const continuePendingNavigation = () => {
    const navigation = pendingNavigation;
    if (!navigation) return;
    setPendingNavigation(null);
    navigation.proceed();
  };

  const saveAndContinueNavigation = async () => {
    if (!pendingNavigation || navigationBusy || saving || savingOutline) return;
    setNavigationBusy(true);
    try {
      if (outlineDirty && !await saveOutline(outlineStatus)) return;
      if (!await saveNow('NAVIGATION')) return;
      continuePendingNavigation();
    } finally {
      setNavigationBusy(false);
    }
  };

  const generateOutline = async () => {
    if (!editable || !authoring?.available || generatingOutline || savingOutline || loadedCaseId !== selectedCaseId) return;
    const requestCaseId = selectedCaseId;
    setGeneratingOutline(true); setError(''); setAiGeneration({ kind: 'outline', status: 'running', title: '보고서 목차 작성계획을 만들고 있습니다' });
    const templateTitles = selectedTemplateCategory?.outline ?? [];
    const applyTemplateOutline = () => {
      setOutlineTitles(Object.fromEntries(authoring.chapters.map((chapter, index) => {
        const sourceTitle = templateTitles[index]?.replace(/^\s*(?:\d+[.)]|[IVX]+[.)]|CH-?\d+\s*[.)-]?)\s*/iu, '').trim();
        return [chapter.id, sourceTitle || chapter.title];
      })));
      setOutlineNotes(Object.fromEntries(authoring.chapters.map((chapter) => [chapter.id, outlineNotes[chapter.id] ?? ''])));
      setOutlineDirty(true);
    };
    try {
      if (!authoring.outlineAiConnected) {
        applyTemplateOutline();
        setAiGeneration((current) => current?.kind === 'outline' ? { ...current, status: 'complete' } : current);
        return;
      }
      const result = await apiRequest<{ suggestions: Array<{ chapterId: string; chapterCode: string; chapterTitle?: string; planningNote: string }>; guidelineVersion: number }>('/api/report-authoring/outline/generate', { method: 'POST', body: JSON.stringify({ caseId: requestCaseId }) });
      if (selectedCaseRef.current !== requestCaseId) return;
      setOutlineNotes(Object.fromEntries(result.suggestions.map((item) => [item.chapterId, item.planningNote])));
      setOutlineTitles(Object.fromEntries(authoring.chapters.map((chapter) => {
        const suggestion = result.suggestions.find((item) => item.chapterId === chapter.id);
        return [chapter.id, suggestion?.chapterTitle?.trim() || chapter.title];
      })));
      setOutlineDirty(true); setAiGeneration((current) => current?.kind === 'outline' ? { ...current, status: 'complete' } : current);
    } catch {
      if (selectedCaseRef.current === requestCaseId) {
        applyTemplateOutline();
        setAiGeneration((current) => current?.kind === 'outline' ? { ...current, status: 'complete' } : current);
      }
    }
    finally { if (selectedCaseRef.current === requestCaseId) setGeneratingOutline(false); }
  };

  const generateChapter = async () => {
    if (!editable || !authoring?.available || !authoring.aiConnected || outlineStatus !== 'CONFIRMED' || outlineDirty || !selectedChapterId || dirty || saving || generating || loadedCaseId !== selectedCaseId) return;
    const requestCaseId = selectedCaseId;
    setGenerating(true); setError(''); setAiGeneration({ kind: 'chapter', status: 'running', title: `${selectedChapter?.title ?? '선택 챕터'} 초안을 작성하고 있습니다` });
    try {
      const result = await apiRequest<{ chapter: { chapterCode: string; title: string; content: string; promptVersion: number; caseLawCitations?: CaseLawCitation[]; memory?: { engine: string; shortTermItems: number; approvedLongTermRules: number; personalRules: number; organizationRules: number } } }>('/api/report-authoring/generate', {
        method: 'POST', body: JSON.stringify({ caseId: requestCaseId, chapterId: selectedChapterId, expectedDraftVersion: version, useCaseLaw: useCaseLaw && caseLawSources.length > 0 })
      });
      if (selectedCaseRef.current !== requestCaseId) return;
      const start = `<!-- AI-CHAPTER:${result.chapter.chapterCode}:START -->`;
      const end = `<!-- AI-CHAPTER:${result.chapter.chapterCode}:END -->`;
      const chapterTitle = outlineTitles[selectedChapterId]?.trim() || result.chapter.title;
      const block = `${start}\n## ${result.chapter.chapterCode} ${chapterTitle}\n\n${result.chapter.content}\n${end}`;
      const escapedCode = result.chapter.chapterCode.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const existing = new RegExp(`<!-- (?:AI|MANUAL)-CHAPTER:${escapedCode}:START -->[\\s\\S]*?<!-- (?:AI|MANUAL)-CHAPTER:${escapedCode}:END -->`, 'u');
      const nextContent = existing.test(content) ? content.replace(existing, block) : `${content.trim()}${content.trim() ? '\n\n' : ''}${block}`;
      contentRef.current = nextContent; setContent(nextContent); setEditorJson(null); setDirty(true);
      if(result.chapter.caseLawCitations)setCaseLawCitations(result.chapter.caseLawCitations);
      if (result.chapter.memory) setMemoryNotice(`이번 초안 메모리 적용 · 단기 ${result.chapter.memory.shortTermItems}개 · 승인 장기 ${result.chapter.memory.approvedLongTermRules}개(개인 ${result.chapter.memory.personalRules} · 조직 ${result.chapter.memory.organizationRules})`);
      setAiGeneration((current) => current?.kind === 'chapter' ? { ...current, status: 'complete' } : current);
    } catch (reason) {
      if (selectedCaseRef.current !== requestCaseId) return;
      const providerStatus = reason instanceof ApiError && typeof reason.payload.providerStatus === 'number' ? ` · 공급자 HTTP ${reason.payload.providerStatus}` : '';
      const providerReason = reason instanceof ApiError && typeof reason.payload.providerReason === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(reason.payload.providerReason)
        ? ` · Google 사유 ${reason.payload.providerReason}`
        : '';
      const message=`${reason instanceof Error ? reason.message : String(reason)}${providerStatus}${providerReason}`;setError(message);setAiGeneration((current) => current?.kind === 'chapter' ? { ...current, status: 'error', error: message } : current);
    }
    finally { if (selectedCaseRef.current === requestCaseId) setGenerating(false); }
  };

  const startManualChapter = () => {
    if (!editable || !selectedChapter || loadedCaseId !== selectedCaseId) return;
    setDraftMethod('MANUAL');
    if (authoredChapterCodes.has(selectedChapter.chapterCode)) return;
    const chapterTitle = outlineTitles[selectedChapter.id]?.trim() || selectedChapter.title;
    const start = `<!-- MANUAL-CHAPTER:${selectedChapter.chapterCode}:START -->`;
    const end = `<!-- MANUAL-CHAPTER:${selectedChapter.chapterCode}:END -->`;
    const block = `${start}\n## ${selectedChapter.chapterCode} ${chapterTitle}\n\n[여기에 직접 작성하거나 외부 LLM 결과를 붙여넣으세요.]\n${end}`;
    const nextContent = `${content.trim()}${content.trim() ? '\n\n' : ''}${block}`;
    contentRef.current = nextContent;
    setContent(nextContent);
    setEditorJson(null);
    setDirty(true);
  };

  const exportReportExcel = () => {
    const chapterReview = activeStep === 4 && selectedChapter;
    const exportTitle = chapterReview ? `${selectedChapter.chapterCode} ${outlineTitles[selectedChapter.id]?.trim() || selectedChapter.title}` : title;
    const exportContent = chapterReview ? reportChapterBlock(content, selectedChapter.chapterCode) : content;
    const bytes=reportStudioWorkbook(
      {reportTitle:exportTitle,reportContent:exportContent},
      `${selectedCase?.caseNumber??''} · ${selectedCase?.title??''}`,
      chapterReview ? `담당자 검수 · ${selectedChapter.chapterCode}` : selectedTemplateCategory?.displayName??authoring?.typeGuideline?.typeName??'유형별 보고서',
    );
    const payload=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
    const url=URL.createObjectURL(new Blob([payload],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download=`${selectedCase?.caseNumber??'PROJECT'}_${chapterReview ? selectedChapter.chapterCode : '보고서'}_작성양식.xlsx`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMemoryNotice(chapterReview ? `${selectedChapter.chapterCode} 검수용 Excel을 내보냈습니다. FIELD_CODE 열은 유지하고 C열을 수정한 뒤 현재 단계에서 다시 가져오세요.` : '보고서 입력용 Excel 양식을 내보냈습니다. FIELD_CODE 열은 유지하고 C열을 수정한 뒤 1단계에서 다시 가져오세요.');
  };

  const importReportExcel = async (file: File | undefined) => {
    if(!file)return;
    setSaving(true);setError('');
    try{
      const values=await readReportStudioWorkbook(file);
      if (activeStep === 4 && selectedChapter) {
        const chapterTitle = outlineTitles[selectedChapter.id]?.trim() || selectedChapter.title;
        const nextContent = replaceReportChapterBlock(contentRef.current, selectedChapter.chapterCode, chapterTitle, values.reportContent);
        contentRef.current=nextContent;setContent(nextContent);setEditorJson(null);setDraftMethod('MANUAL');setDirty(true);
        setMemoryNotice(`${selectedChapter.chapterCode} 검수용 Excel 내용을 현재 챕터에만 반영했습니다.`);
      } else {
        const nextContent = activeStep === 3 ? wholeReportDocument(values.reportContent) : values.reportContent;
        titleRef.current=values.reportTitle;contentRef.current=nextContent;
        setTitle(values.reportTitle);setContent(nextContent);setEditorJson(null);setDraftMethod('MANUAL');setDirty(true);
        setMemoryNotice(activeStep === 3 ? 'Excel 보고서 전체를 챕터 구분 없는 단일 수동 초안으로 반영했습니다. 저장 후 담당자 검수로 이동할 수 있습니다.' : '입력용 Excel 가져오기 완료. 보고서 제목과 본문을 반영했으며 자동 저장을 시작합니다.');
      }
    }catch(reason){setError(reason instanceof Error?reason.message:'보고서 Excel을 읽지 못했습니다.');}
    finally{setSaving(false);if(reportExcelInputRef.current)reportExcelInputRef.current.value='';}
  };

  const importReportDocx = async (file: File | undefined) => {
    if(!file)return;
    setSaving(true);setError('');
    try{
      const values=await readReportDocx(file);
      if (activeStep === 4 && selectedChapter) {
        const chapterTitle = outlineTitles[selectedChapter.id]?.trim() || selectedChapter.title;
        const nextContent = replaceReportChapterBlock(contentRef.current, selectedChapter.chapterCode, chapterTitle, values.reportContent);
        contentRef.current=nextContent;setContent(nextContent);setEditorJson(null);setDraftMethod('MANUAL');setDirty(true);
        setMemoryNotice(`Word DOCX 본문을 ${selectedChapter.chapterCode} 챕터에만 반영했습니다.`);
      } else {
        const nextContent = activeStep === 3 ? wholeReportDocument(values.reportContent) : values.reportContent;
        titleRef.current=values.reportTitle;contentRef.current=nextContent;
        setTitle(values.reportTitle);setContent(nextContent);setEditorJson(null);setDraftMethod('MANUAL');setDirty(true);
        setMemoryNotice(activeStep === 3 ? 'Word DOCX 전체를 챕터 구분 없는 단일 수동 초안으로 반영했습니다. 저장 후 담당자 검수로 이동할 수 있습니다.' : 'Word DOCX 가져오기 완료. 제목과 본문을 수동 초안으로 반영했으며 자동 저장을 시작합니다.');
      }
    }catch(reason){setError(reason instanceof Error?reason.message:'Word 보고서를 읽지 못했습니다.');}
    finally{setSaving(false);if(reportDocxInputRef.current)reportDocxInputRef.current.value='';}
  };

  const openAndLinkReportHwp = async (file: File | undefined) => {
    if (!file) return;
    setHwpSourceFile(file);
    setHwpEditorOpen(true);
    setLinkedHwpName(file.name);
    if (!selectedCaseId) return;
    setLinkingHwp(true);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('category', 'REPORT_REFERENCE');
      const response = await fetch(`/api/cases/${encodeURIComponent(selectedCaseId)}/evidence`, { method: 'POST', headers: { 'Idempotency-Key': `report-hwp-${crypto.randomUUID()}` }, body: form });
      const payload = await response.json() as { file?: { originalName: string }; error?: string };
      if (!response.ok || !payload.file) throw new Error(payload.error ?? 'HWP 원본을 프로젝트 보고서 자료에 연결하지 못했습니다.');
      setMemoryNotice(`${payload.file.originalName} 원본을 프로젝트 보고서 근거자료에 연결했습니다. 팝업의 “보고서 전체에 적용”을 누르면 현재 본문을 이 문서로 교체합니다.`);
    } catch (reason) {
      setError(`${reason instanceof Error ? reason.message : 'HWP 원본 연결에 실패했습니다.'} 편집기는 계속 사용할 수 있습니다.`);
    } finally {
      setLinkingHwp(false);
      if (hwpInputRef.current) hwpInputRef.current.value = '';
    }
  };

  const applyHwpTextToCurrentChapter = (importedContent: string) => {
    if (!selectedChapter) {
      setError('HWP 내용을 넣을 보고서 챕터를 먼저 선택해 주세요.');
      return;
    }
    const chapterTitle = outlineTitles[selectedChapter.id]?.trim() || selectedChapter.title;
    const nextContent = replaceReportChapterBlock(contentRef.current, selectedChapter.chapterCode, chapterTitle, importedContent);
    contentRef.current = nextContent;
    setContent(nextContent);
    setEditorJson(null);
    setDraftMethod('MANUAL');
    setDirty(true);
    setMemoryNotice(`HWP/HWPX 본문을 ${selectedChapter.chapterCode} ${chapterTitle}에 반영했습니다. 저장하면 현재 보고서 버전에 기록됩니다.`);
  };

  const applyHwpTextToWholeReport = (importedContent: string) => {
    const nextContent = wholeReportDocument(importedContent);
    contentRef.current = nextContent;
    setContent(nextContent);
    setEditorJson(null);
    setDraftMethod('MANUAL');
    setDirty(true);
    setMemoryNotice('HWP/HWPX 전체 문서를 챕터 구분 없이 보고서 본문 전체에 적용했습니다. 0.9초 자동저장 또는 Ctrl+S로 백업본을 남길 수 있습니다.');
  };

  const importQuantitySpreadsheet = async (file: File | undefined) => {
    if (!file || !selectedCaseId) return;
    setSaving(true); setError('');
    try {
      const excerpt = await readSpreadsheetExcerpt(file, quantityRange);
      const form = new FormData();
      form.set('file', file);
      form.set('category', 'COST_BREAKDOWN');
      const response = await fetch(`/api/cases/${encodeURIComponent(selectedCaseId)}/evidence`, { method: 'POST', headers: { 'Idempotency-Key': `report-quantity-${crypto.randomUUID()}` }, body: form });
      const payload = await response.json() as { file?: { originalName: string }; error?: string };
      if (!response.ok || !payload.file) throw new Error(payload.error ?? '산출·내역자료 원본을 프로젝트에 첨부하지 못했습니다.');
      setQuantityFileName(payload.file.originalName);
      setQuantityExcerpt(excerpt.markdown);
      setMemoryNotice(`${payload.file.originalName} 원본을 첨부하고 ${excerpt.range} 범위를 발췌했습니다. 아래 표를 확인한 뒤 현재 챕터에 넣으세요.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '산출·내역 XLSX를 첨부하지 못했습니다.');
    } finally {
      setSaving(false);
      if (quantityExcelInputRef.current) quantityExcelInputRef.current.value = '';
    }
  };

  const applyQuantityExcerptToCurrentChapter = () => {
    if (!selectedChapter || !quantityExcerpt.trim()) { setError('산출·내역자료를 넣을 챕터와 발췌 내용을 먼저 확인해 주세요.'); return; }
    const chapterTitle = outlineTitles[selectedChapter.id]?.trim() || selectedChapter.title;
    const currentBody = reportChapterBlock(contentRef.current, selectedChapter.chapterCode);
    const attachment = `### 첨부 산출·내역자료\n\n- 원본: ${quantityFileName || '산출·내역자료.xlsx'}\n- 발췌 범위: ${quantityRange.trim() || '사용 영역'}\n\n${quantityExcerpt.trim()}`;
    const nextContent = replaceReportChapterBlock(contentRef.current, selectedChapter.chapterCode, chapterTitle, `${currentBody}${currentBody ? '\n\n' : ''}${attachment}`);
    contentRef.current = nextContent; setContent(nextContent); setEditorJson(null); setDraftMethod('MANUAL'); setDirty(true);
    setMemoryNotice(`${selectedChapter.chapterCode}에 산출·내역자료 발췌 표를 넣었습니다. 원본 파일은 프로젝트 자료에 별도 보존됩니다.`);
  };

  const restoreRevision = (revision: ReportRevision) => {
    titleRef.current = revision.title; contentRef.current = revision.content;
    setTitle(revision.title); setContent(revision.content); setEditorJson(revision.editorJson); setDraftMethod('MANUAL'); setDirty(true);
    setMemoryNotice(`백업 버전 ${revision.version}을 작업 화면에 불러왔습니다. 현재 버전을 덮어쓰지 않았으며 저장하면 새 버전으로 기록됩니다.`);
  };

  const continueWithoutAi = () => {
    const nextContent = contentRef.current.trim() ? contentRef.current : wholeReportDocument(`# ${titleRef.current || '보고서'}\n\n[담당자 검수 단계에서 보고서 본문을 직접 작성하세요.]`);
    contentRef.current = nextContent; setContent(nextContent); setEditorJson(null); setDraftMethod('MANUAL'); setDirty(true);
    activeStepRef.current = 4; setActiveStep(4); setWorkspaceDirty(true); setError('');
    setMemoryNotice('AI 초안 작성을 건너뛰고 담당자 검수로 이동했습니다. Ctrl+S 또는 0.9초 자동저장으로 현재 작업을 보존합니다.');
  };

  const improveWriting = async () => {
    if (!editable || !authoring?.assistantConnected || !content.trim() || dirty || saving || improving || loadedCaseId !== selectedCaseId) return;
    const requestCaseId = selectedCaseId;
    setImproving(true); setError(''); setAiGeneration({ kind: 'improve', status: 'running', title: 'Gemini가 보고서 문장을 개선하고 있습니다' });
    try {
      const result = await apiRequest<{ content: string; credentialSource: string; providerKind: string; modelCode: string }>('/api/report-authoring/improve', {
        method: 'POST', body: JSON.stringify({ caseId: requestCaseId, content, instruction: improvementInstruction.trim(), expectedDraftVersion: version })
      });
      if (selectedCaseRef.current !== requestCaseId) return;
      contentRef.current = result.content; setContent(result.content); setEditorJson(null); setDirty(true); setAiGeneration((current) => current?.kind === 'improve' ? { ...current, status: 'complete' } : current);
    } catch (reason) { if (selectedCaseRef.current === requestCaseId) { const message=reason instanceof Error ? reason.message : String(reason);setError(message);setAiGeneration((current) => current?.kind === 'improve' ? { ...current, status: 'error', error: message } : current); } }
    finally { if (selectedCaseRef.current === requestCaseId) setImproving(false); }
  };

  const improveSelectedWriting = async (instruction = improvementInstruction, selectionOverride?: StructuredSelection) => {
    const selection = selectionOverride ?? reportBodyRef.current?.getSelection() ?? selectedTextRange;
    const start = selection?.from ?? 0;
    const end = selection?.to ?? 0;
    const original = selection?.text ?? '';
    if (!editable || !authoring?.assistantConnected || !original.trim() || original.length > 20_000 || saving || improving || loadedCaseId !== selectedCaseId) return;
    const requestCaseId = selectedCaseId;
    setSelectedTextRange({ from: start, to: end, text: original });
    setImproving(true); setError(''); setAiGeneration({ kind: 'improve', status: 'running', title: '선택한 문장을 Gemini가 다듬고 있습니다' });
    try {
      const result = await apiRequest<{ content: string }>('/api/report-authoring/improve', {
        method: 'POST', body: JSON.stringify({ caseId: requestCaseId, content: original, instruction: instruction.trim(), expectedDraftVersion: version })
      });
      if (selectedCaseRef.current !== requestCaseId) return;
      setAiGeneration(null);
      setImprovementPreview({ start, end, original, replacement: result.content.trim() });
    } catch (reason) {
      if (selectedCaseRef.current === requestCaseId) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message); setAiGeneration((current) => current?.kind === 'improve' ? { ...current, status: 'error', error: message } : current);
      }
    } finally { if (selectedCaseRef.current === requestCaseId) setImproving(false); }
  };

  const applySelectedImprovement = () => {
    if (!improvementPreview) return;
    reportBodyRef.current?.replaceRange(improvementPreview.start, improvementPreview.end, improvementPreview.replacement);
    setSelectedTextRange(null);
    setImprovementPreview(null);
  };

  const submitMemoryFeedback = async () => {
    if (!editable || !selectedChapter || !memoryFeedback.trim() || dirty || saving || submittingMemory || loadedCaseId !== selectedCaseId) return;
    const requestCaseId = selectedCaseId;
    setSubmittingMemory(true); setError(''); setMemoryNotice('');
    try {
      const result = await apiRequest<{ candidate: { ruleText: string; confidence: number }; replayed: boolean }>('/api/report-memory/feedback', {
        method: 'POST',
        headers: { 'Idempotency-Key': memoryRequestKey.current },
        body: JSON.stringify({ caseId: requestCaseId, chapterId: selectedChapter.id, feedback: memoryFeedback.trim(), scope: memoryScope })
      });
      if (selectedCaseRef.current !== requestCaseId) return;
      setMemoryNotice(`학습 후보 등록 완료 · 신뢰도 ${result.candidate.confidence}% · “${result.candidate.ruleText}” · 관리자 승인 후 다음 보고서부터 반영됩니다.`);
      setMemoryFeedback(''); memoryRequestKey.current=crypto.randomUUID();
    } catch (reason) { if (selectedCaseRef.current === requestCaseId) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (selectedCaseRef.current === requestCaseId) setSubmittingMemory(false); }
  };

  const currentReview = reviews.find((review) => review.reportVersion === version) ?? null;
  const currentFinalization = currentReview ? finalizations.find((entry) => entry.reviewId === currentReview.id) ?? null : null;
  const pendingReview = reviews.find((review) => review.status === 'PENDING') ?? null;
  const requestReview = async () => {
    if (!editable || !selectedCaseId || !version || dirty || saving || currentReview || pendingReview) return;
    const requestCaseId = selectedCaseId;
    setSubmittingReview(true); setError('');
    try {
      const result = await apiRequest<{ reviews: PreviewReportReview[] }>('/api/report-reviews', {
        method: 'POST',
        headers: { 'Idempotency-Key': `report-review:${requestCaseId}:v${version}` },
        body: JSON.stringify({ caseId: requestCaseId, expectedVersion: version, note: reviewNote.trim() })
      });
      if (selectedCaseRef.current === requestCaseId) { setReviews(result.reviews); setReviewNote(''); }
    } catch (reason) { if (selectedCaseRef.current === requestCaseId) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (selectedCaseRef.current === requestCaseId) setSubmittingReview(false); }
  };

  const finalizeApproved = async () => {
    if (!currentReview || currentReview.status !== 'APPROVED' || !selectedCaseId || currentFinalization) return;
    setSubmittingReview(true); setError('');
    try {
      const result = await apiRequest<{ finalizations: Finalization[] }>('/api/report-finalizations', {
        method: 'POST', headers: { 'Idempotency-Key': `report-finalize:${selectedCaseId}:v${version}` },
        body: JSON.stringify({ caseId: selectedCaseId, reviewId: currentReview.id })
      });
      setFinalizations(result.finalizations);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSubmittingReview(false); }
  };

  const downloadFinalReport = async (format: FinalDocumentFormat) => {
    if (!currentFinalization || !finalReportPreviewRef.current || !selectedCase) return;
    setSubmittingReview(true); setError(''); setFinalExportMessage('');
    try {
      const result = await downloadFinalDocument({
        root: finalReportPreviewRef.current,
        format,
        fileName: `${selectedCase.caseNumber}_${title}_v${currentFinalization.reportVersion}`,
        onProgress: setFinalExportMessage
      });
      setFinalExportMessage(`${format.toUpperCase()} 확정본 ${result.pageCount}페이지 내려받기 완료 · 화면 미리보기와 동일한 A4 출력본입니다.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSubmittingReview(false); }
  };

  const openTemplateSource = async (file: TemplateLibraryFile) => {
    setError('');
    if (file.viewMode === 'INLINE') {
      const opened = window.open(file.contentUrl, '_blank');
      if (opened) opened.opener = null;
      else setError('브라우저가 새 창을 차단했습니다. 팝업을 허용한 뒤 다시 열어 주세요.');
      return;
    }
    try {
      const result = await apiDownload(file.contentUrl);
      const objectUrl = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = result.filename || file.originalName; anchor.click(); URL.revokeObjectURL(objectUrl);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '원본 템플릿 다운로드에 실패했습니다.'); }
  };

  const projectStepComplete = Boolean(selectedCaseId && loadedCaseId === selectedCaseId && authoring?.available);
  const outlineStepComplete = projectStepComplete && outlineStatus === 'CONFIRMED' && !outlineDirty;
  const wholeDocumentImported = content.includes(WHOLE_DOCUMENT_START) && content.includes(WHOLE_DOCUMENT_END);
  const chapterStepComplete = Boolean(outlineStepComplete && (wholeDocumentImported || (authoring?.chapters.length && authoredChapterCodes.size === authoring.chapters.length)));
  const editingStepComplete = Boolean(chapterStepComplete && version > 0 && title.trim() && content.trim() && !dirty && !saving);
  const outputStepComplete = Boolean(editingStepComplete && currentFinalization);
  const stepComplete: Record<ReportWizardStep, boolean> = {
    1: projectStepComplete,
    2: outlineStepComplete,
    3: chapterStepComplete,
    4: editingStepComplete,
    5: outputStepComplete
  };
  const stepUnlocked: Record<ReportWizardStep, boolean> = {
    1: true,
    2: stepComplete[1],
    3: stepComplete[1] && stepComplete[2],
    4: stepComplete[1] && stepComplete[2] && stepComplete[3],
    5: stepComplete[1] && stepComplete[2] && stepComplete[3] && stepComplete[4]
  };
  const activeStepGuide = REPORT_WIZARD_STEPS.find((step) => step.id === activeStep) ?? REPORT_WIZARD_STEPS[0];
  const nextStep = activeStep < 5 ? (activeStep + 1) as ReportWizardStep : null;
  const previousStep = activeStep > 1 ? (activeStep - 1) as ReportWizardStep : null;
  const nextBlockedReason = activeStep === 1
    ? '프로젝트와 승인 템플릿을 확인하면 다음 단계가 열립니다.'
    : activeStep === 2
      ? '템플릿 목차를 불러와 필요한 제목을 수정한 뒤 목차를 확정해 주세요.'
      : activeStep === 3
        ? '모든 챕터를 작성하거나 HWP·DOCX 전체 문서를 적용하세요. AI 없이 바로 담당자 검수로 이동할 수도 있습니다.'
        : activeStep === 4
          ? '본문을 저장해 자동 저장 완료 표시를 확인해 주세요.'
          : '';
  const reportDocumentTools=(stepId: ReportWizardStep)=>stepId === 1 || stepId === 3 || stepId === 4 ? <DocumentToolMenus groups={[
    {id:'excel',label:'Excel',actions:[
      {id:'export',label:stepId===4?'현재 챕터 Excel 내보내기':'보고서 입력 양식 내보내기',onClick:exportReportExcel},
      {id:'import',label:stepId===4?'현재 챕터 Excel 가져오기':stepId===3?'Excel 전체 문서 적용':'작성 Excel 가져오기',onClick:()=>reportExcelInputRef.current?.click(),disabled:saving},
    ]},
    {id:'docx',label:'DOCX',actions:[
      {id:'import',label:stepId===4?'현재 챕터에 DOCX 반영':stepId===3?'DOCX 전체 문서 적용':'Word DOCX 가져오기',onClick:()=>reportDocxInputRef.current?.click(),disabled:saving},
    ]},
    {id:'hwp',label:'HWP',actions:[
      {id:'import',label:stepId===4?'현재 챕터에 HWP 반영':stepId===3?'HWP 전체 문서 적용':'HWP/HWPX 가져오기·편집',onClick:()=>hwpInputRef.current?.click(),disabled:linkingHwp},
    ]},
  ]}/> : null;
  const renderStageHeader = (stepId: ReportWizardStep) => {
    const guide = REPORT_WIZARD_STEPS[stepId - 1];
    return <header className="report-stage-header">
      <span className="report-stage-header__number" aria-hidden="true">{String(stepId).padStart(2, '0')}</span>
      <div><small>REPORT STEP {stepId}</small><h3>{guide.title}</h3><p>{guide.shortHelp}</p>{showGuide && <ol>{guide.tasks.map((task, index) => <li key={task}><b>{index + 1}</b>{task}</li>)}</ol>}</div>
      <div className="report-stage-header__actions">{reportDocumentTools(stepId)}<aside><strong>{stepComplete[stepId] ? '✓ 단계 완료' : '완료 기준'}</strong><p>{guide.doneText}</p></aside></div>
    </header>;
  };

  if (!loading && cases.length === 0) return <StatusFeedbackState type="empty" title="보고서를 연결할 프로젝트가 없습니다" message="먼저 프로젝트 의뢰를 등록하면 프로젝트별 보고서 작업공간이 자동으로 준비됩니다." actionLabel="프로젝트 의뢰 등록" onAction={() => onNavigate('/cases/new')} />;

  return (
    <div className="content-stack report-authoring-studio" data-wizard-step={activeStep} aria-label="보고서 자동 저장 스튜디오">
      <RhwpEditorDialog isOpen={hwpEditorOpen} sourceFile={hwpSourceFile} suggestedName={`${selectedCase?.caseNumber??'클레임센터'}_${title||'보고서'}.hwp`} documentLabel="프로젝트 보고서" applyLabel={activeStep===4&&selectedChapter?`현재 내용을 ${selectedChapter.chapterCode}에 적용`:'HWP 전체 문서를 보고서에 적용'} onApplyContent={activeStep===4?applyHwpTextToCurrentChapter:applyHwpTextToWholeReport} onClose={()=>{setHwpEditorOpen(false);setHwpSourceFile(null);}} />
      <input ref={reportExcelInputRef} hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event)=>void importReportExcel(event.target.files?.[0])}/>
      <input ref={reportDocxInputRef} hidden type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event)=>void importReportDocx(event.target.files?.[0])}/>
      <input ref={hwpInputRef} hidden type="file" accept=".hwp,.hwpx,.hml,application/x-hwp,application/vnd.hancom.hwpx" onChange={(event)=>void openAndLinkReportHwp(event.target.files?.[0])}/>
      <input ref={quantityExcelInputRef} hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event)=>void importQuantitySpreadsheet(event.target.files?.[0])}/>
      <AiGenerationProgressModal isOpen={Boolean(aiGeneration)} status={aiGeneration?.status??'running'} title={aiGeneration?.title??'AI가 보고서를 작성하고 있습니다'} description={aiGeneration?.kind==='outline'?'선택한 원본 템플릿을 기준으로 목차를 불러오고 현재 프로젝트에 맞게 정리합니다.':aiGeneration?.kind==='improve'?'사실과 수치는 유지하고 문장을 더 명확하고 전문적으로 다듬습니다.':'승인된 챕터 프롬프트와 선택 프로젝트 근거만 사용해 초안을 작성합니다.'} stages={aiGeneration?.kind==='outline'?['프로젝트 유형 확인','원본 템플릿 목차 불러오기','챕터 제목 정리','편집 화면 반영']:aiGeneration?.kind==='improve'?['현재 저장본 확인','문장 구조·표현 개선','사실·수치 보존 검증','개선본 반영 대기']:['챕터 프롬프트 확인','근거 자료·메모 분석','챕터 초안 작성','메모리 규칙·결과 검증']} completeMessage={aiGeneration?.kind==='outline'?'템플릿 기반 목차가 준비되었습니다. 이상한 제목만 고친 뒤 목차를 확정하세요.':aiGeneration?.kind==='improve'?'문장 개선이 완료되었습니다. 수정 내용을 확인하고 저장하세요.':'선택 챕터 초안이 완성되었습니다. 확인 후 다음 챕터를 이어서 작성하세요.'} errorMessage={aiGeneration?.error} confirmLabel={aiGeneration?.kind==='outline'?'목차 편집 화면 보기':aiGeneration?.kind==='improve'?'개선 본문 확인하기':'완료 확인 · 다음 챕터'} onConfirm={()=>{if(aiGeneration?.kind==='chapter'){const next=authoring?.chapters.find((candidate)=>!authoredChapterCodes.has(candidate.chapterCode));if(next)changeSelectedChapter(next.id);else changeWizardStep(4);}setAiGeneration(null);}} onClose={()=>setAiGeneration(null)}/>
      <section className="report-authoring-hero" aria-labelledby="report-authoring-title">
        <div><span>CLAIM REPORT AUTHORING SYSTEM</span><h2 id="report-authoring-title">템플릿에서 목차를 설계하고,<br />챕터별 근거로 완성합니다.</h2><p>프로젝트 유형과 승인 템플릿을 기준으로 회의록·현장조사·물량산출·제안서 근거를 챕터별 AI 작성에 연결합니다.</p></div>
        <div className="report-authoring-hero__actions">
          <div className="report-resume-control">
            <Button variant="secondary" aria-expanded={showResumePicker} aria-controls="report-resume-menu" onClick={() => { setShowResumePicker((current) => !current); setResumeCaseId(selectedCaseId || savedWorkspaces[0]?.caseId || ''); }}>저장한 보고서 이어쓰기 {savedWorkspaces.length ? `(${savedWorkspaces.length})` : ''}</Button>
            {showResumePicker && <section id="report-resume-menu" className="report-resume-menu" aria-label="저장한 보고서 선택">
              <header><div><strong>저장한 보고서 이어쓰기</strong><small>프로젝트를 찾아 마지막 저장 단계부터 계속합니다.</small></div><button type="button" aria-label="이어쓰기 창 닫기" onClick={() => setShowResumePicker(false)}>×</button></header>
              <label><span>프로젝트 검색</span><input value={resumeSearch} onChange={(event) => setResumeSearch(event.target.value)} placeholder="프로젝트 번호·이름·보고서 제목" autoFocus /></label>
              <label><span>저장된 프로젝트</span><select value={resumeCaseId} onChange={(event) => setResumeCaseId(event.target.value)}><option value="">프로젝트를 선택하세요</option>{filteredSavedWorkspaces.map((workspace) => <option key={workspace.caseId} value={workspace.caseId}>{workspace.caseNumber} · {workspace.caseTitle} · {workspace.wizardStep}단계 · v{workspace.version}</option>)}</select></label>
              <Button disabled={!resumeCaseId} onClick={() => { selectCase(resumeCaseId); setShowResumePicker(false); setResumeSearch(''); }}>선택한 보고서 이어쓰기</Button>
            </section>}
          </div>
          <Button variant="secondary" onClick={() => setShowGuide((current) => !current)}>{showGuide ? '간단히 보기' : '단계 도움말 보기'}</Button><Button variant="secondary" disabled={!selectedTemplatePreview} onClick={() => setShowTemplatePreview(true)}>완제품 템플릿 열람</Button>{roles.includes('admin') && <Button onClick={() => onNavigate('/ai-config')}>챕터 프롬프트 설정</Button>}
        </div>
      </section>

      <nav className="report-wizard-navigation" aria-label="보고서 작성 5단계">
        <div className="report-wizard-navigation__heading">
          <span>REPORT WIZARD</span>
          <strong>지금은 {activeStep}단계입니다.</strong>
          <small>앞 단계가 끝나면 다음 단계 버튼이 열립니다.</small>
        </div>
        <ol>{REPORT_WIZARD_STEPS.map((step) => {
          const current = step.id === activeStep;
          const complete = stepComplete[step.id];
          const unlocked = stepUnlocked[step.id];
          return <li key={step.id}>
            <button type="button" className={current ? 'is-current' : complete ? 'is-complete' : ''} disabled={!unlocked} aria-current={current ? 'step' : undefined} onClick={() => changeWizardStep(step.id)}>
              <b>{complete ? '✓' : step.id}</b>
              <span><strong>{step.title}</strong><small>{current ? '지금 진행 중' : complete ? '완료' : unlocked ? '열림' : '앞 단계 완료 후 열림'}</small></span>
            </button>
          </li>;
        })}</ol>
        <span className="report-wizard-navigation__progress"><i style={{ width: `${(activeStep / 5) * 100}%` }} /></span>
      </nav>

      {selectedCase&&<div className="report-current-project report-current-project--persistent" aria-live="polite"><span>현재 프로젝트</span><strong>{selectedCase.caseNumber} · {selectedCase.title}</strong><small>{selectedCase.claimType} · {selectedCase.status}</small></div>}
      {memoryNotice&&<p className="notice-box report-document-notice" role="status">{memoryNotice}</p>}

      <Card title="" className="report-step-card report-step-card--1 report-stage-card">
        {renderStageHeader(1)}
        <div className="inline-form">
          <Select searchable searchPlaceholder="프로젝트 번호·이름 검색" required label="작성할 프로젝트" value={selectedCaseId} onChange={(event) => selectCase(event.target.value)} disabled={saving} options={cases.map((record) => ({ value: record.id, label: `${record.caseNumber} · ${record.title}` }))} />
          <div className="action-row report-autosave-status" aria-live="polite" aria-label="지금 저장 상태">
            <span className="preview-pill">{error ? '자동 저장 일시 중단' : saving ? '자동 저장 중' : dirty || workspaceDirty || outlineDirty ? '변경사항 감지 · 잠시 후 자동 저장' : version ? `자동 저장 완료 · ${savedAt ? new Date(savedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}) : `v${version}`}` : '첫 입력 후 자동 저장'}</span>
            {error && <Button className="report-action-danger" onClick={() => selectedCaseId && void loadDraft(selectedCaseId)}>최신본 다시 불러오기</Button>}
          </div>
        </div>
        <div className="report-template-contract">
          <div><span>CLAIM TYPE</span><strong>{authoring?.claimType ?? selectedCase?.claimType ?? '불러오는 중'}</strong><small>프로젝트 의뢰에 등록된 6대 고정 유형</small></div>
          <div><span>APPROVED TEMPLATE</span><strong>{authoring?.available ? '유형별 템플릿 적용' : '템플릿 확인 필요'}</strong><small>{authoring?.available ? `${authoring.chapters.length}개 챕터 구성` : authoring?.unavailableReason ?? '구성을 불러오는 중'}</small></div>
          <div><span>AUTOSAVE</span><strong>자동 저장</strong><small>입력은 자동 저장 · 복구용 백업은 1시간 단위</small></div>
          {roles.includes('admin') && <Button variant="secondary" onClick={() => onNavigate('/ai-config')}>유형별 템플릿·프롬프트 관리</Button>}
        </div>
        <div className="report-template-viewer-control">
          <label htmlFor="report-template-preview-type"><span>원본 보고서 템플릿 선택·열람</span><select id="report-template-preview-type" value={previewTemplateCategoryCode} onChange={(event) => setPreviewTemplateCategoryCode(event.target.value)}>{authoring?.templateLibrary.map((category) => <option key={category.categoryCode} value={category.categoryCode}>{category.matchesCurrentType ? '● ' : ''}{category.categoryCode} · {category.displayName} · {category.uploadedSourceCount}/{category.expectedSourceCount}</option>)}</select></label>
          <Button aria-label="선택 템플릿 완제품 보기" disabled={!selectedTemplateCategory} onClick={() => setShowTemplatePreview(true)}>원본 완제품·분석 보기</Button>
          <small>● 표시는 현재 프로젝트 {authoring?.claimType ?? selectedCase?.claimType}에 연결된 원본 분류입니다. PDF는 웹에서 바로 열고 HWP·HWPX·XLSX는 원본으로 내려받습니다.</small>
        </div>
        <p className="muted">회사 원본 32개는 공개 웹 자산이 아니라 로그인으로 보호된 Google Drive에 저장됩니다. 관리자가 원본 폴더를 등록하면 처음 작성할 때와 초안 수정 중 언제든 열람할 수 있습니다.</p>
        {loading || loadedCaseId !== selectedCaseId ? <StatusFeedbackState type="loading" message="프로젝트별 보고서 최신본을 불러오고 있습니다." /> : <section className="report-stage-section report-source-readiness" aria-labelledby="report-source-readiness-title">
          <header><div><span>PROJECT EVIDENCE MAP</span><h3 id="report-source-readiness-title">AI 참고자료 준비 상태</h3><p>제안서·착수회의·현장조사·물량산출·자료실·법원자료 중 현재 프로젝트에 연결된 기록만 확인합니다.</p></div><strong>{authoring?.sourceGroups.filter((group) => group.status === 'READY').length ?? 0}/{authoring?.sourceGroups.length ?? 0}<small>READY</small></strong></header>
          <div className="report-source-grid">{authoring?.sourceGroups.map((group) => <button key={group.code} type="button" data-source-state={group.status} onClick={() => onNavigate(withProjectContext(group.route))}><span aria-hidden="true">{group.status === 'READY' ? '✓' : group.status === 'PARTIAL' ? '!' : '+'}</span><div><strong>{group.label}</strong><small>{group.detail}</small></div><em>{group.status === 'READY' ? '준비됨' : group.status === 'PARTIAL' ? '일부 준비' : '자료 연결'}</em></button>)}</div>
          <p className="report-source-policy"><strong>근거 사용 원칙</strong> 파일 본문을 확인하지 못한 내용은 추측하지 않고 <b>[확인 필요]</b>로 남깁니다.</p>
        </section>}
      </Card>

      {loading || loadedCaseId !== selectedCaseId ? null : <>
        <Card title="" className="report-step-card report-step-card--2 report-stage-card">
          {renderStageHeader(2)}
          {!authoring?.available ? <div className="error-box">{authoring?.unavailableReason ?? '이 유형의 승인된 목차 템플릿이 없습니다.'}</div> : <div className="report-outline-planner">
            <header><div><span>{authoring.claimType} · TEMPLATE OUTLINE · v{outlineVersion || 'NEW'}</span><h3>템플릿으로 목차를 만들고 제목만 수정하세요.</h3><p>작성 방향을 직접 적을 필요가 없습니다. 원본 템플릿에서 목차를 자동으로 불러오고, 이상한 제목만 바로 고친 뒤 확정하면 됩니다.</p></div><strong>{authoredChapterCodes.size}/{authoring.chapters.length}<small>작성된 챕터</small></strong></header>
            {authoring.typeGuideline && <details className="report-outline-guideline"><summary><span>관리자 승인 {authoring.claimType} 작성 지침 v{authoring.typeGuideline.version}</span><strong>표준 목차 블루프린트 보기</strong></summary><p>{authoring.typeGuideline.targetWork}</p><pre>{authoring.typeGuideline.tocBlueprint}</pre><small>{authoring.typeGuideline.sourceFileName} · SHA {authoring.typeGuideline.sourceSha256.slice(0, 16)}…</small></details>}
            <div className="notice-box"><strong>쉬운 시작:</strong> 파란색 “AI·템플릿으로 목차 자동 만들기”를 누르세요. API 키가 없어도 선택한 원본 템플릿 목차는 바로 불러옵니다.</div>
            <ol>{authoring.chapters.map((chapter) => { const authored = authoredChapterCodes.has(chapter.chapterCode); const active = chapter.id === selectedChapterId; return <li key={chapter.id}><button type="button" className={active ? 'is-active' : ''} onClick={() => changeSelectedChapter(chapter.id)} aria-pressed={active}><span>{String(chapter.ordinal).padStart(2, '0')}</span><div><strong>{chapter.chapterCode} · {outlineTitles[chapter.id] || chapter.title}</strong><small>{chapter.agentCode} · 제목 편집 가능</small></div><em className={authored ? 'is-complete' : ''}>{authored ? '초안 있음' : '작성 대기'}</em></button></li>; })}</ol>
            {selectedChapter && <div className="report-outline-note report-outline-title-editor"><label htmlFor="report-outline-title"><span>{selectedChapter.chapterCode}</span> 챕터 제목 직접 수정</label><input id="report-outline-title" maxLength={300} value={outlineTitles[selectedChapter.id] ?? selectedChapter.title} disabled={!editable || savingOutline} onChange={(event) => { setOutlineTitles((current) => ({ ...current, [selectedChapter.id]: event.target.value })); setOutlineDirty(true); }} /><small>본문 작성 방향은 관리자의 유형별 지침과 프로젝트 근거로 자동 적용됩니다. 사용자는 목차 제목만 고치면 됩니다.</small></div>}
            <div className="report-outline-actions"><span className={`report-outline-status is-${outlineStatus.toLowerCase()}`}>{outlineStatus === 'CONFIRMED' && !outlineDirty ? '✓ 목차 확정' : outlineDirty ? '목차 변경사항 있음' : '목차 대기'}</span><Button className="report-action-ai" disabled={!editable || generatingOutline || savingOutline} onClick={() => void generateOutline()}>{generatingOutline ? '템플릿 목차 불러오는 중…' : '✦ AI·템플릿으로 목차 자동 만들기'}</Button><Button className="report-action-review" variant="secondary" disabled={!editable || savingOutline || generatingOutline || !authoring.outlinePlan.persistenceAvailable || (!outlineDirty && outlineVersion > 0)} onClick={() => void saveOutline(outlineStatus === 'CONFIRMED' ? 'CONFIRMED' : 'DRAFT')}>{savingOutline ? '저장 중…' : '수정한 목차 저장'}</Button><Button className="report-action-confirm" disabled={!editable || savingOutline || generatingOutline || !authoring.outlinePlan.persistenceAvailable || (outlineStatus === 'CONFIRMED' && !outlineDirty)} onClick={() => void saveOutline('CONFIRMED')}>{outlineStatus === 'CONFIRMED' ? '변경 목차 다시 확정' : '목차 확정 · 다음 단계'}</Button></div>
            {!authoring.outlinePlan.persistenceAvailable && <div className="error-box">목차 저장 기능을 준비하고 있습니다. 잠시 후 다시 시도해 주세요.</div>}
          </div>}
        </Card>
        <Card title="" className="report-step-card report-step-card--3 report-stage-card">
          {renderStageHeader(3)}
          {!authoring?.available ? <div className="error-box">{authoring?.unavailableReason ?? '이 유형의 승인된 챕터 프롬프트가 없습니다.'}</div> : <div className="form-stack">
            <div className="report-draft-methods" role="radiogroup" aria-label="보고서 초안 작성 방식">
              <button type="button" role="radio" aria-checked={draftMethod === 'AI'} className={draftMethod === 'AI' ? 'is-selected is-ai' : ''} onClick={() => setDraftMethod('AI')}><span>✦ AI 자동작성</span><strong>프로젝트 근거로 챕터 초안 생성</strong><small>API가 연결되어 있을 때 사용합니다. 생성 뒤 담당자가 전부 수정할 수 있습니다.</small></button>
              <button type="button" role="radio" aria-checked={draftMethod === 'MANUAL'} className={draftMethod === 'MANUAL' ? 'is-selected is-manual' : ''} onClick={() => setDraftMethod('MANUAL')}><span>⌨ 수동·외부 LLM</span><strong>직접 작성하거나 결과 붙여넣기</strong><small>API 키 없이 ChatGPT·Claude 등에서 만든 초안과 HWP 원본을 사용할 수 있습니다.</small></button>
            </div>
            <div className="inline-form">
              <Select label="초안을 작성할 챕터" value={selectedChapterId} onChange={(event) => changeSelectedChapter(event.target.value)} disabled={!editable || generating || saving} options={authoring.chapters.map((chapter) => ({ value: chapter.id, label: `${chapter.chapterCode} · ${outlineTitles[chapter.id] || chapter.title} · prompt v${chapter.promptVersion}` }))} />
              {draftMethod === 'AI' ? <Button className="report-action-ai" onClick={() => void generateChapter()} disabled={!editable || !authoring.aiConnected || outlineStatus !== 'CONFIRMED' || outlineDirty || !selectedChapterId || dirty || saving || generating}>{generating ? '근거 분석·작성 중…' : '✦ 선택 챕터 AI 자동 작성'}</Button> : <Button className="report-action-manual" onClick={startManualChapter} disabled={!editable || outlineStatus !== 'CONFIRMED' || outlineDirty || !selectedChapterId || saving}>{authoredChapterCodes.has(selectedChapter?.chapterCode ?? '') ? '현재 초안 직접 편집' : '수동 입력 시작'}</Button>}
            </div>
            {draftMethod === 'MANUAL' && <section className="report-manual-source"><div><b>HWP·DOCX 전체 문서 적용</b><span>가져온 문서는 챕터로 임의 분할하지 않고 현재 보고서 본문 전체를 교체합니다. HWP는 팝업에서 원본을 확인한 뒤 “전체 문서를 보고서에 적용”을 누르세요.</span>{linkedHwpName && <small>연결된 원본: {linkedHwpName}</small>}</div><div className="report-manual-source__actions"><Button className="report-action-hwp" onClick={() => hwpInputRef.current?.click()} disabled={linkingHwp}>{linkingHwp ? 'HWP 연결 중…' : 'HWP 전체 적용'}</Button><Button className="report-action-review" variant="secondary" onClick={() => reportDocxInputRef.current?.click()} disabled={saving}>DOCX 전체 적용</Button><Button className="report-action-confirm" onClick={continueWithoutAi} disabled={!editable || outlineStatus !== 'CONFIRMED' || outlineDirty || saving}>AI 없이 담당자 검수로 이동</Button></div></section>}
            <section className="report-quantity-attachment" aria-label="산출서 및 내역자료 첨부"><header><div><b>산출서·내역자료 XLSX 첨부 및 발췌</b><span>원본 파일은 프로젝트 자료에 보존하고, 지정한 셀 범위만 표로 현재 챕터에 넣습니다.</span></div><Button variant="secondary" onClick={() => quantityExcelInputRef.current?.click()} disabled={saving || !selectedChapter}>XLSX 첨부·발췌</Button></header><label><span>발췌 범위</span><input value={quantityRange} onChange={(event) => setQuantityRange(event.target.value)} placeholder="예: A1:H40 · 비워두면 사용영역 전체" /></label>{quantityExcerpt && <div className="report-quantity-attachment__preview"><label><span>{quantityFileName} · 보고서에 넣기 전 수정 가능</span><textarea value={quantityExcerpt} onChange={(event) => setQuantityExcerpt(event.target.value)} /></label><Button className="report-action-confirm" onClick={applyQuantityExcerptToCurrentChapter}>현재 챕터에 표 넣기</Button></div>}</section>
            {selectedChapter && <div className="report-chapter-source-pack"><header><div><span>CURRENT CHAPTER AGENT</span><h3>{selectedChapter.agentCode} · {selectedChapter.chapterCode} {outlineTitles[selectedChapter.id] || selectedChapter.title}</h3></div><em>{selectedChapterSources.filter((source) => source.status === 'READY').length}/{selectedChapterSources.length} SOURCES READY</em></header><div>{selectedChapterSources.map((source) => <span key={source.code} data-source-state={source.status}>{source.status === 'READY' ? '✓' : source.status === 'PARTIAL' ? '!' : '○'} {source.label}</span>)}</div><p><strong>{draftMethod === 'AI' ? 'AI 작성 기준' : '수동 작성 참고자료'}</strong> {draftMethod === 'AI' ? '관리자 승인 프롬프트 + 현재 프로젝트 근거 + 확정 목차 제목을 사용합니다.' : '연결된 프로젝트 근거를 확인하고, 외부 LLM에서 만든 문장도 사실·수치와 대조한 뒤 붙여넣습니다.'}</p></div>}
            {selectedChapter && <section className="report-case-law" aria-labelledby="report-case-law-title">
              <header><div><span>OFFICIAL CASE-LAW GROUNDING</span><h3 id="report-case-law-title">판례 근거 추가</h3><p>국가법령정보센터 원문을 검색해 1~3건을 선택합니다. 사실관계 자료와 법리 근거는 분리되며 선택하지 않은 사건번호는 생성 단계에서 차단됩니다.</p></div><em>{caseLawSources.length}/3 SELECTED</em></header>
              <div className="report-case-law__search"><label><span>법률 쟁점·판례 검색어</span><input value={caseLawQuery} maxLength={200} onChange={(event)=>setCaseLawQuery(event.target.value)} placeholder="예: 지체상금 면책 하자보수보증금" /></label><Button variant="secondary" onClick={()=>void findCaseLawIssues()} disabled={Boolean(caseLawBusy)}>{caseLawBusy==='issues'?'쟁점 추출 중…':'현재 챕터에서 쟁점 찾기'}</Button><Button className="report-action-ai" onClick={()=>void searchCaseLaw()} disabled={caseLawQuery.trim().length<2||Boolean(caseLawBusy)}>{caseLawBusy==='search'?'공식 API 검색 중…':'공식 판례 검색'}</Button></div>
              {caseLawIssues.length>0&&<div className="report-case-law__issues" aria-label="추천 판례 검색어">{caseLawIssues.map((issue)=><button key={issue} type="button" onClick={()=>void searchCaseLaw(issue)} disabled={Boolean(caseLawBusy)}>{issue}</button>)}</div>}
              {!caseLawApiConfigured&&<p className="error-box">테스트 서버의 <code>LAW_API_OC</code> 설정이 필요합니다. 설정 전에도 저장된 판례 근거와 검수 이력은 볼 수 있습니다.</p>}
              {caseLawResults.length>0&&<div className="report-case-law__results">{caseLawResults.map((candidate)=>{const checked=selectedPrecIds.includes(candidate.precId);return <label key={candidate.precId} className={checked?'is-selected':''}><input type="checkbox" checked={checked} disabled={!checked&&selectedPrecIds.length>=3} onChange={(event)=>setSelectedPrecIds((current)=>event.target.checked?[...current,candidate.precId]:current.filter((id)=>id!==candidate.precId))}/><span><strong>{candidate.caseName}</strong><small>{candidate.courtName} · {candidate.caseNumber} · {candidate.decisionDate}</small><em>{candidate.summaryText||candidate.holdingText||'판시사항·판결요지는 원문 선택 후 확인합니다.'}</em></span><a href={candidate.officialUrl} target="_blank" rel="noreferrer">공식 원문</a></label>})}<Button className="report-action-confirm" onClick={()=>void saveCaseLawSelection()} disabled={selectedPrecIds.length<1||Boolean(caseLawBusy)}>{caseLawBusy==='select'?'원문 보존 중…':`선택 ${selectedPrecIds.length}건 근거로 저장`}</Button></div>}
              {caseLawSources.length>0?<div className="report-case-law__selected"><label className="report-case-law__toggle"><input type="checkbox" checked={useCaseLaw} onChange={(event)=>setUseCaseLaw(event.target.checked)}/><span><strong>선택 판례를 이번 AI 초안의 법리 근거로 사용</strong><small>문장별 판례 ID를 기록하고 4단계에서 인용 상태를 검수합니다.</small></span></label>{caseLawSources.map((source)=><article key={source.id}><div><strong>{source.caseName}</strong><span>{source.courtName} · {source.caseNumber} · {source.decisionDate}</span><small>SHA {source.sourceSha256.slice(0,12)}… · {new Date(source.fetchedAt).toLocaleString('ko-KR')}</small></div><p>{source.summaryText||source.holdingText}</p><footer><a href={source.officialUrl} target="_blank" rel="noreferrer">국가법령정보 원문 확인</a><Button variant="secondary" size="sm" onClick={()=>void excludeCaseLaw(source.id)} disabled={Boolean(caseLawBusy)}>이번 챕터에서 제외</Button></footer></article>)}</div>:<p className="empty-box">선택된 판례가 없습니다. 판례 없이 기존 프로젝트 근거만으로 초안을 작성할 수도 있습니다.</p>}
              {caseLawNotice&&<p className="notice-box" role="status">{caseLawNotice}</p>}
            </section>}
            {editable && (content.trim() || draftMethod === 'MANUAL') && activeStep === 3 && <section className="report-stage-inline-editor"><header><div><b>담당자 직접 편집</b><span>AI·수동·외부 문서 초안을 전체폭 편집기에서 고칩니다. 입력은 자동 저장되고 Ctrl+S로 즉시 저장 지점을 만들 수 있습니다.</span></div><div className="report-stage-inline-editor__actions"><Button className="report-action-review" variant="secondary" onClick={() => void saveNow('MANUAL')} disabled={!dirty || saving}>{saving ? '저장 중…' : 'Ctrl+S 저장 지점 만들기'}</Button>{backups.length > 0 && <a href="#report-backups">시간별 백업 불러오기</a>}</div></header><StructuredDocumentEditor ref={reportBodyRef} documentKey={`report-step3-${selectedCaseId}`} label="현재까지 작성된 보고서 초안" value={content} editorJson={editorJson} onSelectionChange={setSelectedTextRange} selectionAssistant={{busy:improving,disabled:!authoring?.assistantConnected,onImprove:(mode,selection)=>void improveSelectedWriting(mode==='professional'?'문법과 맞춤법을 바로잡고 건설 클레임 보고서 문체로 전문적으로 다듬어 주세요. 사실과 수치는 유지하세요.':mode==='concise'?'중복 표현을 제거하고 더 간결하고 명확하게 고쳐 주세요. 사실과 수치는 유지하세요.':improvementInstruction,selection)}} onChange={(next, json) => { contentRef.current = next; setContent(next); setEditorJson(json); setDirty(true); }} /></section>}
            {draftMethod === 'AI' && <p className="muted">프로젝트 유형 {authoring.claimType} · {authoring.providerLabel} / {authoring.modelLabel} · {authoring.credentialSource === 'PERSONAL' ? '내 개인 API 키 우선 사용' : authoring.credentialSource === 'ORGANIZATION' ? '조직 공용 암호화 키 사용' : authoring.credentialSource === 'ENVIRONMENT' ? '회사 서버 보안 키 사용' : '키 연결 필요'} · 프롬프트 원문은 관리자만 열람·수정할 수 있습니다.</p>}
            {(outlineStatus !== 'CONFIRMED' || outlineDirty) && <div className="error-box">2단계에서 최신 목차 기획을 확정해야 챕터 자동 작성이 열립니다.</div>}
            {draftMethod === 'AI' && !authoring.aiConnected && <div className="error-box">AI 연결이 없어 자동작성을 사용할 수 없습니다. 수동·외부 LLM을 선택하면 API 키 없이 계속 작성할 수 있습니다.</div>}
            {draftMethod === 'AI' && (dirty || saving) && <p className="notice-box">현재 편집 내용을 먼저 저장하면 최신 보고서 버전을 기준으로 AI 챕터를 작성할 수 있습니다.</p>}
          </div>}
        </Card>
        <Card title="" className="report-step-card report-step-card--4 report-stage-card">
          {renderStageHeader(4)}
          <div className="form-stack">
            <section className="report-chapter-collaboration" aria-labelledby="report-chapter-collaboration-title">
              <header><div><span>CHAPTER COLLABORATION · VERSIONED</span><h3 id="report-chapter-collaboration-title">챕터별 담당 지정·작성·검수</h3><p>담당 PM이 챕터별 회원을 지정합니다. 담당자는 배정된 챕터만 작성·검수하고, PM이 검수 완료본을 전체 보고서에 반영합니다.</p></div><em>{chapterCollaboration?.canManage ? 'PM · ASSIGNMENT CONTROL' : 'MY ASSIGNED CHAPTERS'}</em></header>
              {chapterCollaboration?.canManage && <div className="report-chapter-assignment-grid">{authoring?.chapters.map((chapter) => {
                const assignment = chapterCollaboration.assignments.find((item) => item.chapterId === chapter.id);
                return <label key={chapter.id}><span><b>{chapter.chapterCode}</b>{outlineTitles[chapter.id] || chapter.title}</span><select aria-label={`${chapter.chapterCode} 담당자`} value={assignment?.assigneeId ?? ''} disabled={Boolean(chapterBusy)} onChange={(event) => void assignChapter(chapter.id, event.target.value)}><option value="">담당 미지정</option>{chapterCollaboration.members.map((member) => <option key={member.id} value={member.id}>{member.displayName} · {member.roles.join('/')}</option>)}</select><small data-status={assignment?.status ?? 'UNASSIGNED'}>{assignment?.assigneeName ?? '담당 없음'} · {assignment?.status === 'READY' ? 'PM 반영 대기' : assignment?.status === 'APPLIED' ? '보고서 반영 완료' : assignment?.status === 'IN_PROGRESS' ? `작성 중 · v${assignment.version}` : '미지정'}</small></label>;
              })}</div>}
              <div className="report-chapter-workbench">
                <Select label="작성·검수할 챕터" value={selectedChapterId} onChange={(event) => changeSelectedChapter(event.target.value)} disabled={Boolean(chapterBusy)} options={(authoring?.chapters ?? []).map((chapter) => {
                  const assignment = chapterCollaboration?.assignments.find((item) => item.chapterId === chapter.id);
                  return { value: chapter.id, label: `${chapter.chapterCode} · ${outlineTitles[chapter.id] || chapter.title} · ${assignment?.assigneeName ?? '미지정'}` };
                })} />
                {selectedChapterAssignment ? <><div className="report-chapter-workbench__identity"><strong>{selectedChapterAssignment.chapterCode} · {selectedChapterAssignment.chapterTitle}</strong><span>담당 {selectedChapterAssignment.assigneeName ?? '미지정'} · v{selectedChapterAssignment.version}</span><em data-status={selectedChapterAssignment.status}>{selectedChapterAssignment.status === 'READY' ? '검수 완료·PM 반영 대기' : selectedChapterAssignment.status === 'APPLIED' ? '전체 보고서 반영 완료' : '작성·검수 중'}</em></div><label className="report-chapter-workbench__editor"><span>챕터 협업 원고</span><textarea value={chapterDrafts[selectedChapterAssignment.chapterId] ?? ''} readOnly={!selectedChapterAssignment.canEdit} onChange={(event) => setChapterDrafts((current) => ({ ...current, [selectedChapterAssignment.chapterId]: event.target.value }))} placeholder="현재 챕터의 사실·수치·근거를 검수하며 작성하세요." /></label><div className="report-chapter-workbench__actions">{selectedChapterAssignment.canEdit && <><Button variant="secondary" onClick={() => void saveChapterCollaboration('SAVE')} disabled={Boolean(chapterBusy)}>챕터 중간 저장</Button><Button className="report-action-review" onClick={() => void saveChapterCollaboration('MARK_READY')} disabled={Boolean(chapterBusy) || !(chapterDrafts[selectedChapterAssignment.chapterId] ?? '').trim()}>담당자 검수 완료</Button></>}{chapterCollaboration?.canManage && selectedChapterAssignment.status === 'READY' && <Button className="report-action-confirm" onClick={() => void saveChapterCollaboration('APPLY')} disabled={Boolean(chapterBusy) || dirty}>검수본을 전체 보고서에 반영</Button>}</div></> : <p className="empty-box">현재 챕터는 아직 담당자가 지정되지 않았습니다. 담당 PM 또는 관리자에게 배정을 요청하세요.</p>}
              </div>
              {chapterNotice && <p className="notice-box" role="status">{chapterNotice}</p>}
            </section>
            <section className="report-case-law-review" aria-labelledby="report-case-law-review-title"><header><div><span>CASE-LAW CITATION REVIEW</span><h3 id="report-case-law-review-title">판례 인용 검수</h3><p>선택 판례의 공식 원문과 초안 문장을 대조합니다. 판례는 법리 근거이며 프로젝트 사실관계나 귀책을 자동 확정하지 않습니다.</p></div><em>{caseLawSources.length ? `${caseLawSources.length}건 대조` : '판례 미사용'}</em></header>{caseLawSources.length?<div>{caseLawSources.map((source)=>{const citation=latestCaseLawCitationBySource.get(source.id);const status=citation?.validationStatus??'REVIEW_REQUIRED';const label=status==='VERIFIED'?'ID 연결 정상':status==='INSUFFICIENT'?'근거 연결 불충분':status==='MISMATCH'?'내용 불일치':'사람 확인 필요';return <article key={source.id} data-citation-status={status}><header><div><strong>{source.caseNumber} · {source.caseName}</strong><small>{source.courtName} · {source.decisionDate}</small></div><span>{label}</span></header><p>{citation?.citationText||'이 판례와 연결된 생성 문장이 아직 없습니다. 판례 근거 초안을 생성하거나 직접 인용을 확인해 주세요.'}</p><small>{citation?.validationNote||'공식 판례 원문과 보고서 문장을 사람이 대조해야 합니다.'}</small><footer><a href={source.officialUrl} target="_blank" rel="noreferrer">공식 원문 열기</a><Button variant="secondary" size="sm" onClick={()=>void excludeCaseLaw(source.id)} disabled={Boolean(caseLawBusy)}>판례 교체·제외</Button></footer></article>})}</div>:<p className="empty-box">현재 챕터는 판례를 사용하지 않았습니다. 사실관계 근거만 검수하면 됩니다.</p>}</section>
            <Input required label="보고서 제목" value={title} maxLength={300} readOnly={!editable} onChange={(event) => { titleRef.current = event.target.value; setTitle(event.target.value); setDirty(true); }} />
            {activeStep === 4 && <StructuredDocumentEditor ref={reportBodyRef} documentKey={`report-step4-${selectedCaseId}`} label="보고서 본문 편집" value={content} editorJson={editorJson} readOnly={!editable} onSelectionChange={setSelectedTextRange} selectionAssistant={{busy:improving,disabled:!authoring?.assistantConnected,onImprove:(mode,selection)=>void improveSelectedWriting(mode==='professional'?'문법과 맞춤법을 바로잡고 건설 클레임 보고서 문체로 전문적으로 다듬어 주세요. 사실과 수치는 유지하세요.':mode==='concise'?'중복 표현을 제거하고 더 간결하고 명확하게 고쳐 주세요. 사실과 수치는 유지하세요.':improvementInstruction,selection)}} onChange={(next, json) => { contentRef.current = next; setContent(next); setEditorJson(json); setDirty(true); }} />}
            {editable && <section className="report-writing-assistant" aria-label="Gemini 글쓰기 개선 도우미"><div><span>GEMINI WRITING ASSISTANT</span><strong>다듬을 문장을 드래그한 뒤 원하는 작업을 누르세요.</strong><small>원문은 바로 덮어쓰지 않습니다. Google Docs처럼 개선안을 비교한 뒤 적용하거나 취소합니다.</small></div><input aria-label="글쓰기 개선 요청" value={improvementInstruction} maxLength={2000} onChange={(event) => setImprovementInstruction(event.target.value)} /><div className="report-selection-assistant"><span>{selectedTextRange ? `${selectedTextRange.text.length}자 선택됨` : '먼저 본문에서 문장을 드래그하세요'}</span><div className="action-row"><Button className="report-action-ai" onMouseDown={(event) => event.preventDefault()} onClick={() => void improveSelectedWriting('문법과 맞춤법을 바로잡고 건설 클레임 보고서 문체로 전문적으로 다듬어 주세요. 사실과 수치는 유지하세요.')} disabled={!authoring?.assistantConnected || !selectedTextRange || improving}>✦ 전문적으로</Button><Button className="report-action-ai" onMouseDown={(event) => event.preventDefault()} onClick={() => void improveSelectedWriting('중복 표현을 제거하고 더 간결하고 명확하게 고쳐 주세요. 사실과 수치는 유지하세요.')} disabled={!authoring?.assistantConnected || !selectedTextRange || improving}>✦ 간결하게</Button><Button className="report-action-ai" onMouseDown={(event) => event.preventDefault()} onClick={() => void improveSelectedWriting()} disabled={!authoring?.assistantConnected || !selectedTextRange || improving || improvementInstruction.trim().length < 3}>{improving ? '개선 중…' : '✦ 맞춤 요청'}</Button></div></div><div className="action-row"><Button className="report-action-review" variant="secondary" onClick={() => onNavigate('/settings')}>Gemini 설정 열기</Button><Button className="report-action-review" variant="secondary" disabled={!selectedTemplateCategory} onClick={() => setShowTemplatePreview(true)}>원본 템플릿 다시 보기</Button><Button className="report-action-review" variant="secondary" onClick={() => void improveWriting()} disabled={!authoring?.assistantConnected || !content.trim() || dirty || saving || improving || improvementInstruction.trim().length < 3}>본문 전체 개선</Button></div>{!authoring?.assistantConnected && <small>설정에서 개인 또는 관리자 공용 Gemini API 키를 연결하면 글 개선 버튼이 열립니다.</small>}</section>}
            {editable && selectedChapter && <section className="report-memory-feedback" aria-label="AI 학습 피드백"><header><div><span>FEEDBACK → REVIEW → MEMORY</span><strong>다음 보고서에서 같은 실수를 반복하지 않게 알려주세요.</strong><small>현재 프로젝트 저장본은 단기기억으로, 승인된 개인·유형·챕터 규칙은 장기기억으로 구분합니다. 채팅 기록 전체를 저장하거나 다른 사건의 내용을 섞지 않습니다.</small></div><em>APPROVED MEMORY</em></header><div className="report-memory-feedback__form"><label>적용 범위<select value={memoryScope} onChange={(event) => { setMemoryScope(event.target.value as MemoryScope); memoryRequestKey.current=crypto.randomUUID(); }}><option value="CHAPTER">현재 챕터</option><option value="CLAIM_TYPE">현재 클레임 유형</option><option value="REPORT_TYPE">현재 보고서 유형</option><option value="USER_FEEDBACK">내 반복 피드백</option><option value="GLOBAL">회사 전체</option></select></label><label>다음번에 개선할 점<input value={memoryFeedback} maxLength={2000} onChange={(event) => { setMemoryFeedback(event.target.value); memoryRequestKey.current=crypto.randomUUID(); }} placeholder="예: 책임소재를 너무 단정적으로 쓰지 말고 계약조항을 먼저 보여줘" /></label><Button onClick={() => void submitMemoryFeedback()} disabled={!memoryFeedback.trim() || memoryFeedback.trim().length < 3 || dirty || saving || submittingMemory}>{submittingMemory ? '분석·등록 중…' : '학습 후보 등록'}</Button></div>{dirty && <small>수정한 본문을 먼저 저장해야 AI 초안과 사람 수정본의 차이를 비교할 수 있습니다.</small>}{memoryNotice && <p className="notice-box">{memoryNotice}</p>}</section>}
            <p className="muted">{editable ? '입력이 멈춘 뒤 3초 후 자동 저장됩니다. 복구용 백업본은 변경된 작업을 기준으로 매시간 한 번 생성됩니다.' : 'Reviewer 계정은 저장된 보고서를 읽을 수 있지만 본문은 수정할 수 없습니다.'} {savedAt ? `마지막 저장 ${new Date(savedAt).toLocaleString('ko-KR')}` : ''}</p>
            {error && <p className="error-box" role="alert">{error}</p>}
          </div>
          <details id="report-backups" className="report-revision-history"><summary>시간별 백업 불러오기 · 최근 {backups.length}건</summary>{backups.length ? <ul className="dashboard-work-list">{backups.map((backup) => <li key={backup.id}><span><strong>{backup.backupHour.replace('T',' ')}시 백업 · {backup.title}</strong><small>보고서 v{backup.version} · {new Date(backup.savedAt).toLocaleString('ko-KR')} · {backup.savedBy.name} · 무결성 확인 {backup.contentSha256.slice(0, 12)}…</small></span><Button variant="secondary" onClick={() => restoreRevision(backup)}>이 백업 불러오기</Button></li>)}</ul> : <p className="empty-box">첫 자동 저장 때 백업이 생성되고, 이후 변경된 작업은 1시간 단위로 안전하게 보관됩니다.</p>}</details>
        </Card>
        <Card title="" className="report-step-card report-step-card--5 report-stage-card">
          {renderStageHeader(5)}
          <div className="form-stack">
            <div className="action-row"><span className="preview-pill">{currentReview ? currentReview.status === 'PENDING' ? `v${version} 검토 대기` : currentReview.status === 'APPROVED' ? `v${version} 승인 완료` : `v${version} 수정 요청` : pendingReview ? `v${pendingReview.reportVersion} 검토 중 · 현재 v${version}` : version ? `v${version} 제출 가능` : '저장 후 제출 가능'}</span><Button variant="secondary" onClick={() => onNavigate('/approval')}>검토·승인함 보기</Button></div>
            {currentReview?.decisionNote && <p className="notice-box"><strong>검토 의견</strong><br />{currentReview.decisionNote}</p>}
            {!currentReview && editable && <>
              <label htmlFor="preview-review-note">검토 요청 메모</label>
              <textarea id="preview-review-note" className="report-editor report-editor--decision" value={reviewNote} maxLength={2000} onChange={(event) => setReviewNote(event.target.value)} placeholder="검토자가 확인할 쟁점이나 근거를 남기세요." />
              <div className="action-row"><Button onClick={() => void requestReview()} disabled={!version || dirty || saving || submittingReview || !!pendingReview || loadedCaseId !== selectedCaseId}>{submittingReview ? '제출 중…' : '저장된 최신본 검토 요청'}</Button>{dirty && <span className="muted">변경사항을 먼저 저장해야 합니다.</span>}{pendingReview && <span className="muted">기존 검토가 끝난 뒤 새 버전을 제출할 수 있습니다.</span>}</div>
            </>}
          </div>
          <section className="report-stage-section report-final-output" aria-labelledby="report-final-output-title"><h3 id="report-final-output-title">승인본 확정·3종 다운로드</h3>
          {!currentReview || currentReview.status !== 'APPROVED' ? <p className="empty-box">독립 검토자가 현재 버전을 승인하면 미리보기와 동일한 DOCX·PDF·HWP 출력이 열립니다.</p> : !currentFinalization ? <div className="form-stack">
            <p className="notice-box"><strong>승인 완료 · v{currentReview.reportVersion}</strong><br />승인자 {currentReview.reviewedBy?.name} · 이 정확한 버전만 최종 확정됩니다.</p>
            <div className="action-row"><Button onClick={() => void finalizeApproved()} disabled={submittingReview || dirty || saving}>승인본 최종 확정</Button><span className="muted">확정 기록은 이후 변경·삭제할 수 없습니다.</span></div>
          </div> : <div className="form-stack">
            <p className="notice-box"><strong>최종 확정 완료 · v{currentFinalization.reportVersion}</strong><br />{currentFinalization.finalizedBy.name} · {new Date(currentFinalization.finalizedAt).toLocaleString('ko-KR')} · 승인자 {currentFinalization.approvedBy}</p>
            <div ref={finalReportPreviewRef} className="report-final-export-source"><ReportFinalDocumentPreview caseNumber={selectedCase?.caseNumber??''} caseTitle={selectedCase?.title??''} title={title} content={content} editorJson={editorJson}/></div>
            <div className="action-row final-export-actions" aria-label="확정 보고서 파일 내려받기">
              <Button className="final-export-button is-docx" aria-label="확정 보고서 Word DOCX 내려받기" onClick={() => void downloadFinalReport('docx')} disabled={submittingReview}><FileFormatIcon format="docx"/><span>Word DOCX</span></Button>
              <Button className="final-export-button is-pdf" aria-label="확정 보고서 PDF 내려받기" onClick={() => void downloadFinalReport('pdf')} disabled={submittingReview}><FileFormatIcon format="pdf"/><span>PDF</span></Button>
              <Button className="final-export-button is-hwp" aria-label="확정 보고서 HWP 내려받기" onClick={() => void downloadFinalReport('hwp')} disabled={submittingReview}><FileFormatIcon format="hwp"/><span>HWP</span></Button>
            </div>
            {finalExportMessage && <p className="notice-box" role="status">{finalExportMessage}</p>}
            {currentFinalization.outputs.map((output) => <p className="muted" key={output.id}>{output.format} · {(output.byteSize / 1024).toFixed(1)} KB · SHA {output.contentSha256.slice(0, 16)}…</p>)}
          </div>}</section>
        </Card>
      </>}
      <footer className="report-wizard-footer" aria-label="보고서 단계 이동">
        <Button variant="secondary" disabled={!previousStep} onClick={() => previousStep && changeWizardStep(previousStep)}>← 이전 단계</Button>
        <div>
          <strong>{activeStep} / 5 · {activeStepGuide.title}</strong>
          <small>{stepComplete[activeStep] ? `✓ ${activeStepGuide.doneText}` : nextBlockedReason || activeStepGuide.doneText}</small>
        </div>
        {nextStep
          ? <Button className="workflow-next-action" disabled={!stepComplete[activeStep]} onClick={() => changeWizardStep(nextStep)}>이 단계 완료 · 다음 단계 →</Button>
          : <Button onClick={() => onNavigate('/approval')}>검토·승인함 열기 →</Button>}
      </footer>
      <Dialog isOpen={Boolean(pendingNavigation)} title="보고서 작업을 저장하고 이동할까요?" onClose={() => !navigationBusy && setPendingNavigation(null)}>
        <div className="report-navigation-save-dialog">
          <div className="report-navigation-save-dialog__project"><span>현재 작성 중</span><strong>{selectedCase?.caseNumber} · {selectedCase?.title}</strong><small>{activeStep}단계 · {REPORT_WIZARD_STEPS[activeStep - 1].title} · {version ? `저장본 v${version}` : '아직 저장하지 않은 새 초안'}</small></div>
          <p>{dirty || workspaceDirty || outlineDirty ? '저장하지 않은 본문·목차·진행 단계가 있습니다. “저장하고 이동”을 누르면 현재 상태를 안전하게 저장한 뒤 이동합니다.' : '현재 상태는 이미 저장되어 있습니다. “저장하고 이동”을 누르면 안전하게 다음 화면으로 이동합니다.'}</p>
          <div className="action-row">
            <Button variant="secondary" onClick={() => setPendingNavigation(null)} disabled={navigationBusy}>계속 작성</Button>
            <Button variant="danger" onClick={continuePendingNavigation} disabled={navigationBusy || saving || savingOutline}>저장하지 않고 이동</Button>
            <Button onClick={() => void saveAndContinueNavigation()} disabled={navigationBusy || saving || savingOutline}>{navigationBusy ? '저장 확인 중…' : '저장하고 이동'}</Button>
          </div>
        </div>
      </Dialog>
      <Dialog isOpen={Boolean(improvementPreview)} title="Gemini 글쓰기 개선안 비교" onClose={() => setImprovementPreview(null)}>
        {improvementPreview && <div className="report-improvement-compare">
          <section><span>원문</span><p>{improvementPreview.original}</p></section>
          <section><span>Gemini 개선안</span><p>{improvementPreview.replacement}</p></section>
          <p className="notice-box">사실·숫자·날짜·인용이 원문과 같은지 사람이 확인한 뒤 적용하세요.</p>
          <div className="action-row"><Button variant="secondary" onClick={() => setImprovementPreview(null)}>취소·원문 유지</Button><Button className="report-action-confirm" onClick={applySelectedImprovement}>개선안 적용</Button></div>
        </div>}
      </Dialog>
      <Dialog isOpen={showTemplatePreview && Boolean(selectedTemplateCategory)} title={selectedTemplateCategory ? `${selectedTemplateCategory.categoryCode} · ${selectedTemplateCategory.displayName}` : '원본 보고서 템플릿'} onClose={() => setShowTemplatePreview(false)}>
        {selectedTemplateCategory && <div className="report-template-preview-dialog"><header><span>SOURCE-ANALYZED TEMPLATE · FINISHED REPORT REFERENCE · v{selectedTemplateCategory.analysisVersion}</span><p>{selectedTemplateCategory.analysisSummary}</p>{!selectedTemplateCategory.matchesCurrentType && <strong>참고 열람 전용 · 현재 프로젝트 유형은 {authoring?.claimType}, 이 원본의 주 유형은 {selectedTemplateCategory.primaryClaimType}입니다.</strong>}</header><section className="report-template-source-outline"><h3>원본에서 확인한 목차·작성 순서</h3><ol>{selectedTemplateCategory.outline.map((item) => <li key={item}>{item}</li>)}</ol></section><section className="report-template-source-files"><header><div><span>PRIVATE COMPANY GOOGLE DRIVE</span><h3>실제 원본 완제품 {selectedTemplateCategory.uploadedSourceCount}/{selectedTemplateCategory.expectedSourceCount}개</h3></div></header>{selectedTemplateCategory.files.length ? <ul>{selectedTemplateCategory.files.map((file) => <li key={file.id}><div><strong>{file.originalName}</strong><small>{file.fileExtension.toUpperCase()} · {(file.byteSize / 1024 / 1024).toFixed(1)} MB · {file.uploadedByName} · SHA {file.sha256.slice(0, 12)}…</small></div><Button variant="secondary" onClick={() => void openTemplateSource(file)}>{file.viewMode === 'INLINE' ? '원본 PDF 열기' : '원본 다운로드'}</Button></li>)}</ul> : <p className="empty-box">구조 분석과 챕터 프롬프트는 적용됐지만 Google Drive 원본 파일은 아직 등록되지 않았습니다. 관리자가 AI·템플릿 관리 화면에서 원본 폴더를 한 번 등록해야 합니다.</p>}</section>{selectedTemplatePreview && <details className="report-template-structure-fallback"><summary>웹용 구조 예시도 함께 보기</summary><pre>{selectedTemplatePreview.finishedExample}</pre></details>}</div>}
      </Dialog>
    </div>
  );
}
