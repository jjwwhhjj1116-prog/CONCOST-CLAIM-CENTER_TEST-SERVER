import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');
const workflow = read('apps/web/src/workflow/WorkflowOperations.tsx');
const workflowCss = read('apps/web/src/workflow/WorkflowOperations.css');
const report = read('apps/web/src/routes/PreviewReportStudio.tsx');
const reportCss = read('apps/web/src/routes/PreviewReportStudio.css');

test('CF107 groups the project and editable baseline schedule on all three workflow routes', () => {
  for (const route of ['WF-03', 'WF-04', 'WF-05']) assert.ok(workflow.includes(route));
  const contextStart = workflow.indexOf('className="workflow-project-context"');
  const selector = workflow.indexOf('className="workflow-project-selector"', contextStart);
  const schedule = workflow.indexOf('className="shared-stage-schedule"', selector);
  assert.ok(contextStart > 0 && selector > contextStart && schedule > selector);
  assert.doesNotMatch(workflow, /className="workflow-stepper"|PROJECT DELIVERY · STEP/u);
  assert.match(workflowCss, /\.workflow-project-context \{[^}]*grid-template-columns: minmax\(240px, \.8fr\) minmax\(0, 2fr\)/u);
  assert.match(workflowCss, /@media \(max-width: 980px\)[\s\S]*?\.workflow-project-context \{ grid-template-columns: minmax\(0, 1fr\); \}/u);
  assert.match(workflow, /expectedVersion: scheduleDraft\.version/u);
  assert.match(workflow, /scheduleProject\.canManageSchedule && <Button className="shared-schedule-save-button"/u);
  assert.match(workflow, /onChange=\{\(event\) => selectCase\(event\.target\.value\)\}/u);
});

test('CF107 renames only the allocation member label, not the responsible project PM mapping', () => {
  assert.match(workflow, /산출 및 내역 PM<select value=\{form\.memberName\}/u);
  assert.doesNotMatch(workflow, /실제 투입 담당자/u);
  assert.match(workflow, /담당 PM<\/strong><span>\{scheduleProject\.responsiblePm\?\.name/u);
  assert.match(workflow, /memberName:event\.target\.value/u);
});

test('CF109 fills the existing selector with current project facts without changing schedule actions', () => {
  const selector = workflow.slice(workflow.indexOf('<div className="workflow-project-selector">'), workflow.indexOf('<section className="shared-stage-schedule"'));
  assert.match(selector, /!loading && data\?\.case\.id === selectedCaseId/u);
  assert.match(selector, /<h3>\{data.case.title\}<\/h3>/u);
  assert.match(selector, /data.case.caseNumber/u);
  assert.match(selector, /scheduleProject\?\.caseId === selectedCaseId/u);
  assert.match(selector, /scheduleProject.responsiblePm\?\.name/u);
  assert.match(selector, /projectStatusLabels\[data.case.status\]/u);
  assert.match(selector, /data.case.clientName/u);
  assert.doesNotMatch(selector, /scheduleDraft.status|memberName/u);
  assert.match(selector, /selectCase\(event.target.value\)/u);
  assert.match(workflowCss, /\.workflow-project-summary h3[^}]*overflow-wrap: anywhere/u);
  assert.doesNotMatch(workflowCss, /\.workflow-project-summary[^}]*line-clamp/u);
});

test('CF107 presents report project and template choices together with readiness below', () => {
  const step1 = report.slice(report.indexOf('className="report-step-card report-step-card--1'), report.indexOf('className="report-step-card report-step-card--2'));
  assert.match(step1, /report-project-template-grid/u);
  assert.match(step1, /report-project-choice/u);
  assert.ok(step1.indexOf('label="프로젝트 선택"') < step1.indexOf('id="report-template-preview-type"'));
  assert.ok(step1.indexOf('id="report-template-preview-type"') < step1.indexOf('id="report-source-readiness-title"'));
  assert.match(step1, /id="report-source-readiness-title">참고자료 준비상태</u);
  assert.doesNotMatch(step1, /className="report-template-contract"|유형별 템플릿·프롬프트 관리|AI 참고자료 준비/u);
  assert.match(step1, /aria-label="지금 저장 상태"/u);
  assert.match(step1, /최신본 다시 불러오기/u);
  assert.match(step1, /selectCase\(event\.target\.value\)/u);
  assert.match(step1, /setPreviewTemplateCategoryCode\(event\.target\.value\)/u);
  assert.match(step1, /!authoring\.available && <p className="error-box" role="alert">\{authoring\.unavailableReason/u);
  assert.match(report, /activeStep !== 1 && selectedCase&&<div className="report-current-project/u);
});

test('CF107 preserves admin prompt entry and wizard gating while enlarging step cards', () => {
  assert.match(report, /roles\.includes\('admin'\) && <Button onClick=\{\(\) => onNavigate\('\/ai-config'\)\}>챕터 프롬프트 설정/u);
  assert.match(read('apps/web/src/routes/Router.tsx'), /path: '\/ai-config'[^\n]*allowedRoles: ADMIN_ONLY/u);
  assert.match(report, /const unlocked = stepUnlocked\[step\.id\]/u);
  assert.match(report, /disabled=\{!unlocked\}/u);
  assert.match(reportCss, /\.report-wizard-navigation li button \{[^}]*min-height: 96px/u);
  assert.match(reportCss, /\.report-wizard-navigation li button > b \{[^}]*width: 36px; height: 36px/u);
  assert.match(reportCss, /@media \(max-width: 980px\) \{ \.report-project-template-grid \{ grid-template-columns: minmax\(0, 1fr\)/u);
  assert.match(report, /계약·판례와 현장 근거로 클레임 보고서를 완성합니다\./u);
  assert.match(reportCss, /\.report-stage-header__actions \.document-tool-menus \{[^}]*flex-wrap: wrap; min-width: 0/u);
  assert.match(reportCss, /@media \(max-width: 640px\) \{ \.report-wizard-navigation \{ position: static/u);
  assert.doesNotMatch(report, /템플릿에서 목차를 설계하고/u);
});

test('CF107 browser fixture cannot fall through to live APIs or persist business data', () => {
  const fixture = read('apps/web/qa/cf107-layout.tsx');
  assert.match(fixture, /if \(method !== 'GET'\)/u);
  assert.match(fixture, /실제 저장을 차단한 합성 검수 화면입니다\.' \}, 409/u);
  assert.doesNotMatch(fixture, /originalFetch|nativeFetch|workers\.dev/u);
  assert.match(fixture, /<PreviewReportStudio/u);
  assert.match(fixture, /<WorkflowOperations/u);
});
