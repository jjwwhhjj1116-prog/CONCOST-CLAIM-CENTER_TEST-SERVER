import { Button, Card, Select } from '@claim-studio/ui';
import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../api';
import { CaseEvidencePanel } from '../evidence/CaseEvidencePanel';

interface CaseSummary { id: string; caseNumber: string; title: string; claimType: string; status: string }

export function PreviewEvidenceHub({ roles, onNavigate }: { userName: string; roles: string[]; onNavigate: (path: string) => void }): React.ReactElement {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState(new URLSearchParams(window.location.search).get('caseId') ?? '');
  const [error, setError] = useState('');

  useEffect(() => {
    void apiRequest<{ cases: CaseSummary[] }>('/api/cases?limit=100&q=&scope=project-work').then((result) => {
      setCases(result.cases);
      setSelectedCaseId((current) => result.cases.some((entry) => entry.id === current) ? current : result.cases[0]?.id ?? '');
    }).catch((reason) => setError(reason instanceof Error ? reason.message : '프로젝트를 불러오지 못했습니다.'));
  }, []);

  const selected = cases.find((entry) => entry.id === selectedCaseId) ?? null;
  return <section className="route-view preview-evidence-hub" aria-labelledby="preview-evidence-title">
    <div className="workspace-hero preview-evidence-hero">
      <div><span className="workspace-eyebrow">PROJECT EVIDENCE LIBRARY · GOOGLE DRIVE</span><h2 id="preview-evidence-title">의뢰부터 최종 납품까지<br />모든 자료를 한곳에 모읍니다.</h2><p>발주처 제공자료, 회의록·녹음, 현장사진, 산출·내역, 법원자료와 최종 납품본을 프로젝트별로 분류합니다. 파일명·업로드 시간·사용자·무결성 확인 이력을 기록합니다.</p></div>
      <div className="preview-drive-card"><span>COMPANY STORAGE · CLAIM CENTER ONLY</span><strong>클레임센터 전용 Google Drive</strong><small>CONCOST ERP 그룹웨어 / 02_클레임센터 / 프로젝트 / 업무단계별 자료 · 파일당 최대 10MB</small>{roles.includes('admin') && <button type="button" onClick={() => onNavigate('/settings?section=admin')}>회사 Drive 연결·계정 변경</button>}</div>
    </div>
    <Card title="프로젝트 자료실 선택">
      <div className="inline-form"><Select searchable searchPlaceholder="프로젝트 번호·이름 검색" label="프로젝트" value={selectedCaseId} onChange={(event) => setSelectedCaseId(event.target.value)} options={cases.map((entry) => ({ value: entry.id, label: `${entry.caseNumber} · ${entry.title}` }))} />{selected && <span className="preview-pill">{selected.claimType} · {selected.status}</span>}</div>
      {error && <p className="error-box" role="alert">{error}</p>}
    </Card>
    {selectedCaseId ? <CaseEvidencePanel caseId={selectedCaseId} onNavigate={onNavigate} /> : <p className="empty-box">자료를 연결할 수행 프로젝트가 없습니다. 프로젝트 접수에서 수주 확정하여 프로젝트 워크로 전환해 주세요.</p>}
  </section>;
}

interface GoogleDriveStatus {
  connected: boolean;
  configured: boolean;
  status: 'CONNECTED' | 'DISCONNECTED';
  accountEmail: string | null;
  allowedDomain: string | null;
}

interface GoogleOAuthAppState {
  configured: boolean;
  source: 'CLOUDFLARE_SECRET' | 'ENCRYPTED_D1' | 'NONE';
  clientIdHint: string | null;
  redirectUri: string;
  allowedDomain: string;
  version: number;
  updatedAt: string | null;
}

const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GOOGLE_CONSOLE_LINKS = {
  projects: 'https://console.cloud.google.com/projectselector2/home/dashboard',
  driveApi: 'https://console.cloud.google.com/apis/library/drive.googleapis.com',
  branding: 'https://console.cloud.google.com/auth/branding',
  audience: 'https://console.cloud.google.com/auth/audience',
  dataAccess: 'https://console.cloud.google.com/auth/scopes',
  clients: 'https://console.cloud.google.com/auth/clients'
} as const;

export function PreviewGoogleDriveSetup({ onNavigate }: { onNavigate: (path: string) => void }): React.ReactElement {
  const [status, setStatus] = useState<GoogleDriveStatus | null>(null);
  const [oauthApp, setOauthApp] = useState<GoogleOAuthAppState | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showOAuthEditor, setShowOAuthEditor] = useState(false);
  const [copiedValue, setCopiedValue] = useState<'redirect' | 'scope' | null>(null);
  const load = useCallback(async () => {
    try {
      const [drive, app] = await Promise.all([
        apiRequest<GoogleDriveStatus>('/api/google/status'),
        apiRequest<GoogleOAuthAppState>('/api/google/oauth-app')
      ]);
      setStatus(drive); setOauthApp(app); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Google Drive 상태를 확인하지 못했습니다.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const saveOAuthApp = async () => {
    if (!oauthApp || !clientId.trim() || !clientSecret.trim()) return;
    setBusy(true); setError('');
    try {
      const saved = await apiRequest<GoogleOAuthAppState>('/api/google/oauth-app', {
        method: 'PUT',
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), expectedVersion: oauthApp.version })
      });
      setOauthApp(saved); setClientId(''); setClientSecret('');
      setShowOAuthEditor(false);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Google OAuth 앱 설정을 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  };

  const copySetupValue = async (kind: 'redirect' | 'scope', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(kind);
      window.setTimeout(() => setCopiedValue((current) => current === kind ? null : current), 1800);
    } catch {
      setError('자동 복사가 차단되었습니다. 파란색 값 상자를 선택해서 직접 복사해 주세요.');
    }
  };

  const connect = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/google/oauth/start', { method: 'POST', headers: { Accept: 'application/json' } });
      const payload = await response.json() as { authorizationUrl?: string; error?: string };
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.error ?? 'Google OAuth를 시작하지 못했습니다.');
      const target = new URL(payload.authorizationUrl);
      if (target.origin !== 'https://accounts.google.com') throw new Error('허용되지 않은 Google 승인 주소입니다.');
      window.location.assign(target.toString());
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Google OAuth를 시작하지 못했습니다.'); setBusy(false); }
  };

  const disconnect = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/google/oauth/disconnect', { method: 'POST', headers: { Accept: 'application/json' } });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Google Drive 연결을 해제하지 못했습니다.');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Google Drive 연결을 해제하지 못했습니다.'); }
    finally { setBusy(false); }
  };

  return <section className="route-view preview-drive-setup" aria-labelledby="preview-drive-title">
    <div><span className="workspace-eyebrow">COMPANY GOOGLE DRIVE ACCOUNT</span><h2 id="preview-drive-title">회사 Google Drive 연결·계정 교체</h2><p>Admin이 클레임 전용 회사 계정을 연결합니다. 연결된 계정은 아래에서 확인하고 언제든 다른 회사 계정으로 교체하거나 연결을 해제할 수 있습니다.</p></div>
    <div className="preview-drive-status" role="status"><span className={status?.connected ? 'is-connected' : ''}>{status?.connected ? 'CONNECTED' : 'DISCONNECTED'}</span><strong>{status?.connected ? `현재 회사 Drive 계정 · ${status.accountEmail ?? '계정 확인 필요'}` : status?.configured ? '준비 완료 · 아래 회사 Google 계정 연결 버튼을 누르세요' : 'Google OAuth 앱 최초 등록이 필요합니다'}</strong></div>
    {oauthApp && (!oauthApp.configured || showOAuthEditor) && <section className="preview-drive-config-card" aria-labelledby="google-oauth-app-title">
      <header><div><span>{oauthApp.configured ? 'CHANGE OAUTH CLIENT' : 'ONE-TIME SETUP'}</span><h3 id="google-oauth-app-title">{oauthApp.configured ? 'Google OAuth 앱 자체를 교체합니다' : 'Google OAuth 앱을 한 번만 등록하세요'}</h3><p>이 값은 Google Drive 저장 계정이 아니라 연결 버튼을 작동시키는 회사 OAuth 앱 정보입니다. 저장 계정만 바꿀 때는 이 값을 수정하지 마세요. Client Secret은 브라우저에 다시 표시하지 않고 AES-256-GCM으로 암호화해 D1에 저장합니다.</p></div><a href={GOOGLE_CONSOLE_LINKS.clients} target="_blank" rel="noreferrer">Google 인증 플랫폼 · 클라이언트 열기 ↗</a></header>
      <ol><li>Google Cloud에서 <b>Google Drive API</b>를 사용 설정합니다.</li><li><b>OAuth 클라이언트 ID · 웹 애플리케이션</b>을 만듭니다.</li><li>아래 주소를 <b>승인된 리디렉션 URI</b>에 정확히 등록합니다.</li><li>발급된 Client ID와 Client Secret을 아래에 저장합니다.</li></ol>
      <div className="preview-drive-redirect"><span>승인된 리디렉션 URI</span><code>{oauthApp.redirectUri}</code></div>
      <div className="preview-drive-config-fields"><label>Google OAuth Client ID<input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="000000000000-….apps.googleusercontent.com" autoComplete="off" /></label><label>Google OAuth Client Secret<input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="Google OAuth Client Secret" autoComplete="new-password" /></label></div>
      <div className="preview-drive-config-actions"><button type="button" onClick={() => void saveOAuthApp()} disabled={busy || !clientId.trim() || !clientSecret.trim()}>{busy ? '암호화 저장 중…' : 'OAuth 앱 설정 암호화 저장'}</button>{oauthApp.configured && <button type="button" className="is-secondary" onClick={() => setShowOAuthEditor(false)}>교체 취소</button>}<a href={GOOGLE_CONSOLE_LINKS.driveApi} target="_blank" rel="noreferrer">Google Drive API 사용 설정 ↗</a></div>
    </section>}
    {oauthApp?.configured && <details className="preview-drive-app-summary"><summary>OAuth 앱 설정 · {oauthApp.source === 'ENCRYPTED_D1' ? '관리자 암호화 저장' : 'Cloudflare Secret'} · {oauthApp.clientIdHint}</summary><p>허용 회사 도메인 <strong>{oauthApp.allowedDomain}</strong> · Redirect <code>{oauthApp.redirectUri}</code></p>{oauthApp.source === 'ENCRYPTED_D1' ? <button type="button" onClick={() => setShowOAuthEditor(true)}>OAuth 클라이언트 ID·Secret 교체</button> : <small>이 OAuth 앱은 Cloudflare Secret으로 관리되어 화면에서 덮어쓸 수 없습니다.</small>}</details>}
    {oauthApp && <section className="preview-drive-guide" aria-labelledby="google-drive-guide-title">
      <header><div><span>BEGINNER GUIDE · 10분 설정</span><h3 id="google-drive-guide-title">Google Drive 연결·계정 교체 따라하기</h3><p>아래 순서대로 위에서 아래로 진행하세요. <b>Drive 연결에는 일반 API Key가 아니라 OAuth Client ID와 Client Secret이 필요합니다.</b></p></div><span className="preview-drive-guide-badge">관리자 전용</span></header>
      <div className="preview-drive-guide-choice"><strong>먼저 어떤 작업인지 고르세요</strong><div><p><b>A. 저장할 Google 계정만 변경</b><br/>기존 OAuth 앱은 그대로 두고 3번 ‘대상’에서 새 계정을 허용한 다음, 맨 아래 <b>연결 계정 변경</b>을 누릅니다.</p><p><b>B. Google Cloud 프로젝트·OAuth 앱도 새로 변경</b><br/>1번부터 7번까지 모두 진행하고 새 Client ID·Secret을 위 입력란에 암호화 저장합니다.</p></div></div>
      <div className="preview-drive-guide-grid">
        <article><span>01</span><h4>클레임 전용 프로젝트 선택</h4><p>Google Cloud를 열고 상단 프로젝트 이름을 누릅니다. 기존 <b>CONCOST Claim Center</b>를 선택하거나 클레임 전용 새 프로젝트를 만드세요.</p><a href={GOOGLE_CONSOLE_LINKS.projects} target="_blank" rel="noreferrer">Google Cloud 프로젝트 선택 ↗</a></article>
        <article><span>02</span><h4>Google Drive API 켜기</h4><p>선택한 프로젝트가 맞는지 상단에서 다시 확인하고 <b>사용</b> 버튼을 누릅니다. 이미 ‘관리’로 보이면 켜진 상태입니다.</p><a href={GOOGLE_CONSOLE_LINKS.driveApi} target="_blank" rel="noreferrer">Drive API 사용 설정 ↗</a></article>
        <article><span>03</span><h4>Google 인증 플랫폼 · 브랜딩</h4><p>앱 이름은 <b>클레임센터 스튜디오</b>, 지원 이메일은 회사 이메일로 저장하세요. 운영 게시 전 앱 홈페이지 <code>/about</code>, 개인정보처리방침 <code>/privacy</code>, 서비스 약관 <code>/terms</code>의 공개 URL을 모두 등록해야 합니다.</p><a href={GOOGLE_CONSOLE_LINKS.branding} target="_blank" rel="noreferrer">브랜딩 열기 ↗</a></article>
        <article><span>04</span><h4>대상 · 연결 계정 허용</h4><p>일반 Gmail 계정이면 <b>외부 → 테스트</b>를 선택하고 ‘테스트 사용자’에 연결할 회사 계정을 추가합니다. Google Workspace 조직 계정만 쓸 때 조직이 표시되면 <b>내부</b>를 선택할 수 있습니다.</p><a href={GOOGLE_CONSOLE_LINKS.audience} target="_blank" rel="noreferrer">대상·테스트 사용자 열기 ↗</a></article>
        <article><span>05</span><h4>데이터 액세스 · 최소 권한</h4><p>범위 추가에서 아래 <b>drive.file</b> 하나만 선택하세요. 전체 Drive 권한인 <code>.../auth/drive</code>는 선택하지 않습니다.</p><a href={GOOGLE_CONSOLE_LINKS.dataAccess} target="_blank" rel="noreferrer">데이터 액세스 열기 ↗</a></article>
        <article><span>06</span><h4>웹 OAuth 클라이언트 만들기</h4><p>클라이언트 만들기 → <b>웹 애플리케이션</b>을 선택합니다. 승인된 JavaScript 원본은 비워 두고, 승인된 리디렉션 URI에 아래 주소를 한 글자도 바꾸지 말고 넣으세요.</p><a href={GOOGLE_CONSOLE_LINKS.clients} target="_blank" rel="noreferrer">OAuth 클라이언트 만들기 ↗</a></article>
        <article><span>07</span><h4>ID·Secret 저장 후 연결</h4><p>새 OAuth 앱을 만든 경우 Client ID와 처음 한 번 표시되는 Client Secret을 위 입력란에 저장합니다. 그 다음 아래 <b>{status?.connected ? '연결 계정 변경' : '회사 Google 계정 연결'}</b>을 누르고 계정 선택 화면에서 회사 계정을 고르세요.</p></article>
        <article><span>08</span><h4>CONNECTED 이메일 확인</h4><p>다시 이 화면으로 돌아오면 초록색 CONNECTED와 연결 이메일을 확인합니다. 계정 교체 시 새 업로드는 새 Drive로 가며, 기존 Drive 파일은 자동 이동되지 않으므로 이전 계정을 바로 삭제하지 마세요.</p></article>
      </div>
      <div className="preview-drive-guide-values">
        <div><span>승인된 리디렉션 URI</span><code>{oauthApp.redirectUri}</code><button type="button" onClick={() => void copySetupValue('redirect', oauthApp.redirectUri)}>{copiedValue === 'redirect' ? '복사됨 ✓' : '주소 복사'}</button></div>
        <div><span>허용할 최소 범위</span><code>{GOOGLE_DRIVE_SCOPE}</code><button type="button" onClick={() => void copySetupValue('scope', GOOGLE_DRIVE_SCOPE)}>{copiedValue === 'scope' ? '복사됨 ✓' : '범위 복사'}</button></div>
      </div>
      <aside className="preview-drive-guide-warning"><strong>계정 교체 전에 꼭 확인</strong><ul><li>새 계정이 테스트 앱 사용자라면 ‘대상 → 테스트 사용자’에 먼저 추가합니다. 테스트 모드의 Drive 권한은 보통 7일 뒤 만료되므로 미리보기 검증용으로만 사용하세요.</li><li>새 계정이 <b>@{oauthApp.allowedDomain}</b>가 아닌 일반 Gmail이면 클레임센터 배포 정책의 승인 계정도 함께 변경해야 합니다.</li><li>Google 화면의 ‘확인되지 않은 앱’은 테스트 상태 안내입니다. 등록한 테스트 계정이 맞을 때만 ‘계속’을 누르세요.</li></ul></aside>
      <details className="preview-drive-guide-errors"><summary>오류가 나올 때 바로 확인하기</summary><dl><div><dt>403 access_denied</dt><dd>‘대상’의 테스트 사용자에 지금 선택한 Google 계정이 없습니다.</dd></div><div><dt>redirect_uri_mismatch</dt><dd>OAuth 클라이언트의 승인된 리디렉션 URI가 위 파란색 주소와 한 글자라도 다릅니다.</dd></div><div><dt>GOOGLE_COMPANY_ACCOUNT_REQUIRED</dt><dd>선택한 계정이 허용 회사 도메인 또는 별도 승인 계정이 아닙니다.</dd></div><div><dt>invalid_client</dt><dd>Client ID와 Client Secret이 서로 다른 OAuth 클라이언트에서 발급됐거나 Secret을 잘못 입력했습니다.</dd></div></dl></details>
    </section>}
    <div className="preview-drive-steps"><article><span>01</span><strong>회사 계정 연결</strong><p>관리자가 클레임 전용 회사 Google 계정을 연결합니다.</p></article><article><span>02</span><strong>프로젝트 폴더 자동 생성</strong><p>업로드 시 프로젝트/산출·내역/YYYY-MM 폴더를 자동 생성합니다.</p></article><article><span>03</span><strong>업로더·시간·무결성 기록</strong><p>D1에는 파일 ID, 사용자, 업로드 시각과 SHA-256 메타데이터만 기록합니다.</p></article></div>
    {error && <p className="error-box" role="alert">{error}</p>}
    <div className="preview-drive-actions"><div><button type="button" disabled={busy || !status?.configured} onClick={() => void connect()}>{busy ? '처리 중…' : status?.connected ? '연결 계정 변경' : '회사 Google 계정 연결'}</button>{status?.connected && <button type="button" disabled={busy} onClick={() => void disconnect()}>연결 해제</button>}<Button variant="secondary" onClick={() => onNavigate('/cases/files')}>현재 자료실 보기</Button></div><span>원본 저장소 · 회사 Google Drive · R2 미사용</span></div>
  </section>;
}
