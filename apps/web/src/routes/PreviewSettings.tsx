import { Button, Card, StatusBadge } from '@claim-studio/ui';
import { useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../api';
import { StatusFeedbackState } from '../layout/StatusFeedbackState';
import { PreviewGoogleDriveSetup } from './PreviewEvidenceHub';
import type { UserRole } from './Router';

type ProviderKind = 'OPENAI' | 'ANTHROPIC' | 'GEMINI';
type CredentialScope = 'USER' | 'ORGANIZATION';
type SettingsSection = 'PERSONAL' | 'ADMIN';
type TaskKind = 'OUTLINE_PLANNING' | 'CHAPTER_WRITING' | 'FACT_CHECK';

interface CredentialState {
  configured: boolean;
  storage: 'ENCRYPTED_D1' | 'CLOUDFLARE_SECRET' | 'NONE';
  version: number;
  updatedAt: string | null;
  fingerprint: string | null;
  workspaceConfigured?: boolean | null;
  health?: {
    status: 'UNCHECKED' | 'HEALTHY' | 'FAILED';
    modelCode: string;
    latencyMs: number | null;
    failureCode: string | null;
    providerStatus: number | null;
    checkedAt: string | null;
  };
}
interface ProviderState { providerKind: ProviderKind; label: string; personal: CredentialState; organization: CredentialState }
interface SettingsPayload { personalPriority: boolean; masterKeyReady: boolean; canManageOrganization: boolean; providers: ProviderState[] }
interface AiModelOption { code: string; label: string }
interface AiProvider { providerKind: ProviderKind; label: string; models: AiModelOption[] }
interface AiRoute { taskKind: TaskKind; providerKind: ProviderKind; modelCode: string; reasoningEffort: string; version: number }
interface AiConfig { providers: AiProvider[]; routes: AiRoute[] }
interface WorkspacePolicy {
  organizationName: string;
  localAiMode: 'DISABLED' | 'PRIVATE_SERVER_BRIDGE';
  memoryProvider: 'NONE' | 'HERMES_AGENT';
  memoryApprovalMode: 'ADMIN_REVIEW' | 'DISABLED';
  shortTermMemoryEnabled: boolean;
  longTermMemoryEnabled: boolean;
  version: number;
  updatedAt: string | null;
}
interface WorkspaceRuntime { localAi: string; hermes: string; memoryLearning: string; supportedLocalProviders: string[] }
interface HermesBridgeState {
  configured: boolean; baseUrl: string; keyId: string; version: number; updatedAt: string | null;
  secretStored: boolean; status: 'NOT_CONFIGURED' | 'CONFIGURED_NOT_YET_TESTED' | 'CONNECTED';
}
interface MemoryCandidate {
  id: string; memoryScope: string; scopeKey: string; problemText: string; ruleText: string; tags: string[];
  analyzerCode: string; confidence: number; status: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'DISABLED';
  version: number; createdAt: string; reviewedAt: string | null; feedbackText: string; chapterCode: string;
  caseNumber: string; caseTitle: string; createdByName: string;
}
interface AiGovernance {
  providerKind: 'GEMINI';
  providerServiceTier: 'UNVERIFIED_OR_FREE' | 'PAID_NO_PRODUCT_IMPROVEMENT' | 'VERTEX_AI_ENTERPRISE';
  confidentialExternalAiEnabled: boolean;
  minimizePersonalData: boolean;
  providerTermsUrl: string;
  version: number;
  updatedAt: string;
}
type ProposalTemplateCategory = 'REDEVELOPMENT_FINANCE'|'REDEVELOPMENT_COST'|'CLAIM_LITIGATION'|'PRICE_ESCALATION'|'PUBLIC_SUPPORT'|'GENERAL_CLAIM';
interface ProposalTemplateChapterPrompt {
  templateSourceId: string;
  chapterNumber: 1 | 2 | 3;
  executionOrder: 1 | 2 | 3;
  chapterTitle: string;
  instructionText: string;
  isActive: boolean;
  version: number;
  updatedAt: string;
}
interface ProposalTemplatePromptProfile {
  templateSourceId:string; templateSourceName:string; templateCategory:ProposalTemplateCategory;
  systemInstruction:string; validationInstruction:string; isActive:boolean; version:number; updatedAt:string;
  chapters:ProposalTemplateChapterPrompt[];
}

const PROPOSAL_TEMPLATE_CATEGORY_LABELS:Record<ProposalTemplateCategory,string>={
  REDEVELOPMENT_FINANCE:'정비사업 금융·HUG',REDEVELOPMENT_COST:'정비사업 공사비',CLAIM_LITIGATION:'클레임·소송·감정',PRICE_ESCALATION:'물가변동·간접비',PUBLIC_SUPPORT:'공공지원·LH',GENERAL_CLAIM:'일반 건설클레임'
};

const MODEL_CHOICES: Record<ProviderKind, readonly string[]> = {
  OPENAI: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  ANTHROPIC: ['claude-sonnet-5', 'claude-opus-5'],
  GEMINI: ['gemini-3.7-flash', 'gemini-3.6-flash']
};
const PRIMARY_TASK: Record<ProviderKind, { task: TaskKind; label: string; effort: string }> = {
  OPENAI: { task: 'OUTLINE_PLANNING', label: '목차·구조 기획', effort: 'high' },
  ANTHROPIC: { task: 'CHAPTER_WRITING', label: '장문 보고서 본문 작성', effort: 'high' },
  GEMINI: { task: 'FACT_CHECK', label: '사실·근거 확인과 문장 개선', effort: 'medium' }
};

const PROVIDER_COPY: Record<ProviderKind, {
  short: string; use: string; placeholder: string; issueUrl: string; guideUrl: string; issueSteps: readonly string[];
}> = {
  OPENAI: {
    short: 'ChatGPT', use: '목차 기획과 구조 설계', placeholder: 'OpenAI API Key',
    issueUrl: 'https://platform.openai.com/api-keys', guideUrl: 'https://platform.openai.com/docs/quickstart/make-your-first-api-request',
    issueSteps: ['OpenAI Platform에 로그인합니다.', 'API Keys에서 Create new secret key를 누릅니다.', '발급 직후 한 번만 보이는 키를 복사해 아래에 저장합니다.']
  },
  ANTHROPIC: {
    short: 'Claude', use: '장문 보고서 본문 작성', placeholder: 'Anthropic API Key',
    issueUrl: 'https://console.anthropic.com/settings/keys', guideUrl: 'https://platform.claude.com/docs/en/manage-claude/authentication',
    issueSteps: ['Anthropic Console에 로그인합니다.', 'Settings · API Keys에서 새 키를 만들고 복사합니다.', '여러 Workspace에 연결된 키라면 Settings · Workspaces의 wrkspc_ ID도 함께 입력합니다.']
  },
  GEMINI: {
    short: 'Gemini', use: '글쓰기 도우미·문장 개선·사실 확인', placeholder: 'Google AI Studio API Key',
    issueUrl: 'https://aistudio.google.com/apikey', guideUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    issueSteps: ['Google AI Studio에 회사 또는 개인 Google 계정으로 로그인합니다.', 'API 키 만들기를 누르고 사용할 Google Cloud 프로젝트를 고릅니다.', '발급 키를 복사해 아래에 저장한 뒤 연결 확인을 누릅니다.']
  }
};

export function PreviewSettings({ roles, onNavigate }: { roles: UserRole[]; onNavigate: (path: string) => void }): React.ReactElement {
  const isAdmin = roles.includes('admin');
  const requestedSection = new URLSearchParams(window.location.search).get('section');
  const [section, setSection] = useState<SettingsSection>(requestedSection === 'admin' && isAdmin ? 'ADMIN' : 'PERSONAL');
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const [selectedModels, setSelectedModels] = useState<Partial<Record<ProviderKind, string>>>({});
  const [workspace, setWorkspace] = useState<WorkspacePolicy | null>(null);
  const [runtime, setRuntime] = useState<WorkspaceRuntime | null>(null);
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([]);
  const [aiGovernance, setAiGovernance] = useState<AiGovernance | null>(null);
  const [proposalPromptProfiles, setProposalPromptProfiles] = useState<ProposalTemplatePromptProfile[]>([]);
  const [selectedProposalPromptSourceId, setSelectedProposalPromptSourceId] = useState('');
  const [hermesBridge, setHermesBridge] = useState<HermesBridgeState | null>(null);
  const [hermesHmacKey, setHermesHmacKey] = useState('');
  const [aiGovernanceAck, setAiGovernanceAck] = useState('');
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [workspaceIds, setWorkspaceIds] = useState<Record<string, string>>({});
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setPayload(await apiRequest<SettingsPayload>('/api/settings/ai-credentials'));
      if (isAdmin) {
        const [admin, memory, governance, proposalConfig, bridgeConfig, reportAi] = await Promise.all([
          apiRequest<{ settings: WorkspacePolicy; runtime: WorkspaceRuntime }>('/api/settings/admin-workspace'),
          apiRequest<{ candidates: MemoryCandidate[] }>('/api/admin/report-memory'),
          apiRequest<{ governance: AiGovernance }>('/api/settings/ai-governance').catch(() => null),
          apiRequest<{ promptProfiles: ProposalTemplatePromptProfile[] }>('/api/proposal-studio/config'),
          apiRequest<{ bridge: HermesBridgeState }>('/api/settings/hermes-bridge'),
          apiRequest<{ aiConfig: AiConfig }>('/api/admin/report-prompts')
        ]);
        setWorkspace(admin.settings);
        setRuntime(admin.runtime);
        setMemoryCandidates(memory.candidates);
        setAiGovernance(governance?.governance ?? null);
        setProposalPromptProfiles(proposalConfig.promptProfiles ?? []);
        setSelectedProposalPromptSourceId((current) => current || proposalConfig.promptProfiles?.[0]?.templateSourceId || '');
        setHermesBridge(bridgeConfig.bridge);
        setAiConfig(reportAi.aiConfig);
        setSelectedModels(Object.fromEntries(reportAi.aiConfig.providers.map((provider) => {
          const available = provider.models.filter((model) => MODEL_CHOICES[provider.providerKind].includes(model.code));
          const routed = reportAi.aiConfig.routes.find((route) => route.taskKind === PRIMARY_TASK[provider.providerKind].task && route.providerKind === provider.providerKind);
          return [provider.providerKind, available.some((model) => model.code === routed?.modelCode) ? routed?.modelCode : available[0]?.code ?? ''];
        })) as Partial<Record<ProviderKind, string>>);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const changeSection = (next: SettingsSection) => {
    if (next === 'ADMIN' && !isAdmin) return;
    setSection(next);
    window.history.replaceState({}, '', next === 'ADMIN' ? '/settings?section=admin' : '/settings');
  };
  const stateFor = (provider: ProviderState, scope: CredentialScope) => scope === 'USER' ? provider.personal : provider.organization;
  const inputKey = (provider: ProviderKind, scope: CredentialScope) => `${scope}:${provider}`;
  const modelOptions = (provider: ProviderKind): AiModelOption[] => {
    const configured = aiConfig?.providers.find((item) => item.providerKind === provider)?.models ?? [];
    return configured.filter((model) => MODEL_CHOICES[provider].includes(model.code));
  };

  const saveProviderModel = async (provider: ProviderKind): Promise<void> => {
    if (!aiConfig) return;
    const target = PRIMARY_TASK[provider];
    const route = aiConfig.routes.find((item) => item.taskKind === target.task);
    const modelCode = selectedModels[provider] ?? '';
    if (!route || !modelOptions(provider).some((model) => model.code === modelCode)) throw new Error('선택한 AI 모델 정보를 다시 불러와 주세요.');
    const result = await apiRequest<{ aiConfig: AiConfig }>('/api/admin/report-prompts/settings', {
      method: 'PUT', body: JSON.stringify({ taskKind: target.task, providerKind: provider, modelCode, reasoningEffort: target.effort, expectedVersion: route.version })
    });
    setAiConfig(result.aiConfig);
  };

  const saveKey = async (provider: ProviderState, scope: CredentialScope) => {
    const state = stateFor(provider, scope);
    const field = inputKey(provider.providerKind, scope);
    const key = keys[field]?.trim() ?? '';
    const workspaceId = workspaceIds[field]?.trim() ?? '';
    const workspaceOnly = provider.providerKind === 'ANTHROPIC' && scope === 'ORGANIZATION' && state.configured && Boolean(workspaceId);
    if (!key && !workspaceOnly) return;
    setBusy(field); setError(''); setNotice('');
    try {
      const next = await apiRequest<SettingsPayload>(`/api/settings/ai-credentials/${provider.providerKind}`, {
        method: 'PUT', body: JSON.stringify({ scope, ...(key ? { apiKey: key } : {}), ...(workspaceId ? { workspaceId } : {}), expectedVersion: state.version })
      });
      setPayload(next);
      if (scope === 'ORGANIZATION') await saveProviderModel(provider.providerKind);
      setKeys((current) => ({ ...current, [field]: '' }));
      setWorkspaceIds((current) => ({ ...current, [field]: '' }));
      setNotice(workspaceOnly && !key ? 'Claude Workspace ID를 저장했습니다. 연결 확인을 실행해 주세요.' : `${scope === 'USER' ? '개인' : '조직 공용'} ${PROVIDER_COPY[provider.providerKind].short} 키${scope === 'ORGANIZATION' ? '와 선택 모델' : ''}을 저장했습니다.`);
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 409
        ? '다른 화면에서 설정이 변경되었습니다. 새로고침 후 다시 저장해 주세요.'
        : reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(''); }
  };

  const disableKey = async (provider: ProviderState, scope: CredentialScope) => {
    const state = stateFor(provider, scope);
    const field = inputKey(provider.providerKind, scope);
    setBusy(field); setError(''); setNotice('');
    try {
      setPayload(await apiRequest<SettingsPayload>(`/api/settings/ai-credentials/${provider.providerKind}`, {
        method: 'DELETE', body: JSON.stringify({ scope, expectedVersion: state.version })
      }));
      setNotice(`${PROVIDER_COPY[provider.providerKind].short} 키를 안전하게 비활성화했습니다.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };

  const testKey = async (provider: ProviderState, scope: CredentialScope) => {
    const field = inputKey(provider.providerKind, scope);
    setBusy(`test:${field}`); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ source: string; checkedAt: string; latencyMs: number }>(`/api/settings/ai-credentials/${provider.providerKind}/test`, {
        method: 'POST', timeoutMs: 40_000, body: JSON.stringify({ scope, modelCode: selectedModels[provider.providerKind] ?? modelOptions(provider.providerKind)[0]?.code })
      });
      setPayload(await apiRequest<SettingsPayload>('/api/settings/ai-credentials'));
      setNotice(`${PROVIDER_COPY[provider.providerKind].short} 연결 정상 · ${result.latencyMs.toLocaleString('ko-KR')}ms · ${new Date(result.checkedAt).toLocaleString('ko-KR')}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      try { setPayload(await apiRequest<SettingsPayload>('/api/settings/ai-credentials')); } catch { /* keep the provider failure visible */ }
    }
    finally { setBusy(''); }
  };

  const saveWorkspace = async () => {
    if (!workspace) return;
    setBusy('workspace'); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ settings: WorkspacePolicy; runtime: WorkspaceRuntime }>('/api/settings/admin-workspace', {
        method: 'PUT', body: JSON.stringify({
          organizationName: workspace.organizationName,
          localAiMode: workspace.localAiMode,
          memoryProvider: workspace.memoryProvider,
          memoryApprovalMode: workspace.memoryApprovalMode,
          shortTermMemoryEnabled: workspace.shortTermMemoryEnabled,
          longTermMemoryEnabled: workspace.longTermMemoryEnabled,
          expectedVersion: workspace.version
        })
      });
      setWorkspace(result.settings); setRuntime(result.runtime); setNotice('관리자 워크스페이스 정책을 D1에 저장했습니다.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };

  const saveHermesBridge = async () => {
    if (!hermesBridge || !hermesHmacKey.trim()) return;
    setBusy('hermes-bridge'); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ bridge: HermesBridgeState }>('/api/settings/hermes-bridge', {
        method:'PUT', body:JSON.stringify({ baseUrl:hermesBridge.baseUrl, keyId:hermesBridge.keyId, hmacKey:hermesHmacKey.trim(), expectedVersion:hermesBridge.version })
      });
      setHermesBridge(result.bridge); setHermesHmacKey('');
      setNotice('Hermes Private Bridge 주소와 HMAC 공유키를 암호화해 저장했습니다. 연결 확인을 실행하세요.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };

  const testHermesBridge = async () => {
    setBusy('hermes-test'); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ bridge: HermesBridgeState; health: { serviceVersion: string; hermesRuntime: string; latencyMs: number } }>('/api/settings/hermes-bridge/test', { method:'POST' });
      setHermesBridge(result.bridge);
      setNotice(`Hermes 연결 확인 완료 · ${result.health.hermesRuntime} · ${result.health.serviceVersion} · ${result.health.latencyMs}ms`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };

  const saveAiGovernance = async () => {
    if (!aiGovernance) return;
    setBusy('ai-governance'); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ governance: AiGovernance }>('/api/settings/ai-governance', { method:'PUT', body:JSON.stringify({ providerServiceTier:aiGovernance.providerServiceTier,confidentialExternalAiEnabled:aiGovernance.confidentialExternalAiEnabled,expectedVersion:aiGovernance.version,acknowledgement:aiGovernanceAck }) });
      setAiGovernance(result.governance); setAiGovernanceAck(''); setNotice('외부 AI 자료 전송 정책을 저장했습니다. 정책에 맞는 자료만 Gemini로 전송됩니다.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };

  const replaceProposalPromptProfile = (profile:ProposalTemplatePromptProfile) => setProposalPromptProfiles((current)=>current.map((item)=>item.templateSourceId===profile.templateSourceId?profile:item));

  const updateSelectedProposalPromptProfile = (update:(profile:ProposalTemplatePromptProfile)=>ProposalTemplatePromptProfile) => setProposalPromptProfiles((current)=>current.map((profile)=>profile.templateSourceId===selectedProposalPromptSourceId?update(profile):profile));

  const saveProposalPromptProfile = async (profile:ProposalTemplatePromptProfile) => {
    setBusy(`proposal-profile:${profile.templateSourceId}`); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ profile: ProposalTemplatePromptProfile }>(`/api/proposal-studio/prompt-profiles/${encodeURIComponent(profile.templateSourceId)}`, {
        method:'PUT',
        body:JSON.stringify({templateCategory:profile.templateCategory,systemInstruction:profile.systemInstruction,validationInstruction:profile.validationInstruction,isActive:profile.isActive,version:profile.version})
      });
      replaceProposalPromptProfile(result.profile);
      setNotice(`${result.profile.templateSourceName}의 공통·자가검증 지침 v${result.profile.version}을 저장했습니다.`);
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 409 ? '다른 관리자가 먼저 이 템플릿 지침을 수정했습니다. 화면을 다시 불러와 주세요.' : reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(''); }
  };

  const saveProposalPrompt = async (profile:ProposalTemplatePromptProfile,prompt:ProposalTemplateChapterPrompt) => {
    setBusy(`proposal-chapter:${profile.templateSourceId}:${prompt.chapterNumber}`);setError('');setNotice('');
    try{
      const result=await apiRequest<{profile:ProposalTemplatePromptProfile}>(`/api/proposal-studio/prompt-profiles/${encodeURIComponent(profile.templateSourceId)}/chapters/${prompt.chapterNumber}`,{method:'PUT',body:JSON.stringify({chapterTitle:prompt.chapterTitle,instructionText:prompt.instructionText,isActive:prompt.isActive,version:prompt.version})});
      replaceProposalPromptProfile(result.profile);
      setNotice(`${result.profile.templateSourceName} · ${prompt.chapterNumber}장 지침을 v${result.profile.chapters.find((item)=>item.chapterNumber===prompt.chapterNumber)?.version}으로 저장했습니다.`);
    }catch(reason){setError(reason instanceof ApiError&&reason.status===409?'다른 관리자가 먼저 이 챕터 지침을 수정했습니다. 화면을 다시 불러와 주세요.':reason instanceof Error?reason.message:String(reason));}
    finally{setBusy('');}
  };

  const changePassword = async () => {
    if (newPassword !== confirmPassword) { setError('새 비밀번호 확인이 일치하지 않습니다.'); return; }
    setBusy('password'); setError(''); setNotice('');
    try {
      await apiRequest('/api/settings/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setNotice('비밀번호를 변경했습니다. 이 브라우저의 작업은 유지되고 다른 기기의 로그인 세션은 종료되었습니다.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(''); }
  };

  const decideMemory = async (candidate: MemoryCandidate, action: 'APPROVE' | 'REJECT' | 'DISABLE') => {
    setBusy(`memory:${candidate.id}`); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ candidates: MemoryCandidate[] }>(`/api/admin/report-memory/${candidate.id}`, {
        method: 'PUT', body: JSON.stringify({
          action, expectedVersion: candidate.version,
          note: action === 'APPROVE' ? '관리자 검토 후 다음 생성에 반영' : action === 'REJECT' ? '관리자 검토에서 반영 제외' : '관리자에 의해 비활성화'
        })
      });
      setMemoryCandidates(result.candidates);
      setNotice(action === 'APPROVE' ? 'Memory를 승인했습니다.' : action === 'DISABLE' ? '활성 Memory를 비활성화했습니다.' : '학습 후보를 반려했습니다.');
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 409 ? '다른 관리자가 먼저 처리했습니다. 다시 불러와 주세요.' : reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(''); }
  };

  if (loading) return <StatusFeedbackState type="loading" message="설정과 연결 상태를 불러오고 있습니다." />;
  if (!payload) return <StatusFeedbackState type="error" title="설정을 불러오지 못했습니다" message={error || '잠시 후 다시 시도해 주세요.'} actionLabel="다시 시도" onAction={() => void load()} />;

  const renderCredentials = (scope: CredentialScope, title: string, detail: string) => <Card title={title} className="credential-settings-card">
    <header className="credential-settings-card__intro">
      <div><p>{detail}</p><small>{scope === 'USER' ? '개인 Gemini 키는 초안 개선과 AI 어시스턴트에만 사용합니다.' : '개인 Gemini 키가 없는 사용자에게 필요한 작업은 공용키가 사용됩니다.'}</small></div>
      <StatusBadge status={scope === 'USER' ? 'review' : 'approved'} />
    </header>
    <div className="credential-provider-grid" data-scope={scope}>
      {(scope === 'USER' ? payload.providers.filter((provider) => provider.providerKind === 'GEMINI') : payload.providers).map((provider) => {
        const state = stateFor(provider, scope);
        const field = inputKey(provider.providerKind, scope);
        const copy = PROVIDER_COPY[provider.providerKind];
        const options = modelOptions(provider.providerKind);
        const selectedModel = selectedModels[provider.providerKind] ?? options[0]?.code ?? '';
        const workspaceId = workspaceIds[field]?.trim() ?? '';
        const workspaceEditable = provider.providerKind === 'ANTHROPIC' && scope === 'ORGANIZATION';
        const hasCredentialChange = Boolean(keys[field]?.trim()) || (workspaceEditable && Boolean(workspaceId));
        const modelRoute = aiConfig?.routes.find((route) => route.taskKind === PRIMARY_TASK[provider.providerKind].task);
        const modelDirty = scope === 'ORGANIZATION' && Boolean(modelRoute) && (modelRoute?.providerKind !== provider.providerKind || modelRoute?.modelCode !== selectedModel);
        const isBusy = busy === field || busy === `test:${field}` || busy === `model:${field}`;
        const healthStatus = state.health?.status ?? 'UNCHECKED';
        const healthLabel = !state.configured ? '키 필요' : healthStatus === 'HEALTHY' ? '연결 정상' : healthStatus === 'FAILED' ? '연결 오류' : '확인 필요';
        return <section key={provider.providerKind} data-provider={provider.providerKind} data-configured={state.configured} data-health={healthStatus}>
          <header><span>{copy.short.slice(0, 2).toUpperCase()}</span><div><h3>{provider.label}</h3><p>{copy.use}</p></div><strong>{healthLabel}</strong></header>
          <div className="credential-state">
            <span>{state.storage === 'ENCRYPTED_D1' ? '키 암호화 저장됨' : state.storage === 'CLOUDFLARE_SECRET' ? '회사 서버 보안 키 저장됨' : '저장된 키 없음'}</span>
            {state.configured && healthStatus === 'UNCHECKED' && <small>저장만 완료되었습니다. 실제 사용 전 ‘연결 확인’을 실행해 주세요.</small>}
            {healthStatus === 'HEALTHY' && <small>{state.health?.modelCode} · {state.health?.latencyMs?.toLocaleString('ko-KR')}ms · {state.health?.checkedAt ? new Date(state.health.checkedAt).toLocaleString('ko-KR') : ''}</small>}
            {healthStatus === 'FAILED' && <small>최근 확인 실패 · {state.health?.failureCode ?? '원인 확인 필요'}{state.health?.providerStatus ? ` · HTTP ${state.health.providerStatus}` : ''}</small>}
            {state.fingerprint && <small>등록 키 확인값 · v{state.version}</small>}
          </div>
          <label htmlFor={`${field}-model`}>사용 모델</label>
          <select id={`${field}-model`} value={selectedModel} onChange={(event) => setSelectedModels((current) => ({ ...current, [provider.providerKind]: event.target.value }))}>
            {options.map((model) => <option key={model.code} value={model.code}>{model.label}</option>)}
          </select>
          <small className="credential-model-help">{scope === 'ORGANIZATION' ? `저장하면 ${PRIMARY_TASK[provider.providerKind].label} 기본 모델로 함께 적용됩니다.` : '개인 Gemini 키 연결 확인과 글쓰기 도우미에 사용합니다.'}</small>
          <label htmlFor={`${field}-key`}>{state.configured ? '새 키로 교체' : 'API Key 입력'}</label>
          <input id={`${field}-key`} type="password" value={keys[field] ?? ''} autoComplete="new-password" spellCheck={false} placeholder={copy.placeholder} onChange={(event) => setKeys((current) => ({ ...current, [field]: event.target.value }))} />
          {!keys[field]?.trim() && <small className="credential-input-help">키 원문은 저장 후 다시 표시되지 않습니다.</small>}
          {workspaceEditable && <>
            <label htmlFor={`${field}-workspace`}>Anthropic Workspace ID <small>선택 입력</small></label>
            <input id={`${field}-workspace`} type="text" value={workspaceIds[field] ?? ''} autoComplete="off" spellCheck={false} placeholder="wrkspc_..." onChange={(event) => setWorkspaceIds((current) => ({ ...current, [field]: event.target.value }))} />
            <small className="credential-input-help">여러 Workspace에 연결된 개인·서비스 계정 키만 필요합니다. {state.workspaceConfigured ? 'Workspace ID 저장됨' : '400 오류가 나면 Console · Settings · Workspaces의 ID를 입력하세요.'}</small>
          </>}
          <div className="credential-key-actions">
            <div className="action-row">
              <Button onClick={() => void saveKey(provider, scope)} disabled={isBusy || !hasCredentialChange || !selectedModel}>{isBusy ? '처리 중…' : workspaceEditable && !keys[field]?.trim() ? 'Workspace ID 저장' : state.configured ? scope === 'ORGANIZATION' ? '키·모델 교체' : '키 교체' : scope === 'ORGANIZATION' ? '키·모델 저장' : '암호화 저장'}</Button>
              {scope === 'ORGANIZATION' && state.configured && modelDirty && <Button variant="secondary" onClick={() => { setBusy(`model:${field}`); setError(''); setNotice(''); void saveProviderModel(provider.providerKind).then(() => setNotice(`${copy.short}의 ${PRIMARY_TASK[provider.providerKind].label} 모델을 저장했습니다.`)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setBusy('')); }} disabled={isBusy || busy === `model:${field}`}>모델만 적용</Button>}
              <a href={copy.issueUrl} target="_blank" rel="noreferrer">API KEY 발급 ↗</a>
              {state.configured && <Button variant="secondary" onClick={() => void testKey(provider, scope)} disabled={isBusy}>연결 확인</Button>}
              {state.storage === 'ENCRYPTED_D1' && <Button variant="ghost" onClick={() => void disableKey(provider, scope)} disabled={isBusy}>비활성화</Button>}
            </div>
            <details className="credential-issue-guide"><summary>API KEY 발급방법</summary><ol>{copy.issueSteps.map((step) => <li key={step}>{step}</li>)}</ol><a href={copy.guideUrl} target="_blank" rel="noreferrer">공식 발급 가이드 열기 ↗</a></details>
          </div>
        </section>;
      })}
    </div>
  </Card>;

  return <div className="content-stack preview-settings" aria-label="설정">
    <section className="preview-settings-hero"><div><span>WORKSPACE CONTROL CENTER</span><h2>설정</h2><p>개인 Gemini API 키와 관리자 전용 회사 Drive·공용 AI·Memory 정책을 한곳에서 관리합니다.</p></div><div><strong>{payload.masterKeyReady ? '암호화 저장 준비됨' : '서버 암호화키 필요'}</strong><small>키 원문은 브라우저와 API 응답에 다시 표시하지 않습니다.</small></div></section>
    <nav className="settings-section-tabs" aria-label="설정 종류">
      <button type="button" className={section === 'PERSONAL' ? 'is-active' : ''} aria-current={section === 'PERSONAL' ? 'page' : undefined} onClick={() => changeSection('PERSONAL')}><span>PERSONAL</span><strong>개인 설정</strong><small>Gemini 개인 키·비밀번호</small></button>
      {isAdmin && <button type="button" className={section === 'ADMIN' ? 'is-active' : ''} aria-current={section === 'ADMIN' ? 'page' : undefined} onClick={() => changeSection('ADMIN')}><span>ADMIN ONLY</span><strong>관리자 설정</strong><small>회사 Drive·공용 AI·Hermes·사용자</small></button>}
    </nav>
    <section className="settings-access-strip" aria-label="현재 계정 설정 권한"><div><span>현재 로그인 역할</span><strong>{roles.map((role) => role.toUpperCase()).join(' · ') || 'USER'}</strong></div><p>{section === 'PERSONAL' ? '현재 화면의 API 키는 내 계정에만 적용됩니다.' : '조직 전체에 적용되는 관리자 전용 화면입니다.'}</p></section>

    {section === 'PERSONAL' && <>
      <Card title="로그인 비밀번호 변경" className="password-settings-card">
        <p>내 계정의 비밀번호는 복원할 수 없는 안전한 방식으로 저장됩니다. 변경 후 현재 브라우저는 유지되고 다른 기기의 기존 로그인은 종료됩니다.</p>
        <div className="password-change-grid">
          <label>현재 비밀번호<input type="password" autoComplete="current-password" value={currentPassword} maxLength={128} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label>새 비밀번호<input type="password" autoComplete="new-password" value={newPassword} minLength={4} maxLength={128} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <label>새 비밀번호 확인<input type="password" autoComplete="new-password" value={confirmPassword} minLength={4} maxLength={128} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          <Button onClick={() => void changePassword()} disabled={busy === 'password' || !currentPassword || newPassword.length < 4 || newPassword !== confirmPassword}>{busy === 'password' ? '변경 중…' : '내 비밀번호 저장'}</Button>
        </div>
      </Card>
      {renderCredentials('USER', '개인 Gemini 연결 설정', '한 번 저장하면 내 계정에 암호화 등록되어 다시 로그인해도 자동으로 사용합니다. 무료 할당량을 모두 쓰면 새 키를 발급받아 “새 키로 교체”만 해주세요.')}
    </>}

    {section === 'ADMIN' && isAdmin && workspace && <>
      <PreviewGoogleDriveSetup onNavigate={onNavigate} />
      {renderCredentials('ORGANIZATION', '조직 공용 AI 설정', '개인 키가 없는 직원에게 적용되는 회사 공용 암호화 키입니다.')}
      <Card title="문서 제작 플랫폼 연결 상태" className="document-platform-status-card">
        <p className="document-platform-status-card__intro">보고서·제안서 작성에 실제로 연결된 기능과 회사 서버가 준비된 뒤 연결할 기능을 구분했습니다. <strong>준비 중인 기능을 작동하는 것처럼 표시하지 않습니다.</strong></p>
        <div className="document-platform-status-grid" aria-label="문서 제작 플랫폼 연결 상태">
          <article data-platform-status="active"><header><span>ACTIVE</span><strong>Tiptap 구조화 편집기</strong></header><p>제목·목록·표·링크·이미지·찾기/바꾸기·전체화면·AI 선택영역 개선</p><small>보고서와 제안서 담당자 검수 단계에서 사용</small></article>
          <article data-platform-status="active"><header><span>ACTIVE</span><strong>D1 문서 원본 저장</strong></header><p>Tiptap JSON과 Markdown을 함께 보관해 이어쓰기·버전·내보내기 근거를 유지합니다.</p><small>향후 PostgreSQL로 옮길 때 같은 JSON 계약 사용</small></article>
          <article data-platform-status="active"><header><span>ACTIVE</span><strong>HWP/HWPX · DOCX · PDF</strong></header><p>rhwp 편집과 문서 내보내기, 전체 미리보기, 프로젝트 일정표 A4 출력을 제공합니다.</p><small>최종 확정 전에는 D1 작업본만 갱신</small></article>
          <article data-platform-status="server"><header><span>SERVER BRIDGE</span><strong>Gotenberg PDF 변환</strong></header><p>고정밀 서버 PDF 렌더링은 항상 켜진 회사 서버 연결 후 활성화합니다.</p><small>현재 Worker의 결정론적 PDF/A4 출력을 유지</small></article>
          <article data-platform-status="server"><header><span>SERVER BRIDGE</span><strong>Yjs · Hocuspocus 협업</strong></header><p>실시간 공동편집과 충돌 병합은 WebSocket 서버가 준비되면 연결합니다.</p><small>현재는 D1 자동저장·낙관적 버전 충돌 방지 사용</small></article>
          <article data-platform-status="planned"><header><span>VIETNAM SERVER</span><strong>Mem0 · LangGraph Memory</strong></header><p>관리자 승인 장기기억과 작성 워크플로우는 베트남 서버 배치 단계에서 연결합니다.</p><small>현재는 Hermes/D1 승인 메모리와 같은 보안 경계 유지</small></article>
        </div>
        <p className="settings-honest-note"><strong>개발자 인수 기준</strong>Tiptap JSON을 문서 원본으로 유지하고, 출력·협업·장기기억 서버는 별도 HTTPS Bridge로 연결합니다. 연결 실패 시 편집과 D1 저장은 계속 사용할 수 있어야 합니다.</p>
      </Card>
      <Card title="제안서 1~3장 AI 작성 지침 · 템플릿별 관리자 전용" className="proposal-prompt-settings-card">
        <p className="settings-honest-note"><strong>템플릿마다 별도 관리됩니다.</strong> Gemini는 의뢰·회의록·1단계 입력을 근거로 <b>2장 쟁점 → 1장 목적 → 3장 수행업무 → 자가검증</b> 순서로 최초 초안을 한 번만 만듭니다. 이후 작성자는 담당자 검수 단계에서 전부 수정합니다. 직원 계정에는 아래 지침 원문이 노출되지 않습니다.</p>
        <label className="proposal-template-profile-picker">관리할 제안서 원본 템플릿<select value={selectedProposalPromptSourceId} onChange={(event)=>setSelectedProposalPromptSourceId(event.target.value)}>{proposalPromptProfiles.map((profile)=><option key={profile.templateSourceId} value={profile.templateSourceId}>{profile.templateSourceName} · {PROPOSAL_TEMPLATE_CATEGORY_LABELS[profile.templateCategory]} · v{profile.version}</option>)}</select></label>
        {proposalPromptProfiles.filter((profile)=>profile.templateSourceId===selectedProposalPromptSourceId).map((profile)=><div className="proposal-template-profile" key={profile.templateSourceId}>
          <section className="proposal-template-profile__common">
            <header><div><span>TEMPLATE PROFILE</span><h3>{profile.templateSourceName}</h3><p>{PROPOSAL_TEMPLATE_CATEGORY_LABELS[profile.templateCategory]} · 관리자 승인 v{profile.version}</p></div><label className="settings-check"><input type="checkbox" checked={profile.isActive} onChange={(event)=>updateSelectedProposalPromptProfile((item)=>({...item,isActive:event.target.checked}))}/>이 템플릿 AI 초안 활성</label></header>
            <label>제안서 유형<select value={profile.templateCategory} onChange={(event)=>updateSelectedProposalPromptProfile((item)=>({...item,templateCategory:event.target.value as ProposalTemplateCategory}))}>{Object.entries(PROPOSAL_TEMPLATE_CATEGORY_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            <label>템플릿 공통 시스템 지침<textarea value={profile.systemInstruction} minLength={300} maxLength={20000} onChange={(event)=>updateSelectedProposalPromptProfile((item)=>({...item,systemInstruction:event.target.value}))}/></label>
            <label>1~3장 병합 자가검증 지침<textarea value={profile.validationInstruction} minLength={200} maxLength={12000} onChange={(event)=>updateSelectedProposalPromptProfile((item)=>({...item,validationInstruction:event.target.value}))}/></label>
            <div className="action-row"><small>공통 규칙과 검수 규칙은 이 원본 템플릿에만 적용됩니다.</small><Button onClick={()=>void saveProposalPromptProfile(profile)} disabled={busy===`proposal-profile:${profile.templateSourceId}`||profile.systemInstruction.trim().length<300||profile.validationInstruction.trim().length<200}>{busy===`proposal-profile:${profile.templateSourceId}`?'저장 중…':'공통·검수 지침 저장'}</Button></div>
          </section>
          <div className="proposal-prompt-settings-list">
            {profile.chapters.slice().sort((a,b)=>a.executionOrder-b.executionOrder).map((prompt)=><article key={prompt.chapterNumber}>
              <header><span>{prompt.executionOrder}</span><div><strong>{prompt.executionOrder}차 실행 · {prompt.chapterNumber}장</strong><small>관리자 승인 v{prompt.version} · {prompt.updatedAt==='FALLBACK'?'기본 지침':new Date(prompt.updatedAt).toLocaleString('ko-KR')}</small></div></header>
              <label>챕터 제목<input value={prompt.chapterTitle} maxLength={200} onChange={(event)=>updateSelectedProposalPromptProfile((item)=>({...item,chapters:item.chapters.map((chapter)=>chapter.chapterNumber===prompt.chapterNumber?{...chapter,chapterTitle:event.target.value}:chapter)}))}/></label>
              <label>Gemini 작성 지침<textarea value={prompt.instructionText} minLength={300} maxLength={16000} onChange={(event)=>updateSelectedProposalPromptProfile((item)=>({...item,chapters:item.chapters.map((chapter)=>chapter.chapterNumber===prompt.chapterNumber?{...chapter,instructionText:event.target.value}:chapter)}))}/></label>
              <div className="action-row"><label className="settings-check"><input type="checkbox" checked={prompt.isActive} onChange={(event)=>updateSelectedProposalPromptProfile((item)=>({...item,chapters:item.chapters.map((chapter)=>chapter.chapterNumber===prompt.chapterNumber?{...chapter,isActive:event.target.checked}:chapter)}))}/>AI 최초 초안에 사용</label><Button onClick={()=>void saveProposalPrompt(profile,prompt)} disabled={busy===`proposal-chapter:${profile.templateSourceId}:${prompt.chapterNumber}`||prompt.instructionText.trim().length<300}>{busy===`proposal-chapter:${profile.templateSourceId}:${prompt.chapterNumber}`?'저장 중…':`${prompt.chapterNumber}장 지침 저장`}</Button></div>
            </article>)}
          </div>
        </div>)}
      </Card>
      {aiGovernance && <Card title="외부 AI 자료 보안·비학습 정책"><div className="workspace-policy-grid">
        <label>Gemini 서비스 등급<select value={aiGovernance.providerServiceTier} onChange={(event) => setAiGovernance({ ...aiGovernance,providerServiceTier:event.target.value as AiGovernance['providerServiceTier'],confidentialExternalAiEnabled:event.target.value==='UNVERIFIED_OR_FREE'?false:aiGovernance.confidentialExternalAiEnabled })}><option value="UNVERIFIED_OR_FREE">무료 또는 결제상태 미확인 · 내부자료 전송 차단</option><option value="PAID_NO_PRODUCT_IMPROVEMENT">Cloud Billing 활성 유료 Gemini API</option><option value="VERTEX_AI_ENTERPRISE">Vertex AI 기업계약</option></select></label>
        <label className="settings-check"><input type="checkbox" checked={aiGovernance.confidentialExternalAiEnabled} disabled={aiGovernance.providerServiceTier==='UNVERIFIED_OR_FREE'} onChange={(event) => setAiGovernance({ ...aiGovernance,confidentialExternalAiEnabled:event.target.checked })}/>내부·기밀 자료의 외부 AI 전송 허용</label>
        <label className="is-wide">관리자 확인 문구<input value={aiGovernanceAck} onChange={(event) => setAiGovernanceAck(event.target.value)} placeholder="유료 서비스의 비학습 조건과 회사 보안정책을 확인했습니다" /></label>
      </div><p className="settings-honest-note"><strong>기본값은 차단입니다.</strong> 무료 Gemini API에는 회사 내부·기밀 자료를 보내지 않습니다. 유료 서비스의 실제 Cloud Billing 상태와 회사 계약·개인정보 처리기준을 관리자가 확인한 뒤에만 허용하세요. 전송 전 주민번호·전화·이메일·키 패턴을 최소화하고, 공급자 원문 응답은 D1에 저장하지 않습니다.</p><div className="action-row"><Button onClick={() => void saveAiGovernance()} disabled={busy==='ai-governance'||aiGovernanceAck!=='유료 서비스의 비학습 조건과 회사 보안정책을 확인했습니다'}>{busy==='ai-governance'?'저장 중…':'보안정책 확인·저장'}</Button><a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Gemini 공식 이용약관 ↗</a><a href="https://ai.google.dev/gemini-api/docs/zdr" target="_blank" rel="noreferrer">Zero Data Retention 안내 ↗</a></div></Card>}
      {hermesBridge && <Card title="Hermes Agent · 회사 전용 Memory Bridge" className="hermes-bridge-settings">
        <div className="settings-runtime-status"><div><span>BRIDGE STATUS</span><strong>{hermesBridge.status}</strong></div><div><span>SECRET</span><strong>{hermesBridge.secretStored ? 'AES-256-GCM 저장' : '미설정'}</strong></div><div><span>FAILOVER</span><strong>D1 승인 메모리 유지</strong></div></div>
        <p className="settings-honest-note"><strong>중요:</strong> Hermes Agent는 Python 프로그램이라 Cloudflare Worker 웹페이지 안에 직접 심을 수 없습니다. 베트남 서버·VPS처럼 항상 켜진 서버에 Hermes를 실행하고, 이 화면에는 그 서버 앞의 HTTPS/HMAC Bridge만 연결합니다. Ollama·LM Studio는 로컬 모델을 쓸 때만 선택 사항이며, Hermes 메모리 자체를 위해 반드시 설치할 필요는 없습니다.</p>
        <div className="workspace-policy-grid">
          <label>HTTPS Bridge 주소<input value={hermesBridge.baseUrl} placeholder="https://claim-memory.company.example" onChange={(event)=>setHermesBridge({...hermesBridge,baseUrl:event.target.value})}/></label>
          <label>Key ID<input value={hermesBridge.keyId} placeholder="claim-center-prod" maxLength={80} onChange={(event)=>setHermesBridge({...hermesBridge,keyId:event.target.value})}/></label>
          <label className="is-wide">HMAC 공유키<input type="password" autoComplete="new-password" value={hermesHmacKey} placeholder={hermesBridge.secretStored?'새 공유키로 교체할 때만 입력':'32자 이상의 무작위 공유키'} maxLength={512} onChange={(event)=>setHermesHmacKey(event.target.value)}/></label>
        </div>
        <div className="action-row"><Button onClick={()=>void saveHermesBridge()} disabled={busy==='hermes-bridge'||!hermesHmacKey.trim()||!hermesBridge.baseUrl.trim()||!hermesBridge.keyId.trim()}>{busy==='hermes-bridge'?'저장 중…':'Bridge 암호화 저장'}</Button><Button variant="secondary" onClick={()=>void testHermesBridge()} disabled={busy==='hermes-test'||!hermesBridge.configured}>{busy==='hermes-test'?'확인 중…':'실제 연결 확인'}</Button><a href="https://github.com/NousResearch/hermes-agent" target="_blank" rel="noreferrer">공식 Hermes GitHub ↗</a></div>
        <details className="credential-issue-guide" open><summary>초등학생도 따라가는 설치·연결 순서</summary><ol>
          <li><b>항상 켜지는 서버를 정합니다.</b> 지금 PC에서 시험은 가능하지만 PC를 끄면 멈춥니다. 실제 운영은 베트남 서버나 회사 VPS가 맞습니다.</li>
          <li><b>Windows 시험 설치:</b> 관리자 PowerShell에서 <code>iex (irm https://hermes-agent.nousresearch.com/install.ps1)</code>을 실행합니다. Linux/WSL은 <code>curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash</code>입니다.</li>
          <li><b>모델을 고릅니다.</b> 서버에서 <code>hermes model</code>을 실행합니다. 클라우드 모델을 쓰면 Ollama가 필요 없고, 사내 로컬 모델을 쓰려면 Ollama 또는 OpenAI 호환 서버를 연결합니다.</li>
          <li><b>회사 Bridge를 띄웁니다.</b> 개발자가 <code>docs/runbooks/vietnam-hermes-private-bridge.md</code> 계약대로 <code>/v1/health</code>와 <code>/v1/memory/rank</code>를 구현하고 Cloudflare Tunnel/Access 뒤에 둡니다.</li>
          <li><b>위 3개 값을 저장하고 ‘실제 연결 확인’을 누릅니다.</b> CONNECTED가 뜰 때만 Hermes가 승인된 D1 규칙의 순서를 보조합니다. 장애 시에는 자동으로 D1 승인 규칙만 사용합니다.</li>
        </ol><div className="action-row"><a href="https://github.com/NousResearch/hermes-agent/blob/main/website/docs/getting-started/quickstart.md" target="_blank" rel="noreferrer">공식 빠른 시작 ↗</a><a href="https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md" target="_blank" rel="noreferrer">공식 Memory 설명 ↗</a><a href="https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/docker.md" target="_blank" rel="noreferrer">Docker 영속 설치 ↗</a></div></details>
      </Card>}
      <Card title="조직·로컬 AI·Hermes Memory 정책"><div className="workspace-policy-grid">
        <label>조직 표시명<input value={workspace.organizationName} maxLength={80} onChange={(event) => setWorkspace({ ...workspace, organizationName: event.target.value })} /></label>
        <label>로컬 AI 정책<select value={workspace.localAiMode} onChange={(event) => setWorkspace({ ...workspace, localAiMode: event.target.value as WorkspacePolicy['localAiMode'] })}><option value="DISABLED">비활성</option><option value="PRIVATE_SERVER_BRIDGE">회사 전용 Server Bridge 준비</option></select></label>
        <label>Memory Agent<select value={workspace.memoryProvider} onChange={(event) => setWorkspace({ ...workspace, memoryProvider: event.target.value as WorkspacePolicy['memoryProvider'], shortTermMemoryEnabled: false, longTermMemoryEnabled: false })}><option value="NONE">연결 안 함</option><option value="HERMES_AGENT">D1 Hermes 호환 메모리</option></select></label>
        <label>학습 반영 방식<select value={workspace.memoryApprovalMode} onChange={(event) => setWorkspace({ ...workspace, memoryApprovalMode: event.target.value as WorkspacePolicy['memoryApprovalMode'] })}><option value="ADMIN_REVIEW">관리자 승인 후 반영</option><option value="DISABLED">학습 비활성</option></select></label>
        <label className="settings-check"><input type="checkbox" disabled={workspace.memoryProvider !== 'HERMES_AGENT'} checked={workspace.shortTermMemoryEnabled} onChange={(event) => setWorkspace({ ...workspace, shortTermMemoryEnabled: event.target.checked })} />프로젝트 단기기억 정책</label>
        <label className="settings-check"><input type="checkbox" disabled={workspace.memoryProvider !== 'HERMES_AGENT'} checked={workspace.longTermMemoryEnabled} onChange={(event) => setWorkspace({ ...workspace, longTermMemoryEnabled: event.target.checked })} />회사 장기기억 후보 정책</label>
      </div><div className="settings-runtime-status"><div><span>LOCAL AI</span><strong>{runtime?.localAi ?? 'DISABLED'}</strong></div><div><span>MEMORY ENGINE</span><strong>{runtime?.hermes ?? 'DISABLED'}</strong></div><div><span>LEARNING LOOP</span><strong>{runtime?.memoryLearning ?? 'FOUNDATION_ONLY'}</strong></div></div><div className="local-ai-guide memory-architecture-guide"><div><span>01 · SHORT TERM</span><strong>현재 프로젝트 단기기억</strong><p>현재 사건의 선택 챕터 저장본만 다음 작성 컨텍스트에 넣습니다.</p><code>사건·사용자 격리 · 원문 전체 재사용 금지</code></div><div><span>02 · LONG TERM</span><strong>승인된 장기기억</strong><p>개인·유형·챕터·회사 범위의 규칙을 관리자가 승인한 뒤 최대 8개만 검색합니다.</p><code>범위 우선순위 · 사용 원장 · 비활성화 가능</code></div><div><span>03 · PRIVATE SERVER</span><strong>외부 Hermes 선택 연결</strong><p>향후 공유 서버에 공식 Hermes Agent를 설치하면 같은 Memory Agent 경계를 통해 교체합니다.</p><code>현재 Worker에는 Python 런타임을 포함하지 않음</code></div></div><p className="settings-honest-note"><strong>실제 학습 경계</strong>채팅 기록을 기억이라고 부르지 않습니다. AI 초안과 저장된 사람 수정본의 차이를 구조화하고, 관리자 승인된 규칙만 다음 생성에 실제 주입합니다.</p><div className="action-row"><Button onClick={() => void saveWorkspace()} disabled={busy === 'workspace'}>{busy === 'workspace' ? '저장 중…' : '관리자 정책 저장'}</Button></div></Card>
      <Card title={`AI Memory 관리 · ${memoryCandidates.filter((item) => item.status === 'PENDING').length}개 승인 대기`}><div className="memory-candidate-list">{memoryCandidates.length ? memoryCandidates.map((candidate) => <article key={candidate.id} data-memory-status={candidate.status}><header><div><span>{candidate.memoryScope} · {candidate.scopeKey}</span><strong>{candidate.caseNumber} · {candidate.chapterCode}</strong><small>{candidate.caseTitle} · {candidate.createdByName} · 신뢰도 {candidate.confidence}%</small></div><em>{candidate.status}</em></header><p><b>사용자 피드백</b> {candidate.feedbackText}</p><p><b>구조화 규칙</b> {candidate.ruleText}</p><div className="action-row">{candidate.status === 'PENDING' && <><Button onClick={() => void decideMemory(candidate, 'APPROVE')} disabled={busy === `memory:${candidate.id}`}>승인·반영</Button><Button variant="secondary" onClick={() => void decideMemory(candidate, 'REJECT')} disabled={busy === `memory:${candidate.id}`}>반려</Button></>}{candidate.status === 'ACTIVE' && <Button variant="secondary" onClick={() => void decideMemory(candidate, 'DISABLE')} disabled={busy === `memory:${candidate.id}`}>비활성화</Button>}</div></article>) : <p className="empty-box">아직 학습 후보가 없습니다.</p>}</div></Card>
      <Card title="관리자 기능"><div className="settings-admin-links"><button type="button" onClick={() => onNavigate('/ai-config')}><strong>보고서 유형·챕터 작성 지침</strong><small>유형별 공통 지침, 챕터 역할과 AI 모델을 관리합니다.</small></button><button type="button" onClick={() => onNavigate('/integrations/google')}><strong>Google Drive 상세 설정</strong><small>회사 계정 연결·계정 교체·연결 해제</small></button><button type="button" onClick={() => onNavigate('/users')}><strong>사용자·권한</strong><small>회원 계정과 역할 관리</small></button></div></Card>
    </>}

    {notice && <p className="notice-box" role="status">{notice}</p>}
    {error && <p className="error-box" role="alert">{error}</p>}
  </div>;
}
