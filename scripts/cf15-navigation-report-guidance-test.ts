import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync('apps/web/src/layout/AppShell.tsx', 'utf8');
const router = readFileSync('apps/web/src/routes/Router.tsx', 'utf8');
const studio = readFileSync('apps/web/src/routes/PreviewReportStudio.tsx', 'utf8');
const schedule = readFileSync('apps/web/src/workflow/ProjectWorkflowSchedule.tsx', 'utf8');

test('CF15 sidebar follows the requested workflow with proposal authoring nested between intake and award', () => {
  for (const label of ['HOME', '프로젝트 접수', '프로젝트 제안서', '프로젝트 워크', '프로젝트 보고서', '드라이브', '법원 자료', '검토·납품 관리']) {
    assert.match(shell, new RegExp(label, 'u'));
  }
  assert.match(shell, /routeIds: \['CASE-02', 'CASE-07', 'CASE-08', 'PROP-02', 'PROP-03', 'PROP-04', 'WF-02'\]/u);
  assert.match(shell, /routeIds: \['CASE-06', 'CASE-09'\]/u);
  assert.match(shell, /nestedGroups: \[\s*\{ label: '프로젝트 의뢰'.*routeIds: \['CASE-02', 'CASE-07', 'CASE-08'\]/su);
  assert.match(shell, /\{ label: '프로젝트 제안서', eyebrow: '제안서 관리', routeIds: \['PROP-02', 'PROP-03', 'PROP-04'\] \}/u);
  assert.match(shell, /routeIds: \['PROJ-01', 'WF-03', 'WF-04', 'WF-05', 'REPO-02', 'REPO-03', 'REPO-04'\]/u);
  assert.match(shell, /nestedGroups: \[\{ label: '프로젝트 보고서'.*routeIds: \['REPO-02', 'REPO-03', 'REPO-04'\]/u);
  assert.doesNotMatch(shell, /routeIds: \[[^\]]*'PROJ-02'/u);
  assert.doesNotMatch(shell, /routeIds: \['PROP-02', 'CASE-01', 'CASE-02'\]/u);
  assert.match(shell, /icon: 'proposal'/u);
  assert.match(shell, /icon: 'library'/u);
  assert.match(shell, /expandedGroups/u);
  assert.match(shell, /expandedSubgroups/u);
  assert.match(shell, /className="navigation-group-toggle"/u);
  assert.match(shell, /aria-expanded=\{isExpanded\}/u);
  assert.match(shell, /className="navigation-subgroup__title"/u);
  assert.doesNotMatch(shell, /01 ·|02 ·|03 ·|04 ·|05 ·/u);
  assert.match(router, /CASE-02'.*'프로젝트 의뢰서 작성'/u);
  assert.match(router, /PROP-02'.*'제안서 작성'/u);
  assert.match(router, /PROP-03'.*'프로젝트별 제안서 목록'/u);
  assert.match(router, /PROP-04'.*'제안서 DB관리'.*ADMIN_ONLY/u);
  assert.match(router, /WF-02'.*'프로젝트 접수'/u);
  assert.match(shell, /<button\s+type="button"\s+key=\{route\.id\}/u);
  assert.doesNotMatch(shell, /<a\s+key=\{route\.id\}/u);
  assert.match(schedule, /담당 PM과 단계별 기준 일정/u);
  assert.match(schedule, /detail-schedule-board/u);
  assert.doesNotMatch(schedule, /수량산출·내역작성 투입 현황/u);
  assert.doesNotMatch(schedule, /보고서 작성 전담 5인/u);
});

test('CF15 report writing menu opens the real studio with template, outline, tutorial and admin prompt boundaries', () => {
  assert.match(router, /REPO-02'.*'보고서 작성'/u);
  assert.match(router, /previewMode && currentRoute\.id === 'REPO-02'.*PreviewReportStudio/u);
  assert.match(studio, /지금은 \{activeStep\}단계입니다/u);
  assert.match(studio, /이 단계 완료 · 다음 단계/u);
  assert.match(studio, /renderStageHeader\(2\)/u);
  assert.match(studio, /report-step-card--2 report-stage-card/u);
  assert.match(studio, /authoring\.chapters\.map/u);
  assert.match(studio, /프롬프트 원문은 관리자만 열람·수정/u);
  assert.match(studio, /roles\.includes\('admin'\).*onNavigate\('\/ai-config'\)/u);
  assert.match(router, /AI-01'.*allowedRoles: ADMIN_ONLY/u);
});
