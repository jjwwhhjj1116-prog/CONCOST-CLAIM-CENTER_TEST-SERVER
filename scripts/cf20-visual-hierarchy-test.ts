import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

const relativeLuminance = (hex: string) => {
  const channels = hex.match(/[a-f\d]{2}/giu)?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

const contrastRatio = (foreground: string, background: string) => {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (light + 0.05) / (dark + 0.05);
};

test('CF20 exposes a persisted accessible light and dark theme toggle', () => {
  const shell = read('apps/web/src/layout/AppShell.tsx');
  const html = read('apps/web/index.html');
  const theme = read('apps/web/src/theme-system.css');

  assert.match(html, /<html lang="ko" data-theme="light">/u);
  assert.match(shell, /claim-center-theme/u);
  assert.match(shell, /aria-pressed=\{theme === 'dark'\}/u);
  assert.match(shell, /라이트 모드로 전환/u);
  assert.match(shell, /다크 모드로 전환/u);
  assert.match(theme, /:root\[data-theme='light'\]/u);
  assert.match(theme, /prefers-reduced-motion/u);
});

test('CF20 gives proposal, project workflow, and report authoring steps distinct hierarchy', () => {
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const workflow = read('apps/web/src/workflow/WorkflowOperations.tsx');
  const report = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const theme = read('apps/web/src/theme-system.css');

  assert.match(proposal, /proposal-step-button/u);
  assert.match(workflow, /--step-color/u);
  for (const step of ['1', '2', '3', '4', '5']) assert.match(report, new RegExp(`report-step-card--${step}`));
  for (const color of ['#c8794d', '#4a86c5', '#766bb5', '#4b967f']) assert.match(theme, new RegExp(color));
  assert.match(theme, /--report-step-number/u);
  assert.match(theme, /\.case-create-number strong/u);
});

test('CF21 keeps active navigation legible and harmonizes light workspace surfaces', () => {
  const shell = read('apps/web/src/layout/AppShell.tsx');
  const theme = read('apps/web/src/theme-system.css');

  assert.match(shell, /navigation-group\$\{isCurrentGroup \? ' is-current' : ''\}/u);
  assert.match(theme, /\.navigation-group\.is-current \.navigation-group-toggle/u);
  assert.match(theme, /box-shadow: inset 3px 0 #4a86c5/u);
  assert.doesNotMatch(theme, /\.navigation-group \.navigation-link\[aria-current='page'\] \{ background: linear-gradient/u);
  assert.match(theme, /:root\[data-theme='light'\] \.schedule-board/u);
  assert.match(theme, /:root\[data-theme='light'\] \.case-evidence-categories button/u);
  assert.match(theme, /:root\[data-theme='light'\] \.litigation-kpis article/u);
});

test('CF22 applies the pastel overlay system and project-specific work tags', () => {
  const html = read('apps/web/index.html');
  const theme = read('apps/web/src/theme-system.css');
  const model = read('apps/web/src/workflow/workflow-model.ts');
  const schedule = read('apps/web/src/workflow/ProjectWorkflowSchedule.tsx');
  const scheduleCss = read('apps/web/src/workflow/ProjectWorkflowSchedule.css');

  assert.match(html, /family=Noto\+Sans\+KR/u);
  assert.match(html, /family=DM\+Mono/u);
  assert.match(theme, /--page-bg: #f4f7fb/u);
  assert.match(theme, /0 6px 18px rgba\(34, 62, 94, \.04\)/u);
  assert.match(theme, /\.navigation-group \.navigation-link\[aria-current='page'\].*background: rgba\(var\(--group-rgb\), \.14\)/u);
  assert.match(model, /highlights: readonly/u);
  assert.match(model, /마감팀 · 마감 물량 산출/u);
  assert.doesNotMatch(schedule, /project-brief-board/u);
  assert.match(schedule, /project-modal-highlights/u);
  assert.match(schedule, /selectedProject\.highlights\.map/u);
  assert.ok(schedule.indexOf('className="schedule-board"') < schedule.indexOf('className="workflow-summary"'), '월간 캘린더가 요약 카드보다 먼저 렌더링되어야 합니다.');
  assert.match(theme, /\.notice-box \*/u);
  assert.match(theme, /color:#111827!important/u);
  for (const tone of ['finish', 'structure', 'civil', 'report', 'survey', 'pending']) {
    assert.match(scheduleCss, new RegExp(`data-tone='${tone}'`));
  }
});

test('CF23 opens project workflow as a contextual schedule dialog without a duplicate sidebar category', () => {
  const app = read('apps/web/src/App.tsx');
  const shell = read('apps/web/src/layout/AppShell.tsx');
  const schedule = read('apps/web/src/workflow/ProjectWorkflowSchedule.tsx');
  const scheduleCss = read('apps/web/src/workflow/ProjectWorkflowSchedule.css');

  assert.match(app, /currentBrowserLocation/u);
  assert.match(app, /currentSearch=\{currentSearch\}/u);
  assert.doesNotMatch(shell, /routeIds: \[[^\]]*'PROJ-02'/u);
  assert.match(shell, /sidebar-project-context/u);
  assert.match(shell, /현재 선택 프로젝트/u);
  assert.match(shell, /selectedStage \? `\$\{selectedStage\.id\}단계/u);
  assert.match(shell, /상세 팝업/u);
  assert.match(schedule, /project-context-strip/u);
  assert.match(schedule, /전체 단계 워크플로우/u);
  assert.match(schedule, /projectId=\$\{projectId\}/u);
  assert.match(schedule, /project-detail-modal/u);
  assert.match(schedule, /role="dialog"/u);
  assert.match(schedule, /aria-modal="true"/u);
  assert.match(schedule, /D1 LIVE PROJECTS · 신규 의뢰 자동 반영/u);
  assert.match(schedule, /apiRequest<\{ projects: WorkflowProject\[\]; dataBasis: string \}>\('\/api\/project-workflow\/schedule'\)/u);
  assert.doesNotMatch(schedule, /WORKFLOW_PROJECTS/u);
  assert.match(scheduleCss, /\.project-context-strip \{/u);
  assert.match(scheduleCss, /\.project-detail-modal-backdrop \{/u);
});

test('CF24 renders report authoring as a gated one-step-at-a-time wizard', () => {
  const studio = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const css = read('apps/web/src/routes/PreviewReportStudio.css');

  assert.match(studio, /type ReportWizardStep = 1 \| 2 \| 3 \| 4 \| 5/u);
  assert.match(studio, /REPORT_WIZARD_STEPS/u);
  assert.match(studio, /REPORT STEP/u);
  assert.match(studio, /완료 기준/u);
  assert.match(studio, /이 단계 완료 · 다음 단계/u);
  assert.match(studio, /stepUnlocked/u);
  assert.match(css, /data-wizard-step='1'.*report-step-card--1/u);
  assert.match(css, /data-wizard-step='5'.*report-step-card--5/u);
  assert.match(css, /\.report-wizard-footer/u);
});

test('CF51 keeps dark court heroes and light feedback surfaces readable', () => {
  const litigation = read('apps/web/src/routes/PreviewLitigationCenter.css');
  const theme = read('apps/web/src/theme-system.css');

  assert.match(litigation, /\.litigation-hero h2 \{[^}]*color: #f8fafc[^}]*-webkit-text-fill-color: #f8fafc/su);
  assert.match(litigation, /\.litigation-hero p \{[^}]*color: #dbeafe/su);
  assert.match(theme, /:root\[data-theme='light'\] \.litigation-trust-note \{[^}]*background: #fff7e6[^}]*color: #334155/su);
  assert.match(theme, /--text-muted: #64748b/su);
  assert.match(theme, /textarea::placeholder \{ color: #64748b/su);

  assert.ok(contrastRatio('#f8fafc', '#0b1330') >= 7, '법원 배너 제목은 짙은 배경에서 AAA 수준이어야 합니다.');
  assert.ok(contrastRatio('#dbeafe', '#0b1330') >= 7, '법원 배너 설명도 짙은 배경에서 AAA 수준이어야 합니다.');
  assert.ok(contrastRatio('#334155', '#fff7e6') >= 7, '라이트 안내문 본문은 밝은 배경에서 AAA 수준이어야 합니다.');
  assert.ok(contrastRatio('#64748b', '#ffffff') >= 4.5, '보조 문구 토큰은 흰 배경에서 WCAG AA를 충족해야 합니다.');
});

test('CF52 presents each report step as one focused work card and hides saved work behind a picker', () => {
  const studio = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const css = read('apps/web/src/routes/PreviewReportStudio.css');

  assert.match(studio, /report-resume-control/u);
  assert.match(studio, /report-resume-menu/u);
  assert.match(studio, /프로젝트 번호·이름·보고서 제목/u);
  assert.doesNotMatch(studio, /className="report-resume-board"/u);
  assert.match(studio, /renderStageHeader\(1\)/u);
  assert.match(studio, /renderStageHeader\(5\)/u);
  assert.doesNotMatch(studio, /Card title="SOURCE READINESS/u);
  assert.doesNotMatch(studio, /Card title=\{`저장 이력/u);
  assert.doesNotMatch(studio, /Card title="FINAL OUTPUT/u);
  assert.match(css, /\.report-stage-card::after \{ display: none; \}/u);
});

test('CF80 groups schedule controls and doubles the PM schedule editor type scale', () => {
  const schedule = read('apps/web/src/workflow/ProjectWorkflowSchedule.tsx');
  const css = read('apps/web/src/workflow/ProjectWorkflowSchedule.css');

  assert.match(schedule, /className="schedule-control-panel" aria-label="일정표 보기 및 휴일 설정"/u);
  assert.ok(schedule.indexOf('className="schedule-toolbar"') < schedule.indexOf('className="schedule-holiday-guide"'), '보기 설정과 휴일 안내가 하나의 패널 안에서 순서대로 표시되어야 합니다.');
  assert.match(css, /\.project-schedule-manager > header h3 \{[^}]*font-size:2\.2rem/su);
  assert.match(css, /\.project-pm-control label,[^{]+\{[^}]*font-size:1\.35rem/su);
  assert.match(css, /\.project-stage-editor-list > article > header strong \{[^}]*font-size:1\.6rem/su);
  assert.match(css, /\.stage-schedule-save-button \{[^}]*font-size:1\.52rem!important/su);
  assert.match(css, /@media \(max-width: 1200px\) \{\s*\.project-stage-editor-list \{ grid-template-columns:1fr; \}/su);
});
