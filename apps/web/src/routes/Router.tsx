import React, { useState } from 'react';
import { Button, Card, ComponentCatalog, Dialog, Input, Select, StateView, StatusBadge } from '@claim-studio/ui';
import { CaseManagement } from '../case-management/CaseManagement';
import { ProposalView } from '../proposals/ProposalView';
import { ProposalLibraryView } from '../proposals/ProposalLibraryView';
import { IntakeLibraryView } from '../intakes/IntakeLibraryView';
import { ReportTemplateCatalog } from '../templates/ReportTemplateCatalog';
import { ReportStudio } from '../reports/ReportStudio';
import { ReportList } from '../reports/ReportList';
import { ReportLibraryView } from '../reports/ReportLibraryView';
import { ApprovalInbox } from '../reports/ApprovalInbox';
import { AiConfigManager } from '../ai/AiConfigManager';
import { FeeSuccessCompensation } from '../fees/FeeSuccessCompensation';
import { GoogleWorkspaceIntegration } from '../integrations/GoogleWorkspaceIntegration';
import { GoogleWorkspaceCaseTools } from '../integrations/GoogleWorkspaceCaseTools';
import { StatusFeedbackState } from '../layout/StatusFeedbackState';
import { PreviewFeature } from './PreviewWorkspace';
import { PreviewEvidenceHub, PreviewGoogleDriveSetup } from './PreviewEvidenceHub';
import { PreviewReportStudio } from './PreviewReportStudio';
import { PreviewApprovalInbox } from './PreviewApprovalInbox';
import { PreviewAdminUsers } from './PreviewAdminUsers';
import { ProjectWorkflowSchedule } from '../workflow/ProjectWorkflowSchedule';
import { ProposalAwardWorkflow } from '../workflow/ProposalAwardWorkflow';
import { WorkflowOperations } from '../workflow/WorkflowOperations';
import { PreviewAiAdmin } from './PreviewAiAdmin';
import { PreviewLitigationCenter } from './PreviewLitigationCenter';
import { PreviewDeliveryCenter } from './PreviewDeliveryCenter';
import { PreviewOutcomeCenter } from './PreviewOutcomeCenter';
import { PreviewSettings } from './PreviewSettings';
import { PreviewDocumentTemplates } from './PreviewDocumentTemplates';
import { BusinessCardContacts } from './BusinessCardContacts';

export const USER_ROLES = ['ceo', 'director', 'pm', 'staff', 'reviewer', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const CLAIM_TYPES = [
  { value: 'TYPE-01', label: 'TYPE-01: 현장조사 및 수량산출 클레임' },
  { value: 'TYPE-02', label: 'TYPE-02: 분석 보고서 작성 클레임' },
  { value: 'TYPE-03', label: 'TYPE-03: 일반적인 클레임' },
  { value: 'TYPE-04', label: 'TYPE-04: 재건축·재개발 공사비 협상' },
  { value: 'TYPE-05', label: 'TYPE-05: 사감정보고서' },
  { value: 'TYPE-06', label: 'TYPE-06: 물가변동' }
] as const;

export interface RouteConfig {
  id: string;
  path: string;
  name: string;
  allowedRoles?: readonly UserRole[];
}

const ADMIN_ONLY: readonly UserRole[] = ['admin'];
const FINANCE_ROLES: readonly UserRole[] = ['ceo', 'director', 'pm'];
const CASE_CREATE_ROLES: readonly UserRole[] = ['ceo', 'director', 'pm', 'staff', 'reviewer', 'admin'];

export const ROUTES: RouteConfig[] = [
  { id: 'AUTH-01', path: '/login', name: '로그인' },
  { id: 'DASH-01', path: '/dashboard', name: 'HOME' },
  { id: 'CASE-01', path: '/cases', name: '전체 프로젝트' },
  { id: 'CASE-02', path: '/cases/new', name: '프로젝트 의뢰서 작성', allowedRoles: CASE_CREATE_ROLES },
  { id: 'CASE-07', path: '/cases/intakes', name: '프로젝트 의뢰 목록' },
  { id: 'CASE-08', path: '/cases/database', name: '프로젝트 의뢰 DB관리', allowedRoles: ADMIN_ONLY },
  { id: 'CASE-03', path: '/cases/detail', name: '사건 상세-개요' },
  { id: 'CASE-04', path: '/cases/schedule', name: '사건 상세-일정' },
  { id: 'CASE-05', path: '/cases/parties', name: '사건 상세-관계자' },
  { id: 'CASE-06', path: '/cases/files', name: '드라이브' },
  { id: 'CASE-09', path: '/cases/files/templates', name: '문서 양식' },
  { id: 'CONTACT-01', path: '/contacts', name: '인맥관리' },
  { id: 'CONTACT-02', path: '/contacts/cards/new', name: '명함등록' },
  { id: 'CONTACT-03', path: '/contacts/cards/database', name: '명함DB관리', allowedRoles: ADMIN_ONLY },
  { id: 'MEET-01', path: '/meetings', name: '착수회의·회의록' },
  { id: 'PROP-01', path: '/proposals/templates', name: '제안서 템플릿 선택' },
  { id: 'PROP-02', path: '/proposals/editor', name: '제안서 작성' },
  { id: 'PROP-03', path: '/proposals/projects', name: '프로젝트별 제안서 목록' },
  { id: 'PROP-04', path: '/proposals/database', name: '제안서 DB관리', allowedRoles: ADMIN_ONLY },
  { id: 'PROJ-01', path: '/projects/schedule', name: '프로젝트 일정표' },
  { id: 'PROJ-02', path: '/projects/workflow', name: '프로젝트 세부 워크플로우' },
  { id: 'PROJ-PRINT', path: '/print/projects/month-a4', name: '프로젝트 일정표 A4 출력' },
  { id: 'WF-01', path: '/workflow/proposal-link', name: '1. 제안서 연동' },
  { id: 'WF-02', path: '/workflow/award', name: '프로젝트 접수' },
  { id: 'WF-07', path: '/workflow/projects/database', name: '프로젝트 DB관리', allowedRoles: ADMIN_ONLY },
  { id: 'WF-03', path: '/workflow/kickoff', name: '착수회의' },
  { id: 'WF-04', path: '/workflow/site-survey', name: '현장조사' },
  { id: 'WF-05', path: '/workflow/quantity', name: '물량산출 및 내역' },
  { id: 'WF-06', path: '/workflow/report', name: '6. 보고서 작성' },
  { id: 'REPO-01', path: '/reports', name: '납품 보고서' },
  { id: 'REPO-02', path: '/reports/studio', name: '보고서 작성' },
  { id: 'REPO-03', path: '/reports/projects', name: '프로젝트별 보고서 목록' },
  { id: 'REPO-04', path: '/reports/database', name: '보고서 DB관리', allowedRoles: ADMIN_ONLY },
  { id: 'APPR-01', path: '/approval', name: '검토·승인' },
  { id: 'POST-01', path: '/after-delivery', name: '법원 자료·소송 일정' },
  { id: 'OUTCOME-01', path: '/outcomes', name: '판결·성과 관리', allowedRoles: FINANCE_ROLES },
  { id: 'FEE-01', path: '/success-fee', name: '성공보수', allowedRoles: FINANCE_ROLES },
  { id: 'INTEG-01', path: '/integrations/google', name: 'Google Drive 연결', allowedRoles: ADMIN_ONLY },
  { id: 'TPL-01', path: '/templates', name: '유형별 보고서 템플릿', allowedRoles: ADMIN_ONLY },
  { id: 'AI-01', path: '/ai-config', name: '보고서 유형·챕터 작성 지침', allowedRoles: ADMIN_ONLY },
  { id: 'MY-01', path: '/settings', name: '설정' },
  { id: 'USER-01', path: '/users', name: '사용자와 권한', allowedRoles: ADMIN_ONLY },
  { id: 'AUD-01', path: '/audit-logs', name: '감사로그', allowedRoles: ADMIN_ONLY },
  { id: 'RESP-01', path: '/tablet-responsive', name: '태블릿·컴포넌트 카탈로그' }
];

export interface ResolvedRoute {
  route: RouteConfig;
  params: Record<string, string>;
}

export const resolveRoute = (path: string): ResolvedRoute | undefined => {
  const exact = ROUTES.find((route) => route.path === path);
  if (exact) return { route: exact, params: {} };
  const studio = path.match(/^\/cases\/([^/]+)\/reports\/([^/]+)\/studio$/);
  if (studio) {
    const route = ROUTES.find((entry) => entry.id === 'REPO-02');
    if (route) return { route, params: { caseId: decodeURIComponent(studio[1]), reportId: decodeURIComponent(studio[2]) } };
  }
  return undefined;
};
export const routeByPath = (path: string): RouteConfig | undefined => resolveRoute(path)?.route;
export const canAccessRoute = (route: RouteConfig, roles: UserRole | readonly UserRole[]): boolean => {
  const activeRoles = Array.isArray(roles) ? roles : [roles];
  return !route.allowedRoles || activeRoles.some((role) => route.allowedRoles?.includes(role));
};
export const isSafeReturnTo = (path: string): boolean => path.startsWith('/') && !path.startsWith('//') && Boolean(routeByPath(path));

export const reviewerCapabilities = {
  uploadEvidence: true,
  editReportBody: false,
  approveSection: true,
  mergeFinalDocument: false
} as const;

export interface RouterProps {
  currentPath: string;
  currentSearch?: string;
  roles: UserRole[];
  onNavigate: (path: string) => void;
  userName?: string;
  userEmail?: string;
  previewMode?: boolean;
}

const ForbiddenRoute: React.FC<{ route: RouteConfig; onNavigate: (path: string) => void }> = ({ route, onNavigate }) => (
  <StatusFeedbackState
    type="forbidden"
    title="403 Forbidden"
    message={`${route.name} 화면에 접근할 권한이 없습니다. 담당 배정과 역할을 확인해 주세요.`}
    actionLabel="대시보드로 이동"
    onAction={() => onNavigate('/dashboard')}
  />
);

const ReportStudioActions: React.FC<{ roles: UserRole[] }> = ({ roles }) => {
  const [showEditForbidden, setShowEditForbidden] = useState(false);
  const reviewer = roles.includes('reviewer');
  return (
    <Card title="Reviewer RBAC 행동 계약">
      <p className="muted">Reviewer는 스튜디오를 열람할 수 있지만 본문 편집과 최종 병합은 할 수 없습니다.</p>
      <label htmlFor="report-body">보고서 초안 본문</label>
      <textarea
        id="report-body"
        className="report-editor"
        defaultValue="합성 테스트 사건의 보고서 초안입니다. 실제 고객정보를 포함하지 않습니다."
        readOnly={reviewer}
        aria-readonly={reviewer}
        onClick={() => reviewer && setShowEditForbidden(true)}
      />
      <div className="action-row" aria-label="보고서 권한별 작업">
        <Button>검토자료 업로드</Button>
        <Button variant="secondary" disabled={reviewer}>본문 저장</Button>
        <Button variant="secondary">장 1차 승인</Button>
        <Button variant="danger" disabled={reviewer}>최종 DOCX/PDF 병합</Button>
      </div>
      <Dialog isOpen={showEditForbidden} title="403 본문 편집 권한 없음" onClose={() => setShowEditForbidden(false)}>
        Reviewer는 댓글과 수정 요청만 작성할 수 있습니다. 본문 변경은 저장되지 않습니다.
      </Dialog>
    </Card>
  );
};

export const RouterView: React.FC<RouterProps> = ({ currentPath, currentSearch = '', roles, userName = 'Preview User', userEmail = '', previewMode = false, onNavigate }) => {
  const [uiState, setUiState] = useState<'normal' | 'loading' | 'empty' | 'error' | 'forbidden'>('normal');
  const resolvedRoute = resolveRoute(currentPath);
  const currentRoute = resolvedRoute?.route;

  if (!currentRoute) {
    return (
      <StatusFeedbackState
        type="error"
        title="페이지를 찾을 수 없습니다 (404)"
        message={`요청한 경로(${currentPath})가 존재하지 않습니다.`}
        actionLabel="대시보드로 이동"
        onAction={() => onNavigate('/dashboard')}
      />
    );
  }
  if (!canAccessRoute(currentRoute, roles)) return <ForbiddenRoute route={currentRoute} onNavigate={onNavigate} />;
  if (currentRoute.id === 'RESP-01') return <ComponentCatalog />;
  if (previewMode && ['WF-03', 'WF-04', 'WF-05'].includes(currentRoute.id)) {
    return <WorkflowOperations routeId={currentRoute.id as 'WF-03' | 'WF-04' | 'WF-05'} roles={roles} onNavigate={onNavigate} />;
  }
  if (previewMode && ['WF-01', 'WF-02'].includes(currentRoute.id)) {
    return <ProposalAwardWorkflow routeId={currentRoute.id as 'WF-01' | 'WF-02'} roles={roles} onNavigate={onNavigate} />;
  }
  if (previewMode && currentRoute.id === 'WF-07') {
    return <ProposalAwardWorkflow routeId="WF-07" roles={roles} onNavigate={onNavigate} />;
  }
  if (!previewMode && ['WF-01', 'WF-02'].includes(currentRoute.id)) {
    return <ProposalAwardWorkflow routeId={currentRoute.id as 'WF-01' | 'WF-02'} roles={roles} onNavigate={onNavigate} />;
  }
  if (!previewMode && currentRoute.id === 'WF-07') {
    return <ProposalAwardWorkflow routeId="WF-07" roles={roles} onNavigate={onNavigate} />;
  }
  if (['PROJ-01', 'PROJ-02', 'WF-01', 'WF-02', 'WF-03', 'WF-04', 'WF-05', 'WF-06'].includes(currentRoute.id)) {
    return <ProjectWorkflowSchedule routeId={currentRoute.id} onNavigate={onNavigate} />;
  }
  if (previewMode && ['DASH-01', 'CASE-01', 'CASE-02', 'CASE-03', 'CASE-04', 'CASE-05'].includes(currentRoute.id)) {
    return (
      <section className="route-view" aria-labelledby="route-title">
        <div className="route-heading">
          <h2 id="route-title">{currentRoute.name}</h2>
          <span className="preview-pill">업무 기록 자동 저장</span>
        </div>
        <CaseManagement routeId={currentRoute.id} onNavigate={onNavigate} previewMode />
      </section>
    );
  }
  if (previewMode && currentRoute.id === 'CASE-06') return <PreviewEvidenceHub userName={userName} roles={roles} onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'CASE-09') return <PreviewDocumentTemplates onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'CONTACT-01') return <BusinessCardContacts mode="LIST" roles={roles} onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'CONTACT-02') return <BusinessCardContacts mode="REGISTER" roles={roles} onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'CONTACT-03') return <BusinessCardContacts mode="DATABASE" roles={roles} onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'CASE-07') return <IntakeLibraryView mode="projects" onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'CASE-08') return <IntakeLibraryView mode="database" onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'INTEG-01') return <PreviewGoogleDriveSetup onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'WF-06') return <PreviewReportStudio key={currentSearch} roles={roles} onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'REPO-02') return <PreviewReportStudio key={currentSearch} roles={roles} onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'REPO-03') return <ReportLibraryView mode="projects" onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'REPO-04') return <ReportLibraryView mode="database" onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'APPR-01') return <PreviewApprovalInbox roles={roles} onNavigate={onNavigate} />;
  if (previewMode && ['PROP-01', 'PROP-02'].includes(currentRoute.id)) {
    return (
      <section className="route-view" aria-labelledby="route-title">
        <div className="route-heading">
          <h2 id="route-title">{currentRoute.name}</h2>
        </div>
        <ProposalView routeId={currentRoute.id} roles={roles} userEmail={userEmail} onNavigate={onNavigate} />
      </section>
    );
  }
  if (previewMode && currentRoute.id === 'PROP-03') return <ProposalLibraryView mode="projects" onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'PROP-04') return <ProposalLibraryView mode="database" onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'USER-01') return <PreviewAdminUsers />;
  if (previewMode && currentRoute.id === 'AI-01') return <PreviewAiAdmin />;
  if (previewMode && currentRoute.id === 'MY-01') return <PreviewSettings roles={roles} onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'POST-01') return <PreviewLitigationCenter roles={roles} onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'REPO-01') return <PreviewDeliveryCenter onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'OUTCOME-01') return <PreviewOutcomeCenter onNavigate={onNavigate} />;
  if (previewMode && currentRoute.id === 'FEE-01') return <StatusFeedbackState type="empty" title="운영 메뉴에서 제외된 기능입니다" message="성공보수 기능은 현재 클레임센터 스튜디오 업무 범위에서 사용하지 않습니다." actionLabel="업무 홈으로 이동" onAction={() => onNavigate('/dashboard')} />;
  if (previewMode && currentRoute.id !== 'RESP-01') return <PreviewFeature route={currentRoute} onNavigate={onNavigate} />;

  if (['DASH-01', 'CASE-01', 'CASE-02', 'CASE-03', 'CASE-04', 'CASE-05', 'CASE-06', 'MEET-01'].includes(currentRoute.id)) {
    const googleRoute = ['CASE-04', 'CASE-06', 'MEET-01'].includes(currentRoute.id)
      ? currentRoute.id as 'CASE-04' | 'CASE-06' | 'MEET-01'
      : null;
    return (
      <section className="route-view" aria-labelledby="route-title">
        <div className="route-heading">
          <h2 id="route-title">{currentRoute.name}</h2>
        </div>
        <CaseManagement routeId={currentRoute.id} onNavigate={onNavigate} />
        {googleRoute && <GoogleWorkspaceCaseTools routeId={googleRoute} roles={roles} />}
      </section>
    );
  }

  if (['PROP-01', 'PROP-02'].includes(currentRoute.id)) {
    return (
      <section className="route-view" aria-labelledby="route-title">
        <div className="route-heading">
          <h2 id="route-title">{currentRoute.name}</h2>
        </div>
        <ProposalView routeId={currentRoute.id} roles={roles} userEmail={userEmail} onNavigate={onNavigate} />
      </section>
    );
  }
  if (currentRoute.id === 'PROP-03') return <ProposalLibraryView mode="projects" onNavigate={onNavigate} />;
  if (currentRoute.id === 'PROP-04') return <ProposalLibraryView mode="database" onNavigate={onNavigate} />;
  if (currentRoute.id === 'CASE-07') return <IntakeLibraryView mode="projects" onNavigate={onNavigate} />;
  if (currentRoute.id === 'CASE-08') return <IntakeLibraryView mode="database" onNavigate={onNavigate} />;
  if (currentRoute.id === 'REPO-03') return <ReportLibraryView mode="projects" onNavigate={onNavigate} />;
  if (currentRoute.id === 'REPO-04') return <ReportLibraryView mode="database" onNavigate={onNavigate} />;
  if (currentRoute.id === 'CASE-09') return <PreviewDocumentTemplates onNavigate={onNavigate} />;

  if (currentRoute.id === 'TPL-01') {
    return (
      <section className="route-view" aria-labelledby="route-title">
        <div className="route-heading">
          <h2 id="route-title">{currentRoute.name}</h2>
        </div>
        <ReportTemplateCatalog routeId={currentRoute.id} roles={roles} onNavigate={onNavigate} />
      </section>
    );
  }

  if (currentRoute.id === 'REPO-02') {
    return (
      <section className="route-view" aria-labelledby="route-title">
        <div className="route-heading">
          <h2 id="route-title">{currentRoute.name}</h2>
        </div>
        <ReportStudio reportId={resolvedRoute?.params.reportId} roles={roles} onNavigate={onNavigate} />
      </section>
    );
  }

  if (currentRoute.id === 'REPO-01') {
    return (
      <section className="route-view" aria-labelledby="route-title">
        <div className="route-heading">
          <h2 id="route-title">{currentRoute.name}</h2>
        </div>
        <ReportList onNavigate={onNavigate} />
      </section>
    );
  }

  if (currentRoute.id === 'APPR-01') {
    return (
      <section className="route-view" aria-labelledby="route-title">
        <div className="route-heading">
          <h2 id="route-title">{currentRoute.name}</h2>
        </div>
        <ApprovalInbox onNavigate={onNavigate} />
      </section>
    );
  }

  if (currentRoute.id === 'AI-01') {
    return (
      <section className="route-view" aria-labelledby="route-title">
        <AiConfigManager roles={roles} />
      </section>
    );
  }

  if (currentRoute.id === 'FEE-01') {
    return (
      <section className="route-view" aria-labelledby="route-title">
        <FeeSuccessCompensation roles={roles} onNavigate={onNavigate} />
      </section>
    );
  }

  if (currentRoute.id === 'INTEG-01') {
    return (
      <section className="route-view" aria-labelledby="route-title">
        <GoogleWorkspaceIntegration roles={roles} onNavigate={onNavigate} />
      </section>
    );
  }

  return (
    <section className="route-view" aria-labelledby="route-title">
      <div className="route-heading">
          <h2 id="route-title">{currentRoute.name}</h2>
        <div className="state-controls" aria-label="화면 상태 미리보기">
          {(['normal', 'loading', 'empty', 'error', 'forbidden'] as const).map((state) => (
            <Button key={state} size="sm" variant="secondary" onClick={() => setUiState(state)}>{state === 'forbidden' ? '403' : state}</Button>
          ))}
        </div>
      </div>

      <StateView state={uiState} onRetry={() => setUiState('normal')}>
        <div className="content-stack">
          <Card title={`화면 계약: ${currentRoute.id}`}>
            <div className="form-stack">
              <Select label="6대 고정 클레임 유형 선택" options={[...CLAIM_TYPES]} />
              <Input label="사건·문서 검색" placeholder="검색어를 입력하세요" />
              <div className="action-row"><StatusBadge status="approved" /><StatusBadge status="ai_draft" /><StatusBadge status="review" /></div>
              <p className="muted">현재 서버 역할: <strong>{roles.join(', ').toUpperCase()}</strong> · 화면과 API가 동일한 서버 세션 권한을 사용합니다.</p>
            </div>
          </Card>
          {currentRoute.id === 'REPO-02' && <ReportStudioActions roles={roles} />}
        </div>
      </StateView>
    </section>
  );
};
