import { Extension, ResizableNodeView } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Plugin } from '@tiptap/pm/state';
import { columnResizingPluginKey } from '@tiptap/pm/tables';

const displayScale = (element: HTMLElement) => element.offsetWidth > 0 ? element.getBoundingClientRect().width / element.offsetWidth : 1;

/** Tiptap 3.30/PM tables mix client pixels with document pixels. Adapt their public hooks, not stored dimensions. */
export const ScaledTableResize = Extension.create({
  name: 'scaledTableResize', priority: 1100,
  addProseMirrorPlugins() {
    let cleanup = () => {};
    return [new Plugin({
      view: () => ({ destroy: () => cleanup() }),
      props: { handleDOMEvents: { mousedown(view, event) {
        const state = columnResizingPluginKey.getState(view.state);
        const scale = displayScale(view.dom);
        if (!view.editable || event.button !== 0 || !state || state.activeHandle < 0 || state.dragging || Math.abs(scale - 1) < 0.001) return false;
        cleanup();
        const origin = event.clientX;
        const win = view.dom.ownerDocument.defaultView!;
        const correct = (move: MouseEvent) => {
          if (view.isDestroyed) { cleanup(); return; }
          const dragging = columnResizingPluginKey.getState(view.state)?.dragging;
          if (dragging) view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setDragging: { ...dragging, startX: move.clientX - (move.clientX - origin) / scale } }).setMeta('addToHistory', false));
        };
        const finish = (up: MouseEvent) => { correct(up); cleanup(); };
        cleanup = () => { win.removeEventListener('mousemove', correct, true); win.removeEventListener('mouseup', finish, true); };
        win.addEventListener('mousemove', correct, true); win.addEventListener('mouseup', finish, true);
        return false; // The existing plugin still owns the actual resize and commit.
      } } }
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
