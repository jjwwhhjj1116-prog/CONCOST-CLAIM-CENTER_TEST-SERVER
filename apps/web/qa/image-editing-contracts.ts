import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { undoDepth } from '@tiptap/pm/history';
import { ScaledImage } from '../src/documents/document-resize-scale';
import { DocumentPresentationAttributes, editorHtmlToMarkdown, markdownToEditorHtml, normalizeStructuredDocumentHtml, renderStructuredDocumentHtml } from '../src/documents/StructuredDocumentEditor';
import expertProfile from '../../cloudflare/src/proposal-template-assets/CH04_EXPERT_PROFILE.jpg';

const directions = ['top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const;
const sample: JSONContent = { type: 'doc', content: [{ type: 'image', attrs: { src: '/qa/resize.svg', alt: 'Resize QA', width: 360, height: 180, alignment: 'right' } }] };

/** Native image node view + actual DOM dimensions, not mocked drag calculations. */
export async function imageEditingContracts(): Promise<string[]> {
  const results: string[] = [];
  const assert = (condition: unknown, message: string) => { if (!condition) throw Error(message); };
  const check = async (label: string, run: (editor: Editor) => void, scale = .75, content = sample) => {
    const host = document.createElement('div'); host.className = 'structured-editor is-a4-portrait';
    host.style.cssText = `position:fixed;left:-2500px;top:0;width:676px;zoom:${scale}`;
    document.body.append(host); const element = document.createElement('div'); host.append(element);
    const editor = new Editor({ element, extensions: [StarterKit, DocumentPresentationAttributes, ScaledImage.configure({ resize: { enabled: true, directions: [...directions], minWidth: 80, minHeight: 40, alwaysPreserveAspectRatio: false } })], content: { ...content, content: [...content.content!, { type: 'paragraph' }] } });
    editor.view.dom.style.cssText = 'width:676px;max-width:none;min-height:0;padding:0;border:0';
    try { await editor.view.dom.querySelector('img')!.decode(); editor.commands.setNodeSelection(0); run(editor); results.push(`PASS CF100 ${label}`); }
    catch (error) { results.push(`FAIL CF100 ${label}: ${String(error)}`); }
    finally { editor.destroy(); host.remove(); }
  };
  const image = (editor: Editor) => editor.view.dom.querySelector('img')!;
  const dimensions = (editor: Editor, width: number, height: number) => {
    const img = image(editor), attrs = editor.state.doc.firstChild!.attrs;
    assert(Math.abs(img.offsetWidth - width) <= 1 && Math.abs(img.offsetHeight - height) <= 1, `DOM ${img.offsetWidth}×${img.offsetHeight}, expected ${width}×${height}`);
    assert(Math.abs(Number(attrs.width) - width) <= 1 && Math.abs(Number(attrs.height) - height) <= 1, `JSON ${attrs.width}×${attrs.height}`);
  };
  const gesture = (editor: Editor, direction: string, dx: number, dy: number, cancel = false, shiftKey = false) => {
    const handle = editor.view.dom.querySelector<HTMLElement>(`[data-resize-handle="${direction}"]`)!;
    const box = handle.getBoundingClientRect(), clientX = box.x + box.width / 2, clientY = box.y + box.height / 2;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, buttons: 1, clientX, clientY, shiftKey }));
    if (dx || dy) document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1, clientX: clientX + dx, clientY: clientY + dy, shiftKey }));
    if (cancel) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: clientX + dx, clientY: clientY + dy }));
  };
  for (const scale of [1, .7]) for (const direction of directions) await check(`${scale * 100}% ${direction} 독립 축·실행취소`, editor => {
    assert(editor.view.dom.querySelectorAll('[data-resize-handle]').length === 8, '8방향 누락');
    gesture(editor, direction, 28, 21);
    const width = 360 + (direction.includes('left') ? -28 / scale : direction.includes('right') ? 28 / scale : 0);
    const height = 180 + (direction.includes('top') ? -21 / scale : direction.includes('bottom') ? 21 / scale : 0);
    dimensions(editor, Math.round(width), Math.round(height)); assert(undoDepth(editor.state) === 1, `드래그 undo 단위: ${undoDepth(editor.state)}`);
    editor.commands.undo(); dimensions(editor, 360, 180); editor.commands.redo(); dimensions(editor, Math.round(width), Math.round(height));
  }, scale);
  await check('CH04 기본360px 이미지 확장·미리보기 명시적 높이·undo', editor => {
    assert(image(editor).offsetWidth === 360, '공통양식 시작 크기');
    const height = image(editor).offsetHeight;
    gesture(editor, 'right', 30, 0); dimensions(editor, 400, height);
    const preview = document.createElement('div'); preview.className = 'structured-editor__preview';
    preview.style.cssText = 'width:676px;padding:0;border:0'; preview.innerHTML = renderStructuredDocumentHtml(editor.getJSON()); document.body.append(preview);
    try { const img = preview.querySelector('img')!; assert(img.offsetWidth === 400 && img.offsetHeight === height, '출력 높이/폭 불일치'); }
    finally { preview.remove(); }
    editor.commands.undo(); assert(image(editor).offsetWidth === 360 && !image(editor).hasAttribute('width'), '기본 치수 undo 복원');
  }, .75, { type: 'doc', content: [{ type: 'image', attrs: { src: expertProfile } }] });
  await check('경계 클릭·Esc는 JSON/DOM/undo 기록 불변', editor => {
    const before = JSON.stringify(editor.getJSON()), css = image(editor).style.cssText;
    gesture(editor, 'right', 0, 0); gesture(editor, 'bottom-right', 30, 40, true);
    assert(JSON.stringify(editor.getJSON()) === before && image(editor).style.cssText === css && undoDepth(editor.state) === 0, `클릭/취소가 편집으로 저장됨: undo=${undoDepth(editor.state)}, JSON=${JSON.stringify(editor.getJSON()) === before}, CSS=${image(editor).style.cssText === css}`);
  });
  await check('연속 드래그 각각 undo/redo', editor => {
    gesture(editor, 'right', 30, 0); gesture(editor, 'bottom', 0, 30); dimensions(editor, 400, 220);
    assert(undoDepth(editor.state) === 2, '두 드래그가 하나로 병합');
    editor.commands.undo(); dimensions(editor, 400, 180); editor.commands.undo(); dimensions(editor, 360, 180);
    editor.commands.redo(); editor.commands.redo(); dimensions(editor, 400, 220);
  });
  await check('Shift 비율 유지·최소치·본문 폭 제한', editor => {
    gesture(editor, 'bottom-right', 30, 0, false, true); dimensions(editor, 400, 200);
    gesture(editor, 'right', 3000, 0); dimensions(editor, 676, 200);
    gesture(editor, 'bottom', 0, 3000); dimensions(editor, 676, 680);
    gesture(editor, 'bottom-right', -3000, -3000); dimensions(editor, 80, 40);
  });
  await check('명시적 치수/정렬 JSON·HTML·Markdown 5회 보존', editor => {
    editor.commands.updateAttributes('image', { width: 420, height: 300 }); dimensions(editor, 420, 300);
    for (let i = 0; i < 5; i++) {
      editor.commands.setContent(markdownToEditorHtml(editorHtmlToMarkdown(renderStructuredDocumentHtml(editor.getJSON()))));
      dimensions(editor, 420, 300); assert(editor.state.doc.firstChild!.attrs.alignment === 'right', '정렬 유실');
      assert(editor.state.doc.firstChild!.attrs.src === '/qa/resize.svg', '원본 유실');
    }
  });
  await check('가로만 조절 시 큰 기존 높이 유지', editor => {
    gesture(editor, 'right', 30, 0); dimensions(editor, 400, 900);
  }, .75, { type: 'doc', content: [{ type: 'image', attrs: { src: '/qa/resize.svg', width: 360, height: 900 } }] });
  await check('세로만 조절 시 작은 기존 폭 유지', editor => {
    gesture(editor, 'bottom', 0, 30); dimensions(editor, 50, 220);
  }, .75, { type: 'doc', content: [{ type: 'image', attrs: { src: '/qa/resize.svg', width: 50, height: 180 } }] });
  await check('가져온 HTML의 속성·px 스타일 혼합 치수와 % 스타일 보존', () => {
    for (const dimensions of ['height="180" style="width:360px"', 'width="360" style="height:180px"', 'style="width:360px;height:180px"']) {
      const html = normalizeStructuredDocumentHtml(`<img src="/qa/resize.svg" ${dimensions}>`);
      const image = new DOMParser().parseFromString(html, 'text/html').querySelector('img')!;
      assert(image.width === 360 && image.height === 180 && image.style.width === '360px' && image.style.height === '180px', '혼합 치수 유실');
    }
    const html = normalizeStructuredDocumentHtml('<img src="/qa/resize.svg" height="180" style="width:50%">');
    assert(new DOMParser().parseFromString(html, 'text/html').querySelector('img')!.style.width === '50%', '상대 폭 스타일 삭제');
  });
  await check('읽기전용 전환은 손잡이 숨김·치수 변경 차단', editor => {
    editor.setEditable(false); const before = JSON.stringify(editor.getJSON());
    assert([...editor.view.dom.querySelectorAll<HTMLElement>('[data-resize-handle]')].every(handle => getComputedStyle(handle).display === 'none'), '읽기전용 손잡이 노출');
    if (editor.view.dom.querySelector('[data-resize-handle]')) gesture(editor, 'right', 30, 0);
    assert(JSON.stringify(editor.getJSON()) === before, '읽기전용 드래그 저장'); dimensions(editor, 360, 180);
  });
  return results;
}
