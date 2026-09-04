/** Paginate rendered HTML only; never insert layout nodes into the saved editor. */
export function paginateReport(source: HTMLElement, height: number): { pages: string[]; overflow: boolean } {
  const tester = source.cloneNode(false) as HTMLElement;
  tester.style.cssText = `position:absolute;left:0;top:0;width:${source.clientWidth}px;height:auto;min-height:0;max-height:none;display:flow-root;overflow:visible;margin:0;`;
  source.append(tester);
  const pages: string[] = [];
  let overflow = height < 40;
  const fits = () => tester.scrollHeight <= height + 1 && tester.scrollWidth <= source.clientWidth + 1;
  const commit = () => { if (tester.childNodes.length) { pages.push(tester.innerHTML); tester.replaceChildren(); } };
  const appendAtomic = (node: Node) => {
    const copy = node.cloneNode(true); tester.append(copy);
    if (fits()) return;
    copy.parentNode?.removeChild(copy); commit(); tester.append(copy);
    if (!fits()) overflow = true;
  };
  // DOM ranges retain inline formatting, links, line breaks and images when a
  // paragraph is taller than a sheet. Only text/BR boundaries can be split.
  const splitTextBlock = (block: HTMLElement) => {
    let rest = block.cloneNode(true) as HTMLElement;
    while (rest.childNodes.length) {
      tester.append(rest);
      if (fits()) return;
      rest.remove();
      const positions: Array<[Node, number]> = [];
      const walk = document.createTreeWalker(rest, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      while (walk.nextNode()) {
        const node = walk.currentNode;
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? '';
          for (let offset = 1; offset <= text.length; offset++) {
            if (offset < text.length && /[\uD800-\uDBFF]/u.test(text[offset - 1])) continue;
            positions.push([node, offset]);
          }
        } else if ((node as Element).tagName === 'BR' && node.parentNode) {
          positions.push([node.parentNode, Array.prototype.indexOf.call(node.parentNode.childNodes, node) + 1]);
        }
      }
      const fragment = (at: number, tail = false) => {
        const range = document.createRange(); range.selectNodeContents(rest);
        if (tail) range.setStart(...positions[at]); else range.setEnd(...positions[at]);
        const shell = rest.cloneNode(false) as HTMLElement; shell.append(range.cloneContents()); return shell;
      };
      let low = 0, high = positions.length - 1, best = -1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2), part = fragment(mid);
        tester.append(part); const ok = fits(); part.remove();
        if (ok) { best = mid; low = mid + 1; } else high = mid - 1;
      }
      if (best < 0) {
        if (tester.childNodes.length) { commit(); continue; }
        appendAtomic(rest); return;
      }
      tester.append(fragment(best)); commit(); rest = fragment(best, true);
      // A continuation is not a new indented paragraph/list item.
      rest.style.textIndent = '0';
      if (rest.tagName === 'LI') rest.style.listStyleType = 'none';
      if (['UL', 'OL'].includes(rest.tagName) && rest.firstElementChild instanceof HTMLElement) rest.firstElementChild.style.listStyleType = 'none';
    }
  };
  const splitList = (list: HTMLOListElement) => {
    let ordinal = Number(list.getAttribute('start') ?? (list.reversed ? list.children.length : 1));
    const direction = list.reversed ? -1 : 1;
    for (const item of [...list.children]) {
      if (item.hasAttribute('value')) ordinal = Number(item.getAttribute('value'));
      const shell = list.cloneNode(false) as HTMLElement;
      if (list.tagName === 'OL') shell.setAttribute('start', String(ordinal));
      shell.append(item.cloneNode(true)); tester.append(shell);
      if (!fits()) {
        shell.remove(); commit(); tester.append(shell);
        if (!fits()) { shell.remove(); if (item.querySelector('table')) appendAtomic(shell); else splitTextBlock(shell); }
      }
      ordinal += direction;
    }
  };
  const splitTable = (table: HTMLTableElement) => {
    const rows = [...table.rows]; // Direct table rows, not nested table rows.
    const headers = rows.filter((row, index) => row.parentElement?.tagName === 'THEAD' || (index === 0 && [...row.cells].every(cell => cell.tagName === 'TH')));
    const bodyRows = rows.filter(row => !headers.includes(row));
    const shell = () => {
      const next = table.cloneNode(false) as HTMLTableElement;
      for (const child of [...table.children]) if (['COLGROUP', 'CAPTION'].includes(child.tagName)) next.append(child.cloneNode(true));
      if (headers.length) { const head = next.createTHead(); headers.forEach(row => head.append(row.cloneNode(true))); }
      next.createTBody(); return next;
    };
    let current = shell(); tester.append(current);
    for (let index = 0; index < bodyRows.length;) {
      // Keep every connected rowspan group on one sheet.
      const group: HTMLTableRowElement[] = []; let end = index + 1;
      for (; index < Math.min(end, bodyRows.length); index++) {
        const row = bodyRows[index]; group.push(row);
        for (const cell of [...row.cells]) end = Math.max(end, cell.rowSpan === 0 ? bodyRows.length : index + cell.rowSpan);
      }
      const copies = group.map(row => row.cloneNode(true)); current.tBodies[0].append(...copies);
      if (!fits()) {
        copies.forEach(copy => copy.parentNode?.removeChild(copy));
        if (!current.tBodies[0].rows.length) current.remove();
        commit(); current = shell(); tester.append(current); current.tBodies[0].append(...copies);
        if (!fits()) overflow = true;
      }
    }
    if (!bodyRows.length && !fits()) { current.remove(); appendAtomic(table); }
  };
  try {
    for (const node of [...source.childNodes].filter(node => node !== tester)) {
      if (node instanceof HTMLElement && node.hasAttribute('data-document-page-break')) { commit(); continue; }
      const copy = node.cloneNode(true); tester.append(copy);
      if (fits()) continue;
      copy.parentNode?.removeChild(copy);
      if (node instanceof HTMLTableElement) splitTable(node);
      else if (node instanceof HTMLElement && ['UL', 'OL'].includes(node.tagName)) splitList(node as HTMLOListElement);
      else if (node instanceof HTMLElement && !node.querySelector('table') && node.textContent?.length) splitTextBlock(node);
      else appendAtomic(node);
    }
    commit(); return { pages: pages.length ? pages : [''], overflow };
  } finally { tester.remove(); }
}
