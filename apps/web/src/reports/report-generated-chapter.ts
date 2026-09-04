import type { JSONContent } from '@tiptap/core';

/** Replace just the requested chapter, retaining all unrelated structured nodes. */
export function mergeGeneratedChapter(document: JSONContent, chapterCode: string, generated: JSONContent): JSONContent {
  const nodes = document.content ?? [];
  const marker = (node: JSONContent, edge: string) => node.type === 'aiChapterMarker' && ['AI', 'MANUAL'].some(kind => node.attrs?.marker === `${kind}-CHAPTER:${chapterCode}:${edge}`);
  const collectMarkers = (items: JSONContent[]): JSONContent[] => items.flatMap(node => [...(node.type === 'aiChapterMarker' ? [node] : []), ...collectMarkers(node.content ?? [])]);
  const generatedMarkers = collectMarkers(generated.content ?? []);
  if (generatedMarkers.length !== 2 || !marker(generatedMarkers[0], 'START') || !marker(generatedMarkers[1], 'END')) throw new Error('AI 응답에 잘못된 챕터 구분이 포함돼 반영하지 않았습니다. 다시 작성해 주세요.');
  const start = nodes.findIndex(node => marker(node, 'START'));
  if (start < 0) {
    if (nodes.some(node => marker(node, 'END'))) throw new Error('챕터 시작 표시가 누락됐습니다. 본문 구분을 확인해 주세요.');
    const nextChapter = nodes.findIndex(node => node.type === 'aiChapterMarker' && /^(?:AI|MANUAL)-CHAPTER:CH-\d+:START$/u.test(node.attrs?.marker ?? '') && String(node.attrs?.marker).split(':')[1].localeCompare(chapterCode, undefined, { numeric: true }) > 0);
    const at = nextChapter < 0 ? nodes.length : nextChapter;
    return { ...document, content: [...nodes.slice(0, at), ...(generated.content ?? []), ...nodes.slice(at)] };
  }
  const end = nodes.findIndex((node, index) => index > start && marker(node, 'END'));
  if (end < 0 || nodes.filter(node => marker(node, 'START')).length !== 1 || nodes.filter(node => marker(node, 'END')).length !== 1 || nodes.slice(start + 1, end).some(node => node.type === 'aiChapterMarker')) throw new Error('챕터 구분이 중복되거나 잘못되었습니다. 현재 본문을 보존했습니다. 목차와 본문 구분을 확인해 주세요.');
  return { ...document, content: [...nodes.slice(0, start), ...(generated.content ?? []), ...nodes.slice(end + 1)] };
}
