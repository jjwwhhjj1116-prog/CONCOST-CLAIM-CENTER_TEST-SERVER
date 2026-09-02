import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { structuredDocumentContentSignature } from '../apps/web/src/documents/structured-document-sync';

const read = (path: string) => readFileSync(path, 'utf8');

test('CF66 resynchronizes the editor when only the structured JSON source changes', () => {
  const markdown = '전문가 현황\n\n![전문가](/api/proposal-studio/assets/CH04_EXPERT_PROFILE?v=3)';
  const staleJson = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '전문가 현황' }] }] };
  assert.notEqual(
    structuredDocumentContentSignature(markdown, staleJson),
    structuredDocumentContentSignature(markdown, null),
    '같은 Markdown이라도 editorJson이 폐기되면 외부 콘텐츠 동기화가 다시 실행되어야 합니다.',
  );

  const editor = read('apps/web/src/documents/StructuredDocumentEditor.tsx');
  assert.match(editor, /lastAppliedContentSignature/u);
  assert.match(editor, /structuredDocumentContentSignature\(value, editorJson\)/u);
  assert.match(editor, /desiredSignature === lastAppliedContentSignature\.current/u);
  assert.doesNotMatch(editor, /value === lastEmitted\.current/u);
});

test('CF66 final preview renders the exact reviewed chapter snapshot without live asset hydration', () => {
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const finalPreview = proposal.slice(
    proposal.indexOf('function ProposalFinalChapterPage'),
    proposal.indexOf('export const ProposalView'),
  );
  assert.match(finalPreview, /<ProposalRichContent body=\{item\.body\} editorJson=\{item\.editorJson\}\/>/u);
  assert.doesNotMatch(finalPreview, /assets=\{/u);
  assert.match(proposal, /hydrateCompanyAssets\?proposalChapterWithCompanyImages/u);
  assert.match(proposal, /deduplicateProposalImages\(source\)/u);
});
