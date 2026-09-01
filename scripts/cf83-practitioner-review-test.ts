import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { generateProposalDocx, generateProposalPdf, type ProposalExportDocument } from '../apps/cloudflare/src/proposal-docx.js';
import { meetingMinutesWorkbook } from '../apps/web/src/proposals/proposal-excel.js';

const read = (path: string): string => readFileSync(path, 'utf8');

test('CF83 project lists, evidence, and authoring screens follow the practitioner access contract', () => {
  const worker = read('apps/cloudflare/src/index.ts');
  const evidence = read('apps/web/src/evidence/CaseEvidencePanel.tsx');
  const select = read('packages/ui/src/components/Select.tsx');
  const workflow = read('apps/web/src/workflow/WorkflowOperations.tsx');
  const report = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const migration = read('apps/cloudflare/migrations/0053_cf83_practitioner_review.sql');

  assert.match(worker, /assignedOnly = url\.searchParams\.get\('assignedOnly'\) === 'true'/u);
  assert.match(worker, /const visibility = assignedOnly[\s\S]*?: '1 = 1'/u);
  assert.match(worker, /organizationPreviewCase\(env, caseId\)/u);
  assert.match(worker, /accessMode:\s*'STUDIO_SESSION_PROXY'/u);
  assert.doesNotMatch(worker, /googleFileId: row\.googleFileId/u);
  assert.match(evidence, /스튜디오 권한으로 다운로드/u);
  assert.doesNotMatch(evidence, /drive\.google\.com/u);
  assert.match(evidence, /upload\(event\.dataTransfer\.files, value\)/u);

  assert.match(select, /searchable\?: boolean/u);
  assert.match(select, /searchPlaceholder\?: string/u);
  assert.match(workflow, /stage=SITE_SURVEY/u);
  assert.match(worker, /requestedStage/u);
  assert.match(worker, /preview_project_stage_schedules stage_filter/u);
  assert.match(report, /dirty \|\| outlineDirty \|\| workspaceDirty/u);
  assert.match(migration, /ADD COLUMN client_name TEXT/u);
});

test('CF83 proposal review re-entry and project-specific printing remain available', () => {
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const schedule = read('apps/web/src/workflow/ProjectWorkflowSchedule.tsx');
  const print = read('apps/web/src/workflow/ProjectSchedulePrint.tsx');
  const claimTypes = read('apps/web/src/claim-types.ts');

  assert.doesNotMatch(proposal, /canResumeReviewerEdits/u);
  assert.match(proposal, /target>=3&&\(!firstThreeComplete\|\|dirty\)/u);
  assert.match(proposal, /작성 기준/u);
  assert.match(proposal, /실명 제출이 원칙/u);
  assert.match(proposal, /apiDownloadPost/u);
  assert.match(schedule, /이 프로젝트 상세 일정 출력/u);
  assert.match(print, /projectId/u);
  assert.match(print, /WORKFLOW_STAGES/u);
  assert.match(claimTypes, /TYPE-01/u);
  assert.match(claimTypes, /현장조사 및 수량산출 클레임/u);
});

test('CF83 approved proposal DOCX and PDF use editable A4 landscape output', () => {
  const document: ProposalExportDocument = {
    proposalId: 'proposal-cf83', versionId: 'version-cf83', versionNumber: 3,
    projectTitle: '실무자 검토 반영 제안서', clientName: '컨코스트 발주처', subtitle: '확정 출력 검수',
    submissionDate: '2026-09-01', caseNumber: 'CC-2026-00083', claimType: 'TYPE-03',
    preparedBy: '담당 PM', contentSha256: '8'.repeat(64),
    chapters: [{ number: 1, title: '제안 목적', body: '확인된 프로젝트 자료를 근거로 작성한 편집 가능한 본문입니다.' }]
  };
  const docxText = new TextDecoder().decode(generateProposalDocx(document));
  const pdfText = new TextDecoder().decode(generateProposalPdf(document));
  assert.match(docxText, /w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/u);
  assert.match(docxText, /편집 가능한 본문/u);
  assert.match(pdfText, /\/MediaBox \[0 0 842 595\]/u);
  assert.doesNotMatch(pdfText, /\/MediaBox \[0 0 595 842\]/u);
});

test('CF83 reviewed meeting minutes download as the company-form XLSX instead of plain text', () => {
  const bytes = meetingMinutesWorkbook({ author:'담당 PM', meetingDate:'2026. 09. 01', meetingTime:'10:00', location:'본사 회의실', participants:'담당 PM, 기술팀', meetingTitle:'착수회의', attachmentName:'회의자료.pdf', summary:'업무범위와 제출일정을 확정했습니다.', followUps:'1. 현장자료 목록 확인' });
  const packageText = new TextDecoder().decode(bytes);
  assert.match(packageText, /회 의 록/u);
  assert.match(packageText, /회의내용 및 지시사항/u);
  assert.match(packageText, /orientation="landscape"/u);
  const workflow = read('apps/web/src/workflow/WorkflowOperations.tsx');
  assert.match(workflow, /현재 회의록 XLSX 내려받기/u);
});
