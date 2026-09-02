import { HocuspocusProvider, WebSocketStatus, type StatesArray } from '@hocuspocus/provider';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import CharacterCount from '@tiptap/extension-character-count';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit, TableView } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { Extension, Mark, Node, generateHTML, mergeAttributes, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { selectedRect } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import * as Y from 'yjs';
import { structuredDocumentContentSignature } from './structured-document-sync';

export interface StructuredSelection {
  from: number;
  to: number;
  text: string;
}

export type StructuredSelectionImprovementMode = 'professional' | 'concise' | 'custom';

export interface StructuredSelectionAssistant {
  busy?: boolean;
  disabled?: boolean;
  onImprove: (mode: StructuredSelectionImprovementMode, selection: StructuredSelection) => void;
}

export interface StructuredDocumentEditorHandle {
  focus: () => void;
  getJSON: () => JSONContent | null;
  getMarkdown: () => string;
  getSelection: () => StructuredSelection | null;
  replaceRange: (from: number, to: number, replacement: string, expectedText?: string) => boolean;
  insertTable: (rows?: number, columns?: number) => void;
  insertImage: (image: { src: string; alt: string; title?: string }) => void;
  deleteSelectedTable: () => boolean;
  deleteSelectedImage: () => { deleted: boolean; src?: string };
  moveSelectedImage: (direction: 'up' | 'down') => boolean;
  dismissSelectionMenu: () => void;
}

interface StructuredDocumentEditorProps {
  value: string;
  editorJson?: JSONContent | null;
  label: string;
  placeholder?: string;
  readOnly?: boolean;
  compact?: boolean;
  pageMode?: 'standard' | 'a4-portrait';
  documentKey?: string;
  collaboration?: {
    documentId: string;
    userName: string;
    userEmail?: string;
  };
  selectionAssistant?: StructuredSelectionAssistant;
  onRequestInsertTable?: () => void;
  onChange: (markdown: string, editorJson: JSONContent) => void;
  onSelectionChange?: (selection: StructuredSelection | null) => void;
}

interface CollaborationSession {
  document: Y.Doc;
  provider: HocuspocusProvider;
  user: { name: string; color: string; email?: string };
}

interface StructuredDocumentEditorCoreProps extends StructuredDocumentEditorProps {
  collaborationSession?: CollaborationSession | null;
  collaborationStatus?: WebSocketStatus;
  collaborationSynced?: boolean;
  collaborationUsers?: Array<{ clientId: number; name: string; color: string }>;
  collaborationError?: string;
}

const AiChapterMarker = Node.create({
  name: 'aiChapterMarker',
  group: 'block',
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      marker: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-ai-chapter-marker') ?? '',
        renderHTML: (attributes) => ({ 'data-ai-chapter-marker': attributes.marker })
      }
    };
  },
  parseHTML() { return [{ tag: 'div[data-ai-chapter-marker]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { class: 'structured-editor__marker' })]; }
});

const FONT_FAMILIES = [
  { value: '', label: '기본 글꼴', group: '기본' },
  { value: 'Pretendard', label: '프리텐다드', group: '한글 기본·시스템' },
  { value: 'Malgun Gothic', label: '맑은 고딕', group: '한글 기본·시스템' },
  { value: 'Dotum', label: '돋움', group: '한글 기본·시스템' },
  { value: 'Gulim', label: '굴림', group: '한글 기본·시스템' },
  { value: 'Batang', label: '바탕', group: '한글 기본·시스템' },
  { value: 'Gungsuh', label: '궁서', group: '한글 기본·시스템' },
  { value: 'Noto Sans KR', label: 'Noto Sans KR', group: '무료 한글 글꼴' },
  { value: 'Noto Serif KR', label: 'Noto Serif KR', group: '무료 한글 글꼴' },
  { value: 'Nanum Gothic', label: '나눔고딕', group: '무료 한글 글꼴' },
  { value: 'Nanum Myeongjo', label: '나눔명조', group: '무료 한글 글꼴' },
  { value: 'NanumSquare', label: '나눔스퀘어', group: '무료 한글 글꼴' },
  { value: 'Gowun Dodum', label: '고운돋움', group: '무료 한글 글꼴' },
  { value: 'Arial', label: 'Arial', group: '영문 글꼴' },
  { value: 'Times New Roman', label: 'Times New Roman', group: '영문 글꼴' }
] as const;
const FONT_SIZES = ['', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32'] as const;
const DEFAULT_TEXT_COLOR = '#17253a';
const IMAGE_ALIGNMENTS = new Set(['left', 'center', 'right']);
const TABLE_DENSITIES = new Set(['compact', 'normal', 'comfortable']);
const CELL_VERTICAL_ALIGNMENTS = new Set(['top', 'middle', 'bottom']);
const CELL_HORIZONTAL_ALIGNMENTS = new Set(['left', 'center', 'right']);
const clampMeasurement = (value: unknown, minimum: number, maximum: number, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed * 10) / 10)) : fallback;
};

const normalizeFontFamily = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/["']/gu, '').trim().toLocaleLowerCase('en-US');
  return FONT_FAMILIES.find((font) => font.value.toLocaleLowerCase('en-US') === normalized)?.value || null;
};

const normalizeFontSize = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').replace(/px$/iu, ''));
  return Number.isFinite(parsed) && parsed >= 8 && parsed <= 72 ? Math.round(parsed) : null;
};

const normalizeTextColor = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLocaleLowerCase('en-US');
  if (/^#[0-9a-f]{6}$/u.test(normalized)) return normalized;
  const shortHex = normalized.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/u);
  return shortHex ? `#${shortHex[1]}${shortHex[1]}${shortHex[2]}${shortHex[2]}${shortHex[3]}${shortHex[3]}` : null;
};

const DocumentTextStyle = Mark.create({
  name: 'documentTextStyle',
  addAttributes() {
    return {
      fontFamily: { default: null, parseHTML: (element) => normalizeFontFamily(element.style.fontFamily) },
      fontSize: { default: null, parseHTML: (element) => normalizeFontSize(element.style.fontSize) },
      color: { default: null, parseHTML: (element) => normalizeTextColor(element.style.color) }
    };
  },
  parseHTML() {
    return [{
      tag: 'span',
      getAttrs: (node) => {
        if (!(node instanceof HTMLElement)) return false;
        const fontFamily = normalizeFontFamily(node.style.fontFamily);
        const fontSize = normalizeFontSize(node.style.fontSize);
        const color = normalizeTextColor(node.style.color);
        return fontFamily || fontSize || color ? { fontFamily, fontSize, color } : false;
      }
    }];
  },
  renderHTML({ HTMLAttributes }) {
    const fontFamily = normalizeFontFamily(HTMLAttributes.fontFamily);
    const fontSize = normalizeFontSize(HTMLAttributes.fontSize);
    const color = normalizeTextColor(HTMLAttributes.color);
    const style = [fontFamily ? `font-family:${fontFamily}` : '', fontSize ? `font-size:${fontSize}px` : '', color ? `color:${color}` : ''].filter(Boolean).join(';');
    return ['span', style ? { style } : {}, 0];
  }
});

const DocumentPresentationAttributes = Extension.create({
  name: 'documentPresentationAttributes',
  addGlobalAttributes() {
    return [
      {
        types: ['image'],
        attributes: {
          alignment: {
            default: 'center',
            parseHTML: (element) => IMAGE_ALIGNMENTS.has(element.getAttribute('data-image-align') ?? '') ? element.getAttribute('data-image-align') : 'center',
            renderHTML: (attributes) => ({ 'data-image-align': IMAGE_ALIGNMENTS.has(attributes.alignment) ? attributes.alignment : 'center' })
          }
        }
      },
      {
        types: ['table'],
        attributes: {
          documentDefaultsVersion: {
            default: 2,
            parseHTML: (element) => Number(element.getAttribute('data-document-defaults-version')) || 1,
            renderHTML: (attributes) => ({ 'data-document-defaults-version': String(Number(attributes.documentDefaultsVersion) || 2) })
          },
          tableWidth: {
            default: 100,
            parseHTML: (element) => Math.min(100, Math.max(35, Number(element.getAttribute('data-table-width')) || Number.parseFloat(element.style.width) || 100)),
            renderHTML: (attributes) => ({ 'data-table-width': String(Math.min(100, Math.max(35, Number(attributes.tableWidth) || 100))) })
          },
          tableAlignment: {
            default: 'center',
            parseHTML: (element) => IMAGE_ALIGNMENTS.has(element.getAttribute('data-table-align') ?? '') ? element.getAttribute('data-table-align') : 'center',
            renderHTML: (attributes) => ({ 'data-table-align': IMAGE_ALIGNMENTS.has(attributes.tableAlignment) ? attributes.tableAlignment : 'center' })
          },
          tableDensity: {
            default: 'normal',
            parseHTML: (element) => TABLE_DENSITIES.has(element.getAttribute('data-table-density') ?? '') ? element.getAttribute('data-table-density') : 'normal',
            renderHTML: (attributes) => ({ 'data-table-density': TABLE_DENSITIES.has(attributes.tableDensity) ? attributes.tableDensity : 'normal' })
          }
        }
      },
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          verticalAlignment: {
            default: 'middle',
            parseHTML: (element) => CELL_VERTICAL_ALIGNMENTS.has(element.getAttribute('data-cell-vertical-align') ?? '') ? element.getAttribute('data-cell-vertical-align') : 'middle',
            renderHTML: (attributes) => ({ 'data-cell-vertical-align': CELL_VERTICAL_ALIGNMENTS.has(attributes.verticalAlignment) ? attributes.verticalAlignment : 'middle' })
          },
          horizontalAlignment: {
            default: 'center',
            parseHTML: (element) => CELL_HORIZONTAL_ALIGNMENTS.has(element.getAttribute('data-cell-horizontal-align') ?? '') ? element.getAttribute('data-cell-horizontal-align') : 'center',
            renderHTML: (attributes) => ({ 'data-cell-horizontal-align': CELL_HORIZONTAL_ALIGNMENTS.has(attributes.horizontalAlignment) ? attributes.horizontalAlignment : 'center' })
          }
        }
      },
      {
        types: ['tableRow'],
        attributes: {
          rowHeightMm: {
            default: null,
            parseHTML: (element) => {
              const raw = element.getAttribute('data-row-height-mm') ?? element.style.height.replace(/mm$/iu, '');
              const parsed = Number(raw);
              return Number.isFinite(parsed) ? clampMeasurement(parsed, 6, 100, 12) : null;
            },
            renderHTML: (attributes) => {
              if (attributes.rowHeightMm === null || attributes.rowHeightMm === undefined) return {};
              const height = clampMeasurement(attributes.rowHeightMm, 6, 100, 12);
              return { 'data-row-height-mm': String(height), style: `height:${height}mm` };
            }
          }
        }
      }
    ];
  }
});

class DocumentTableView extends TableView {
  constructor(node: ProseMirrorNode, cellMinWidth: number, view: EditorView, HTMLAttributes?: Record<string, unknown>) {
    super(node, cellMinWidth, view, HTMLAttributes);
    this.applyPresentation(node);
  }

  update(node: ProseMirrorNode): boolean {
    const updated = super.update(node);
    if (updated) this.applyPresentation(node);
    return updated;
  }

  private applyPresentation(node: ProseMirrorNode): void {
    const width = Math.min(100, Math.max(35, Number(node.attrs.tableWidth) || 100));
    const alignment = IMAGE_ALIGNMENTS.has(node.attrs.tableAlignment) ? node.attrs.tableAlignment : 'center';
    const density = TABLE_DENSITIES.has(node.attrs.tableDensity) ? node.attrs.tableDensity : 'normal';
    this.table.dataset.tableWidth = String(width);
    this.table.dataset.tableAlign = alignment;
    this.table.dataset.tableDensity = density;
    this.table.style.width = `${width}%`;
    this.table.style.minWidth = '0';
    this.table.style.maxWidth = '100%';
    this.table.style.tableLayout = 'fixed';
    const columns = [...this.table.querySelectorAll<HTMLTableColElement>('colgroup > col')];
    if (columns.length) {
      const storedWidths = columns.map((column) => Number.parseFloat(column.style.width || column.getAttribute('width') || '0'));
      const total = storedWidths.reduce((sum, columnWidth) => sum + (Number.isFinite(columnWidth) && columnWidth > 0 ? columnWidth : 0), 0);
      columns.forEach((column, index) => {
        const proportional = total > 0 ? Math.max(0, storedWidths[index]) / total * 100 : 100 / columns.length;
        column.style.width = `${Math.max(1, proportional).toFixed(4)}%`;
        column.removeAttribute('width');
      });
    }
  }
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const markerPattern = /<!--\s*((?:(?:AI|MANUAL)-CHAPTER:[^:]+:(?:START|END)|MANUAL-WHOLE-DOCUMENT:(?:START|END)))\s*-->/gu;

const rightAlignedTableHeader = /(?:금액|공사비|단가|연면적|면적|수량|총액|합계|계약금|증감액|비율|세대수|동수|㎡|m²|원|억원)/iu;
const rightAlignedTableValue = /^\s*(?:[-+]?\d[\d,.]*(?:\s*(?:원|억원|만원|%|㎡|m²|m2|세대|동))?)\s*$/iu;

const jsonText = (node: JSONContent): string => `${typeof node.text === 'string' ? node.text : ''}${node.content?.map(jsonText).join('') ?? ''}`;
const normalizeA4TableJson = (source: JSONContent): JSONContent => {
  const visit = (node: JSONContent): JSONContent => {
    const next: JSONContent = { ...node, ...(node.attrs ? { attrs: { ...node.attrs } } : {}), ...(node.content ? { content: node.content.map(visit) } : {}) };
    if (next.type !== 'table' || !next.content?.length) return next;
    const rows = next.content.filter((row) => row.type === 'tableRow');
    const firstCells = rows[0]?.content ?? [];
    const columnCount = firstCells.reduce((sum, cell) => sum + Math.max(1, Number(cell.attrs?.colspan) || 1), 0);
    if (!columnCount) return next;
    const rawWidths: number[] = [];
    firstCells.forEach((cell) => {
      const span = Math.max(1, Number(cell.attrs?.colspan) || 1);
      const stored = Array.isArray(cell.attrs?.colwidth) ? cell.attrs?.colwidth as unknown[] : [];
      for (let index = 0; index < span; index += 1) rawWidths.push(Number(stored[index]) || 0);
    });
    const storedTotal = rawWidths.reduce((sum, width) => sum + Math.max(0, width), 0);
    const tableWidth = Math.min(100, Math.max(35, Number(next.attrs?.tableWidth) || 100));
    const availableWidth = Math.round(676 * tableWidth / 100);
    const normalizedWidths = rawWidths.map((width) => Math.max(20, Math.round(storedTotal > 0 ? width / storedTotal * availableWidth : availableWidth / columnCount)));
    const requiresA4Migration = Number(next.attrs?.documentDefaultsVersion) < 2 || storedTotal > availableWidth * 1.05;
    const rightColumns = new Set(firstCells.flatMap((cell, index) => rightAlignedTableHeader.test(jsonText(cell)) ? [index] : []));
    rows.forEach((row, rowIndex) => {
      if (requiresA4Migration) row.attrs = { ...row.attrs, rowHeightMm: null };
      let columnIndex = 0;
      row.content?.forEach((cell) => {
        const span = Math.max(1, Number(cell.attrs?.colspan) || 1);
        const cellText = jsonText(cell);
        cell.attrs = {
          ...cell.attrs,
          colwidth: normalizedWidths.slice(columnIndex, columnIndex + span),
          ...(requiresA4Migration ? {
            verticalAlignment: 'middle',
            horizontalAlignment: rowIndex > 0 && (rightColumns.has(columnIndex) || rightAlignedTableValue.test(cellText)) ? 'right' : 'center'
          } : {})
        };
        columnIndex += span;
      });
    });
    next.attrs = { ...next.attrs, documentDefaultsVersion: 2 };
    return next;
  };
  return visit(source);
};

/**
 * Make saved table measurements portable between the editor and the A4 preview.
 * Tiptap stores resized columns as pixels; copying those pixels into a narrower
 * preview made the last column collapse. Convert every colgroup to proportions
 * and apply the same 12px/centre/middle defaults used by both surfaces.
 */
export const normalizeStructuredDocumentHtml = (html: string): string => {
  if (!html.trim() || typeof DOMParser === 'undefined') return html;
  const parsed = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
  parsed.querySelectorAll<HTMLTableElement>('table').forEach((table) => {
    const requestedWidth = Math.min(100, Math.max(35, Number(table.dataset.tableWidth) || Number.parseFloat(table.style.width) || 100));
    table.dataset.tableWidth = String(requestedWidth);
    table.style.width = `${requestedWidth}%`;
    table.style.tableLayout = 'fixed';
    const columns = [...table.querySelectorAll<HTMLTableColElement>('colgroup > col')];
    if (columns.length) {
      const widths = columns.map((column) => Number.parseFloat(column.style.width || column.getAttribute('width') || '0'));
      const total = widths.reduce((sum, width) => sum + (Number.isFinite(width) && width > 0 ? width : 0), 0);
      columns.forEach((column, index) => {
        const proportional = total > 0 ? (Math.max(0, widths[index]) / total) * 100 : 100 / columns.length;
        column.style.width = `${Math.max(1, proportional).toFixed(4)}%`;
        column.removeAttribute('width');
      });
    }
    const headerCells = [...(table.rows[0]?.cells ?? [])];
    const rightColumns = new Set(headerCells.flatMap((cell, index) => rightAlignedTableHeader.test(cell.textContent ?? '') ? [index] : []));
    [...table.rows].forEach((row, rowIndex) => [...row.cells].forEach((cell, cellIndex) => {
      cell.dataset.cellVerticalAlign ||= 'middle';
      const shouldRightAlign = rowIndex > 0 && (rightColumns.has(cellIndex) || rightAlignedTableValue.test(cell.textContent ?? ''));
      cell.dataset.cellHorizontalAlign ||= shouldRightAlign ? 'right' : 'center';
    }));
  });
  return parsed.querySelector('main')?.innerHTML ?? html;
};

const markdownToEditorHtml = (markdown: string): string => {
  const withMarkers = markdown.replace(markerPattern, (_match, marker: string) => `\n<div data-ai-chapter-marker="${marker}"></div>\n`);
  const rendered = marked.parse(withMarkers, { async: false, gfm: true, breaks: true });
  return DOMPurify.sanitize(normalizeStructuredDocumentHtml(typeof rendered === 'string' ? rendered : ''), {
    ADD_ATTR: ['data-ai-chapter-marker', 'data-image-align', 'data-document-defaults-version', 'data-table-width', 'data-table-align', 'data-table-density', 'data-cell-vertical-align', 'data-cell-horizontal-align', 'data-row-height-mm', 'colspan', 'rowspan', 'style', 'target', 'rel', 'width', 'height']
  });
};

const escapeHtmlAttribute = (value: string): string => value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

const createTurndown = () => {
  const service = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    headingStyle: 'atx',
    strongDelimiter: '**'
  });
  service.use(gfm);
  service.addRule('aiChapterMarker', {
    filter: (node) => node instanceof HTMLElement && node.hasAttribute('data-ai-chapter-marker'),
    replacement: (_content, node) => {
      const marker = node instanceof HTMLElement ? node.getAttribute('data-ai-chapter-marker') : '';
      return marker ? `\n\n<!-- ${marker} -->\n\n` : '';
    }
  });
  service.addRule('documentTextStyle', {
    filter: (node) => node instanceof HTMLElement && node.tagName === 'SPAN' && Boolean(normalizeFontFamily(node.style.fontFamily) || normalizeFontSize(node.style.fontSize) || normalizeTextColor(node.style.color)),
    replacement: (content, node) => {
      if (!(node instanceof HTMLElement)) return content;
      const fontFamily = normalizeFontFamily(node.style.fontFamily);
      const fontSize = normalizeFontSize(node.style.fontSize);
      const color = normalizeTextColor(node.style.color);
      const style = [fontFamily ? `font-family:${fontFamily}` : '', fontSize ? `font-size:${fontSize}px` : '', color ? `color:${color}` : ''].filter(Boolean).join(';');
      return style ? `<span style="${escapeHtmlAttribute(style)}">${content}</span>` : content;
    }
  });
  service.addRule('sizedImage', {
    filter: 'img',
    replacement: (_content, node) => {
      if (!(node instanceof HTMLImageElement)) return '';
      const src = node.getAttribute('src') ?? '';
      if (!src) return '';
      const alt = node.getAttribute('alt') ?? '';
      const title = node.getAttribute('title') ?? '';
      const rawWidth = Number(node.getAttribute('width'));
      const width = Number.isFinite(rawWidth) && rawWidth > 0 ? Math.round(rawWidth) : null;
      const rawHeight = Number(node.getAttribute('height'));
      const height = Number.isFinite(rawHeight) && rawHeight > 0 ? Math.round(rawHeight) : null;
      const alignment = IMAGE_ALIGNMENTS.has(node.getAttribute('data-image-align') ?? '') ? node.getAttribute('data-image-align')! : 'center';
      return `\n\n<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}"${title ? ` title="${escapeHtmlAttribute(title)}"` : ''}${width ? ` width="${width}"` : ''}${height ? ` height="${height}"` : ''} data-image-align="${alignment}">\n\n`;
    }
  });
  service.addRule('adjustableTable', {
    filter: 'table',
    replacement: (_content, node) => node instanceof HTMLTableElement
      ? `\n\n${DOMPurify.sanitize(node.outerHTML, { ADD_ATTR: ['data-document-defaults-version', 'data-table-width', 'data-table-align', 'data-table-density', 'data-cell-vertical-align', 'data-cell-horizontal-align', 'data-row-height-mm', 'colspan', 'rowspan', 'style'] })}\n\n`
      : ''
  });
  return service;
};

const editorHtmlToMarkdown = (html: string): string => createTurndown().turndown(html).replace(/\n{3,}/gu, '\n\n').trim();

/** Render the same structured document used by the editor for final previews. */
export const renderStructuredDocumentHtml = (editorJson: JSONContent): string => {
  try {
    const html = generateHTML(editorJson, [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      Highlight.configure({ multicolor: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: false } }),
      Image.configure({ allowBase64: false, inline: false }),
      AiChapterMarker,
      DocumentTextStyle,
      DocumentPresentationAttributes
    ]);
    return DOMPurify.sanitize(normalizeStructuredDocumentHtml(html), {
      ADD_ATTR: ['data-ai-chapter-marker', 'data-image-align', 'data-document-defaults-version', 'data-table-width', 'data-table-align', 'data-table-density', 'data-cell-vertical-align', 'data-cell-horizontal-align', 'data-row-height-mm', 'colspan', 'rowspan', 'style', 'target', 'rel', 'width', 'height']
    });
  } catch {
    return '';
  }
};

const ToolbarButton = ({ active = false, disabled = false, label, onClick, children }: { active?: boolean; disabled?: boolean; label: string; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" className={active ? 'is-active' : ''} disabled={disabled} title={label} aria-label={label} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</button>
);

const findMatches = (editor: Editor, query: string): Array<{ from: number; to: number }> => {
  const matches: Array<{ from: number; to: number }> = [];
  if (!query) return matches;
  const pattern = new RegExp(escapeRegExp(query), 'giu');
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const match of node.text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      matches.push({ from: pos + match.index, to: pos + match.index + match[0].length });
    }
  });
  return matches;
};

const collaborationColor = (identity: string): string => {
  const palette = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2', '#059669', '#4f46e5', '#be123c'];
  let hash = 0;
  for (const character of identity) hash = ((hash << 5) - hash + character.codePointAt(0)!) | 0;
  return palette[Math.abs(hash) % palette.length];
};

const normalizeCollaborationUsers = (states: StatesArray): Array<{ clientId: number; name: string; color: string }> => states.flatMap((state) => {
  const user = state.user as { name?: unknown; color?: unknown } | undefined;
  if (!user || typeof user.name !== 'string' || !user.name.trim()) return [];
  return [{ clientId: state.clientId, name: user.name.trim(), color: typeof user.color === 'string' ? user.color : collaborationColor(user.name) }];
});

const StructuredDocumentEditorCore = forwardRef<StructuredDocumentEditorHandle, StructuredDocumentEditorCoreProps>(function StructuredDocumentEditorCore({
  value,
  editorJson,
  label,
  placeholder = '내용을 입력하세요.',
  readOnly = false,
  compact = false,
  pageMode = 'standard',
  documentKey,
  collaborationSession = null,
  collaborationStatus = WebSocketStatus.Disconnected,
  collaborationSynced = false,
  collaborationUsers = [],
  collaborationError = '',
  selectionAssistant,
  onRequestInsertTable,
  onChange,
  onSelectionChange
}, ref) {
  const [fullscreen, setFullscreen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState('');
  const [replacement, setReplacement] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [activeSelection, setActiveSelection] = useState<StructuredSelection | null>(null);
  const [imageSelected, setImageSelected] = useState(false);
  const [imageWidthPercent, setImageWidthPercent] = useState(100);
  const [imageAlignment, setImageAlignment] = useState<'left' | 'center' | 'right'>('center');
  const [tableActive, setTableActive] = useState(false);
  const [tableWidthPercent, setTableWidthPercent] = useState(100);
  const [tableAlignment, setTableAlignment] = useState<'left' | 'center' | 'right'>('center');
  const [tableDensity, setTableDensity] = useState<'compact' | 'normal' | 'comfortable'>('normal');
  const [cellVerticalAlignment, setCellVerticalAlignment] = useState<'top' | 'middle' | 'bottom'>('middle');
  const [columnWidthMm, setColumnWidthMm] = useState('35');
  const [rowHeightMm, setRowHeightMm] = useState('');
  const [fontFamily, setFontFamily] = useState('');
  const [fontSize, setFontSize] = useState('');
  const [textColor, setTextColor] = useState(DEFAULT_TEXT_COLOR);
  const [copyStatus, setCopyStatus] = useState('');
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);
  const lastAppliedContentSignature = useRef(structuredDocumentContentSignature(value, editorJson));
  const selectionRef = useRef<StructuredSelection | null>(null);
  // useEditor is recreated for each documentKey. Calculate this value on that
  // render so a chapter never inherits the previous chapter's first content.
  const initialContent = collaborationSession ? undefined : editorJson ? (pageMode === 'a4-portrait' ? normalizeA4TableJson(editorJson) : editorJson) : markdownToEditorHtml(value);

  const selectedImageElement = (activeEditor: Editor): HTMLImageElement | null => {
    if (!(activeEditor.state.selection instanceof NodeSelection) || activeEditor.state.selection.node.type.name !== 'image') return null;
    const dom = activeEditor.view.nodeDOM(activeEditor.state.selection.from);
    if (dom instanceof HTMLImageElement) return dom;
    return dom instanceof HTMLElement ? dom.querySelector('img') : null;
  };

  const syncContextualControls = (activeEditor: Editor) => {
    const selection = activeEditor.state.selection;
    const selectedImage = selection instanceof NodeSelection && selection.node.type.name === 'image';
    setImageSelected(selectedImage);
    if (selectedImage && selection instanceof NodeSelection) {
      const attributes = selection.node.attrs;
      const alignment = IMAGE_ALIGNMENTS.has(attributes.alignment) ? attributes.alignment as 'left' | 'center' | 'right' : 'center';
      const element = selectedImageElement(activeEditor);
      const editorStyle = window.getComputedStyle(activeEditor.view.dom);
      const availableWidth = Math.max(1, activeEditor.view.dom.clientWidth - Number.parseFloat(editorStyle.paddingLeft || '0') - Number.parseFloat(editorStyle.paddingRight || '0'));
      const displayedWidth = Number(attributes.width) || element?.getBoundingClientRect().width || availableWidth;
      setImageAlignment(alignment);
      setImageWidthPercent(Math.min(100, Math.max(10, Math.round((displayedWidth / availableWidth) * 100))));
    }
    const inTable = activeEditor.isActive('table');
    setTableActive(inTable);
    if (inTable) {
      const attributes = activeEditor.getAttributes('table');
      setTableWidthPercent(Math.min(100, Math.max(35, Number(attributes.tableWidth) || 100)));
      setTableAlignment(IMAGE_ALIGNMENTS.has(attributes.tableAlignment) ? attributes.tableAlignment as 'left' | 'center' | 'right' : 'center');
      setTableDensity(TABLE_DENSITIES.has(attributes.tableDensity) ? attributes.tableDensity as 'compact' | 'normal' | 'comfortable' : 'normal');
      const cellAttributes = activeEditor.isActive('tableHeader') ? activeEditor.getAttributes('tableHeader') : activeEditor.getAttributes('tableCell');
      setCellVerticalAlignment(CELL_VERTICAL_ALIGNMENTS.has(cellAttributes.verticalAlignment) ? cellAttributes.verticalAlignment as 'top' | 'middle' | 'bottom' : 'middle');
      const activeElement = document.activeElement;
      const editingMeasurements = activeElement instanceof HTMLElement && Boolean(activeElement.closest('.structured-editor__table-measurements'));
      if (!editingMeasurements) {
        const cellWidths = Array.isArray(cellAttributes.colwidth) ? cellAttributes.colwidth : [];
        if (Number(cellWidths[0]) > 0) setColumnWidthMm(String(clampMeasurement(Number(cellWidths[0]) * 25.4 / 96, 10, 180, 35)));
        const rowAttributes = activeEditor.getAttributes('tableRow');
        setRowHeightMm(rowAttributes.rowHeightMm === null || rowAttributes.rowHeightMm === undefined ? '' : String(clampMeasurement(rowAttributes.rowHeightMm, 6, 100, 12)));
      }
    }
    const textAttributes = activeEditor.getAttributes('documentTextStyle');
    setFontFamily(normalizeFontFamily(textAttributes.fontFamily) ?? '');
    setFontSize(normalizeFontSize(textAttributes.fontSize)?.toString() ?? '');
    setTextColor(normalizeTextColor(textAttributes.color) ?? DEFAULT_TEXT_COLOR);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure(collaborationSession ? { undoRedo: false, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } } : { link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      Highlight.configure({ multicolor: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: true, allowTableNodeSelection: true, View: DocumentTableView } }),
      Image.configure({
        allowBase64: false,
        inline: false,
        resize: {
          enabled: true,
          directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
          minWidth: 80,
          minHeight: 40,
          alwaysPreserveAspectRatio: true
        }
      }),
      Placeholder.configure({ placeholder }),
      CharacterCount,
      AiChapterMarker,
      DocumentTextStyle,
      DocumentPresentationAttributes,
      ...(collaborationSession ? [
        Collaboration.configure({ document: collaborationSession.document }),
        CollaborationCaret.configure({ provider: collaborationSession.provider, user: collaborationSession.user })
      ] : [])
    ],
    content: initialContent,
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate: ({ editor: activeEditor }) => {
      const nextMarkdown = editorHtmlToMarkdown(activeEditor.getHTML());
      const nextJson = activeEditor.getJSON();
      lastAppliedContentSignature.current = structuredDocumentContentSignature(nextMarkdown, nextJson);
      onChange(nextMarkdown, nextJson);
    },
    onSelectionUpdate: ({ editor: activeEditor }) => {
      const { from, to } = activeEditor.state.selection;
      syncContextualControls(activeEditor);
      const text = from === to ? '' : activeEditor.state.doc.textBetween(from, to, '\n');
      const selection = text.trim() ? { from, to, text } : null;
      selectionRef.current = selection;
      setActiveSelection(selection);
      if (!selection) setCopyStatus('');
      onSelectionChange?.(selection);
    },
    onTransaction: ({ editor: activeEditor }) => syncContextualControls(activeEditor)
  }, [documentKey, collaborationSession]);

  useEffect(() => {
    if (!editor?.isInitialized || editor.isDestroyed) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    setImageSelected(false);
    setTableActive(false);
    setActiveSelection(null);
    selectionRef.current = null;
  }, [documentKey]);

  useEffect(() => {
    if (collaborationSession) return;
    if (!editor?.isInitialized || editor.isDestroyed) return;
    const desiredSignature = structuredDocumentContentSignature(value, editorJson);
    if (desiredSignature === lastAppliedContentSignature.current) return;
    lastAppliedContentSignature.current = desiredSignature;
    editor.commands.setContent(editorJson ? (pageMode === 'a4-portrait' ? normalizeA4TableJson(editorJson) : editorJson) : markdownToEditorHtml(value), { emitUpdate: false });
  }, [collaborationSession, editor, editorJson, pageMode, value]);

  useEffect(() => {
    if (!collaborationSession || !collaborationSynced || !editor?.isInitialized || editor.isDestroyed || !editor.isEmpty || !value.trim()) return;
    editor.commands.setContent(editorJson ?? markdownToEditorHtml(value));
  }, [collaborationSession, collaborationSynced, editor, editorJson, value]);

  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [fullscreen]);

  const deleteSelectedImageNode = (): { deleted: boolean; src?: string } => {
    if (!editor || !(editor.state.selection instanceof NodeSelection) || editor.state.selection.node.type.name !== 'image') return { deleted: false };
    const src = typeof editor.state.selection.node.attrs.src === 'string' ? editor.state.selection.node.attrs.src : undefined;
    editor.chain().focus().deleteSelection().run();
    window.dispatchEvent(new CustomEvent('structured-editor:image-deleted', { detail: { documentKey, src } }));
    return { deleted: true, ...(src ? { src } : {}) };
  };

  const applyTextFormatting = (next: { fontFamily?: string; fontSize?: string; color?: string | null }) => {
    if (!editor) return;
    const current = editor.getAttributes('documentTextStyle');
    const nextFamily = next.fontFamily === undefined ? normalizeFontFamily(current.fontFamily) : normalizeFontFamily(next.fontFamily);
    const nextSize = next.fontSize === undefined ? normalizeFontSize(current.fontSize) : normalizeFontSize(next.fontSize);
    const nextColor = next.color === undefined ? normalizeTextColor(current.color) : normalizeTextColor(next.color);
    const chain = editor.chain().focus();
    if (!nextFamily && !nextSize && !nextColor) chain.unsetMark('documentTextStyle').run();
    else chain.setMark('documentTextStyle', { fontFamily: nextFamily, fontSize: nextSize, color: nextColor }).run();
  };

  const applyImageWidth = (percentage: number) => {
    if (!editor || !(editor.state.selection instanceof NodeSelection) || editor.state.selection.node.type.name !== 'image') return;
    const normalized = Math.min(100, Math.max(10, Math.round(percentage)));
    const element = selectedImageElement(editor);
    const style = window.getComputedStyle(editor.view.dom);
    const availableWidth = Math.max(80, editor.view.dom.clientWidth - Number.parseFloat(style.paddingLeft || '0') - Number.parseFloat(style.paddingRight || '0'));
    const currentWidth = Number(editor.state.selection.node.attrs.width) || element?.getBoundingClientRect().width || element?.naturalWidth || availableWidth;
    const currentHeight = Number(editor.state.selection.node.attrs.height) || element?.getBoundingClientRect().height || element?.naturalHeight || currentWidth;
    const aspectRatio = currentWidth > 0 && currentHeight > 0 ? currentWidth / currentHeight : 1;
    const width = Math.max(80, Math.round((availableWidth * normalized) / 100));
    const height = Math.max(40, Math.round(width / aspectRatio));
    setImageWidthPercent(normalized);
    if (element) {
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
    }
    editor.chain().focus().updateAttributes('image', { width, height }).run();
  };

  const applyImageAlignment = (alignment: 'left' | 'center' | 'right') => {
    if (!editor || !(editor.state.selection instanceof NodeSelection) || editor.state.selection.node.type.name !== 'image') return;
    setImageAlignment(alignment);
    editor.chain().focus().updateAttributes('image', { alignment }).run();
  };

  const applyTablePresentation = (attributes: { tableWidth?: number; tableAlignment?: 'left' | 'center' | 'right'; tableDensity?: 'compact' | 'normal' | 'comfortable' }) => {
    if (!editor?.isActive('table')) return;
    if (attributes.tableWidth !== undefined) setTableWidthPercent(attributes.tableWidth);
    if (attributes.tableAlignment) setTableAlignment(attributes.tableAlignment);
    if (attributes.tableDensity) setTableDensity(attributes.tableDensity);
    editor.chain().focus().updateAttributes('table', attributes).run();
  };

  const applyCellVerticalAlignment = (alignment: 'top' | 'middle' | 'bottom') => {
    if (!editor?.isActive('table')) return;
    const rect = selectedRect(editor.state);
    let transaction = editor.state.tr;
    for (const relativePosition of rect.map.cellsInRect({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })) {
      const position = rect.tableStart + relativePosition;
      const node = transaction.doc.nodeAt(position);
      if (node && (node.type.name === 'tableCell' || node.type.name === 'tableHeader')) transaction = transaction.setNodeMarkup(position, undefined, { ...node.attrs, verticalAlignment: alignment });
    }
    editor.view.dispatch(transaction.scrollIntoView());
    editor.commands.focus();
    setCellVerticalAlignment(alignment);
  };

  const applySelectedTableMeasurements = () => {
    if (!editor?.isActive('table')) return;
    const rect = selectedRect(editor.state);
    const widthPx = Math.round(clampMeasurement(columnWidthMm, 10, 180, 35) * 96 / 25.4);
    const normalizedRowHeight = rowHeightMm.trim() ? clampMeasurement(rowHeightMm, 6, 100, 12) : null;
    let transaction = editor.state.tr;
    for (const relativePosition of rect.map.cellsInRect({ left: rect.left, right: rect.right, top: 0, bottom: rect.map.height })) {
      const position = rect.tableStart + relativePosition;
      const node = transaction.doc.nodeAt(position);
      if (!node || (node.type.name !== 'tableCell' && node.type.name !== 'tableHeader')) continue;
      const span = Math.max(1, Number(node.attrs.colspan) || 1);
      transaction = transaction.setNodeMarkup(position, undefined, { ...node.attrs, colwidth: Array.from({ length: span }, () => widthPx) });
    }
    let rowPosition = rect.tableStart;
    for (let rowIndex = 0; rowIndex < rect.table.childCount; rowIndex += 1) {
      const row = rect.table.child(rowIndex);
      if (rowIndex >= rect.top && rowIndex < rect.bottom) transaction = transaction.setNodeMarkup(rowPosition, undefined, { ...row.attrs, rowHeightMm: normalizedRowHeight });
      rowPosition += row.nodeSize;
    }
    editor.view.dispatch(transaction.scrollIntoView());
    editor.commands.focus();
    setColumnWidthMm(String(clampMeasurement(columnWidthMm, 10, 180, 35)));
    setRowHeightMm(normalizedRowHeight === null ? '' : String(normalizedRowHeight));
  };

  useImperativeHandle(ref, () => ({
    focus: () => { editor?.chain().focus().run(); },
    getJSON: () => editor?.getJSON() ?? null,
    getMarkdown: () => editor ? editorHtmlToMarkdown(editor.getHTML()) : value,
    getSelection: () => selectionRef.current,
    replaceRange: (from, to, next, expectedText) => {
      if (!editor) return false;
      if (expectedText !== undefined && editor.state.doc.textBetween(from, to, '\n') !== expectedText) return false;
      editor.chain().focus().insertContentAt({ from, to }, next).run();
      return true;
    },
    insertTable: (rows, columns) => {
      if (rows === undefined || columns === undefined) {
        setTableDialogOpen(true);
        return;
      }
      editor?.chain().focus().insertTable({ rows, cols: columns, withHeaderRow: true }).run();
    },
    insertImage: ({ src, alt, title }) => {
      editor?.chain().focus().setImage({ src, alt, title: title ?? alt }).run();
    },
    deleteSelectedTable: () => {
      if (!editor?.isActive('table')) return false;
      editor.chain().focus().deleteTable().run();
      return true;
    },
    deleteSelectedImage: () => {
      return deleteSelectedImageNode();
    },
    moveSelectedImage: (direction) => {
      if (!editor || !(editor.state.selection instanceof NodeSelection) || editor.state.selection.node.type.name !== 'image') return false;
      const { selection } = editor.state;
      const parent = selection.$from.parent;
      const index = selection.$from.index();
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= parent.childCount) return false;
      const neighbor = parent.child(targetIndex);
      const image = selection.node;
      const from = selection.from;
      const nextPosition = direction === 'up' ? from - neighbor.nodeSize : from + neighbor.nodeSize;
      const transaction = editor.state.tr.delete(from, from + image.nodeSize).insert(nextPosition, image);
      transaction.setSelection(NodeSelection.create(transaction.doc, nextPosition));
      editor.view.dispatch(transaction.scrollIntoView());
      return true;
    },
    dismissSelectionMenu: () => {
      if (!editor) return;
      editor.chain().setTextSelection(editor.state.selection.to).blur().run();
      selectionRef.current = null;
      setActiveSelection(null);
      onSelectionChange?.(null);
    }
  }), [editor, onSelectionChange, value]);

  const findNext = () => {
    if (!editor || !search.trim()) { setSearchStatus('찾을 내용을 입력하세요.'); return; }
    const matches = findMatches(editor, search.trim());
    if (!matches.length) { setSearchStatus('일치하는 내용이 없습니다.'); return; }
    const next = matches.find((item) => item.from > editor.state.selection.from) ?? matches[0];
    editor.chain().focus().setTextSelection(next).scrollIntoView().run();
    setSearchStatus(`${matches.length}건 중 다음 위치로 이동했습니다.`);
  };

  const replaceCurrent = () => {
    if (!editor || !search.trim()) return;
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, '\n');
    if (selected.toLocaleLowerCase('ko-KR') !== search.trim().toLocaleLowerCase('ko-KR')) { findNext(); return; }
    editor.chain().focus().insertContentAt({ from, to }, replacement).run();
    setSearchStatus('선택한 1건을 바꿨습니다.');
  };

  const replaceAll = () => {
    if (!editor || !search.trim()) return;
    const matches = findMatches(editor, search.trim());
    let transaction = editor.state.tr;
    for (const match of [...matches].reverse()) transaction = transaction.insertText(replacement, match.from, match.to);
    if (matches.length) editor.view.dispatch(transaction);
    setSearchStatus(matches.length ? `${matches.length}건을 모두 바꿨습니다.` : '일치하는 내용이 없습니다.');
  };

  const addLink = () => {
    if (!editor) return;
    const previous = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt('연결할 주소를 입력하세요.', previous ?? 'https://');
    if (href === null) return;
    if (!href.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim(), target: '_blank', rel: 'noopener noreferrer' }).run();
  };

  const addImage = () => {
    if (!editor) return;
    const src = window.prompt('로그인으로 보호된 회사 자료실 이미지 주소 또는 공개 이미지 주소를 입력하세요.', '');
    if (!src?.trim()) return;
    const alt = window.prompt('이미지 설명(대체 텍스트)을 입력하세요.', '') ?? '';
    editor.chain().focus().setImage({ src: src.trim(), alt: alt.trim(), title: alt.trim() }).run();
  };

  const copySelectedText = async () => {
    const selection = selectionRef.current;
    if (!selection?.text.trim()) return;
    try {
      await navigator.clipboard.writeText(selection.text);
      setCopyStatus('복사됨');
      window.setTimeout(() => setCopyStatus(''), 1400);
    } catch {
      setCopyStatus('복사 실패');
    }
  };

  const runSelectionImprovement = (mode: StructuredSelectionImprovementMode) => {
    const selection = selectionRef.current;
    if (!selection || selectionAssistant?.disabled || selectionAssistant?.busy) return;
    selectionAssistant?.onImprove(mode, selection);
  };

  const wordCount = editor?.getText().trim().split(/\s+/u).filter(Boolean).length ?? 0;
  const characterCount = editor?.storage.characterCount.characters() as number | undefined;

  return <>
    {tableDialogOpen && createPortal(<div className="structured-editor__table-dialog-backdrop" role="presentation" onMouseDown={()=>setTableDialogOpen(false)}><section role="dialog" aria-modal="true" aria-labelledby="structured-table-dialog-title" className="structured-editor__table-dialog" onMouseDown={(event)=>event.stopPropagation()}><h2 id="structured-table-dialog-title">표 크기 설정</h2><p>커서를 표가 들어갈 위치에 둔 뒤 필요한 행과 열 수를 지정하세요. 첫 번째 행은 제목 행으로 생성됩니다.</p><div><label><span>행 수</span><input type="number" min="2" max="30" value={tableRows} onChange={(event)=>setTableRows(Math.min(30,Math.max(2,Number(event.target.value)||2)))}/></label><b>×</b><label><span>열 수</span><input type="number" min="2" max="12" value={tableColumns} onChange={(event)=>setTableColumns(Math.min(12,Math.max(2,Number(event.target.value)||2)))}/></label></div><small>행 2~30개, 열 2~12개까지 만들 수 있습니다.</small><footer><button type="button" onClick={()=>setTableDialogOpen(false)}>취소</button><button type="button" className="is-primary" onClick={()=>{editor?.chain().focus().insertTable({rows:tableRows,cols:tableColumns,withHeaderRow:true}).run();setTableDialogOpen(false);}}>▦ {tableRows}행 × {tableColumns}열 표 만들기</button></footer></section></div>,document.body)}
    <section className={`structured-editor${fullscreen ? ' is-fullscreen' : ''}${compact ? ' is-compact' : ''}${pageMode === 'a4-portrait' ? ' is-a4-portrait' : ''}${readOnly ? ' is-readonly' : ''}`} aria-label={label}>
    <header className="structured-editor__header">
      <div><strong>{label}</strong><span>{readOnly ? '읽기 전용' : collaborationSession ? '실시간 공동 편집 + 자동 저장' : '자동 저장 호환 편집기'}</span></div>
      {collaborationSession && <div className="structured-editor__collaboration" data-status={collaborationStatus}>
        <span>{collaborationError ? '인증 확인 필요' : collaborationStatus === WebSocketStatus.Connected ? (collaborationSynced ? '실시간 연결됨' : '문서 동기화 중…') : collaborationStatus === WebSocketStatus.Connecting ? '협업 서버 연결 중…' : '오프라인 편집 중'}</span>
        <div aria-label={`현재 공동 편집자 ${collaborationUsers.length}명`}>
          {collaborationUsers.slice(0, 5).map((user) => <i key={user.clientId} title={user.name} style={{ backgroundColor: user.color }}>{user.name.slice(0, 1)}</i>)}
          {collaborationUsers.length > 5 && <b>+{collaborationUsers.length - 5}</b>}
        </div>
      </div>}
      <div className="structured-editor__view-actions">
        <ToolbarButton label="찾기와 바꾸기" active={showSearch} onClick={() => setShowSearch((current) => !current)}>찾기</ToolbarButton>
        <ToolbarButton label="본문 미리보기" active={preview} onClick={() => setPreview((current) => !current)}>{preview ? '편집' : '미리보기'}</ToolbarButton>
        <ToolbarButton label={fullscreen ? '전체화면 닫기' : '전체화면 편집'} active={fullscreen} onClick={() => setFullscreen((current) => !current)}>{fullscreen ? '축소' : '전체화면'}</ToolbarButton>
      </div>
    </header>
    {!readOnly && !preview && <div className="structured-editor__toolbar" role="toolbar" aria-label="문서 서식 도구">
      <div className="structured-editor__toolbar-group" data-label="실행">
        <ToolbarButton label="실행 취소" disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}>↶</ToolbarButton>
        <ToolbarButton label="다시 실행" disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}>↷</ToolbarButton>
      </div>
      <div className="structured-editor__toolbar-group structured-editor__text-controls" data-label="글자">
        <label><span>글꼴</span><select aria-label="선택 글꼴" value={fontFamily} style={fontFamily ? { fontFamily } : undefined} onChange={(event) => applyTextFormatting({ fontFamily: event.target.value })}>{['기본','한글 기본·시스템','무료 한글 글꼴','영문 글꼴'].map((group) => <optgroup key={group} label={group}>{FONT_FAMILIES.filter((font) => font.group === group).map((font) => <option key={font.label} value={font.value} style={font.value ? { fontFamily: font.value } : undefined}>{font.label}</option>)}</optgroup>)}</select></label>
        <label><span>크기</span><select aria-label="선택 글자 크기" value={fontSize} onChange={(event) => applyTextFormatting({ fontSize: event.target.value })}>{FONT_SIZES.map((size) => <option key={size || 'default'} value={size}>{size ? `${size}px` : '기본'}</option>)}</select></label>
        <label className="structured-editor__color-control"><span>색상</span><input aria-label="선택 글자 색상" type="color" value={textColor} onChange={(event) => applyTextFormatting({ color: event.target.value })}/></label>
        <ToolbarButton label="글자 색상 기본값" disabled={!normalizeTextColor(editor?.getAttributes('documentTextStyle').color)} onClick={() => applyTextFormatting({ color: null })}>색상 해제</ToolbarButton>
      </div>
      <div className="structured-editor__toolbar-group" data-label="강조">
        <ToolbarButton label="굵게" active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></ToolbarButton>
        <ToolbarButton label="기울임" active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></ToolbarButton>
        <ToolbarButton label="밑줄" active={editor?.isActive('underline')} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></ToolbarButton>
        <ToolbarButton label="취소선" active={editor?.isActive('strike')} onClick={() => editor?.chain().focus().toggleStrike().run()}><s>S</s></ToolbarButton>
        <ToolbarButton label="형광펜" active={editor?.isActive('highlight')} onClick={() => editor?.chain().focus().toggleHighlight().run()}>강조</ToolbarButton>
      </div>
      <div className="structured-editor__toolbar-group" data-label="정렬">
        <ToolbarButton label="왼쪽 정렬" active={editor?.isActive({ textAlign: 'left' })} onClick={() => editor?.chain().focus().setTextAlign('left').run()}>왼쪽</ToolbarButton>
        <ToolbarButton label="가운데 정렬" active={editor?.isActive({ textAlign: 'center' })} onClick={() => editor?.chain().focus().setTextAlign('center').run()}>가운데</ToolbarButton>
        <ToolbarButton label="오른쪽 정렬" active={editor?.isActive({ textAlign: 'right' })} onClick={() => editor?.chain().focus().setTextAlign('right').run()}>오른쪽</ToolbarButton>
      </div>
      <div className="structured-editor__toolbar-group structured-editor__toolbar-table" data-label="표">
        <ToolbarButton label="표 삽입" onClick={() => onRequestInsertTable ? onRequestInsertTable() : setTableDialogOpen(true)}>표 +</ToolbarButton>
        <ToolbarButton label="표 행 추가" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().addRowAfter().run()}>행 +</ToolbarButton>
        <ToolbarButton label="표 열 추가" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().addColumnAfter().run()}>열 +</ToolbarButton>
        <ToolbarButton label="표 행 삭제" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().deleteRow().run()}>행 −</ToolbarButton>
        <ToolbarButton label="표 열 삭제" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().deleteColumn().run()}>열 −</ToolbarButton>
        <ToolbarButton label="표 셀 병합" disabled={!editor?.can().mergeCells()} onClick={() => editor?.chain().focus().mergeCells().run()}>셀 병합</ToolbarButton>
        <ToolbarButton label="표 셀 분할" disabled={!editor?.can().splitCell()} onClick={() => editor?.chain().focus().splitCell().run()}>셀 분할</ToolbarButton>
        <ToolbarButton label="표 삭제" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().deleteTable().run()}>표 삭제</ToolbarButton>
      </div>
      <div className="structured-editor__toolbar-group structured-editor__toolbar-insert" data-label="삽입·정리">
        <ToolbarButton label="링크" active={editor?.isActive('link')} onClick={addLink}>링크</ToolbarButton>
        <ToolbarButton label="이미지" onClick={addImage}>이미지</ToolbarButton>
        <ToolbarButton label="선택 이미지 위로 이동" disabled={!imageSelected} onClick={() => {
          if (!editor || !(editor.state.selection instanceof NodeSelection) || editor.state.selection.node.type.name !== 'image') return;
          const parent = editor.state.selection.$from.parent; const index = editor.state.selection.$from.index(); if (index < 1) return;
          const previous = parent.child(index - 1); const image = editor.state.selection.node; const from = editor.state.selection.from; const nextPosition = from - previous.nodeSize;
          const transaction = editor.state.tr.delete(from, from + image.nodeSize).insert(nextPosition, image); transaction.setSelection(NodeSelection.create(transaction.doc, nextPosition)); editor.view.dispatch(transaction.scrollIntoView());
        }}>이미지 ↑</ToolbarButton>
        <ToolbarButton label="선택 이미지 아래로 이동" disabled={!imageSelected} onClick={() => {
          if (!editor || !(editor.state.selection instanceof NodeSelection) || editor.state.selection.node.type.name !== 'image') return;
          const parent = editor.state.selection.$from.parent; const index = editor.state.selection.$from.index(); if (index >= parent.childCount - 1) return;
          const next = parent.child(index + 1); const image = editor.state.selection.node; const from = editor.state.selection.from; const nextPosition = from + next.nodeSize;
          const transaction = editor.state.tr.delete(from, from + image.nodeSize).insert(nextPosition, image); transaction.setSelection(NodeSelection.create(transaction.doc, nextPosition)); editor.view.dispatch(transaction.scrollIntoView());
        }}>이미지 ↓</ToolbarButton>
        <ToolbarButton label="선택 이미지 삭제" disabled={!imageSelected} onClick={deleteSelectedImageNode}>이미지 삭제</ToolbarButton>
        <ToolbarButton label="구분선" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>구분선</ToolbarButton>
        <ToolbarButton label="서식 지우기" onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}>서식 지우기</ToolbarButton>
      </div>
    </div>}
    {!readOnly && !preview && imageSelected && <div className="structured-editor__object-controls is-image" role="group" aria-label="선택 이미지 크기와 정렬">
      <strong>선택 이미지</strong>
      <label><span>크기</span><input aria-label="이미지 너비 비율" type="range" min="10" max="100" step="5" value={imageWidthPercent} onChange={(event) => applyImageWidth(Number(event.target.value))} /><output>{imageWidthPercent}%</output></label>
      <div className="structured-editor__quick-sizes">{[25, 50, 75, 100].map((size) => <ToolbarButton key={size} label={`이미지 너비 ${size}%`} active={imageWidthPercent === size} onClick={() => applyImageWidth(size)}>{size}%</ToolbarButton>)}</div>
      <div><span>정렬</span>{(['left', 'center', 'right'] as const).map((alignment) => <ToolbarButton key={alignment} label={`이미지 ${alignment === 'left' ? '왼쪽' : alignment === 'center' ? '가운데' : '오른쪽'} 정렬`} active={imageAlignment === alignment} onClick={() => applyImageAlignment(alignment)}>{alignment === 'left' ? '왼쪽' : alignment === 'center' ? '가운데' : '오른쪽'}</ToolbarButton>)}</div>
      <small>파란 모서리 조절점을 드래그해도 원본 비율을 유지한 채 크기가 저장됩니다.</small>
      <ToolbarButton label="선택 이미지 삭제" onClick={deleteSelectedImageNode}>이미지 삭제</ToolbarButton>
    </div>}
    {!readOnly && !preview && tableActive && <div className="structured-editor__object-controls is-table" role="group" aria-label="선택 표 크기와 간격">
      <strong>현재 표</strong>
      <label><span>표 너비</span><input aria-label="표 너비 비율" type="range" min="35" max="100" step="5" value={tableWidthPercent} onChange={(event) => applyTablePresentation({ tableWidth: Number(event.target.value) })} /><output>{tableWidthPercent}%</output></label>
      <div className="structured-editor__quick-sizes">{[50, 65, 80, 100].map((size) => <ToolbarButton key={size} label={`표 너비 ${size}%`} active={tableWidthPercent === size} onClick={() => applyTablePresentation({ tableWidth: size })}>{size}%</ToolbarButton>)}</div>
      <div><span>정렬</span>{(['left', 'center', 'right'] as const).map((alignment) => <ToolbarButton key={alignment} label={`표 ${alignment === 'left' ? '왼쪽' : alignment === 'center' ? '가운데' : '오른쪽'} 정렬`} active={tableAlignment === alignment} onClick={() => applyTablePresentation({ tableAlignment: alignment })}>{alignment === 'left' ? '왼쪽' : alignment === 'center' ? '가운데' : '오른쪽'}</ToolbarButton>)}</div>
      <div><span>셀 상하</span>{(['top', 'middle', 'bottom'] as const).map((alignment) => <ToolbarButton key={alignment} label={`선택 셀 ${alignment === 'top' ? '위' : alignment === 'middle' ? '가운데' : '아래'} 정렬`} active={cellVerticalAlignment === alignment} onClick={() => applyCellVerticalAlignment(alignment)}>{alignment === 'top' ? '위' : alignment === 'middle' ? '가운데' : '아래'}</ToolbarButton>)}</div>
      <div><span>셀 간격</span>{(['compact', 'normal', 'comfortable'] as const).map((density) => <ToolbarButton key={density} label={`표 ${density === 'compact' ? '좁게' : density === 'normal' ? '보통' : '넓게'}`} active={tableDensity === density} onClick={() => applyTablePresentation({ tableDensity: density })}>{density === 'compact' ? '좁게' : density === 'normal' ? '보통' : '넓게'}</ToolbarButton>)}</div>
      <div className="structured-editor__table-measurements"><label><span>선택 열 너비</span><input aria-label="선택 열 너비 밀리미터" type="number" min="10" max="180" step="1" value={columnWidthMm} onChange={(event) => setColumnWidthMm(event.target.value)}/><output>mm</output></label><label><span>선택 행 높이</span><input aria-label="선택 행 높이 밀리미터" type="number" min="6" max="100" step="1" value={rowHeightMm} placeholder="자동" onChange={(event) => setRowHeightMm(event.target.value)}/><output>{rowHeightMm ? 'mm' : '자동'}</output></label><ToolbarButton label="선택 행 높이를 내용에 맞게 자동 조정" onClick={()=>setRowHeightMm('')}>행높이 자동</ToolbarButton><ToolbarButton label="선택한 표 셀의 열 너비와 행 높이 적용" onClick={applySelectedTableMeasurements}>치수 적용</ToolbarButton></div>
      <small>셀을 선택한 뒤 상하 정렬과 열·행 치수를 적용할 수 있습니다. 열 경계선 드래그도 그대로 지원합니다.</small>
      <ToolbarButton label="표 삭제" onClick={() => editor?.chain().focus().deleteTable().run()}>표 삭제</ToolbarButton>
    </div>}
    {showSearch && <div className="structured-editor__search" role="search"><label>찾기<input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); findNext(); } }} /></label><label>바꾸기<input value={replacement} onChange={(event) => setReplacement(event.target.value)} /></label><button type="button" onClick={findNext}>다음 찾기</button>{!readOnly && <><button type="button" onClick={replaceCurrent}>현재 바꾸기</button><button type="button" className="is-primary" onClick={replaceAll}>모두 바꾸기</button></>}<span role="status">{searchStatus}</span></div>}
    <div className="structured-editor__canvas">
      {preview ? <article className="structured-editor__preview" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(editor?.getHTML() ?? '') }} /> : <>
        {editor && <BubbleMenu
          editor={editor}
          pluginKey={`structured-selection-assistant-${documentKey ?? label}`}
          updateDelay={80}
          shouldShow={({ editor: activeEditor, from, to }) => !readOnly && activeEditor.isEditable && activeEditor.isFocused && from !== to && Boolean(activeEditor.state.doc.textBetween(from, to, '\n').trim())}
          className="structured-editor__selection-menu"
          role="toolbar"
          aria-label="선택 문장 빠른 작업"
        >
          <button type="button" className="is-copy" onMouseDown={(event) => event.preventDefault()} onClick={() => void copySelectedText()} aria-label="선택 문장 복사">{copyStatus || '복사'}</button>
          <button type="button" onMouseDown={(event)=>event.preventDefault()} disabled={!editor.can().undo()} onClick={()=>editor.chain().focus().undo().run()} aria-label="실행 취소">↶ 실행취소</button>
          <button type="button" onMouseDown={(event)=>event.preventDefault()} disabled={!editor.can().redo()} onClick={()=>editor.chain().focus().redo().run()} aria-label="다시 실행">↷ 다시실행</button>
          <button type="button" onMouseDown={(event)=>event.preventDefault()} className={editor.isActive('bold')?'is-active':''} onClick={()=>editor.chain().focus().toggleBold().run()} aria-label="굵게">굵게</button>
          <button type="button" onMouseDown={(event)=>event.preventDefault()} onClick={()=>editor.chain().focus().setTextAlign('left').run()}>왼쪽</button>
          <button type="button" onMouseDown={(event)=>event.preventDefault()} onClick={()=>editor.chain().focus().setTextAlign('center').run()}>가운데</button>
          <button type="button" onMouseDown={(event)=>event.preventDefault()} onClick={()=>editor.chain().focus().setTextAlign('right').run()}>오른쪽</button>
          {tableActive&&<><button type="button" onMouseDown={(event)=>event.preventDefault()} onClick={()=>editor.chain().focus().addRowAfter().run()}>행 +</button><button type="button" onMouseDown={(event)=>event.preventDefault()} onClick={()=>editor.chain().focus().addColumnAfter().run()}>열 +</button></>}
          {selectionAssistant&&<>
          <span aria-hidden="true" />
          <button type="button" className="is-ai" disabled={selectionAssistant.disabled || selectionAssistant.busy || !activeSelection} onMouseDown={(event) => event.preventDefault()} onClick={() => runSelectionImprovement('professional')}>✦ 전문적으로</button>
          <button type="button" className="is-ai" disabled={selectionAssistant.disabled || selectionAssistant.busy || !activeSelection} onMouseDown={(event) => event.preventDefault()} onClick={() => runSelectionImprovement('concise')}>✦ 간결하게</button>
          <button type="button" className="is-ai is-primary" disabled={selectionAssistant.disabled || selectionAssistant.busy || !activeSelection} onMouseDown={(event) => event.preventDefault()} onClick={() => runSelectionImprovement('custom')}>{selectionAssistant.busy ? '개선 중…' : '✦ Gemini 개선'}</button>
          </>}
        </BubbleMenu>}
        <EditorContent editor={editor} />
      </>}
    </div>
    <footer>{collaborationError && <span className="structured-editor__collaboration-error">{collaborationError}</span>}<span>{wordCount.toLocaleString('ko-KR')}단어</span><span>{(characterCount ?? 0).toLocaleString('ko-KR')}자</span><span>{collaborationSession ? '실시간 공동편집 연결' : 'Ctrl+Z 실행 취소 · 검수 완료 시 버전 저장'}</span></footer>
    </section>
  </>;
});

const CollaborativeDocumentEditor = forwardRef<StructuredDocumentEditorHandle, StructuredDocumentEditorProps>(function CollaborativeDocumentEditor(props, ref) {
  const [session, setSession] = useState<CollaborationSession | null>(null);
  const [status, setStatus] = useState(WebSocketStatus.Connecting);
  const [synced, setSynced] = useState(false);
  const [users, setUsers] = useState<Array<{ clientId: number; name: string; color: string }>>([]);
  const [error, setError] = useState('');
  const runtime = globalThis as typeof globalThis & {
    __CLAIM_CENTER_COLLABORATION_URL__?: string;
    __CLAIM_CENTER_COLLABORATION_TOKEN_ENDPOINT__?: string;
  };
  const url = runtime.__CLAIM_CENTER_COLLABORATION_URL__?.trim() ?? '';
  const tokenEndpoint = runtime.__CLAIM_CENTER_COLLABORATION_TOKEN_ENDPOINT__?.trim() || '/api/collaboration/token';
  const collaboration = props.collaboration!;

  useEffect(() => {
    const document = new Y.Doc();
    const user = {
      name: collaboration.userName.trim() || collaboration.userEmail?.split('@')[0] || '협업 사용자',
      color: collaborationColor(collaboration.userEmail || collaboration.userName || collaboration.documentId),
      ...(collaboration.userEmail ? { email: collaboration.userEmail } : {})
    };
    let active = true;
    const provider = new HocuspocusProvider({
      url,
      name: collaboration.documentId,
      document,
      sessionAwareness: true,
      flushDelay: 250,
      token: async () => {
        const response = await fetch(tokenEndpoint, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentName: collaboration.documentId })
        });
        if (!response.ok) throw new Error(`협업 인증 토큰 발급 실패 (HTTP ${response.status})`);
        const payload = await response.json() as { token?: unknown };
        if (typeof payload.token !== 'string' || !payload.token) throw new Error('협업 인증 토큰이 없습니다.');
        return payload.token;
      },
      onStatus: ({ status: next }) => { if (active) setStatus(next); },
      onSynced: ({ state }) => { if (active) setSynced(state); },
      onAwarenessUpdate: ({ states }) => { if (active) setUsers(normalizeCollaborationUsers(states)); },
      onAuthenticationFailed: ({ reason }) => { if (active) setError(`실시간 협업 인증 실패: ${reason}`); },
      onAuthenticated: () => { if (active) setError(''); }
    });
    provider.setAwarenessField('user', user);
    setSession({ document, provider, user });
    return () => {
      active = false;
      provider.destroy();
      document.destroy();
    };
  }, [collaboration.documentId, collaboration.userEmail, collaboration.userName, tokenEndpoint, url]);

  if (!session) return <section className="structured-editor structured-editor--collaboration-loading" aria-label={props.label}><strong>실시간 공동 편집기를 준비하고 있습니다…</strong></section>;
  return <StructuredDocumentEditorCore {...props} ref={ref} collaborationSession={session} collaborationStatus={status} collaborationSynced={synced} collaborationUsers={users} collaborationError={error} />;
});

export const StructuredDocumentEditor = forwardRef<StructuredDocumentEditorHandle, StructuredDocumentEditorProps>(function StructuredDocumentEditor(props, ref) {
  const runtime = globalThis as typeof globalThis & {
    __CLAIM_CENTER_COLLABORATION_URL__?: string;
    __CLAIM_CENTER_SESSION_USER__?: { id: string; name: string; email: string; organizationId: string; roles: string[] };
  };
  const collaborationUrl = runtime.__CLAIM_CENTER_COLLABORATION_URL__?.trim();
  const implicitDocumentKey = props.documentKey?.replace(/^report-step(?:3|4)-/u, 'report-');
  const collaboration = props.collaboration ?? (props.documentKey ? {
    documentId: `claim-center:${runtime.__CLAIM_CENTER_SESSION_USER__?.organizationId ?? 'unknown'}:${implicitDocumentKey}`,
    userName: runtime.__CLAIM_CENTER_SESSION_USER__?.name ?? '로그인 사용자',
    userEmail: runtime.__CLAIM_CENTER_SESSION_USER__?.email
  } : undefined);
  if (collaboration && collaborationUrl) return <CollaborativeDocumentEditor {...props} collaboration={collaboration} ref={ref} />;
  return <StructuredDocumentEditorCore {...props} ref={ref} />;
});
