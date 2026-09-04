import type { JSONContent } from '@tiptap/core';
const text = (value: string): JSONContent => ({ type: 'text', text: value });
export const chapters = [{ id: 'ch1', chapterCode: 'CH-01', title: '검토결론 요약', agentCode: 'AGENT-01', ordinal: 1, promptVersion: 1 }, { id: 'ch2', chapterCode: 'CH-02', title: '현장조사 결과', agentCode: 'AGENT-03', ordinal: 2, promptVersion: 1 }];
export const reportJson: JSONContent = { type: 'doc', content: [
  { type: 'aiChapterMarker', attrs: { marker: 'AI-CHAPTER:CH-01:START' } },
  { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ ...text('CH-01 '), marks: [{ type: 'bold' }] }, { ...text('검토결론 요약'), marks: [{ type: 'documentTextStyle', attrs: { color: '#c2410c', fontSize: '24px' } }] }] },
  { type: 'paragraph', content: [text('담당자가 수정한 본문: 증액 검토 123,456원. 검토결론 요약이라는 본문 문구도 보존.')] },
  { type: 'table', attrs: { tableWidth: '90', tableAlign: 'center', tableDensity: 'normal' }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [180] }, content: [{ type: 'paragraph', content: [text('검토결론 요약 / 표 안의 값 보존')] }] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [220] }, content: [{ type: 'paragraph', content: [text('123,456원')] }] }] }] },
  { type: 'image', attrs: { src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="240" height="120"%3E%3Crect width="240" height="120" fill="%231b7093"/%3E%3C/svg%3E', alt: '합성 현장 사진', width: 240, height: 120, imageAlign: 'center' } },
  { type: 'aiChapterMarker', attrs: { marker: 'AI-CHAPTER:CH-01:END' } },
  { type: 'aiChapterMarker', attrs: { marker: 'MANUAL-CHAPTER:CH-02:START' } },
  { type: 'heading', attrs: { level: 2 }, content: [text('CH-02 현장조사 결과')] },
  { type: 'paragraph', content: [text('현장조사 원문은 변경하지 않습니다.')] },
  { type: 'aiChapterMarker', attrs: { marker: 'MANUAL-CHAPTER:CH-02:END' } },
  // StarterKit's trailingNode is present in reports already saved from the editor.
  { type: 'paragraph' }
] };
