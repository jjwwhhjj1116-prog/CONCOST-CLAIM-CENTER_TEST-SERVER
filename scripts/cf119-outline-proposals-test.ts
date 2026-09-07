import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium, type Page } from 'playwright-core';

// Actual Studio and event handlers; synthetic API only, isolated Chrome, no external requests.
test('CF119 outline candidates remain separate until explicitly applied and saved', async t => {
  const { createServer } = await import('../apps/web/node_modules/vite/dist/node/index.js');
  const server = await createServer({ root: fileURLToPath(new URL('../apps/web', import.meta.url)), server: { host: '127.0.0.1', port: 0, hmr:false }, logLevel: 'error', plugins: [{
    name: 'cf119-outline-fixture', enforce: 'pre',
    transform(code: string, id: string) {
      if (!id.replaceAll('\\', '/').endsWith('/qa/cf114-studio.tsx')) return;
      const replace = (before: string, after: string) => { assert.ok(code.includes(before), `Fixture anchor missing: ${before}`); code = code.replace(before, after); };
      replace('window.fetch = async (input, init) => {', `
        cases.push({ ...cases[0], id:'cf119-other', caseNumber:'CF119-002', title:'다른 합성 프로젝트' });
        const cf119 = { mode:params.get('mode') || 'success', hold:params.has('hold'), pending:false, release:null, requests:[], puts:[], outlineWrites:[], remount:null, snapshot:() => structuredClone({draft,outline}) };
        window.cf119 = cf119;
        const templateLibrary = [
          { id:'reference-01', categoryCode:'REF-01', displayName:'현재 유형 원본', primaryClaimType:'TYPE-01', secondaryClaimTypes:[], matchesCurrentType:true, expectedSourceCount:1, uploadedSourceCount:0, analysisVersion:1, analysisSummary:'TYPE-01', files:[], outline:['1. TYPE01 전용 검토 결론','2. TYPE01 전용 현장조사'] },
          { id:'reference-04', categoryCode:'REF-04', displayName:'다른 유형 원본', primaryClaimType:'TYPE-04', secondaryClaimTypes:[], matchesCurrentType:false, expectedSourceCount:1, uploadedSourceCount:0, analysisVersion:1, analysisSummary:'TYPE-04', files:[], outline:['1. TYPE04 참고 보수비','2. TYPE04 참고 기성금'] }
        ];
        const otherItems = () => outline.items.map((item,index) => ({...item,chapterTitle:'다른 프로젝트 제목 ' + (index+1)}));
        window.fetch = async (input, init) => {`);
      replace("  if (method === 'POST' && url.pathname === '/api/report-chapter-collaboration') {", `
        if (method === 'POST' && url.pathname === '/api/report-authoring/outline/generate') {
          cf119.requests.push(JSON.parse(String(init?.body)));
          if (cf119.hold) { cf119.pending=true; await new Promise(resolve => { cf119.release=() => { cf119.pending=false; resolve(); }; }); }
          if (cf119.mode === 'failure') return response({error:'합성 AI 응답 실패'},502);
          const suggestions=chapters.map((ch,index) => ({chapterId:ch.id,chapterCode:ch.chapterCode,chapterTitle:'AI 제안 제목 '+(index+1),planningNote:'검증된 근거 검토 '+(index+1)}));
          if (cf119.mode === 'malformed') suggestions[1].chapterId='unknown';
          return response({suggestions,provider:'QA',model:'synthetic'});
        }
        if (method === 'POST' && url.pathname === '/api/report-chapter-collaboration') {`);
      replace("if (method === 'PUT' && url.pathname === '/api/report-drafts') {\n    const body = JSON.parse(String(init?.body));", "if (method === 'PUT' && url.pathname === '/api/report-drafts') {\n    const body = JSON.parse(String(init?.body)); cf119.puts.push(body);");
      replace("if (method === 'PUT' && url.pathname === '/api/report-authoring/outline') {\n    const body = JSON.parse(String(init?.body));", `if (method === 'PUT' && url.pathname === '/api/report-authoring/outline') {
        const body=JSON.parse(String(init?.body)); cf119.outlineWrites.push(body);
        if (cf119.mode === 'save-failure') return response({error:'합성 목차 저장 실패'},503);`);
      replace("if (url.pathname === '/api/report-drafts') return response({ draft, revisions: [], backups: [] });", "if (url.pathname === '/api/report-drafts') return response({ draft:url.searchParams.get('caseId') === 'cf119-other' ? {...draft,caseId:'cf119-other',title:'다른 보고서',wizardStep:2} : draft,revisions:[],backups:[] });");
      replace("outlinePlan: outline, sourceGroups: [], templates: [], templateLibrary: [], aiConnected: true", "outlinePlan:url.searchParams.get('caseId') === 'cf119-other' ? {...outline,items:otherItems()} : outline, sourceGroups:[],templates:[],templateLibrary,outlineAiConnected:cf119.mode !== 'disconnected',aiConnected:true");
      replace("createRoot(document.getElementById('root')!).render(", `
        function OutlineRouteFixture() {
          const [routeKey,setRouteKey]=React.useState(0);
          cf119.remount=() => setRouteKey(value=>value+1);
          return <PreviewReportStudio key={routeKey} roles={['pm']} onNavigate={path=>{
            history.replaceState({},'',location.pathname+new URL(path,location.origin).search);
            setRouteKey(value=>value+1);
          }}/>;
        }
        createRoot(document.getElementById('root')!).render(`);
      const renderStart = code.lastIndexOf("createRoot(document.getElementById('root')!).render(");
      assert.ok(renderStart > 0);
      const renderEnd = code.indexOf('\n', renderStart);
      code = code.slice(0, renderStart) + "createRoot(document.getElementById('root')!).render(<OutlineRouteFixture/>);" + (renderEnd < 0 ? '' : code.slice(renderEnd));
      return code;
    }
  }] } as any);
  await server.listen();
  const origin=`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`;
  const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(path=>path&&existsSync(path));
  assert.ok(executablePath);
  const browser=await chromium.launch({executablePath,headless:true});
  const errors:string[]=[];
  const load=async(query='')=>{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.setDefaultTimeout(15_000); page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(`${origin}/qa/cf114-studio.html?step=2&${query}`);
    try { await page.locator('.report-outline-column').first().waitFor(); }
    catch (error) { console.error('CF119 fixture diagnostics', errors, (await page.locator('body').innerText()).slice(0,3000)); throw error; }
    return page;
  };
  const current=(page:Page)=>page.locator('.report-outline-column').first();
  const titles=(page:Page)=>current(page).locator('ol > li').evaluateAll(rows=>rows.map(row=>(row.querySelector('input') as HTMLInputElement|null)?.value ?? row.querySelector('strong')?.textContent ?? row.textContent));
  const snapshot=(page:Page)=>page.evaluate(()=>(window as any).cf119.snapshot());
  const generate=(page:Page)=>page.getByRole('button',{name:'AI 목차 자동생성',exact:true}).click();
  const edit=async(page:Page,ordinal:number,value:string)=>{
    await page.getByRole('button',{name:`CH-0${ordinal} 목차 제목 직접 수정`,exact:true}).click();
    const input=page.getByRole('textbox',{name:`CH-0${ordinal} 목차 제목`,exact:true});
    await input.fill(value); await input.press('Enter');
  };
  try {
    await t.test('generation alone preserves current titles, dirty state, body and saved outline without a modal',async()=>{
      const page=await load('hold=1'), beforeTitles=await titles(page), before=await snapshot(page);
      const beforeStatus=await page.locator('.report-outline-status').textContent();
      await generate(page); await page.waitForFunction(()=>(window as any).cf119.pending);
      assert.equal(await page.getByRole('dialog').count(),0);
      assert.deepEqual(await titles(page),beforeTitles);
      await page.evaluate(()=>(window as any).cf119.release());
      await page.getByRole('button',{name:'CH-01 제안 적용',exact:true}).waitFor();
      assert.deepEqual(await titles(page),beforeTitles);
      assert.equal(await page.locator('.report-outline-status').textContent(),beforeStatus);
      assert.deepEqual(await snapshot(page),before);
      assert.equal(await page.getByRole('dialog').count(),0);
      assert.deepEqual(await page.evaluate(()=>({puts:(window as any).cf119.puts,outline:(window as any).cf119.outlineWrites})),{puts:[],outline:[]});
      await page.close();
    });
    await t.test('single/all apply and inline edits save titles/notes, preserve non-heading nodes and survive Step 4 re-entry',async()=>{
      const page=await load(), before=await snapshot(page);
      await generate(page); await page.getByRole('button',{name:'CH-01 제안 적용',exact:true}).click();
      assert.match(String((await titles(page))[0]),/AI 제안 제목 1/u);
      assert.match(String((await titles(page))[1]),/현장조사 결과/u);
      assert.deepEqual(await snapshot(page),before,'apply remains local until explicit save');
      await page.getByRole('button',{name:'제안 전체 적용',exact:true}).click();
      await edit(page,1,'담당자 확정 제목');
      assert.match(String((await titles(page))[1]),/AI 제안 제목 2/u);
      assert.equal(await page.getByRole('dialog').count(),0);
      await page.getByRole('button',{name:'수정한 목차 저장',exact:true}).click();
      await page.waitForFunction(()=>(window as any).cf119.snapshot().draft.version>1);
      const saved=await snapshot(page);
      assert.deepEqual(saved.outline.items.map((item:any)=>[item.chapterTitle,item.planningNote]),[['담당자 확정 제목','검증된 근거 검토 1'],['AI 제안 제목 2','검증된 근거 검토 2']]);
      assert.deepEqual(saved.draft.editorJson.content.filter((node:any)=>node.type!=='heading'),before.draft.editorJson.content.filter((node:any)=>node.type!=='heading'),'paragraphs, table, image and markers remain exact');
      assert.deepEqual(saved.draft.editorJson.content.filter((node:any)=>node.type==='heading').map((node:any)=>node.content.map((child:any)=>child.text??'').join('')),['CH-01 담당자 확정 제목','CH-02 AI 제안 제목 2']);
      assert.match(saved.draft.content,/검토결론 요약이라는 본문 문구도 보존/u);
      assert.match(saved.draft.content,/CH-02 AI 제안 제목 2/u);
      assert.equal(saved.outline.version,2);
      await page.locator('.report-wizard-navigation li:nth-child(4) button').click();
      const reviewTitle=page.getByRole('textbox',{name:'챕터 제목',exact:true});
      await reviewTitle.waitFor();
      await page.getByRole('combobox',{name:'수정할 챕터',exact:true}).selectOption('ch1');
      assert.equal(await reviewTitle.inputValue(),'담당자 확정 제목');
      await page.waitForFunction(()=>(window as any).cf119.snapshot().draft.wizardStep===4);
      await page.evaluate(()=>(window as any).cf119.remount());
      await reviewTitle.waitFor();
      await page.getByRole('combobox',{name:'수정할 챕터',exact:true}).selectOption('ch1');
      assert.equal(await reviewTitle.inputValue(),'담당자 확정 제목','canonical GET re-entry restores saved titles');
      await page.close();
    });
    await t.test('provider failure and malformed candidates retain current edits; fallback is not silent',async()=>{
      for(const mode of ['failure','malformed']){
        const page=await load(`mode=${mode}`);
        await edit(page,1,'오류 전 직접 수정');
        const before=await titles(page), saved=await snapshot(page);
        await generate(page); await page.getByText(/왼쪽 목차는 변경하지 않았습니다/u).waitFor();
        assert.deepEqual(await titles(page),before); assert.deepEqual(await snapshot(page),saved);
        assert.equal(await page.getByRole('button',{name:'CH-01 제안 적용',exact:true}).count(),0);
        assert.equal(await page.getByRole('dialog').count(),0); await page.close();
      }
    });
    await t.test('failed save retains local edits and original stored body without a report PUT',async()=>{
      const page=await load('mode=save-failure'), before=await snapshot(page);
      await edit(page,1,'저장 실패에도 남는 제목');
      await page.getByRole('button',{name:'수정한 목차 저장',exact:true}).click();
      await page.getByText('합성 목차 저장 실패',{exact:true}).waitFor();
      assert.match(String((await titles(page))[0]),/저장 실패에도 남는 제목/u);
      assert.deepEqual(await snapshot(page),before);
      assert.deepEqual(await page.evaluate(()=>(window as any).cf119.puts),[]);
      await page.close();
    });
    await t.test('pending generation blocks navigation; switching projects clears prior candidates',async()=>{
      const page=await load('hold=1');
      await generate(page); await page.waitForFunction(()=>(window as any).cf119.pending);
      await page.locator('.report-wizard-navigation li:nth-child(1) button').click();
      await page.getByText('AI 목차 제안이 끝난 뒤 현재 목차를 저장하고 이동해 주세요. 입력 내용은 유지됩니다.',{exact:true}).waitFor();
      assert.equal(await page.locator('.report-authoring-studio').getAttribute('data-wizard-step'),'2');
      await page.locator('#qa-navigate').click();
      assert.doesNotMatch(await page.locator('#qa-audit').innerText(),/NAVIGATED/u);
      await page.evaluate(()=>(window as any).cf119.release());
      await page.getByRole('button',{name:'CH-01 제안 적용',exact:true}).waitFor();
      mkdirSync('tmp/cf119-outline',{recursive:true});
      await page.locator('.report-outline-planner').screenshot({path:'tmp/cf119-outline/desktop.png'});
      await page.setViewportSize({width:390,height:844});
      await page.locator('.report-outline-planner').screenshot({path:'tmp/cf119-outline/mobile.png'});
      const boxes=await page.locator('.report-outline-column').evaluateAll(nodes=>nodes.map(node=>({top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom,width:node.getBoundingClientRect().width})));
      assert.ok(boxes[1].top>=boxes[0].bottom,'mobile stacks the two panels');
      assert.ok(boxes.every(box=>box.width<=390),'mobile panels fit viewport');
      await page.setViewportSize({width:1440,height:1000});
      await page.locator('.report-wizard-navigation li:nth-child(1) button').click();
      const select=page.getByRole('combobox',{name:'프로젝트 선택',exact:true});
      await select.waitFor(); await select.selectOption('cf119-other');
      await page.waitForFunction(()=>location.search.includes('cf119-other'));
      await current(page).waitFor();
      assert.match(String((await titles(page))[0]),/다른 프로젝트 제목 1/u);
      assert.match(String((await titles(page))[0]),/다른 프로젝트 제목 1/u);
      assert.equal(await page.getByRole('button',{name:'CH-01 제안 적용',exact:true}).count(),0);
      assert.deepEqual(await page.evaluate(()=>(window as any).cf119.outlineWrites),[]);
      await page.close();
    });
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await server.close();}
});
