import { Button, Card, Dialog } from '@claim-studio/ui';
import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../api';
import { StatusFeedbackState } from '../layout/StatusFeedbackState';

interface WorkspaceUser {
  id: string;
  loginId: string;
  displayName: string;
  email: string;
  roles: string[];
  departmentCode: string;
  active: boolean;
  version: number;
  assignedCaseCount: number;
}

interface RegistrationRequest {
  id:string; loginId:string; displayName:string; email:string; requestedRole:string; requestNote:string|null;
  status:'PENDING'|'APPROVED'|'REJECTED'; reviewNote:string|null; reviewedAt:string|null; reviewedByName:string|null; version:number; createdAt:string;
}

const ACCOUNT_ROLES = ['admin', 'ceo', 'director', 'pm', 'staff', 'reviewer'] as const;
const DEPARTMENTS = [
  ['CLAIM_CENTER', '클레임센터'],
  ['MANAGEMENT_SUPPORT', '경영지원본부'],
  ['TECHNICAL_HQ', '기술본부'],
  ['DEVELOPMENT', '개발팀'],
  ['UNASSIGNED', '미지정']
] as const;
const departmentLabel = (code: string): string => DEPARTMENTS.find(([value]) => value === code)?.[1] ?? '미지정';

export function PreviewAdminUsers(): React.ReactElement {
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<WorkspaceUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [form, setForm] = useState({ loginId: '', displayName: '', email: '', password: '', roles: ['staff'] as string[], departmentCode: 'CLAIM_CENTER' });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [result,requestResult] = await Promise.all([
        apiRequest<{ users: WorkspaceUser[] }>('/api/admin/users'),
        apiRequest<{ requests: RegistrationRequest[] }>('/api/admin/registration-requests')
      ]);
      setUsers(result.users);setRequests(requestResult.requests);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleRole = (role: string) => setForm((current) => ({
    ...current,
    roles: current.roles.includes(role) ? current.roles.filter((entry) => entry !== role) : [...current.roles, role]
  }));

  const createAccount = async () => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest('/api/admin/users', { method: 'POST', body: JSON.stringify(form) });
      setNotice(`${form.displayName} 계정을 승인·등록했습니다. 이제 다른 PC에서도 같은 아이디와 비밀번호로 로그인할 수 있습니다.`);
      setShowCreate(false);
      setForm({ loginId: '', displayName: '', email: '', password: '', roles: ['staff'], departmentCode: 'CLAIM_CENTER' });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const changeAccount = async (target: WorkspaceUser, action: 'ACTIVATE' | 'DEACTIVATE' | 'RESET_PASSWORD' | 'SET_DEPARTMENT', password?: string, departmentCode?: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/api/admin/users/${encodeURIComponent(target.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ action, expectedVersion: target.version, ...(password === undefined ? {} : { password }), ...(departmentCode === undefined ? {} : { departmentCode }) })
      });
      setNotice(action === 'ACTIVATE' ? `${target.displayName} 계정의 로그인을 다시 승인했습니다.` : action === 'DEACTIVATE' ? `${target.displayName} 계정의 접속을 차단했습니다. 기존 로그인 세션도 종료됩니다.` : action === 'SET_DEPARTMENT' ? `${target.displayName} 계정의 부서를 ${departmentLabel(departmentCode ?? '')}(으)로 변경했습니다.` : `${target.displayName} 계정의 비밀번호를 변경했습니다. 기존 로그인 세션은 종료됩니다.`);
      setPasswordTarget(null); setNewPassword('');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const decideRegistration = async (target:RegistrationRequest,action:'APPROVE'|'REJECT') => {
    if(busy)return;const reviewNote=window.prompt(action==='APPROVE'?'승인 메모(선택)':'거절 사유를 입력하세요.')??(action==='APPROVE'?'':null);if(reviewNote===null)return;
    setBusy(true);setError('');setNotice('');
    try{await apiRequest(`/api/admin/registration-requests/${encodeURIComponent(target.id)}`,{method:'PUT',body:JSON.stringify({action,expectedVersion:target.version,reviewNote})});setNotice(action==='APPROVE'?`${target.displayName} 회원가입을 승인했습니다. 이제 로그인할 수 있습니다.`:`${target.displayName} 회원가입 신청을 거절했습니다.`);await load();}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}
  };

  if (loading && users.length === 0) return <StatusFeedbackState type="loading" message="사용자와 사건 배정 현황을 불러오고 있습니다." />;

  return (
    <section className="route-view admin-users" aria-labelledby="admin-users-title">
      <div className="workspace-hero">
        <div><span className="workspace-eyebrow">ADMIN WORKSPACE</span><h2 id="admin-users-title">로그인 계정·권한 관리</h2><p>관리자가 승인한 활성 계정만 어느 PC에서든 로그인할 수 있습니다. 비밀번호는 PBKDF2로 보호되며 화면과 API에 다시 표시되지 않습니다.</p></div>
        <div className="admin-user-total"><strong>{users.filter((user) => user.active).length}</strong><span>ACTIVE USERS</span></div>
      </div>

      {error && <p className="error-box" role="alert">{error}</p>}
      {notice && <p className="notice-box" role="status">{notice}</p>}

      <Card title={`회원가입 승인 대기 ${requests.filter((request)=>request.status==='PENDING').length}명`}>
        <div className="admin-registration-list">
          {requests.filter((request)=>request.status==='PENDING').length===0?<p className="empty-box">승인 대기 중인 회원가입 신청이 없습니다.</p>:requests.filter((request)=>request.status==='PENDING').map((request)=><article key={request.id}><div><strong>{request.displayName}</strong><small>{request.loginId} · {request.email}</small><p>{request.requestNote||'신청 메모 없음'}</p></div><span>{request.requestedRole.toUpperCase()}</span><small>{new Date(request.createdAt).toLocaleString('ko-KR')}</small><div><Button variant="secondary" onClick={()=>void decideRegistration(request,'REJECT')} disabled={busy}>거절</Button><Button onClick={()=>void decideRegistration(request,'APPROVE')} disabled={busy}>승인·계정 생성</Button></div></article>)}
        </div>
      </Card>

      <Card title={`승인 계정 ${users.length}명`}>
        <div className="admin-user-toolbar"><p>계정 삭제는 감사 이력을 보존하기 위해 영구 삭제 대신 <strong>접속 차단</strong>으로 처리합니다.</p><Button onClick={() => setShowCreate(true)}>+ 로그인 계정 추가</Button></div>
        <div className="admin-user-list">
          {users.map((user) => (
            <article key={user.id}>
              <span className="admin-user-avatar" aria-hidden="true">{user.displayName.slice(0, 1)}</span>
              <div><strong>{user.displayName}</strong><small>{user.loginId} · {user.email}</small></div>
              <div className="admin-role-list">{user.roles.map((role) => <span key={role}>{role.toUpperCase()}</span>)}</div>
              <label className="admin-user-department"><span>Drive 부서 권한</span><select value={user.departmentCode} disabled={busy} onChange={(event) => void changeAccount(user, 'SET_DEPARTMENT', undefined, event.target.value)}>{DEPARTMENTS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <div className="admin-user-cases"><strong>{user.assignedCaseCount}</strong><small>배정 사건</small></div>
              <span className={user.active ? 'admin-user-status is-active' : 'admin-user-status'}>{user.active ? '로그인 승인' : '접속 차단'}</span>
              <div className="admin-user-actions"><Button variant="secondary" onClick={() => { setPasswordTarget(user); setNewPassword(''); }}>비밀번호 변경</Button><Button variant={user.active ? 'danger' : 'secondary'} onClick={() => void changeAccount(user, user.active ? 'DEACTIVATE' : 'ACTIVATE')} disabled={busy}>{user.active ? '계정 삭제·차단' : '다시 승인'}</Button></div>
            </article>
          ))}
        </div>
        <div className="admin-user-footer"><span>계정 추가·차단·비밀번호 변경은 관리자 감사 이력에 남습니다.</span><Button variant="secondary" onClick={() => void load()} disabled={loading}>새로고침</Button></div>
      </Card>

      <Dialog isOpen={showCreate} title="새 로그인 계정 승인·등록" onClose={() => !busy && setShowCreate(false)}>
        <div className="admin-account-form">
          <label>로그인 아이디(이메일)<input type="email" autoComplete="off" value={form.loginId} onChange={(event) => setForm((current) => ({ ...current, loginId: event.target.value, email: current.email || event.target.value }))} placeholder="name@con-cost.com" /></label>
          <label>이름<input value={form.displayName} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="사용자 이름" /></label>
          <label>연락 이메일<input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="name@con-cost.com" /></label>
          <label>초기 비밀번호<input type="password" autoComplete="new-password" value={form.password} minLength={4} maxLength={128} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="4자 이상" /></label>
          <label>소속 부서<select value={form.departmentCode} onChange={(event) => setForm((current) => ({ ...current, departmentCode: event.target.value }))}>{DEPARTMENTS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <fieldset><legend>허용 역할</legend><div>{ACCOUNT_ROLES.map((role) => <label key={role}><input type="checkbox" checked={form.roles.includes(role)} onChange={() => toggleRole(role)} />{role.toUpperCase()}</label>)}</div></fieldset>
          <p>클레임센터 Drive는 클레임센터·경영지원본부와 관리자만 이용할 수 있습니다. 비밀번호 원문은 저장되지 않습니다.</p>
          <div className="action-row"><Button variant="secondary" onClick={() => setShowCreate(false)} disabled={busy}>취소</Button><Button onClick={() => void createAccount()} disabled={busy || !form.loginId || !form.displayName || !form.email || form.password.length < 4 || form.roles.length === 0}>{busy ? '등록 중…' : '계정 승인·등록'}</Button></div>
        </div>
      </Dialog>

      <Dialog isOpen={Boolean(passwordTarget)} title="계정 비밀번호 변경" onClose={() => !busy && setPasswordTarget(null)}>
        <div className="admin-account-form">
          <p><strong>{passwordTarget?.displayName}</strong> · {passwordTarget?.loginId}<br />변경하면 해당 계정의 기존 로그인 세션이 모두 종료됩니다.</p>
          <label>새 비밀번호<input type="password" autoComplete="new-password" value={newPassword} minLength={4} maxLength={128} onChange={(event) => setNewPassword(event.target.value)} placeholder="4자 이상" /></label>
          <div className="action-row"><Button variant="secondary" onClick={() => setPasswordTarget(null)} disabled={busy}>취소</Button><Button onClick={() => passwordTarget && void changeAccount(passwordTarget, 'RESET_PASSWORD', newPassword)} disabled={busy || newPassword.length < 4}>{busy ? '변경 중…' : '비밀번호 저장'}</Button></div>
        </div>
      </Dialog>
    </section>
  );
}
