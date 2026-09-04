import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renameStructuredReportTitles } from '../apps/web/src/reports/report-outline-sync';
import { reportJson } from './fixtures/cf108-report';
import type { JSONContent } from '@tiptap/core';
const change = { chapterCode: 'CH-01', previousTitle: '검토결론 요약', title: '검수한 결론 및 권고' };
const text = (node: JSONContent): string => node.text ?? node.content?.map(text).join('') ?? '';

test('CF108 changes only the matched heading and preserves reviewed body, table, image and markers', () => {
  const original = JSON.stringify(reportJson);
  const result = renameStructuredReportTitles(reportJson, [change]);
  assert.deepEqual(result.matched, ['CH-01']);
  assert.deepEqual(result.unmatched, []);
  assert.equal(text(result.document.content![1]), 'CH-01 검수한 결론 및 권고');
  assert.equal(JSON.stringify(reportJson), original);
  result.document.content!.forEach((node, i) => { if (i !== 1) assert.deepEqual(node, reportJson.content![i]); });
  assert.deepEqual(result.document.content![1].attrs, reportJson.content![1].attrs);
  assert.deepEqual(result.document.content![1].content![0], reportJson.content![1].content![0]);
  assert.deepEqual(result.document.content![1].content![1].marks, reportJson.content![1].content![1].marks);
});
test('CF108 preserves exact imported title formatting but skips duplicates, paragraphs and table headings', () => {
  const heading = (value: string): JSONContent => ({ type: 'heading', attrs: { level: 1, textAlign: 'right' }, content: [{ type: 'text', text: value, marks: [{ type: 'italic' }] }] });
  const document: JSONContent = { type: 'doc', content: [heading(change.previousTitle), { type: 'paragraph', content: [{ type: 'text', text: change.previousTitle }] }, { type: 'table', content: [heading(change.previousTitle)] }] };
  const result = renameStructuredReportTitles(document, [change]);
  assert.equal(text(result.document.content![0]), change.title);
  assert.deepEqual(result.document.content!.slice(1), document.content!.slice(1));
  document.content!.push(heading(change.previousTitle));
  const ambiguous = renameStructuredReportTitles(document, [change]);
  assert.deepEqual(ambiguous.document, document);
  assert.deepEqual(ambiguous.unmatched, ['CH-01']);
});
test('CF108 does not confuse chapter prefixes and safely handles literal title text and title swaps', () => {
  const document: JSONContent = { type: 'doc', content: ['CH-010 longer code', 'CH-01 old', 'CH-02 second'].map(value => ({ type: 'heading', content: [{ type: 'text', text: value }] })) };
  const result = renameStructuredReportTitles(document, [change, { chapterCode: 'CH-02', previousTitle: 'second', title: '<script>& **literal**' }]);
  assert.equal(text(result.document.content![0]), 'CH-010 longer code');
  assert.equal(text(result.document.content![2]), 'CH-02 <script>& **literal**');
  const swap = renameStructuredReportTitles({ type: 'doc', content: ['first', 'second'].map(value => ({ type: 'heading', content: [{ type: 'text', text: value }] })) }, [{ chapterCode: 'A', previousTitle: 'first', title: 'second' }, { chapterCode: 'B', previousTitle: 'second', title: 'first' }]);
  assert.deepEqual(swap.document.content!.map(text), ['second', 'first']);
});
test('CF108 saves current document and version refs, locks concurrent saves and retains partial failure retry', () => {
  const source = readFileSync('apps/web/src/routes/PreviewReportStudio.tsx', 'utf8');
  for (const ref of ['titleRef.current', 'contentRef.current', 'editorJsonRef.current', 'versionRef.current', 'activeStepRef.current', 'selectedChapterRef.current']) assert.ok(source.includes(ref));
  assert.match(source, /draftSaveInFlight.current = true/u);
  assert.match(source, /saveNow\('MANUAL', true\)/u);
  assert.match(source, /본문 제목 저장 다시 시도/u);
  assert.match(source, /!outlineSyncPending && !savingOutline/u);
  assert.match(source, /!rendered.trim\(\)/u);
  assert.match(source, /목차·본문 제목 저장/u);
  assert.match(source, /readOnly=\{!editable \|\| savingOutline\}/u);
  const worker = readFileSync('apps/cloudflare/src/index.ts', 'utf8');
  assert.match(worker, /const chapterTitle = outline.items.find/u);
  assert.match(worker, /replacePreviewReportChapter\(report.content, current.chapterCode, chapterTitle, draftText\)/u);
});
