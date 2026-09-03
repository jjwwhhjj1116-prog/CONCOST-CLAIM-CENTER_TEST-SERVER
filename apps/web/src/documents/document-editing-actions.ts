import { Extension, type Editor } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { CellSelection, selectedRect } from '@tiptap/pm/tables';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { normalizeSpacerHeight } from './document-spacing';
import { writeTableColumnWidths } from './document-resize-scale';

const spacingKey = new PluginKey<number[] | null>('document-spacing-selection');
const isBlank = (node: DocumentNode | null) => node?.type.name === 'documentSpacer'
  || (node?.type.name === 'paragraph' && node.content.content.every(child => child.isText ? !child.text?.trim() : child.type.name === 'hardBreak'));

/** Selection decorations are transient: never written to document JSON or exports. */
export const DocumentSpacingSelection = Extension.create({
  name: 'documentSpacingSelection',
  addProseMirrorPlugins() {
    return [new Plugin<number[] | null>({
      key: spacingKey,
      state: {
        init: () => null,
        apply(tr, positions) {
          const explicit = tr.getMeta(spacingKey) as number[] | null | undefined;
          if (explicit !== undefined) return explicit;
          if (!positions) return null;
          return positions.flatMap(pos => {
            const mapped = tr.mapping.mapResult(pos, 1);
            return !mapped.deleted && isBlank(tr.doc.nodeAt(mapped.pos)) ? [mapped.pos] : [];
          });
        }
      },
      props: {
        handleClick(view, _pos, event) {
          if (!event.ctrlKey && !event.metaKey && spacingKey.getState(view.state) !== null) view.dispatch(view.state.tr.setMeta(spacingKey, null).setMeta('addToHistory', false));
          return false;
        },
        handleKeyDown(view, event) {
          if (!['Control', 'Meta', 'Shift', 'Alt', 'F4'].includes(event.key) && spacingKey.getState(view.state) !== null) view.dispatch(view.state.tr.setMeta(spacingKey, null).setMeta('addToHistory', false));
          return false;
        },
        decorations(state) {
          return DecorationSet.create(state.doc, (spacingKey.getState(state) ?? []).flatMap(pos => {
            const node = state.doc.nodeAt(pos);
            return isBlank(node) ? [Decoration.node(pos, pos + node!.nodeSize, { class: 'is-spacing-selected' })] : [];
          }));
        },
        handleClickOn(view, _pos, node, nodePos, event, direct) {
          if (!view.editable || !direct || !isBlank(node)) return false;
          if (!(event.ctrlKey || event.metaKey)) {
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)).setMeta(spacingKey, null).setMeta('addToHistory', false));
            event.preventDefault(); view.focus(); return true;
          }
          const existing = spacingKey.getState(view.state);
          const positions = new Set(existing ?? []);
          const selection = view.state.selection;
          if (!existing && selection instanceof NodeSelection && isBlank(selection.node)) positions.add(selection.from);
          if (positions.has(nodePos)) positions.delete(nodePos); else positions.add(nodePos);
          view.dispatch(view.state.tr.setMeta(spacingKey, [...positions].sort((a, b) => a - b)).setMeta('addToHistory', false));
          event.preventDefault();
          view.focus();
          return true;
        }
      }
    })];
  }
});

export const selectedSpacingPositions = (editor: Editor): number[] => {
  const multiple = spacingKey.getState(editor.state);
  if (multiple) return multiple;
  const selection = editor.state.selection;
  if (selection instanceof NodeSelection && (isBlank(selection.node) || selection.node.type.name === 'documentPageBreak')) return [selection.from];
  if (selection.empty && isBlank(selection.$from.parent)) return [selection.$from.before()];
  return [];
};

export function preserveSpacingSelection(editor: Editor) {
  const positions = selectedSpacingPositions(editor);
  if (positions.length) editor.view.dispatch(editor.state.tr.setMeta(spacingKey, positions).setMeta('addToHistory', false));
}

export type RepeatableDocumentAction =
  | { kind: 'text'; attrs: { fontFamily?: string | null; fontSize?: number | null; color?: string | null } }
  | { kind: 'mark'; name: 'bold' | 'italic' | 'underline' | 'strike' | 'highlight'; enabled: boolean }
  | { kind: 'align'; alignment: 'left' | 'center' | 'right' }
  | { kind: 'insertSpacer' | 'spacing'; height: number }
  | { kind: 'deleteSpacing' }
  | { kind: 'table'; rows: number; columns: number }
  | { kind: 'attributes'; target: 'image' | 'table'; attrs: Record<string, unknown> }
  | { kind: 'cellAlign'; alignment: 'top' | 'middle' | 'bottom' }
  | { kind: 'measurements'; width: number | null; height?: number | null }
  | { kind: 'command'; command: 'addRowAfter' | 'addColumnAfter' | 'deleteRow' | 'deleteColumn' | 'mergeCells' | 'splitCell' | 'deleteTable' | 'setHorizontalRule' }
  | { kind: 'pageBreak' | 'clearFormat' };

export const documentActionLabel = (action: RepeatableDocumentAction) => ({
  text: '글자 서식', mark: '강조 서식', align: '문단 정렬', insertSpacer: '빈 줄 삽입', spacing: '빈 줄 간격',
  deleteSpacing: '간격 삭제', table: '표 삽입', command: '표·구분선 편집', pageBreak: '쪽 나누기', clearFormat: '서식 지우기',
  attributes: '표·이미지 서식', cellAlign: '셀 상하 정렬', measurements: '열·행 치수'
})[action.kind];

/** Replay semantic values at the CURRENT selection, never a previous transaction/range. */
export function applyDocumentAction(editor: Editor, action: RepeatableDocumentAction): boolean {
  if (!editor.isEditable || editor.isDestroyed) return false;
  const selection = editor.state.selection;
  if (['insertSpacer', 'spacing', 'deleteSpacing', 'table'].includes(action.kind) && selection instanceof CellSelection) return false;
  // Each explicit action (including F4) is one undo step, even in rapid succession.
  editor.view.dispatch(closeHistory(editor.state.tr));
  const chain = editor.chain().focus();
  switch (action.kind) {
    case 'text': return chain.setMark('documentTextStyle', action.attrs).run();
    case 'mark': return (action.enabled ? chain.setMark(action.name) : chain.unsetMark(action.name)).run();
    case 'align': return chain.setTextAlign(action.alignment).run();
    case 'table': return chain.insertTable({ rows: Math.min(30, Math.max(2, action.rows)), cols: Math.min(12, Math.max(2, action.columns)), withHeaderRow: true }).run();
    case 'attributes': return editor.isActive(action.target) && chain.updateAttributes(action.target, action.attrs).run();
    case 'cellAlign':
    case 'measurements': {
      if (!editor.isActive('table')) return false;
      const rect = selectedRect(editor.state);
      const tr = editor.state.tr;
      for (const relative of action.kind === 'cellAlign' ? rect.map.cellsInRect(rect) : []) {
        const pos = rect.tableStart + relative;
        const node = tr.doc.nodeAt(pos);
        if (!node) continue;
        const attrs = action.kind === 'cellAlign' ? { verticalAlignment: action.alignment } : {};
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
      }
      if (action.kind === 'measurements' && action.width !== null) {
        const wrapper = editor.view.nodeDOM(rect.tableStart - 1) as HTMLElement | null;
        const table = wrapper?.matches('table') ? wrapper : wrapper?.querySelector('table');
        if (!table) return false;
        const scale = table.getBoundingClientRect().width / table.offsetWidth;
        const widths = [...table.querySelectorAll(':scope > colgroup > col')].map(col => col.getBoundingClientRect().width / scale);
        if (widths.length !== rect.map.width) return false;
        const total = widths.reduce((sum, value) => sum + value, 0), count = rect.right - rect.left;
        const rest = widths.length - count;
        const minimum = Math.min(24, total / widths.length);
        const desired = rest ? Math.max(minimum, Math.min(action.width * 96 / 25.4, (total - rest * minimum) / count)) : total / count;
        const otherWeight = widths.reduce((sum, width, index) => sum + (index < rect.left || index >= rect.right ? Math.max(0, width - minimum) : 0), 0);
        const free = Math.max(0, total - desired * count - minimum * rest);
        writeTableColumnWidths(tr, rect.tableStart, rect.table, widths.map((width, index) => index >= rect.left && index < rect.right ? desired : minimum + free * (otherWeight ? Math.max(0, width - minimum) / otherWeight : 1 / rest)));
      }
      if (action.kind === 'measurements' && action.height !== undefined) {
        let pos = rect.tableStart;
        rect.table.forEach((row, _offset, index) => {
          if (index >= rect.top && index < rect.bottom) tr.setNodeMarkup(pos, undefined, { ...row.attrs, rowHeightMm: action.height });
          pos += row.nodeSize;
        });
      }
      editor.view.dispatch(tr); editor.view.focus(); return true;
    }
    case 'command': return chain[action.command]().run();
    case 'pageBreak': return chain.insertContent({ type: 'documentPageBreak' }).run();
    case 'clearFormat': return chain.unsetAllMarks().clearNodes().run();
    case 'insertSpacer': {
      const spacer = editor.schema.nodes.documentSpacer.create({ heightPx: normalizeSpacerHeight(action.height) });
      const empty = selection.empty && isBlank(selection.$from.parent);
      const pos = empty ? selection.$from.before() : selection instanceof NodeSelection ? selection.to : selection.$to.depth > 0 ? selection.$to.after() : selection.to;
      const tr = empty ? editor.state.tr.replaceWith(pos, selection.$from.after(), spacer) : editor.state.tr.insert(pos, spacer);
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      editor.view.dispatch(tr.scrollIntoView()); editor.view.focus(); return true;
    }
    case 'spacing':
    case 'deleteSpacing': {
      const positions = selectedSpacingPositions(editor);
      if (!positions.length) return false;
      const tr = editor.state.tr;
      for (const pos of [...positions].sort((a, b) => b - a)) {
        const node = tr.doc.nodeAt(pos);
        if (!node || (!isBlank(node) && node.type.name !== 'documentPageBreak')) continue;
        if (action.kind === 'deleteSpacing') tr.delete(pos, pos + node.nodeSize);
        else tr.replaceWith(pos, pos + node.nodeSize, editor.schema.nodes.documentSpacer.create({ heightPx: normalizeSpacerHeight(action.height) }));
      }
      if (!tr.docChanged) return false;
      tr.setMeta(spacingKey, action.kind === 'spacing' ? positions.map(pos => tr.mapping.map(pos, -1)) : []);
      editor.view.dispatch(tr); editor.view.focus(); return true;
    }
  }
}
