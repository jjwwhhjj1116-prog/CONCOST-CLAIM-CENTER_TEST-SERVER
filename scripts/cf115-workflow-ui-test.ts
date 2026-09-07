import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('CF115 actual workflow UI imports automatically, preserves drafts and blocks stale results', async t => {
  const { createServer } = await import('../apps/web/node_modules/vite/dist/node/index.js');
  const server = await createServer({ root: fileURLToPath(new URL('../apps/web', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
    name: 'cf115-workflow-ui-fixture',
    configureServer(server) { server.middlewares.use(async (request, response, next) => {
      if (!request.url?.startsWith('/cf115-workflow-test.html')) return next();
      const html = await server.transformIndexHtml(request.url, '<!doctype html><html lang="ko"><head><meta charset="utf-8"><script>window.__CLAIM_API_ORIGIN__=location.origin</script></head><body><div id="root"></div><script type="module" src="/cf115-workflow-test-entry.js"></script></body></html>');
      response.setHeader('Content-Type', 'text/html'); response.end(html);
    }); },
    resolveId: id => id === '/cf115-workflow-test-entry.js' ? '\0cf115-workflow-test-entry' : undefined,
    load: id => id === '\0cf115-workflow-test-entry' ? `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { WorkflowOperations } from '/src/workflow/WorkflowOperations.tsx';
      import { requestNavigation } from '/src/navigation-guard.ts';
      import { minutesFieldDefaults } from '/@fs/${fileURLToPath(new URL('../apps/cloudflare/src/company-minutes.ts', import.meta.url)).replaceAll('\\', '/')}';
      import '/src/workflow/WorkflowOperations.css';
      const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
      const cases=ids.map((id,i)=>({id,caseNumber:'CF115-'+(i+1),title:'합성 프로젝트 '+(i+1),claimType:'TYPE-01',status:'CONTRACT',version:1}));
      const initial=()=>({minutesFields:{...minutesFieldDefaults},meetingAt:'2026-09-07T01:00:00.000Z',surveyDate:'2026-09-07',location:'기존 장소',agenda:'기존 안건',scopeText:'기존 조사',leadUnit:'기존 팀',participantUnits:[],rawNotes:'기존 원문',summaryText:'기존 요약',timeline:[{order:1,title:'기존 후속',detail:'기존 업무'}],status:'DRAFTED',version:1,outputVersion:1,outputStatus:'DRAFTED',id:'survey-1',folderPath:'test',photoCount:0,audioCount:0,documentCount:0,updatedAt:'2026-09-07',updatedByName:'검수자'});
      let records=ids.map(initial), root=createRoot(document.getElementById('root')), serial=0;
      const state={uploads:0,ai:0,downloads:0,saves:[],mode:'success',pending:[],holdUpload:false,uploadRelease:null,abortedSignals:[],kind:'WF-03'};
      const result=()=>({meetingAt:state.mode==='missing'?null:'2026-09-07T01:00:00Z',surveyDate:state.mode==='missing'?null:'2026-09-07',location:'새 장소',agenda:'새 안건',participants:['새 담당자'],leadUnit:'새 팀',sourceNotes:'원본 전체 라벨\\n회의명: 새 안건\\n본문 새 원문',meetingContent:'본문 새 원문',summary:state.mode==='raw'?'':'새 AI 요약',timeline:state.mode==='raw'?[]:[{order:1,title:'새 후속',detail:'새 후속 업무'}],missingFields:state.mode==='raw'?['AI 정리 미실행']:state.mode==='missing'?['회의 일자','회의 시간','조사 일자','authorPosition','minutesFields.clientName','meetingAt','surveyDate','location','leadUnit','현장 사진 원본','unknownField','minutesFields.unknownField','constructor','작성자(author)','보고부서(minutesFields.reportingDepartment)']:[],minutesFields:{...minutesFieldDefaults,author:'홍검수',authorPosition:'팀장',meetingTitle:'새 안건',participants:'새 담당자'}});
      const originalFetch=window.fetch.bind(window), json=(value,status=200)=>Promise.resolve(Response.json(value,{status}));
      window.fetch=async (input,init={})=>{
        const url=new URL(typeof input==='string'?input:input.url,location.origin), path=url.pathname, method=init.method||'GET';
        if(!path.startsWith('/api/'))return originalFetch(input,init);
        if(path==='/api/cases')return json({cases});
        if(path==='/api/project-workflow/schedule')return state.mode==='schedule-failure'?json({error:'합성 일정 조회 실패'},503):json({projects:[]});
        const index=path.includes(ids[1])?1:0;
        const payload=()=>({case:cases[index],kickoff:records[index],siteSurveys:[records[index]],allocations:[],events:[],googleDrive:{connected:true,deferredByUser:false,uploadEnabled:true}});
        if(path.endsWith('/workflow'))return json(payload());
        if(path.endsWith('/workflow/ai-import')){
          state.ai++; state.abortedSignals.push(init.signal);
          if(state.mode==='failure')return json({error:'합성 AI 실패 · 다시 시도하세요'},503);
          if(state.mode==='hold')return new Promise(resolve=>state.pending.push(()=>resolve(Response.json({import:result(),generator:'GEMINI'}))));
          return json({import:result(),generator:state.mode==='raw'?'LOCAL_STRUCTURED_FALLBACK':'GEMINI'});
        }
        if(path.endsWith('/download')){state.downloads++;return new Response('자료실 원문',{headers:{'Content-Type':'text/plain','Content-Disposition':"attachment; filename*=UTF-8''evidence.txt"}});}
        if(path.endsWith('/evidence')){
          if(method==='POST') {state.uploads++;if(state.holdUpload)await new Promise(resolve=>state.uploadRelease=resolve);return json({file:{id:'file-1',originalName:'source.txt',storageProvider:'GOOGLE_DRIVE'}});}
          return json({files:state.mode==='wrong-evidence'?[]:[{id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',category:state.kind==='WF-03'?'KICKOFF_MATERIAL':'SITE_PHOTO',originalName:'evidence.txt',mimeType:'text/plain',byteSize:20,sha256:'test',storageProvider:'GOOGLE_DRIVE',uploadedBy:'검수자',uploadedAt:'2026-09-07',downloadUrl:'/api/cases/evidence/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/download',driveUrl:null}],googleDriveConnected:true,storagePolicy:'GOOGLE_DRIVE_REQUIRED'});
        }
        if(method==='PUT'&&(path.endsWith('/workflow/kickoff')||path.endsWith('/workflow/site-survey'))){
          if(state.mode==='save-failure')return json({error:'합성 기록 저장 실패'},503);
          const body=JSON.parse(init.body);state.saves.push(body);records[index]={...records[index],...body,version:records[index].version+1,outputVersion:records[index].outputVersion+1,summaryText:body.summaryText??'',timeline:body.timeline??[]};return json(payload());
        }
        return json({});
      };
      function mount(kind='WF-03',index=0,evidence=false){state.kind=kind;history.replaceState({},'',location.pathname+'?caseId='+ids[index]+(evidence?'&evidenceId=eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee':''));root.render(React.createElement(WorkflowOperations,{key:++serial,routeId:kind,roles:['admin'],onNavigate:path=>requestNavigation(path,()=>{})}));}
      window.cf115={state,ids,mount,reset(){records=ids.map(initial);Object.assign(state,{uploads:0,ai:0,downloads:0,saves:[],mode:'success',pending:[],holdUpload:false,uploadRelease:null,abortedSignals:[]});},navigate:()=>requestNavigation('/other',()=>{}),release:()=>{state.pending.splice(0).forEach(fn=>fn());}};
      mount();
    ` : undefined
  }] });
  await server.listen();
  const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(value => value && existsSync(value));
  assert.ok(executablePath, 'Set CHROME_PATH to an installed Chrome/Chromium executable.');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ timezoneId: 'UTC' });
    const errors: string[] = []; page.on('pageerror', reason => errors.push(reason.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/cf115-workflow-test.html`);
    const state = () => page.evaluate(() => { const { uploads, ai, downloads, saves } = (window as any).cf115.state; return { uploads, ai, downloads, saves }; });
    const upload = () => page.getByLabel('자동정리할 원본 파일').setInputFiles({ name: 'source.txt', mimeType: 'text/plain', buffer: Buffer.from('회의 원문') });
    const reset = async (kind='WF-03', evidence=false) => { await page.evaluate(({kind,evidence})=>{(window as any).cf115.reset();(window as any).cf115.mount(kind,0,evidence);},{kind,evidence}); await page.getByLabel('자동정리할 원본 파일').waitFor(); };
    await page.getByLabel('자동정리할 원본 파일').waitFor({ timeout:15_000 }).catch(()=>assert.fail(JSON.stringify(errors)));
    for (const kind of ['WF-03','WF-04']) await t.test(`${kind}: one selection auto-runs AI, retry reuses original, preview and PUT use matching new result`, async () => {
      await reset(kind);
      await page.evaluate(()=>{(window as any).cf115.state.mode='failure';}); await upload();
      await page.getByText('합성 AI 실패 · 다시 시도하세요',{exact:true}).waitFor();
      assert.equal(await page.locator('.workflow-ai-importer .notice-box').count(),0,'failed progress must clear');
      assert.match(await page.locator('.workflow-import-state').innerText(),/source.txt/u);
      assert.deepEqual({uploads:(await state()).uploads,ai:(await state()).ai},{uploads:1,ai:1});
      await page.evaluate(()=>{(window as any).cf115.state.mode='success';}); await page.getByRole('button',{name:'다시 시도',exact:true}).click();
      await page.getByText(/Gemini 자동정리 완료 · 화면에 반영했습니다/u).waitFor();
      assert.equal((await state()).uploads,1,'AI retry must not re-upload');
      assert.equal(await page.locator('textarea.is-tall').inputValue(),'본문 새 원문');
      assert.match(await page.locator('.is-output').first().innerText(),/새 AI 요약/u); assert.doesNotMatch(await page.locator('.is-output').first().innerText(),/기존 요약/u);
      assert.equal(await page.getByLabel('작성자 성명',{exact:true}).inputValue(),'홍검수');
      assert.equal(await page.getByLabel('첨부파일명',{exact:true}).inputValue(),'source.txt','original filename is a persisted form value, not only a preview fallback');
      page.once('dialog',dialog=>dialog.dismiss()); await page.locator('#workflow-case').selectOption('22222222-2222-4222-8222-222222222222');
      assert.equal(await page.locator('#workflow-case').inputValue(),'11111111-1111-4111-8111-111111111111','dirty project switch requires confirmation');
      await page.evaluate(()=>{(window as any).cf115.state.mode='save-failure';});await page.getByRole('button',{name:'기록 저장',exact:true}).click();
      await page.getByText('합성 기록 저장 실패',{exact:true}).waitFor();assert.match(await page.locator('.workflow-ai-importer').innerText(),/아직 업무 기록은 저장하지 않았습니다/u);
      await page.evaluate(()=>{(window as any).cf115.state.mode='schedule-failure';});
      await page.getByRole('button',{name:'기록 저장',exact:true}).click();
      await page.waitForFunction(()=>(window as any).cf115.state.saves.length===1);
      const saved=(await state()).saves[0];assert.equal(saved.rawNotes,'본문 새 원문');assert.equal(saved.summaryText,'새 AI 요약');assert.deepEqual(saved.timeline,[{order:1,title:'새 후속',detail:'새 후속 업무'}]);
      assert.equal(saved.minutesFields.attachmentName,'source.txt');
      if(kind==='WF-03')assert.equal(saved.meetingAt,'2026-09-07T01:00:00.000Z','KST form persists correctly even from a UTC browser');
      await page.waitForFunction(()=>!document.querySelector('.workflow-ai-importer input[type=file]')?.hasAttribute('disabled'));
      await page.waitForFunction(()=>!document.querySelector('.workflow-ai-importer')?.textContent?.includes('아직 업무 기록은 저장하지 않았습니다'));
      await page.getByText(/업무 기록은 이미 저장되어 다시 저장할 필요가 없습니다/u).waitFor();
      assert.match(await page.locator('.is-output').first().innerText(),/새 AI 요약/u);
      await page.evaluate(kind=>{(window as any).cf115.state.mode='success';(window as any).cf115.mount(kind);},kind);
      await page.getByLabel('첨부파일명',{exact:true}).waitFor();assert.equal(await page.getByLabel('첨부파일명',{exact:true}).inputValue(),'source.txt','attachment name survives reload');
    });
    await t.test('source edits invalidate imported summary, raw fallback never reuses old AI output',async()=>{
      await reset('WF-04');await upload();await page.getByText(/Gemini 자동정리 완료 · 화면에 반영했습니다/u).waitFor();
      await page.locator('textarea.is-tall').fill('담당자가 수정한 원문');assert.doesNotMatch(await page.locator('.is-output').first().innerText(),/새 AI 요약/u);
      await page.getByRole('button',{name:'기록 저장',exact:true}).click();await page.waitForFunction(()=>(window as any).cf115.state.saves.length===1);
      assert.equal((await state()).saves[0].summaryText,undefined);
      await page.waitForFunction(()=>!document.querySelector('.workflow-generate-button')?.hasAttribute('disabled'));
      await reset();await page.evaluate(()=>{(window as any).cf115.state.mode='raw';});await upload();await page.getByText(/원문 가져오기 완료 · AI 정리 미실행/u).waitFor();
      assert.match(await page.locator('.is-output').first().innerText(),/본문 새 원문/u);assert.doesNotMatch(await page.locator('.is-output').first().innerText(),/기존 요약/u);
    });
    await t.test('during import project/form are disabled and late responses cannot cross unmount/project boundaries',async()=>{
      await reset();await page.evaluate(()=>{(window as any).cf115.state.mode='hold';});await upload();await page.waitForFunction(()=>(window as any).cf115.state.ai===1);
      assert.equal(await page.locator('#workflow-case').isDisabled(),true);assert.equal(await page.locator('textarea.is-tall').isDisabled(),true);
      page.once('dialog',dialog=>dialog.dismiss());assert.equal(await page.evaluate(()=>(window as any).cf115.navigate()),true,'busy import uses the navigation guard');
      await page.evaluate(()=>{(window as any).cf115.mount('WF-03',1);});await page.waitForFunction(()=>document.querySelector<HTMLSelectElement>('#workflow-case')?.value==='22222222-2222-4222-8222-222222222222'&&!document.querySelector('textarea.is-tall')?.hasAttribute('disabled'));
      await page.evaluate(()=>{(window as any).cf115.release();});
      assert.equal(await page.evaluate(()=>(window as any).cf115.state.abortedSignals[0].aborted),true);assert.equal(await page.locator('textarea.is-tall').inputValue(),'기존 원문');
      assert.doesNotMatch(await page.locator('.is-output').first().innerText(),/새 AI 요약/u);
    });
    await t.test('library handoff downloads once and analyzes without another upload',async()=>{
      await reset('WF-03',true);await page.getByText(/Gemini 자동정리 완료 · 화면에 반영했습니다/u).waitFor();
      assert.deepEqual({uploads:(await state()).uploads,ai:(await state()).ai,downloads:(await state()).downloads},{uploads:0,ai:1,downloads:1});
    });
    await t.test('lower evidence-panel AI action uses the same importer without uploading again',async()=>{
      await reset();await page.getByRole('button',{name:'AI 회의록 작성',exact:true}).click();await page.getByText(/Gemini 자동정리 완료 · 화면에 반영했습니다/u).waitFor();
      assert.deepEqual({uploads:(await state()).uploads,ai:(await state()).ai,downloads:(await state()).downloads},{uploads:0,ai:1,downloads:1});
      assert.equal(await page.getByLabel('첨부파일명',{exact:true}).inputValue(),'evidence.txt','library handoff retains the original attachment filename');
    });
    await t.test('missing dates stay blank and visible for review; multiple drop and foreign evidence are rejected',async()=>{
      for(const kind of ['WF-03','WF-04']){
        await reset(kind);await page.evaluate(()=>{(window as any).cf115.state.mode='missing';});await upload();await page.getByText(/확인 필요: 회의 일자/u).waitFor();
        const notice=await page.locator('.workflow-ai-importer .notice-box').innerText();
        assert.match(notice,/작성자 직급, 거래처명, 회의 일시, 조사 일자, 장소, 조사 책임 팀, 현장 사진 원본, unknownField, minutesFields\.unknownField, constructor/u,'known field keys translate while Korean and unknown values are preserved');
        assert.doesNotMatch(notice,/authorPosition|minutesFields\.clientName|meetingAt|surveyDate|leadUnit|\(author\)|minutesFields\.reportingDepartment/u);
        assert.match(notice,/작성자 성명, 보고부서/u);
        assert.equal(await page.getByLabel(kind==='WF-03'?'회의 일시':'조사 일자',{exact:true}).inputValue(),'');
        assert.equal(await page.getByRole('button',{name:'기록 저장',exact:true}).isDisabled(),true);
      }
      await reset();await page.locator('.workflow-ai-importer').evaluate(element=>{const data=new DataTransfer();data.items.add(new File(['one'],'one.txt',{type:'text/plain'}));data.items.add(new File(['two'],'two.txt',{type:'text/plain'}));element.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}));});
      await page.getByText(/파일을 한 개씩 올려 주세요/u).waitFor();assert.equal((await state()).uploads,0);assert.equal((await state()).ai,0);
      await page.evaluate(()=>{(window as any).cf115.reset();(window as any).cf115.state.mode='wrong-evidence';(window as any).cf115.mount('WF-03',0,true);});
      await page.getByText(/현재 프로젝트·업무 분류에 속한 자료가 아닙니다/u).waitFor();assert.equal((await state()).downloads,0);assert.equal((await state()).ai,0);
    });
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); await server.close(); }
});
