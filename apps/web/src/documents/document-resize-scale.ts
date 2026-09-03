import { Extension, ResizableNodeView } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Plugin, TextSelection, type Transaction } from '@tiptap/pm/state';
import { CellSelection, TableMap, selectedRect } from '@tiptap/pm/tables';
import { closeHistory } from '@tiptap/pm/history';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';

const displayScale = (element: HTMLElement) => element.offsetWidth > 0 ? element.getBoundingClientRect().width / element.offsetWidth : 1;

export function writeTableColumnWidths(tr: Transaction, tableStart: number, table: DocumentNode, widths: number[]) {
  const map = TableMap.get(table);
  for (const offset of new Set(map.map)) {
    const cell = table.nodeAt(offset)!;
    const left = map.findCell(offset).left;
    tr.setNodeMarkup(tableStart + offset, undefined, { ...cell.attrs, colwidth: widths.slice(left, left + cell.attrs.colspan).map(width => Math.round(width * 100) / 100) });
  }
  return tr;
}

export function selectTableCells(view: EditorView, scope: 'table' | 'row' | 'column'): boolean {
  if (!view.editable) return false;
  let rect;
  try { rect = selectedRect(view.state); } catch { return false; }
  const { map, tableStart } = rect;
  const top = scope === 'row' ? rect.top : 0;
  const bottom = scope === 'row' ? rect.bottom : map.height;
  const left = scope === 'column' ? rect.left : 0;
  const right = scope === 'column' ? rect.right : map.width;
  view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, tableStart + map.map[top * map.width + left], tableStart + map.map[(bottom - 1) * map.width + right - 1])));
  view.focus(); return true;
}

/** Keep adjacent column totals fixed; one completed gesture is one undoable document change. */
export const ScaledTableResize = Extension.create({
  name: 'scaledTableResize', priority: 1100,
  addProseMirrorPlugins() {
    let cleanup = () => {};
    let dragging = false;
    const cellAt = (view: EditorView, event: MouseEvent) => {
      const cell = event.target instanceof Element ? event.target.closest<HTMLTableCellElement>('td,th') : null;
      return cell && view.dom.contains(cell) ? cell : null;
    };
    const rowEdge = (cell: HTMLTableCellElement, event: MouseEvent) => Math.abs(cell.getBoundingClientRect().bottom - event.clientY) <= 6;
    return [new Plugin({
      view: () => ({ destroy: () => cleanup() }),
      props: {
        handleKeyDown(view, event) {
          if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a' && selectTableCells(view, 'table')) { event.preventDefault(); return true; }
          return false;
        },
        handleDOMEvents: {
          mousemove(view, event) {
            if (dragging) return true;
            const cell = cellAt(view, event);
            view.dom.classList.toggle('row-resize-cursor', Boolean(view.editable && cell && rowEdge(cell, event)));
            return false;
          },
          mousedown(view, event) {
            const cell = cellAt(view, event);
            if (!view.editable || event.button !== 0 || !cell) return false;
            const box = cell.getBoundingClientRect();
            const pos = view.posAtDOM(cell, 0);
            const $pos = view.state.doc.resolve(pos);
            let depth = $pos.depth;
            while (depth > 0 && $pos.node(depth).type.spec.tableRole !== 'table') depth--;
            if (!depth) return false;
            const table = $pos.node(depth), tableStart = $pos.start(depth), tableDom = cell.closest('table')!;
            const map = TableMap.get(table);
            const cellPos = $pos.before(depth + 1);
            // posAtDOM(td, 0) resolves in the cell; locate its actual map offset, including merged cells.
            const offset = $pos.depth > depth + 1 ? $pos.before(depth + 2) - tableStart : cellPos - tableStart;
            const rect = map.findCell(offset);
            const rightEdge = Math.abs(box.right - event.clientX) <= 6;
            const leftEdge = Math.abs(box.left - event.clientX) <= 6;
            const column = rightEdge ? rect.right - 1 : leftEdge ? rect.left - 1 : -1;
            const isColumn = (rightEdge || leftEdge) && column >= 0 && column < map.width - 1;
            const isRow = !isColumn && rowEdge(cell, event);
            if (!isColumn && !isRow) {
              // Never delegate unsupported outer borders to native, unbounded column resizing.
              if (rightEdge || leftEdge) { event.preventDefault(); return true; }
              return false;
            }
            event.preventDefault(); cleanup(); dragging = true;
            view.dispatch(view.state.tr.setSelection(TextSelection.near($pos))); view.focus();
            const scale = displayScale(tableDom);
            const columns = [...tableDom.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col')];
            const originalStyles = columns.map(col => col.style.cssText);
            const widths = columns.map(col => col.getBoundingClientRect().width / scale);
            if (widths.length !== map.width) { dragging = false; return true; }
            const rowIndex = rect.bottom - 1, rowDom = tableDom.rows[rowIndex];
            const height = rowDom.getBoundingClientRect().height / scale;
            const rowPos = tableStart + Array.from({ length: rowIndex }, (_, index) => table.child(index).nodeSize).reduce((a, b) => a + b, 0);
            const doc = view.state.doc, win = view.dom.ownerDocument.defaultView!;
            let delta = 0;
            const guide = view.dom.ownerDocument.createElement('div');
            guide.className = 'structured-editor__row-resize-guide';
            guide.style.cssText = `position:fixed;pointer-events:none;z-index:1200;border-top:2px solid #1769e0;left:${tableDom.getBoundingClientRect().left}px;width:${tableDom.getBoundingClientRect().width}px`;
            if (isRow) view.dom.ownerDocument.body.append(guide);
            const move = (next: MouseEvent) => {
              if (view.isDestroyed || !view.state.doc.eq(doc)) { cleanup(); return; }
              delta = ((isColumn ? next.clientX - event.clientX : next.clientY - event.clientY) / scale);
              if (isColumn) {
                const minimum = Math.min(24, widths[column], widths[column + 1]);
                delta = Math.max(minimum - widths[column], Math.min(widths[column + 1] - minimum, delta));
                columns.forEach((col, index) => { col.style.width = `${widths[index] + (index === column ? delta : index === column + 1 ? -delta : 0)}px`; });
              } else {
                const minimum = Math.min(6 * 96 / 25.4, height), maximum = Math.max(100 * 96 / 25.4, height);
                delta = Math.max(minimum - height, Math.min(maximum - height, delta));
                guide.style.top = `${rowDom.getBoundingClientRect().bottom + delta * scale}px`;
              }
              next.preventDefault();
            };
            const finish = () => {
              const changed = Math.abs(delta * scale) >= 2 && !view.isDestroyed && view.state.doc.eq(doc);
              cleanup();
              if (!changed) return;
              let tr = closeHistory(view.state.tr);
              if (isColumn) tr = writeTableColumnWidths(tr, tableStart, table, widths.map((width, index) => width + (index === column ? delta : index === column + 1 ? -delta : 0)));
              else tr.setNodeMarkup(rowPos, undefined, { ...table.child(rowIndex).attrs, rowHeightMm: Math.round((height + delta) * 25.4 / 96 * 100) / 100 });
              view.dispatch(tr); view.dispatch(closeHistory(view.state.tr)); view.focus();
            };
            const cancel = (key: KeyboardEvent) => { if (key.key === 'Escape') { key.preventDefault(); cleanup(); } };
            let cleaned = false;
            cleanup = () => {
              if (cleaned) return;
              cleaned = true;
              win.removeEventListener('mousemove', move, true); win.removeEventListener('mouseup', finish, true); win.removeEventListener('keydown', cancel, true); win.removeEventListener('blur', cleanup);
              columns.forEach((col, index) => { col.style.cssText = originalStyles[index]; }); guide.remove(); dragging = false;
            };
            win.addEventListener('mousemove', move, true); win.addEventListener('mouseup', finish, true); win.addEventListener('keydown', cancel, true); win.addEventListener('blur', cleanup);
            return true;
          }
        }
      }
    })];
  }
});

export const ScaledImage = Image.extend({
  addNodeView() {
    const parent = this.parent?.();
    if (!parent) return null;
    return props => {
      const view = parent(props);
      if (!(view instanceof ResizableNodeView)) return view;
      let start = { width: 0, height: 0, scale: 1 };
      const begin = (event: Event) => {
        if (!(event.target instanceof Element) || !event.target.closest('[data-resize-handle]')) return;
        start = { width: view.element.offsetWidth, height: view.element.offsetHeight, scale: displayScale(view.element) };
      };
      view.dom.addEventListener('mousedown', begin, true); view.dom.addEventListener('touchstart', begin, true);
      const resize = view.onResize;
      view.onResize = (width, height) => {
        if (start.width && start.height && Math.abs(start.scale - 1) >= 0.001) {
          const style = getComputedStyle(props.editor.view.dom);
          const available = props.editor.view.dom.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
          const minimumWidth = Math.max(view.minSize.width, view.preserveAspectRatio ? view.minSize.height * start.width / start.height : 0);
          width = Math.min(available, Math.max(minimumWidth, start.width + (width - start.width) / start.scale));
          height = view.preserveAspectRatio ? width * start.height / start.width : Math.max(view.minSize.height, start.height + (height - start.height) / start.scale);
        }
        resize?.(width, height);
      };
      const destroy = view.destroy.bind(view);
      view.destroy = () => { view.dom.removeEventListener('mousedown', begin, true); view.dom.removeEventListener('touchstart', begin, true); destroy(); };
      return view;
    };
  }
});
