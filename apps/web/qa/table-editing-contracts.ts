import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { undoDepth } from '@tiptap/pm/history';
import { DocumentPresentationAttributes, DocumentTableView, DocumentTextStyle, markdownToEditorHtml, normalizeA4TableJson, renderStructuredDocumentHtml } from '../src/documents/StructuredDocumentEditor';
import { ScaledTableResize, selectTableCells, writeTableColumnWidths } from '../src/documents/document-resize-scale';
import { applyDocumentAction } from '../src/documents/document-editing-actions';

const p = (text:string):JSONContent => ({type:'paragraph',content:[{type:'text',text}]});
const sample:JSONContent={type:'doc',content:[p('표 밖 문장'),{type:'table',attrs:{documentDefaultsVersion:2,tableWidth:100},content:Array.from({length:3},(_,row)=>({type:'tableRow',content:[226,225,225].map((width,col)=>({type:row?'tableCell':'tableHeader',attrs:{colwidth:[width]},content:[p(`${row},${col}`)]}))}))},p('표 뒤 문장')]};

/** Runs real editor schema, node view and DOM event plugins in the local browser fixture. */
export function tableEditingContracts():string[]{
  const results:string[]=[];
  const assert=(condition:unknown,label:string)=>{if(!condition)throw Error(label);};
  const check=(label:string,fn:(editor:Editor)=>void,content:JSONContent|string=sample)=>{
    const host=document.createElement('div');host.className='structured-editor is-a4-portrait';
    host.style.cssText='position:fixed;left:-2500px;top:0;width:676px;zoom:.75';document.body.append(host);
    const element=document.createElement('div');host.append(element);
    const editor=new Editor({element,extensions:[StarterKit,TableKit.configure({table:{resizable:true,lastColumnResizable:false,allowTableNodeSelection:false,View:DocumentTableView}}),DocumentPresentationAttributes,DocumentTextStyle,ScaledTableResize],content});
    editor.view.dom.style.cssText='width:676px;max-width:none;min-height:0;padding:0';
    try{fn(editor);results.push(`PASS CF99 ${label}`);}catch(error){results.push(`FAIL CF99 ${label}: ${String(error)}`);}finally{editor.destroy();host.remove();}
  };
  const tableInfo=(editor:Editor)=>{
    let pos=0;editor.state.doc.forEach((node,offset)=>{if(node.type.name==='table')pos=offset;});
    const table=editor.state.doc.nodeAt(pos)!;return {table,start:pos+1,map:TableMap.get(table)};
  };
  const tableDom=(editor:Editor)=>editor.view.dom.querySelector('table')!;
  const widths=(editor:Editor)=>[...tableDom(editor).querySelectorAll('col')].map(col=>col.getBoundingClientRect().width);
  const equalWidths=(a:number[],b:number[])=>a.length===b.length&&a.every((value,index)=>Math.abs(value-b[index])<1);
  const choose=(editor:Editor,first=0,last=first)=>{
    const {map,start}=tableInfo(editor);editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,start+map.map[first],start+map.map[last])));
  };
  const gesture=(editor:Editor,axis:'column'|'row',delta:number,cancel=false)=>{
    const cell=tableDom(editor).rows[0].cells[0],box=cell.getBoundingClientRect();
    const clientX=axis==='column'?box.right-1:box.left+box.width/2,clientY=axis==='row'?box.bottom-1:box.top+box.height/2;
    cell.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,buttons:1,clientX,clientY}));
    if(delta)window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,cancelable:true,buttons:1,clientX:clientX+(axis==='column'?delta:0),clientY:clientY+(axis==='row'?delta:0)}));
    if(cancel)window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX,clientY}));
  };
  check('6열 Markdown 입력은 모든 셀 치수·자동 행 높이를 복원',editor=>{
    const html=markdownToEditorHtml('| 업무 | 금액 |\n|---|---|\n| 검토 | 100 |');
    assert(new DOMParser().parseFromString(html,'text/html').querySelector('table')?.dataset.tableDensity==='normal','최초 미리보기와 편집 후 기본 간격 불일치');
    const {table}=tableInfo(editor);table.forEach(row=>{assert(row.attrs.rowHeightMm===null,'빈 높이를6mm로 변경');row.forEach(cell=>assert(cell.attrs.colwidth?.length===1&&cell.attrs.colwidth[0]>0,'불완전한 열폭'));});
  },markdownToEditorHtml('| 담당 | 성명 | 학력 | 이메일 | 연락처 | 팩스 |\n|---|---|---|---|---|---|\n| 총괄 | 담당자 | 박사 | test@example.com | 070-0000-0000 | 02-0000-0000 |'));
  check('불완전한 과거 colwidth도 TableView 반복 갱신에 증폭되지 않음',editor=>{
    const {table}=tableInfo(editor);const json=table.toJSON();json.content![0].content!.forEach((cell,index)=>{cell.attrs={...cell.attrs,colwidth:index?[null]:[112]};});
    const node=editor.schema.nodeFromJSON(json),view=new DocumentTableView(node,24,editor.view);
    const before=view.table.querySelector('colgroup')!.outerHTML;
    for(let i=0;i<10;i++)view.update(node);
    assert(view.table.querySelector('colgroup')!.outerHTML===before,'DOM % 재입력으로 열폭 증폭');
  });
  check('경계 클릭·Esc는 문서/화면/undo 기록을 변경하지 않음',editor=>{
    const json=JSON.stringify(editor.getJSON()),before=widths(editor),depth=undoDepth(editor.state);
    gesture(editor,'column',0);gesture(editor,'column',24,true);
    assert(JSON.stringify(editor.getJSON())===json&&equalWidths(before,widths(editor))&&undoDepth(editor.state)===depth,'클릭/취소 변경');
  });
  check('75% 축소 열 드래그 두 번·개별 undo·고정 전체 너비',editor=>{
    const initial=JSON.stringify(editor.getJSON()),before=widths(editor);
    gesture(editor,'column',24);const once=JSON.stringify(editor.getJSON()),onceWidths=widths(editor);
    assert(Math.abs(onceWidths[0]-before[0]-24)<1,'축소 비율 중복/누락');
    gesture(editor,'column',24);assert(undoDepth(editor.state)===2,'드래그 히스토리 병합');
    assert(Math.abs(widths(editor).reduce((a,b)=>a+b)-before.reduce((a,b)=>a+b))<1,'표 전체 너비 변경');
    editor.commands.undo();assert(JSON.stringify(editor.getJSON())===once&&equalWidths(widths(editor),onceWidths),'첫undo DOM/JSON 불일치');
    editor.commands.undo();assert(JSON.stringify(editor.getJSON())===initial&&equalWidths(widths(editor),before),'둘째undo DOM/JSON 불일치');
  });
  check('행 하단 드래그·undo는 열 폭과 다른 행을 보존',editor=>{
    const initial=JSON.stringify(editor.getJSON()),before=widths(editor),height=tableDom(editor).rows[0].getBoundingClientRect().height;
    gesture(editor,'row',24);const {table}=tableInfo(editor);
    assert(table.child(0).attrs.rowHeightMm>0&&table.child(1).attrs.rowHeightMm===null,'행 범위');
    assert(tableDom(editor).rows[0].getBoundingClientRect().height>height+20&&equalWidths(before,widths(editor)),'행 높이/열 너비');
    editor.commands.undo();assert(JSON.stringify(editor.getJSON())===initial,'행undo');
  });
  check('2x2 셀 선택 서식·선택 표시가 표 밖으로 번지지 않음',editor=>{
    choose(editor,0,4);applyDocumentAction(editor,{kind:'text',attrs:{fontSize:14}});
    const {table}=tableInfo(editor);table.forEach((row,_pos,r)=>row.forEach((cell,_offset,c)=>assert(Boolean(cell.firstChild?.firstChild?.marks.some(mark=>mark.attrs.fontSize===14))===(r<2&&c<2),'선택 밖 글자 변경')));
    assert(editor.state.doc.firstChild?.firstChild?.marks.length===0,'표 밖 변경');
    const selected=[...editor.view.dom.querySelectorAll<HTMLElement>('.selectedCell')];assert(selected.length===4,'셀 선택 누락');
    assert(selected.every(cell=>getComputedStyle(cell).position==='relative'&&getComputedStyle(cell,'::after').position==='absolute'),'선택 오버레이 기준');
    assert(selected.every(cell=>getComputedStyle(cell.querySelector('p')!).marginBottom==='0px'),'A4 셀 안에 본문16px간격 유입');
    assert(selectTableCells(editor.view,'table')&&(editor.state.selection as CellSelection).isRowSelection(),'표 전체 선택');
    assert(editor.view.dom.querySelectorAll('.selectedCell').length===9,'문서 전체 대신 표 선택');
  });
  check('높이만·자동 높이·너비만 적용과 undo',editor=>{
    choose(editor,3,4);const before=JSON.stringify(editor.getJSON());
    applyDocumentAction(editor,{kind:'measurements',width:null,height:18});
    const row=tableInfo(editor).table.child(1);assert(row.attrs.rowHeightMm===18&&row.firstChild?.attrs.colwidth[0]===226,'높이가 열 변경');
    applyDocumentAction(editor,{kind:'measurements',width:30});assert(tableInfo(editor).table.child(1).attrs.rowHeightMm===18,'너비가 높이 변경');
    editor.commands.undo();applyDocumentAction(editor,{kind:'measurements',width:null,height:null});assert(tableInfo(editor).table.child(1).attrs.rowHeightMm===null,'자동 높이 미적용');
    editor.commands.undo();editor.commands.undo();assert(JSON.stringify(editor.getJSON())===before,'명령 단위undo');
  });
  check('병합 셀 치수 저장·JSON 재진입·HTML 왕복',editor=>{
    const cell=(text:string,colwidth:number[],attrs={})=>({type:'tableCell',attrs:{colwidth,...attrs},content:[p(text)]});
    const source:JSONContent={type:'doc',content:[{type:'table',attrs:{documentDefaultsVersion:2},content:[{type:'tableRow',attrs:{rowHeightMm:18},content:[cell('A',[100],{rowspan:2}),cell('B',[250,326],{colspan:2})]},{type:'tableRow',content:[cell('C',[250]),cell('D',[326])]}]}]};
    const node=editor.schema.nodeFromJSON(source.content![0]),tr=editor.state.tr;
    editor.commands.setContent(source);const info=tableInfo(editor);
    editor.view.dispatch(writeTableColumnWidths(editor.state.tr,info.start,info.table,[100,250,326]));
    const normalized=normalizeA4TableJson(editor.getJSON()),rows=normalized.content![0].content!;
    assert(rows[1].content![0].attrs?.colwidth.join()==='250'&&rows[1].content![1].attrs?.colwidth.join()==='326','rowspan 재진입');
    assert(rows[0].attrs?.rowHeightMm===18,'높이 유실');
    const dom=new DOMParser().parseFromString(renderStructuredDocumentHtml(normalized,{pageMode:'a4-portrait'}),'text/html');
    assert(dom.querySelectorAll('tr')[1].cells[0].getAttribute('colwidth')==='250','HTML rowspan');
    assert(TableMap.get(node).width===3&&tr.doc,'유효한 병합표');
  });
  check('수동24px 좁은 열·현재 행높이/정렬은 손상 복구 대상 아님',editor=>{
    const source:JSONContent={type:'doc',content:[{type:'table',attrs:{documentDefaultsVersion:2},content:[{type:'tableRow',attrs:{rowHeightMm:18},content:[24,652].map(width=>({type:'tableCell',attrs:{colwidth:[width],verticalAlignment:'bottom',horizontalAlignment:'left'},content:[p('텍스트')]}))}]}]};
    const normalized=normalizeA4TableJson(source),row=normalized.content![0].content![0];
    assert(row.content![0].attrs?.colwidth[0]===24&&row.attrs?.rowHeightMm===18&&row.content![0].attrs?.verticalAlignment==='bottom','명시적 치수/정렬 변경');
    editor.commands.setContent(normalized);assert(widths(editor)[0]<30,'좁은 열 균등 배분');
    const again=normalizeA4TableJson(normalized);assert(JSON.stringify(again)===JSON.stringify(normalized),'정규화 비멱등');
  });
  check('읽기전용에서 표 선택·치수 변경 차단',editor=>{
    choose(editor);editor.setEditable(false);const before=JSON.stringify(editor.getJSON());
    assert(!selectTableCells(editor.view,'table')&&!applyDocumentAction(editor,{kind:'measurements',width:null,height:30}),'읽기전용 명령');
    gesture(editor,'row',24);assert(JSON.stringify(editor.getJSON())===before,'읽기전용 드래그');
  });
  return results;
}
