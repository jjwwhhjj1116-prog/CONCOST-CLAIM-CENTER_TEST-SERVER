import type { JSONContent } from '@tiptap/core';
import { marked, type Tokens } from 'marked';

export interface ReportTitleChange { chapterCode: string; previousTitle: string; title: string }
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const plain = (node: JSONContent): string => node.text ?? node.content?.map(plain).join('') ?? '';

function replacement(text: string, change: ReportTitleChange): string | null {
  const prefix = text.match(new RegExp(`^(\\s*${escapePattern(change.chapterCode)}(?:[\\s.:·–—-]+|$))`, 'iu'))?.[0];
  if (prefix !== undefined) return `${prefix.trimEnd()}${/\s$/u.test(prefix) || prefix === change.chapterCode ? ' ' : ''}${change.title}`;
  // Whole-document imports may omit chapter codes. Only unique exact titles qualify.
  return text.trim() === change.previousTitle.trim() ? change.title : null;
}

// Keep unchanged text runs/marks around the actual edit (e.g. a separately styled CH-01).
function replaceRuns(runs: string[], next: string): string[] {
  const previous = runs.join('');
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let end = previous.length, nextEnd = next.length;
  while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
  let offset = 0, inserted = false;
  return runs.map((run, index) => {
    const limit = offset + run.length;
    let value = run.slice(0, Math.max(0, Math.min(run.length, start - offset)));
    if (!inserted && (start < limit || index === runs.length - 1)) { value += next.slice(start, nextEnd); inserted = true; }
    value += run.slice(Math.max(0, Math.min(run.length, end - offset)));
    offset = limit;
    return value;
  });
}

export function renameStructuredReportTitles(document: JSONContent, changes: ReportTitleChange[]): { document: JSONContent; matched: string[]; unmatched: string[] } {
  const next = structuredClone(document);
  const headings: JSONContent[] = [];
  const visit = (node: JSONContent) => {
    if (['table', 'codeBlock'].includes(node.type ?? '')) return;
    if (node.type === 'heading') headings.push(node);
    else node.content?.forEach(visit);
  };
  visit(next);
  const matches = changes.map(change => ({ change, candidates: headings.filter(node => replacement(plain(node), change) !== null) }));
  const matched: string[] = [];
  for (const { change, candidates } of matches) {
    if (candidates.length !== 1 || matches.some(other => other.change !== change && other.candidates.includes(candidates[0]))) continue;
    const heading = candidates[0];
    const textNodes: JSONContent[] = [];
    const texts = (node: JSONContent) => { if (node.type === 'text') textNodes.push(node); else node.content?.forEach(texts); };
    texts(heading);
    if (!textNodes.length) continue;
    const runs = replaceRuns(textNodes.map(node => node.text ?? ''), replacement(plain(heading), change)!);
    textNodes.forEach((node, index) => { node.text = runs[index]; });
    const clean = (node: JSONContent) => { if (node.content) node.content = node.content.filter(child => child.type !== 'text' || child.text).map(child => { clean(child); return child; }); };
    clean(heading);
    matched.push(change.chapterCode);
  }
  return { document: next, matched, unmatched: changes.filter(change => !matched.includes(change.chapterCode)).map(change => change.chapterCode) };
}

/** Only serialize the heading-containing token; all other Markdown/HTML stays byte-for-byte intact. */
export function renameUnstructuredReportTitles(content: string, changes: ReportTitleChange[]): { content: string; matched: string[]; unmatched: string[] } {
  if (!changes.length) return { content, matched: [], unmatched: [] };
  const tokens = marked.lexer(content, { gfm: true });
  // Marked normalizes line endings. Map token boundaries back to the original text,
  // so only edited heading tokens are serialized, not unrelated imported content.
  const offsets: number[] = [];
  let normalized = '';
  for (let i = 0; i < content.length; i++) {
    offsets.push(i);
    if (content[i] === '\r') { normalized += '\n'; if (content[i + 1] === '\n') i++; }
    else normalized += content[i];
  }
  offsets.push(content.length);
  if (tokens.map(token => token.raw).join('') !== normalized) return { content, matched: [], unmatched: changes.map(change => change.chapterCode) };
  const entries: { index: number; root: HTMLElement; heading: HTMLElement; markdown: boolean }[] = [];
  tokens.forEach((token, index) => {
    if (token.type !== 'heading' && token.type !== 'html') return;
    const html = token.type === 'heading' ? marked.parser(Object.assign([token], { links: tokens.links })) : token.raw;
    const root = new DOMParser().parseFromString(html, 'text/html').body;
    root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach(heading => {
      if (!heading.closest('table,pre,code,script,style')) entries.push({ index, root, heading, markdown: token.type === 'heading' });
    });
  });
  const matches = changes.map(change => ({ change, candidates: entries.filter(entry => replacement(entry.heading.textContent ?? '', change) !== null) }));
  const changed = new Map<number, string>();
  const matched: string[] = [];
  for (const { change, candidates } of matches) {
    if (candidates.length !== 1 || matches.some(other => other.change !== change && other.candidates.includes(candidates[0]))) continue;
    const entry = candidates[0];
    const walker = entry.root.ownerDocument.createTreeWalker(entry.heading, 4 /* SHOW_TEXT */);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    if (!texts.length) continue;
    const nextText = replacement(entry.heading.textContent ?? '', change)!;
    const runs = replaceRuns(texts.map(node => node.data), nextText);
    texts.forEach((node, index) => { node.data = runs[index]; });
    const token = tokens[entry.index];
    // Preserve ordinary Markdown headings as Markdown; rich headings retain their inline HTML styles.
    const simple = entry.markdown && entry.heading.children.length === 0;
    const raw = simple ? `${'#'.repeat((token as Tokens.Heading).depth)} ${nextText.replace(/&/gu, '&amp;').replace(/([\\`*_[\]<>])/gu, '\\$1')}\n` : entry.root.innerHTML;
    changed.set(entry.index, raw + (token.raw.endsWith('\n\n') ? '\n' : ''));
    matched.push(change.chapterCode);
  }
  let position = 0;
  const next = tokens.map((token, index) => {
    const original = content.slice(offsets[position], offsets[position + token.raw.length]);
    position += token.raw.length;
    const replacement = changed.get(index);
    return replacement === undefined ? original : original.includes('\r\n') ? replacement.replace(/\n/gu, '\r\n') : replacement;
  }).join('');
  return { content: matched.length ? next : content, matched, unmatched: changes.filter(change => !matched.includes(change.chapterCode)).map(change => change.chapterCode) };
}
