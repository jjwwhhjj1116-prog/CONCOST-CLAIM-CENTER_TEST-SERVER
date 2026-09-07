import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';

// The CF115 virtual Vite fixture pattern mounts the real component; no live APIs or source edits.
test('CF117 workflow record entry survives schedule outages and explicit reload cancellation', async t => {
  const { createServer } = await import('../apps/web/node_modules/vite/dist/node/index.js');
  const server = await createServer({ root: fileURLToPath(new URL('../apps/web', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
    name: 'cf117-workflow-schedule-fixture',
    configureServer(server) { server.middlewares.use(async (request, response, next) => {
      if (!request.url?.startsWith('/cf117-workflow-schedule.html')) return next();
      const html = await server.transformIndexHtml(request.url, '<!doctype html><html lang="ko"><head><meta charset="utf-8"><script>window.__CLAIM_API_ORIGIN__=location.origin</script></head><body><div id="root"></div><script type="module" src="/cf117-workflow-schedule-entry.js"></script></body></html>');
      response.setHeader('Content-Type', 'text/html'); response.end(html);
    }); },
    resolveId: id => id === '/cf117-workflow-schedule-entry.js' ? '\0cf117-workflow-schedule-entry' : undefined,
    load: id => id === '\0cf117-workflow-schedule-entry' ? `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { WorkflowOperations } from '/src/workflow/WorkflowOperations.tsx';
      import { minutesFieldDefaults } from '/@fs/${fileURLToPath(new URL('../apps/cloudflare/src/company-minutes.ts', import.meta.url)).replaceAll('\\', '/')}';
      import '/src/workflow/WorkflowOperations.css';
      const params=new URLSearchParams(location.search), kind=params.get('kind')||'WF-03';
      const state={scheduleFailure:params.has('schedule-failure'),workflowGets:0,scheduleGets:0,saveAttempts:0,uploads:0,ai:0,release:null};
      window.cf117=state;
      const project={id:'11700000-0000-4000-8000-000000000001',caseNumber:'CF117-LOCAL',title:'일정 장애 합성 프로젝트',claimType:'TYPE-01',status:'CONTRACT',version:1};
      const record={minutesFields:{...minutesFieldDefaults},meetingAt:'2026-09-07T01:00:00.000Z',surveyDate:'2026-09-07',location:'기존 장소',agenda:'기존 안건',scopeText:'기존 조사',leadUnit:'기존 팀',participantUnits:[],rawNotes:'기존 저장 원문',summaryText:'기존 요약',timeline:[],status:'DRAFTED',version:1,outputVersion:1,outputStatus:'DRAFTED',id:'survey-1',folderPath:'test',photoCount:0,audioCount:0,documentCount:0,updatedAt:'2026-09-07',updatedByName:'합성 검수자'};
      const empty=params.has('empty'), payload={case:project,kickoff:empty?null:record,siteSurveys:empty?[]:[record],allocations:[],events:[],googleDrive:{connected:true,deferredByUser:false,uploadEnabled:true}};
      const schedule={id:'project-'+project.id,caseId:project.id,responsiblePm:{id:'pm-1',name:'합성 PM'},canManageSchedule:true,stages:['KICKOFF','SITE_SURVEY'].map(stageCode=>({stageCode,startDate:'2026-09-08',endDate:'2026-09-10',scheduleStatus:'PLANNED',scheduleNote:'새로 조회된 일정',scheduleVersion:1,scheduleExplicit:true}))};
      const originalFetch=window.fetch.bind(window), json=(body,status=200)=>Response.json(body,{status});
      window.fetch=async(input,init={})=>{
        const url=new URL(typeof input==='string'?input:input.url,location.origin),path=url.pathname,method=init.method||'GET';
        if(!path.startsWith('/api/'))return originalFetch(input,init);
        if(path==='/api/cases')return json({cases:[project]});
        if(path==='/api/project-workflow/schedule'){state.scheduleGets++;return state.scheduleFailure?json({error:'합성 기준 일정 조회 실패'},503):json({projects:[schedule]});}
        if(path.endsWith('/workflow')){state.workflowGets++;return json(payload);}
        if(method==='PUT'&&(path.endsWith('/workflow/kickoff')||path.endsWith('/workflow/site-survey'))){state.saveAttempts++;return json({error:'합성 업무 기록 저장 실패'},503);}
        if(path.endsWith('/evidence')){
          if(method==='POST'){state.uploads++;return json({file:{id:'source-1',originalName:'cf117.txt',storageProvider:'GOOGLE_DRIVE'}});}
          return json({files:[],googleDriveConnected:true,storagePolicy:'GOOGLE_DRIVE_REQUIRED'});
        }
        if(path.endsWith('/workflow/ai-import')){state.ai++;return new Promise(resolve=>{state.release=()=>resolve(json({error:'합성 지연 AI 종료'},503));});}
        return json({});
      };
      createRoot(document.getElementById('root')).render(React.createElement(WorkflowOperations,{routeId:kind,roles:['admin'],onNavigate:()=>{}}));
    ` : undefined
  }] });
  await server.listen();
  const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(path => path && existsSync(path));
  assert.ok(executablePath, 'Set CHROME_PATH to an installed Chrome/Chromium executable.');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const kind of ['WF-03', 'WF-04']) {
      await t.test(`${kind}: initial schedule failure leaves the form/importer usable and schedule-only retry preserves a new record`, async () => {
        const page = await browser.newPage({ timezoneId: 'UTC' });
        try {
          const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
          await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
          await page.goto(`${origin}/cf117-workflow-schedule.html?kind=${kind}&schedule-failure=1&empty=1`);
          await page.waitForFunction(() => (window as any).cf117?.workflowGets === 1 && (window as any).cf117?.scheduleGets === 1);
          const importer = page.getByLabel('자동정리할 원본 파일');
          await importer.waitFor({ timeout: 3000 });
          assert.equal(await importer.isDisabled(), false, 'a failed schedule dependency must not hide or disable document importing');
          const date = page.getByLabel(kind === 'WF-03' ? '회의 일시' : '조사 일자', { exact: true });
          const chosenDate = kind === 'WF-03' ? '2026-09-21T14:30' : '2026-09-21';
          await date.fill(chosenDate);
          await page.locator('textarea.is-tall').fill('일정 재조회 중 보존할 미저장 원문');
          assert.equal(await page.locator('textarea.is-tall').isEditable(), true);
          const retry = page.getByRole('button', { name: /일정.*(?:다시|재시도)/u });
          assert.equal(await retry.count(), 1, 'a schedule-only retry is offered separately from full record reload');
          await page.evaluate(() => { (window as any).cf117.scheduleFailure = false; });
          await retry.click();
          await page.waitForFunction(() => (window as any).cf117.scheduleGets === 2 && document.querySelector('.shared-stage-schedule')?.textContent?.includes('합성 PM'));
          assert.equal(await page.evaluate(() => (window as any).cf117.workflowGets), 1, 'schedule retry does not reload the workflow record');
          assert.equal(await date.inputValue(), chosenDate, 'schedule dates do not replace the operator-selected meeting/survey date');
          assert.equal(await page.locator('textarea.is-tall').inputValue(), '일정 재조회 중 보존할 미저장 원문');
          assert.equal(await importer.isDisabled(), false);
          assert.deepEqual(errors, []);
        } finally { await page.close(); }
      });
      await t.test(`${kind}: canceling a whole-record reload retains dirty inputs and import locks reload`, async () => {
        const page = await browser.newPage({ timezoneId: 'UTC' });
        try {
          const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
          await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
          await page.goto(`${origin}/cf117-workflow-schedule.html?kind=${kind}`);
          const date = page.getByLabel(kind === 'WF-03' ? '회의 일시' : '조사 일자', { exact: true });
          await date.waitFor();
          const chosenDate = kind === 'WF-03' ? '2026-09-22T15:45' : '2026-09-22';
          await date.fill(chosenDate);
          await page.getByLabel(kind === 'WF-03' ? /^회의명·안건/u : /^조사 범위/u).fill('아직 저장하지 않은 업무 범위');
          await page.locator('textarea.is-tall').fill('재조회 취소 시 보존할 미저장 원문');
          await page.getByRole('button', { name: '기록 저장', exact: true }).click();
          await page.getByText('합성 업무 기록 저장 실패', { exact: true }).waitFor();
          const reload = page.getByRole('button', { name: '다시 불러오기', exact: true });
          const confirmations: string[] = [];
          page.once('dialog', dialog => { confirmations.push(dialog.message()); void dialog.dismiss(); });
          await reload.click();
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert.equal(confirmations.length, 1, 'discarding dirty inputs requires explicit confirmation');
          assert.equal(await page.evaluate(() => (window as any).cf117.workflowGets), 1, 'cancel must not request fresh server data');
          assert.equal(await date.inputValue(), chosenDate);
          assert.equal(await page.locator('textarea.is-tall').inputValue(), '재조회 취소 시 보존할 미저장 원문');
          await page.getByLabel('자동정리할 원본 파일').setInputFiles({ name: 'cf117.txt', mimeType: 'text/plain', buffer: Buffer.from('합성 파일 원문') });
          await page.waitForFunction(() => (window as any).cf117.ai === 1);
          assert.equal(await reload.isDisabled(), true, 'reload cannot unmount the importer while its request is in progress');
          await page.evaluate(() => (window as any).cf117.release());
          await page.getByText('합성 지연 AI 종료', { exact: true }).waitFor();
          assert.equal(await date.inputValue(), chosenDate);
          assert.equal(await page.locator('textarea.is-tall').inputValue(), '재조회 취소 시 보존할 미저장 원문');
          assert.deepEqual(errors, []);
        } finally { await page.close(); }
      });
    }
  } finally { await browser.close(); await server.close(); }
});
