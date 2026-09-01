import React, { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, Drawer, SkipLink } from '@claim-studio/ui';
import { apiRequest } from '../api';
import { ROUTES, canAccessRoute, type UserRole } from '../routes/Router';
import { WORKFLOW_PROJECTS, WORKFLOW_STAGES } from '../workflow/workflow-model';
import { WorkspaceHelpCenter } from './WorkspaceHelpCenter';
import { SoftLaunchNotice } from './SoftLaunchNotice';

const NAVIGATION_GROUPS: readonly {
  label: string;
  eyebrow: string;
  icon: 'home' | 'proposal' | 'work' | 'library' | 'court' | 'quality' | 'settings' | 'admin';
  routeIds: readonly string[];
  nestedGroups?: readonly { label: string; eyebrow: string; routeIds: readonly string[] }[];
  allowedRoles?: readonly UserRole[];
}[] = [
  { label: 'HOME', eyebrow: '클레임센터 홈', icon: 'home', routeIds: ['DASH-01'] },
  {
    label: '프로젝트 접수', eyebrow: '의뢰·제안·수주', icon: 'proposal',
    routeIds: ['CASE-02', 'CASE-07', 'CASE-08', 'PROP-02', 'PROP-03', 'PROP-04', 'WF-02'],
    nestedGroups: [
      { label: '프로젝트 의뢰', eyebrow: '의뢰 관리', routeIds: ['CASE-02', 'CASE-07', 'CASE-08'] },
      { label: '프로젝트 제안서', eyebrow: '제안서 관리', routeIds: ['PROP-02', 'PROP-03', 'PROP-04'] },
      { label: '프로젝트 접수', eyebrow: '접수 관리', routeIds: ['WF-02', 'WF-07'] }
    ]
  },
  {
    label: '프로젝트 워크', eyebrow: '프로젝트 실행', icon: 'work',
    routeIds: ['PROJ-01', 'WF-03', 'WF-04', 'WF-05', 'REPO-02', 'REPO-03', 'REPO-04'],
    nestedGroups: [{ label: '프로젝트 보고서', eyebrow: '보고서 관리', routeIds: ['REPO-02', 'REPO-03', 'REPO-04'] }]
  },
  { label: '드라이브', eyebrow: '자료 관리', icon: 'library', routeIds: ['CASE-06', 'CASE-09', 'CONTACT-01', 'CONTACT-02', 'CONTACT-03'], nestedGroups: [{ label: '자료실 이용', eyebrow: '자료·양식', routeIds: ['CASE-06', 'CASE-09'] }, { label: '인맥관리', eyebrow: '명함·연락처', routeIds: ['CONTACT-01', 'CONTACT-02', 'CONTACT-03'] }] },
  { label: '법원 자료', eyebrow: '법원·소송', icon: 'court', routeIds: ['POST-01'] },
  { label: '검토·납품 관리', eyebrow: '검토·납품 관리', icon: 'quality', routeIds: ['APPR-01', 'REPO-01', 'OUTCOME-01'] },
  { label: '설정', eyebrow: '환경 설정', icon: 'settings', routeIds: ['MY-01'] }
];

const navigationGroupRouteIds = (group: (typeof NAVIGATION_GROUPS)[number]): readonly string[] => [
  ...new Set([...group.routeIds, ...(group.nestedGroups?.flatMap((nested) => nested.routeIds) ?? [])])
];

const NavigationGroupIcon: React.FC<{ name: (typeof NAVIGATION_GROUPS)[number]['icon'] }> = ({ name }) => {
  const paths: Record<typeof name, React.ReactNode> = {
    home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v10h13V10M9 20v-6h6v6" /></>,
    proposal: <><path d="M5 3h10l4 4v14H5z" /><path d="M15 3v5h4M8 12h8M8 16h5" /><path d="m7 7 1 1 2-2" /></>,
    work: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M8 5V3h8v2M3 11h18M9 11v2h6v-2" /></>,
    library: <><path d="M4 5.5 12 3l8 2.5V19l-8 2-8-2z" /><path d="M12 3v18M4 9l8 2 8-2M4 14l8 2 8-2" /></>,
    court: <><path d="M3 9h18M5 9v9m4-9v9m6-9v9m4-9v9M2 21h20M12 3l9 4H3z" /></>,
    quality: <><path d="M12 3 5 6v5c0 4.7 2.8 8.2 7 10 4.2-1.8 7-5.3 7-10V6z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z" /></>,
    admin: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0M18 4l1-1m-1 9 1 1M6 4 5 3M6 12l-1 1" /></>
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
};

export interface AppShellProps {
  currentPath: string;
  currentSearch: string;
  roles: UserRole[];
  userName: string;
  onNavigate: (path: string) => void;
  previewMode?: boolean;
  onExpireSession: () => void;
  children: React.ReactNode;
}

type ThemeMode = 'light' | 'dark';
interface MemberAwardAlert { eventKey:string;caseId:string;caseNumber:string;projectTitle:string;message:string;awardedAt:string;projectStartOn:string|null;projectEndOn:string|null }
interface MemberTodoAlert { eventKey:string;caseId:string;caseNumber:string;title:string;stageCode:string;stageLabel:string;startDate:string;endDate:string;status:string;noteText:string;message:string }
interface MemberAlertsPayload { awards:MemberAwardAlert[];todos:MemberTodoAlert[];today:string;available:boolean }

const SIDEBAR_MIN_WIDTH = 300;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 352;
const SIDEBAR_STORAGE_KEY = 'claim-center-sidebar-width-v3';

const clampSidebarWidth = (value: number): number => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));

const readInitialSidebarWidth = (): number => {
  const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
  if (stored === null) return SIDEBAR_DEFAULT_WIDTH;
  const parsed = Number(stored);
  if (!Number.isFinite(parsed) || parsed < SIDEBAR_MIN_WIDTH || parsed > SIDEBAR_MAX_WIDTH) return SIDEBAR_DEFAULT_WIDTH;
  return clampSidebarWidth(parsed);
};

const readInitialTheme = (): ThemeMode => {
  const stored = window.localStorage.getItem('claim-center-theme');
  return stored === 'dark' || stored === 'light' ? stored : 'light';
};

export const AppShell: React.FC<AppShellProps> = ({
  currentPath,
  currentSearch,
  roles,
  userName,
  onNavigate,
  previewMode = false,
  onExpireSession,
  children
}) => {
  const safeUserName = typeof userName === 'string' && userName.trim() ? userName.trim() : 'User';
  const currentRouteId = ROUTES.find((route) => route.path === currentPath)?.id;
  const activeGroup = NAVIGATION_GROUPS.find((group) => navigationGroupRouteIds(group).includes(currentRouteId ?? ''));
  const activeSubgroup = activeGroup?.nestedGroups?.find((group) => group.routeIds.includes(currentRouteId ?? ''));
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isTablet, setIsTablet] = useState(() => window.innerWidth <= 1024);
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);
  const [sidebarWidth, setSidebarWidth] = useState(readInitialSidebarWidth);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => ({ [activeGroup?.icon ?? 'home']: true }));
  const [expandedSubgroups, setExpandedSubgroups] = useState<Record<string, boolean>>(() => activeSubgroup ? { [activeSubgroup.label]: true } : {});
  const [memberAlerts,setMemberAlerts]=useState<MemberAlertsPayload>({awards:[],todos:[],today:'',available:true});
  const [alertsOpen,setAlertsOpen]=useState(false);
  const [alertsBusy,setAlertsBusy]=useState(false);
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);
  const locationParams = new URLSearchParams(currentSearch);
  const contextProjectId = locationParams.get('projectId');
  const contextCaseId = locationParams.get('caseId');
  const selectedProject = WORKFLOW_PROJECTS.find((project) => project.id === contextProjectId || project.caseId === contextCaseId);
  const selectedStage = WORKFLOW_STAGES.find((stage) => stage.routeId === currentRouteId)
    ?? (currentRouteId === 'REPO-02' ? WORKFLOW_STAGES.find((stage) => stage.id === 6) : undefined)
    ?? (currentRouteId === 'MEET-01' ? WORKFLOW_STAGES.find((stage) => stage.id === 3) : undefined)
    ?? (currentRouteId === 'CASE-06' ? WORKFLOW_STAGES.find((stage) => stage.id === 4) : undefined);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem('claim-center-theme', theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (!activeGroup) return;
    setExpandedGroups((current) => ({ ...current, [activeGroup.icon]: true }));
    if (activeSubgroup) setExpandedSubgroups((current) => ({ ...current, [activeSubgroup.label]: true }));
  }, [activeGroup, activeSubgroup]);

  useEffect(() => {
    const handleResize = () => {
      const tablet = window.innerWidth <= 1024;
      setIsTablet(tablet);
      if (!tablet) setIsDrawerOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(()=>{void apiRequest<MemberAlertsPayload>('/api/member-alerts').then((payload)=>{setMemberAlerts(payload);if(payload.awards.length||payload.todos.length)setAlertsOpen(true);}).catch(()=>undefined);},[]);

  const acknowledgeAlerts=async()=>{const eventKeys=[...memberAlerts.awards,...memberAlerts.todos].map((alert)=>alert.eventKey);if(!eventKeys.length){setAlertsOpen(false);return;}setAlertsBusy(true);try{await apiRequest('/api/member-alerts',{method:'PUT',body:JSON.stringify({eventKeys})});setMemberAlerts((current)=>({...current,awards:[],todos:[]}));setAlertsOpen(false);}finally{setAlertsBusy(false);}};

  const go = (path: string) => {
    onNavigate(path);
    closeDrawer();
  };

  const routeWithProjectContext = (routeId: string, path: string) => {
    if (!selectedProject) return path;
    const projectId = encodeURIComponent(selectedProject.id);
    const caseId = encodeURIComponent(selectedProject.caseId);
    if (routeId === 'REPO-02') return `/reports/studio?caseId=${caseId}&projectId=${projectId}`;
    if (routeId === 'CASE-06') return `/cases/files?caseId=${caseId}&projectId=${projectId}`;
    if (routeId === 'MEET-01') return `/meetings?caseId=${caseId}&projectId=${projectId}`;
    if (routeId.startsWith('WF-')) return `${path}?projectId=${projectId}`;
    return path;
  };

  const navigation = (
    <nav className="navigation-list" aria-label="주요 화면">
      {selectedProject && <section className="sidebar-project-context" aria-label="현재 선택 프로젝트">
        <button type="button" onClick={() => go(`/projects/schedule?projectId=${encodeURIComponent(selectedProject.id)}`)}>
          <span className="sidebar-project-context__eyebrow">현재 선택 프로젝트</span>
          <strong>{selectedProject.code}</strong>
          <b>{selectedProject.name}</b>
          <small>{selectedStage ? `${selectedStage.id}단계 · ${selectedStage.name}` : '전체 단계 워크플로우'}</small>
          <i><em style={{ width: `${selectedProject.progress}%` }} /></i>
          <span className="sidebar-project-context__progress">전체 공정률 {selectedProject.progress}%</span>
        </button>
        <div>
          <button type="button" onClick={() => go('/projects/schedule')}>일정표</button>
          <button type="button" onClick={() => go(`/projects/schedule?projectId=${encodeURIComponent(selectedProject.id)}`)}>상세 팝업</button>
        </div>
      </section>}
      {NAVIGATION_GROUPS.filter((group) => !group.allowedRoles || group.allowedRoles.some((role) => roles.includes(role))).map((group) => {
        const routes = navigationGroupRouteIds(group)
          .map((id) => ROUTES.find((route) => route.id === id))
          .filter((route) => route && canAccessRoute(route, roles));
        if (routes.length === 0) return null;
        const isCurrentGroup = group === activeGroup;
        const isExpanded = Boolean(expandedGroups[group.icon]);
        if (group.icon === 'settings') {
          const route = routes[0];
          if (!route) return null;
          return <section className={`navigation-group navigation-group--single${isCurrentGroup ? ' is-current' : ''}`} key={group.label} aria-label={group.label} data-nav-group={group.icon}>
            <button type="button" className="navigation-single-action" onClick={() => go(route.path)} aria-current={currentPath === route.path ? 'page' : undefined}>
              <span className="navigation-group-icon"><NavigationGroupIcon name={group.icon} /></span>
              <span><strong>{group.label}</strong></span>
            </button>
          </section>;
        }
        return <section className={`navigation-group${isCurrentGroup ? ' is-current' : ''}${isExpanded ? ' is-expanded' : ''}`} key={group.label} aria-label={group.label} data-nav-group={group.icon}>
          <button
            type="button"
            className="navigation-group-toggle"
            aria-expanded={isExpanded}
            aria-controls={`navigation-group-${group.icon}`}
            onClick={() => setExpandedGroups((current) => ({ ...current, [group.icon]: !current[group.icon] }))}
          >
            <span className="navigation-group-icon"><NavigationGroupIcon name={group.icon} /></span>
            <div><h2>{group.label}</h2></div>
            <span className="navigation-chevron" aria-hidden="true" />
          </button>
          <div className="navigation-group__body" id={`navigation-group-${group.icon}`} hidden={!isExpanded}>
          {group.routeIds.map((routeId) => {
            const nested = group.nestedGroups?.find((candidate) => candidate.routeIds.includes(routeId));
            if (nested) {
              if (nested.routeIds[0] !== routeId) return null;
              const nestedRoutes = nested.routeIds
                .map((id) => routes.find((route) => route?.id === id))
                .filter(Boolean);
              if (!nestedRoutes.length) return null;
              const isSubgroupExpanded = Boolean(expandedSubgroups[nested.label]);
              const subgroupTone = nested.routeIds[0] === 'CASE-02' ? 'intake' : nested.routeIds[0] === 'PROP-02' ? 'proposal' : 'report';
              return <section className="navigation-subgroup" key={nested.label} aria-label={nested.label} data-nav-subgroup={subgroupTone}>
                <button
                  type="button"
                  className="navigation-subgroup__title"
                  aria-expanded={isSubgroupExpanded}
                  aria-controls={`navigation-subgroup-${nested.routeIds[0]}`}
                  onClick={() => setExpandedSubgroups((current) => ({ ...current, [nested.label]: !current[nested.label] }))}
                ><span aria-hidden="true">▱</span><div><small>{nested.eyebrow}</small><strong>{nested.label}</strong></div><i aria-hidden="true">⌄</i></button>
                <div className="navigation-subgroup__body" id={`navigation-subgroup-${nested.routeIds[0]}`} hidden={!isSubgroupExpanded}>{nestedRoutes.map((route) => route && <button
                  type="button"
                  key={route.id}
                  data-tour-route={route.id}
                  onClick={() => go(routeWithProjectContext(route.id, route.path))}
                  aria-current={currentPath === route.path ? 'page' : undefined}
                  className="navigation-link navigation-link--nested"
                >
                  <span className="navigation-dot" aria-hidden="true" />
                  <span className="text-ellipsis">{route.name}</span>
                </button>)}</div>
              </section>;
            }
            const route = routes.find((candidate) => candidate?.id === routeId);
            if (!route) return null;
            return <button
              type="button"
              key={route.id}
              data-tour-route={route.id}
              onClick={() => go(routeWithProjectContext(route.id, route.path))}
              aria-current={currentPath === route.path ? 'page' : undefined}
              className="navigation-link"
            >
              <span className="navigation-dot" aria-hidden="true" />
              <span className="text-ellipsis">{route.name}</span>
            </button>;
          })}
          </div>
        </section>;
      })}
    </nav>
  );

  return (
    <div className="app-shell" data-workspace-section={activeGroup?.icon ?? 'home'}>
      <SkipLink targetId="main-content" />
      <header className="topbar">
        <div className="brand-group">
          {isTablet && <Button size="sm" variant="secondary" onClick={() => setIsDrawerOpen(true)} aria-label="메인 메뉴 드로어 열기">☰ 메뉴</Button>}
          <span className="brand-mark" aria-hidden="true"><img src="/assets/claim-center-emblem.png" alt="" /></span>
          <div className="brand-copy"><h1>클레임센터 스튜디오</h1><small>CLAIM CENTER STUDIO</small></div>
        </div>
        <div className="session-tools">
          {previewMode && <span className="preview-chip" aria-label="업무 기록 자동 저장 활성">업무공간 · 자동저장</span>}
          <button
            type="button"
            className="theme-toggle"
            aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
          >
            <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
            <strong>{theme === 'dark' ? '라이트' : '다크'}</strong>
          </button>
          <WorkspaceHelpCenter category={activeGroup?.icon ?? 'home'} routeId={currentRouteId} previewMode={previewMode} onNavigate={go} />
          <button type="button" className="theme-toggle member-alert-button" aria-label={`업무 알림 ${memberAlerts.awards.length+memberAlerts.todos.length}건`} onClick={()=>setAlertsOpen(true)}>
            <span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg></span><strong>알림</strong>{memberAlerts.awards.length+memberAlerts.todos.length>0&&<em>{memberAlerts.awards.length+memberAlerts.todos.length}</em>}
          </button>
          <button type="button" className="theme-toggle" aria-label="개인 및 관리자 설정 열기" onClick={() => go('/settings')}>
            <span aria-hidden="true">⚙</span><strong>설정</strong>
          </button>
          <span className="session-avatar" aria-hidden="true">{safeUserName.slice(0, 1)}</span>
          <span className="session-identity" aria-label="현재 사용자 역할"><strong>{userName}</strong><small>{roles.join(', ').toUpperCase()}</small></span>
          <Button size="sm" variant="ghost" onClick={onExpireSession}>로그아웃</Button>
        </div>
      </header>

      <Dialog isOpen={alertsOpen} title="신규 수주·오늘의 프로젝트 투입 알림" onClose={()=>!alertsBusy&&setAlertsOpen(false)}>
        <div className="member-alert-dialog">
          {memberAlerts.awards.length>0&&<section><header><h3>신규 프로젝트 수주</h3><span>{memberAlerts.awards.length}건</span></header><ul>{memberAlerts.awards.map((alert)=><li key={alert.eventKey}><button type="button" onClick={()=>{go(`/projects/schedule?caseId=${encodeURIComponent(alert.caseId)}`);setAlertsOpen(false);}}><strong>{alert.caseNumber} · {alert.projectTitle}</strong><span>{alert.message}</span><small>{new Date(alert.awardedAt).toLocaleString('ko-KR')} · {alert.projectStartOn??'시작일 미정'} ~ {alert.projectEndOn??'종료일 미정'}</small></button></li>)}</ul></section>}
          <section><header><h3>{memberAlerts.today||'금일'} 투입 To-do</h3><span>{memberAlerts.todos.length}건</span></header>{memberAlerts.todos.length?<ul>{memberAlerts.todos.map((todo)=><li key={todo.eventKey}><button type="button" onClick={()=>{go(`/projects/schedule?caseId=${encodeURIComponent(todo.caseId)}`);setAlertsOpen(false);}}><strong>{todo.caseNumber} · {todo.stageLabel}</strong><span>{todo.title}</span><small>{todo.startDate} ~ {todo.endDate}{todo.noteText?` · ${todo.noteText}`:''}</small></button></li>)}</ul>:<p className="empty-box">오늘 배정된 프로젝트 단계 일정이 없습니다.</p>}</section>
          {!memberAlerts.available&&<p className="error-box">알림 기능을 준비하고 있습니다. 잠시 후 다시 확인해 주세요.</p>}
          <footer><Button variant="secondary" onClick={()=>setAlertsOpen(false)} disabled={alertsBusy}>나중에 다시 보기</Button><Button onClick={()=>void acknowledgeAlerts()} disabled={alertsBusy||(!memberAlerts.awards.length&&!memberAlerts.todos.length)}>{alertsBusy?'확인 저장 중…':'오늘 알림 확인 완료'}</Button></footer>
        </div>
      </Dialog>

      <SoftLaunchNotice />

      <div className="shell-body">
        {!isTablet && <aside className="sidebar" aria-label="주요 내비게이션 사이드바" style={{ width: sidebarWidth, flexBasis: sidebarWidth }}>
          {navigation}
          <div
            className="sidebar-resize-handle"
            role="separator"
            aria-label="좌측 메뉴 폭 조절"
            aria-orientation="vertical"
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
              event.preventDefault();
              if (event.key === 'Home') setSidebarWidth(SIDEBAR_MIN_WIDTH);
              else if (event.key === 'End') setSidebarWidth(SIDEBAR_MAX_WIDTH);
              else setSidebarWidth((current) => clampSidebarWidth(current + (event.key === 'ArrowRight' ? 16 : -16)));
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              document.documentElement.classList.add('is-resizing-sidebar');
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              setSidebarWidth(clampSidebarWidth(event.clientX));
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              document.documentElement.classList.remove('is-resizing-sidebar');
            }}
            onPointerCancel={() => document.documentElement.classList.remove('is-resizing-sidebar')}
          ><span aria-hidden="true" /></div>
        </aside>}
        <Drawer isOpen={isDrawerOpen} onClose={closeDrawer} title="전체 내비게이션 메뉴">{navigation}</Drawer>
        <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
};
