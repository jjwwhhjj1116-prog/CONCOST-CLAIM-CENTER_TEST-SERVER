import React from 'react';
import { Button, Card } from '@claim-studio/ui';
import { PreviewCloudDraft } from './PreviewCloudDraft';

interface PreviewNavigationProps {
  onNavigate: (path: string) => void;
}

export const PreviewDashboard: React.FC<PreviewNavigationProps> = ({ onNavigate }) => {
  const kpis = [
    ['ACTIVE CLAIMS', '12', '진행 중 사건'],
    ['REPORTS', '7', '작성·검토 중'],
    ['APPROVALS', '3', '승인 대기'],
    ['DEADLINES', '4', '이번 주 일정']
  ];
  const work = [
    ['공사비 적정성 검토 보고서', '서울 복합개발 프로젝트', '작성 72%'],
    ['물가변동 검토 의견서', '서부권 인프라 프로젝트', '검토 대기'],
    ['현장조사 수량산출 보고서', '공동주택 하자 사건', '자료 수집']
  ];

  return (
    <section className="route-view preview-dashboard" aria-labelledby="preview-dashboard-title">
      <div className="dashboard-hero preview-hero">
        <div>
          <span className="workspace-eyebrow">CLAIM INTELLIGENCE WORKSPACE</span>
          <h2 id="preview-dashboard-title">복잡한 클레임 업무를<br />하나의 흐름으로.</h2>
          <p>사건 관리부터 근거 자료, AI 초안, 검토·승인, 최종 보고서까지 연결하는 클레임 전문 스튜디오입니다.</p>
        </div>
        <div className="dashboard-quick-actions">
          <Button onClick={() => onNavigate('/tablet-responsive')}>DESIGN SYSTEM</Button>
          <Button variant="secondary" onClick={() => onNavigate('/reports/studio')}>REPORT STUDIO</Button>
        </div>
      </div>

      <div className="dashboard-kpi-grid">
        {kpis.map(([label, value, detail]) => (
          <div className="dashboard-kpi" key={label}>
            <span>{label}</span><strong>{value}</strong><small>{detail}</small>
          </div>
        ))}
      </div>

      <div className="dashboard-columns">
        <Card title="LIVE WORKSPACE">
          <ul className="dashboard-work-list">
            {work.map(([title, project, status]) => (
              <li key={title}><button type="button"><span><strong>{title}</strong><small>{project}</small></span><span className="dashboard-status">{status}</span></button></li>
            ))}
          </ul>
        </Card>
        <Card title="TODAY'S BRIEFING">
          <div className="preview-briefing">
            <span className="preview-orbit" aria-hidden="true">AI</span>
            <h3>보고서 스튜디오가 준비되었습니다.</h3>
            <p>6대 클레임 유형, 20개 핵심 화면, 검토·승인 워크플로를 UI 미리보기로 탐색할 수 있습니다.</p>
            <div className="action-row"><span className="preview-pill">EVIDENCE</span><span className="preview-pill">AI DRAFT</span><span className="preview-pill">APPROVAL</span></div>
          </div>
        </Card>
      </div>
      <PreviewCloudDraft />
    </section>
  );
};

interface PreviewFeatureProps extends PreviewNavigationProps {
  route: { id: string; name: string };
}

export const PreviewFeature: React.FC<PreviewFeatureProps> = ({ route, onNavigate }) => (
  <section className="route-view preview-feature" aria-labelledby="preview-feature-title">
    <div className="workspace-hero">
      <div>
        <span className="workspace-eyebrow">{route.id} · PRODUCT PREVIEW</span>
        <h2 id="preview-feature-title">{route.name}</h2>
        <p>클레임센터의 업무 흐름을 확인하고 사건·일정·관계자 정보를 안전하게 관리하는 화면입니다.</p>
      </div>
      <Button variant="secondary" onClick={() => onNavigate('/dashboard')}>BACK TO DASHBOARD</Button>
    </div>
    <div className="preview-feature-grid">
      <Card title="WORKFLOW"><p>클레임센터의 역할·승인·감사 계약에 맞춘 단계형 업무 화면입니다.</p></Card>
      <Card title="INTERFACE"><p>반응형 레이아웃, 명확한 상태 표시, 키보드 접근성을 적용했습니다.</p></Card>
      <Card title="자동 저장"><p>로그인·사건·일정·관계자·초안 저장 기능이 연결되어 있습니다. 파일 원본은 회사 Google Drive 연결 상태에 따라 보관됩니다.</p></Card>
    </div>
  </section>
);
