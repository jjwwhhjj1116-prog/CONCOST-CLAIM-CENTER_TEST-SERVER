import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog } from '@claim-studio/ui';
import { apiRequest } from './api';
import { AppShell } from './layout/AppShell';
import { requestNavigation } from './navigation-guard';
import { isSafeReturnTo, RouterView, type UserRole } from './routes/Router';
import { ProjectSchedulePrint } from './workflow/ProjectSchedulePrint';
import { PublicOAuthPages } from './routes/PublicOAuthPages';

interface SessionUser {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  roles: UserRole[];
  previewMode?: boolean;
}

const isSessionUser = (value: unknown): value is SessionUser => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SessionUser>;
  return typeof candidate.id === 'string'
    && typeof candidate.email === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.organizationId === 'string'
    && Array.isArray(candidate.roles);
};


const currentBrowserLocation = () => `${window.location.pathname}${window.location.search}`;

export const App: React.FC = () => {
  const [currentLocation, setCurrentLocation] = useState(currentBrowserLocation);
  const currentLocationRef = useRef(currentLocation);
  const currentUrl = new URL(currentLocation, window.location.origin);
  const currentPath = currentUrl.pathname;
  const currentSearch = currentUrl.search;
  const [session, setSession] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [showSignup, setShowSignup] = useState(false);
  const [signupBusy, setSignupBusy] = useState(false);
  const [signupNotice, setSignupNotice] = useState('');
  const [signupError, setSignupError] = useState('');
  const [signupForm, setSignupForm] = useState({ loginId:'',displayName:'',email:'',password:'',confirmPassword:'',requestedRole:'staff',requestNote:'' });

  const navigate = useCallback((path: string, replace = false) => {
    const url = new URL(path, window.location.origin);
    const destination = `${url.pathname}${url.search}`;
    const proceed = () => {
      if (replace) window.history.replaceState(null, '', destination);
      else window.history.pushState(null, '', destination);
      currentLocationRef.current = destination;
      setCurrentLocation(destination);
    };
    if (!replace && requestNavigation(destination, proceed)) return;
    proceed();
  }, []);
  useEffect(() => {
    currentLocationRef.current = currentLocation;
  }, [currentLocation]);
  useEffect(() => {
    const restoreFromHistory = () => {
      const destination = currentBrowserLocation();
      const previous = currentLocationRef.current;
      const proceed = () => {
        window.history.replaceState(null, '', destination);
        currentLocationRef.current = destination;
        setCurrentLocation(destination);
      };
      if (destination !== previous && requestNavigation(destination, proceed)) {
        window.history.pushState(null, '', previous);
        return;
      }
      currentLocationRef.current = destination;
      setCurrentLocation(destination);
    };
    window.addEventListener('popstate', restoreFromHistory);
    return () => window.removeEventListener('popstate', restoreFromHistory);
  }, []);
  useEffect(() => {
    if (currentPath === '/' && session) navigate('/dashboard', true);
  }, [currentPath, navigate, session]);

  useEffect(() => {
    void apiRequest<SessionUser>('/auth/session')
      .then((user) => {
        const restored = isSessionUser(user) ? user : null;
        setSession(restored);
        setPreviewMode(restored?.previewMode === true);
      })
      .catch(() => setSession(null))
      .finally(() => setCheckingSession(false));
  }, []);

  const expireSession = async () => {
    try { await apiRequest('/auth/logout', { method: 'POST' }); } catch { /* Session may already be invalid. */ }
    const returnTo = isSafeReturnTo(currentPath) && currentPath !== '/login' ? currentPath : '/dashboard';
    setSession(null);
    setPreviewMode(false);
    navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  };

  const login = async (event: React.FormEvent) => {
    event.preventDefault(); setLoginError(''); setIsLoggingIn(true);
    try {
      await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ loginId, password }) });
      const user = await apiRequest<SessionUser>('/auth/session');
      if (!isSessionUser(user)) throw new Error('Invalid session response');
      setSession(user);
      setPreviewMode(user.previewMode === true);
      const requested = new URLSearchParams(window.location.search).get('returnTo') ?? '/dashboard';
      navigate(isSafeReturnTo(requested) && requested !== '/login' ? requested : '/dashboard', true);
    } catch (reason) {
      setLoginError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const submitSignup = async (event: React.FormEvent) => {
    event.preventDefault(); setSignupError(''); setSignupNotice('');
    if(signupForm.password!==signupForm.confirmPassword){setSignupError('비밀번호 확인이 일치하지 않습니다.');return;}
    setSignupBusy(true);
    try{
      await apiRequest('/auth/registration-requests',{method:'POST',body:JSON.stringify({loginId:signupForm.loginId,displayName:signupForm.displayName,email:signupForm.email,password:signupForm.password,requestedRole:signupForm.requestedRole,requestNote:signupForm.requestNote})});
      setSignupNotice('가입 신청이 접수되었습니다. 관리자 승인 후 입력한 아이디로 로그인할 수 있습니다.');
      setSignupForm({loginId:'',displayName:'',email:'',password:'',confirmPassword:'',requestedRole:'staff',requestNote:''});
    }catch(reason){setSignupError(reason instanceof Error?reason.message:String(reason));}
    finally{setSignupBusy(false);}
  };

  if (currentPath === '/about') return <PublicOAuthPages page="about" />;
  if (currentPath === '/privacy') return <PublicOAuthPages page="privacy" />;
  if (currentPath === '/terms') return <PublicOAuthPages page="terms" />;

  if (checkingSession) return <main className="login-loading"><span className="login-spinner" aria-hidden="true" /><p role="status">보안 세션을 확인하는 중입니다.</p></main>;

  if (!session || currentPath === '/login') {
    return (
      <main className="login-page" id="main-content">
        <section className="login-visual" aria-labelledby="login-visual-title">
          <div className="login-visual-brand"><span><img src="/assets/claim-center-emblem.png" alt="" /></span><strong>CONCOST · CLAIM INTELLIGENCE</strong></div>
          <div className="login-visual-copy">
            <span>CLAIM EVIDENCE · WORKFLOW · REPORT</span>
            <h1 id="login-visual-title">복잡한 클레임을<br />명확한 근거와<br />하나의 흐름으로.</h1>
            <p>프로젝트 접수부터 현장조사, 물량산출, 보고서 작성과 납품 이후 관리까지 연결하는 클레임 전문 워크스페이스입니다.</p>
            <div className="login-capabilities" aria-label="핵심 기능">
              <span>Evidence</span><span>Workflow</span><span>AI Authoring</span><span>Approval</span>
            </div>
          </div>
          <footer><span>CLAIM CENTER STUDIO</span><small>CONCOST GROUP · PROFESSIONAL WORKSPACE</small></footer>
        </section>

        <section className="login-panel" aria-labelledby="login-title">
          <div className="login-panel-inner">
            <header className="login-wordmark">
              <span className="login-wordmark-symbol" aria-hidden="true"><img src="/assets/claim-center-emblem.png" alt="" /></span>
              <div><strong>클레임센터 스튜디오</strong><small>CLAIM CENTER STUDIO</small></div>
            </header>

            <div className="login-heading">
              <span>SECURE MEMBER ACCESS</span>
              <h2 id="login-title">시스템 로그인</h2>
              <p>승인된 클레임센터 계정으로 로그인해 주세요.</p>
            </div>

            <div className="login-security-chip"><span aria-hidden="true">◇</span><strong>Organization & role protected</strong></div>

            <form className="login-form" onSubmit={(event) => void login(event)}>
              <label htmlFor="login-id">아이디</label>
              <div className="login-input-shell">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4zM4 7l8 6 8-6" /></svg>
                <input id="login-id" name="username" type="text" value={loginId} autoComplete="username" placeholder="아이디 입력" required autoFocus onChange={(event) => setLoginId(event.target.value)} />
              </div>

              <label htmlFor="login-password">비밀번호</label>
              <div className="login-input-shell">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2M5 10h14v10H5zM12 14v2" /></svg>
                <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} value={password} autoComplete="current-password" placeholder="비밀번호 입력" required onChange={(event) => setPassword(event.target.value)} />
                <button type="button" className="login-password-toggle" aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} aria-pressed={showPassword} onClick={() => setShowPassword((current) => !current)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5z" /><circle cx="12" cy="12" r="2.4" /></svg>
                </button>
              </div>

              {loginError && <p role="alert" className="login-error">로그인 정보를 확인해 주세요. <small>{loginError}</small></p>}
              <Button type="submit" disabled={isLoggingIn || !loginId.trim() || !password}>
                <span>{isLoggingIn ? '보안 세션 연결 중…' : '로그인'}</span><span aria-hidden="true">→</span>
              </Button>
            </form>

            <div className="login-help"><span>아직 계정이 없다면 가입을 신청하고 관리자 승인을 받아 주세요.</span><button type="button" onClick={()=>{setShowSignup(true);setSignupError('');setSignupNotice('');}}>회원가입 신청하기 →</button><strong>AUTHORIZED USERS ONLY</strong></div>
            <nav className="login-public-links" aria-label="서비스 및 개인정보 안내"><a href="/about">서비스 소개</a><a href="/privacy">개인정보처리방침</a><a href="/terms">서비스 약관</a></nav>
          </div>
        </section>
        <Dialog isOpen={showSignup} title="클레임센터 회원가입 신청" onClose={()=>!signupBusy&&setShowSignup(false)}>
          <form className="signup-request-form" onSubmit={(event)=>void submitSignup(event)}>
            <p>신청 후 관리자가 승인해야 로그인할 수 있습니다. 입력한 비밀번호는 즉시 PBKDF2로 보호되며 원문은 저장되지 않습니다.</p>
            <label>로그인 아이디(이메일)<input type="email" autoComplete="username" value={signupForm.loginId} onChange={(event)=>setSignupForm((current)=>({...current,loginId:event.target.value,email:current.email||event.target.value}))} required /></label>
            <label>이름<input value={signupForm.displayName} maxLength={100} onChange={(event)=>setSignupForm((current)=>({...current,displayName:event.target.value}))} required /></label>
            <label>연락 이메일<input type="email" value={signupForm.email} onChange={(event)=>setSignupForm((current)=>({...current,email:event.target.value}))} required /></label>
            <label>신청 역할<select value={signupForm.requestedRole} onChange={(event)=>setSignupForm((current)=>({...current,requestedRole:event.target.value}))}><option value="staff">일반 회원</option><option value="reviewer">담당자 검수</option><option value="pm">프로젝트 PM</option></select></label>
            <label>비밀번호<input type="password" minLength={4} maxLength={128} autoComplete="new-password" value={signupForm.password} onChange={(event)=>setSignupForm((current)=>({...current,password:event.target.value}))} required /></label>
            <label>비밀번호 확인<input type="password" minLength={4} maxLength={128} autoComplete="new-password" value={signupForm.confirmPassword} onChange={(event)=>setSignupForm((current)=>({...current,confirmPassword:event.target.value}))} required /></label>
            <label className="span-2">신청 메모<textarea value={signupForm.requestNote} maxLength={1000} placeholder="소속·담당 업무 등 관리자가 확인할 내용을 입력하세요." onChange={(event)=>setSignupForm((current)=>({...current,requestNote:event.target.value}))}/></label>
            {signupError&&<p className="login-error span-2" role="alert">{signupError}</p>}{signupNotice&&<p className="signup-notice span-2" role="status">{signupNotice}</p>}
            <div className="action-row span-2"><Button type="button" variant="secondary" onClick={()=>setShowSignup(false)} disabled={signupBusy}>닫기</Button><Button type="submit" disabled={signupBusy||signupForm.password.length<4}>{signupBusy?'신청 접수 중…':'가입 신청 접수'}</Button></div>
          </form>
        </Dialog>
      </main>
    );
  }

  (globalThis as typeof globalThis & { __CLAIM_CENTER_SESSION_USER__?: { id: string; name: string; email: string; organizationId: string; roles: UserRole[] } }).__CLAIM_CENTER_SESSION_USER__ = {
    id: session.id,
    name: session.name,
    email: session.email,
    organizationId: session.organizationId,
    roles: session.roles
  };

  if (currentPath === '/print/projects/month-a4') {
    return <ProjectSchedulePrint
      currentSearch={currentSearch}
      userName={session.name}
      onClose={() => {
        window.close();
        window.setTimeout(() => {
          if (!window.closed) navigate('/projects/schedule');
        }, 80);
      }}
    />;
  }

  const workspacePath = currentPath === '/' ? '/dashboard' : currentPath;
  return (
    <AppShell key={session.id} userId={session.id} currentPath={workspacePath} currentSearch={currentSearch} roles={session.roles} userName={session.name} previewMode={previewMode} onNavigate={navigate} onExpireSession={() => void expireSession()}>
      <RouterView currentPath={workspacePath} currentSearch={currentSearch} roles={session.roles} userName={session.name} userEmail={session.email} previewMode={previewMode} onNavigate={navigate} />
    </AppShell>
  );
};

export default App;
