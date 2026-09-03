import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { NodeSelection } from '@tiptap/pm/state';
import { DocumentSpacer, DocumentTextStyle } from '../src/documents/StructuredDocumentEditor';
import { applyDocumentAction, DocumentSpacingSelection, preserveSpacingSelection, selectedSpacingPositions } from '../src/documents/document-editing-actions';

/** Actual ProseMirror documents/transactions; fixture-only, no application data or network. */
export function editingContracts(): string[] {
  const results: string[] = [];
  const assert = (condition: unknown, label: string) => { if (!condition) throw Error(label); };
  const check = (label: string, fn: (editor: Editor) => void) => {
    const editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit, TableKit, TextAlign.configure({ types:['paragraph','heading'] }), DocumentSpacer, DocumentTextStyle, DocumentSpacingSelection], content: '<p>alpha</p><div data-document-spacer="24"></div><p>bravo</p><div data-document-spacer="12"></div><p>charlie</p><div data-document-spacer="16"></div><p>delta</p>' });
    try { fn(editor); results.push(`PASS ${label}`); } catch (error) { results.push(`FAIL ${label}: ${String(error)}`); } finally { editor.destroy(); }
  };
  const spacers = (editor: Editor) => { const found: number[] = []; editor.state.doc.descendants((node, pos) => { if (node.type.name === 'documentSpacer') found.push(pos); }); return found; };
  const choose = (editor: Editor, pos: number) => editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
  const ctrlClick = (editor: Editor, pos: number) => editor.view.someProp('handleClickOn', fn => fn(editor.view, pos, editor.state.doc.nodeAt(pos)!, pos, new MouseEvent('click', {ctrlKey:true}), true));
  check('Ctrl 3개 선택·토글·48px 일괄 적용·undo', editor => {
    const pos = spacers(editor); choose(editor, pos[0]); ctrlClick(editor, pos[1]); ctrlClick(editor, pos[2]);
    assert(selectedSpacingPositions(editor).length === 3, '다중선택'); ctrlClick(editor, pos[1]);
    assert(selectedSpacingPositions(editor).join() === [pos[0],pos[2]].join(), '선택해제');
    preserveSpacingSelection(editor);
    editor.commands.setTextSelection(1); // Toolbar focus must not erase the preserved spacing selection.
    const before = editor.getJSON();
    assert(applyDocumentAction(editor, {kind:'spacing',height:48}), '일괄적용');
    assert(spacers(editor).map(p=>editor.state.doc.nodeAt(p)?.attrs.heightPx).join() === '48,12,48', '미선택 노드 변경');
    assert(!JSON.stringify(editor.getJSON()).includes('is-spacing-selected'), '선택상태 저장');
    editor.commands.undo(); assert(JSON.stringify(editor.getJSON()) === JSON.stringify(before), 'undo 한 번 복원');
  });
  check('Ctrl 전체 해제 후 새 빈 줄만 선택', editor => {
    const pos=spacers(editor);choose(editor,pos[0]);ctrlClick(editor,pos[0]);
    assert(selectedSpacingPositions(editor).length===0,'전체 해제');ctrlClick(editor,pos[1]);
    assert(selectedSpacingPositions(editor).join()===String(pos[1]),'해제한 빈 줄 재선택');
  });
  check('다중 선택 앞 텍스트 삽입 후 위치 매핑·삭제·undo', editor => {
    const pos = spacers(editor); choose(editor,pos[0]); ctrlClick(editor,pos[2]);
    editor.view.dispatch(editor.state.tr.insertText('prefix',1));
    assert(selectedSpacingPositions(editor).join() === [pos[0]+6,pos[2]+6].join(), '위치 매핑');
    const before = editor.getJSON(); applyDocumentAction(editor,{kind:'deleteSpacing'});
    assert(spacers(editor).length === 1, '선택 노드만 삭제'); editor.commands.undo();
    assert(JSON.stringify(before) === JSON.stringify(editor.getJSON()), '삭제 undo');
  });
  check('글꼴·크기 반복은 현재 선택에만 적용', editor => {
    editor.commands.setTextSelection({from:1,to:6});
    const action = {kind:'text' as const,attrs:{fontFamily:'Batang',fontSize:24}};
    applyDocumentAction(editor,action); editor.commands.setTextSelection({from:9,to:14}); applyDocumentAction(editor,action);
    const paragraphs = editor.getJSON().content!.filter(n=>n.type==='paragraph');
    assert(paragraphs[0].content?.[0].marks?.some(m=>m.attrs?.fontSize===24),'첫 대상');
    assert(paragraphs[1].content?.[0].marks?.some(m=>m.attrs?.fontSize===24),'새 대상');
    assert(!paragraphs[2].content?.[0].marks?.length,'미선택 대상 오염');
  });
  check('굵게 반복은 토글하지 않고 결과 유지', editor => {
    editor.commands.setTextSelection({from:1,to:6}); const action = {kind:'mark' as const,name:'bold' as const,enabled:true};
    applyDocumentAction(editor,action); applyDocumentAction(editor,action); assert(editor.isActive('bold'),'굵게 해제됨');
  });
  check('빈 줄 삽입 반복·정렬 반복·읽기전용 방어', editor => {
    editor.commands.setTextSelection(2); applyDocumentAction(editor,{kind:'insertSpacer',height:36}); applyDocumentAction(editor,{kind:'insertSpacer',height:36});
    assert(spacers(editor).length===5,'반복삽입 누락');
    editor.commands.setTextSelection(1); applyDocumentAction(editor,{kind:'align',alignment:'center'});
    assert(editor.state.doc.firstChild?.attrs.textAlign==='center','정렬');
    const before=JSON.stringify(editor.getJSON());editor.setEditable(false);
    assert(!applyDocumentAction(editor,{kind:'insertSpacer',height:50})&&before===JSON.stringify(editor.getJSON()),'읽기전용 변경');
  });
  check('표 행·열 수 반복', editor => {
    const action={kind:'table' as const,rows:3,columns:2}; editor.commands.setTextSelection(1); applyDocumentAction(editor,action);
    editor.commands.setTextSelection(editor.state.doc.content.size-1);applyDocumentAction(editor,action);
    const tables=editor.getJSON().content!.filter(n=>n.type==='table');
    assert(tables.length===2&&tables.every(t=>t.content?.length===3&&t.content.every(r=>r.content?.length===2)),'표 반복 치수');
  });
  return results;
}
