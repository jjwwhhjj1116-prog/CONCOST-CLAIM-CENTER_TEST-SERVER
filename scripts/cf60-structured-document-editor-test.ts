import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('CF60 provides one shared Tiptap editor for report and proposal authoring', () => {
  const editor = read('apps/web/src/documents/StructuredDocumentEditor.tsx');
  const report = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const webPackage = read('apps/web/package.json');
  for (const marker of ['StarterKit', 'TableKit', 'CharacterCount', 'BubbleMenu', 'NodeSelection', 'toggleFormatting', 'addColumnAfter', 'mergeCells', 'splitCell', 'replaceAll', 'DocumentTextStyle', 'DocumentPresentationAttributes', 'alwaysPreserveAspectRatio', '이미지 너비 비율', '표 너비 비율', '표 너비 ${size}%', '셀 간격', '표 크기 설정', '표 삭제', '이미지 ↑', '이미지 ↓', '이미지 삭제', '전체화면', '미리보기', '선택 문장 빠른 작업', '✦ Gemini 개선', '돋움', '굴림', '바탕', '궁서', 'Noto Serif KR', '나눔스퀘어', '선택 글자 색상', '글자 색상 기본값', 'normalizeTextColor', 'data-label="글자"', 'data-label="표"']) {
    assert.ok(editor.includes(marker), `missing structured editor feature: ${marker}`);
  }
  assert.match(editor, /\(\?:AI\|MANUAL\)-CHAPTER/u);
  assert.match(editor, /getSelection/u);
  assert.match(editor, /replaceRange/u);
  assert.match(editor, /dismissSelectionMenu/u);
  assert.match(editor, /imageSelected/u);
  assert.match(editor, /data-image-align/u);
  assert.match(editor, /data-table-width/u);
  assert.match(editor, /data-table-density/u);
  assert.match(editor, /const initialContent = collaborationSession \? undefined : editorJson \? \(pageMode === 'a4-portrait' \? normalizeA4TableJson\(editorJson\) : editorJson\) : markdownToEditorHtml\(value\)/u);
  assert.match(report, /StructuredDocumentEditor/u);
  assert.match(report, /editorJson/u);
  assert.match(report, /report-step3-[\s\S]*?selectionAssistant/u);
  assert.match(report, /report-step4-[\s\S]*?selectionAssistant/u);
  assert.match(proposal, /StructuredDocumentEditor/u);
  assert.match(editor, /AI 문장 개선/u);
  assert.match(proposal, /selectionAssistant/u);
  assert.match(proposal, /repairLegacyProposalChapterMixup/u);
  assert.match(proposal, /variablesWereDuplicated/u);
  assert.match(proposal, /<ProposalManualDraft/u);
  assert.match(proposal, /onChange=\{\(number,body,editorJson\)=>/u);
  assert.match(proposal, /renderProposalBodyHtml/u);
  assert.match(proposal, /deduplicateProposalImages/u);
  assert.match(proposal, /dangerouslySetInnerHTML/u);
  assert.match(proposal, /renderStructuredDocumentHtml/u);
  assert.match(proposal, /editorJson=\{item\.editorJson\}/u);
  assert.match(proposal, /ADD_ATTR:\['data-document-spacer','data-document-page-break','data-image-align','data-table-width','data-table-align','data-table-density'/u);
  assert.match(proposal, /<StructuredDocumentEditor key=\{`proposal-\$\{activeProposal\.id\}-\$\{chapter\.number\}`\}/u);
  assert.match(webPackage, /"@tiptap\/react"/u);
  assert.match(webPackage, /"turndown-plugin-gfm"/u);
  assert.doesNotMatch(editor, /data-label="문단"/u);
  assert.doesNotMatch(editor, /data-label="목록"/u);
});

test('CF60 persists structured report JSON and protects proposal AI improvement with D1 versions', () => {
  const worker = read('apps/cloudflare/src/index.ts');
  const migration = read('apps/cloudflare/migrations/0043_cf60_structured_document_editor.sql');
  assert.match(migration, /ALTER TABLE preview_report_drafts ADD COLUMN editor_json TEXT/u);
  assert.match(migration, /ALTER TABLE preview_report_revisions ADD COLUMN editor_json TEXT/u);
  assert.match(worker, /editorJson/u);
  assert.match(worker, /2_000_000/u);
  assert.match(worker, /\/api\/proposal-studio\/improve/u);
  assert.match(worker, /expectedProposalVersion/u);
  assert.match(worker, /PROPOSAL_NOT_EDITABLE/u);
  assert.match(worker, /VERSION_CONFLICT/u);
  assert.match(worker, /원문의 사실·숫자·날짜·인명·회사명·현장명·계약명·영문 약어·근거를 단 하나도 추가/u);
  assert.match(worker, /proposalImprovementPreservesSource/u);
  assert.match(worker, /PROPOSAL_IMPROVEMENT_SOURCE_DRIFT/u);
});

test('CF60 keeps the collaboration bridge disabled until the private server runtime URL is injected', () => {
  const editor = read('apps/web/src/documents/StructuredDocumentEditor.tsx');
  assert.match(editor, /__CLAIM_CENTER_COLLABORATION_URL__/u);
  assert.match(editor, /if \(collaboration && collaborationUrl\)/u);
  assert.match(editor, /자동 저장 호환 편집기/u);
});

test('CF60 exposes an honest admin status and preserves the future server handoff contract', () => {
  const settings = read('apps/web/src/routes/PreviewSettings.tsx');
  const runbook = read('docs/runbooks/document-authoring-platform.md');
  for (const marker of ['문서 제작 플랫폼 연결 상태', 'Tiptap 구조화 편집기', 'D1 문서 원본 저장', 'HWP/HWPX · DOCX · PDF', 'Gotenberg PDF 변환', 'Yjs · Hocuspocus 협업', 'Mem0 · LangGraph Memory']) {
    assert.ok(settings.includes(marker), `missing admin platform status: ${marker}`);
  }
  assert.match(settings, /준비 중인 기능을 작동하는 것처럼 표시하지 않습니다/u);
  assert.match(runbook, /Tiptap JSON을 문서의 정본으로 유지/u);
  assert.match(runbook, /Bridge 장애가 문서 편집·D1 저장을 막아서는 안 됩니다/u);
  assert.match(runbook, /organizationId:caseId:documentKind:documentId/u);
});
