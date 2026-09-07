import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium, type Page } from 'playwright-core';

// Production Studio/handlers/styles with the existing in-memory fixture only.
// HMR is disabled because replacing its root render must not remove refresh bindings.
test('CF120 numbered outlines and AI query-to-official-case-law workflow',async t=>{
  const {createServer}=await import('../apps/web/node_modules/vite/dist/node/index.js');
  const server=await createServer({root:fileURLToPath(new URL('../apps/web',import.meta.url)),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{
    name:'cf120-case-law-fixture',enforce:'pre',
    transform(code:string,id:string){
      if(!id.replaceAll('\\','/').endsWith('/qa/cf114-studio.tsx'))return;
      const replace=(before:string,after:string)=>{assert.ok(code.includes(before),'Missing fixture anchor: '+before);code=code.replace(before,after);};
      replace('window.fetch = async (input, init) => {',`
        cases.push({...cases[0],id:'cf120-other',caseNumber:'CF120-002',title:'다른 프로젝트'});
        const stored={id:'source-saved',precId:'99000',chapterId:'ch2',chapterCode:'CH-02',caseName:'이전에 저장한 판례',courtName:'대법원',caseNumber:'2023다99000',decisionDate:'2023-01-01',holdingText:'저장된 원문',summaryText:'기존 검수 근거 보존',sourceSha256:'a'.repeat(64),officialUrl:'https://www.law.go.kr/precInfoP.do?precSeq=99000',fetchedAt:'2026-09-07T00:00:00Z'};
        const cf120={mode:params.get('mode')||'success',hold:params.get('hold')||'',pending:false,release:null,requests:[],sources:[stored],lawConfigured:params.get('mode')!=='no-oc',snapshot:()=>structuredClone({draft,outline,sources:cf120.sources})};
        window.cf120=cf120;
        const lawPayload=()=>({sources:cf120.sources,citations:[],apiConfigured:cf120.lawConfigured,aiConnected:cf120.mode!=='no-ai',aiConfigured:cf120.mode!=='no-ai'});
        window.fetch = async (input, init) => {`);
      replace("  if (method === 'POST' && url.pathname === '/api/report-chapter-collaboration') {",`
        if(method==='POST'&&url.pathname.startsWith('/api/report-authoring/case-law/')){
          const body=JSON.parse(String(init?.body));const action=url.pathname.split('/').pop();
          cf120.requests.push({action,body});
          if(cf120.hold===action){cf120.pending=true;await new Promise(resolve=>{cf120.release=()=>{cf120.pending=false;resolve();};});}
          if(action==='issues'){
            if(cf120.mode==='no-ai')return response({error:'AI 연결 설정이 필요합니다.',code:'OPENAI_NOT_CONFIGURED'},503);
            if(cf120.mode==='failure')return response({error:'합성 AI 추천 실패',code:'MALFORMED_CASE_LAW_QUERIES'},502);
            return response({suggestions:['공기연장 간접비','지체상금 면책'],source:'AI',apiConfigured:cf120.lawConfigured});
          }
          if(action==='search'){
            if(!cf120.lawConfigured)return response({error:'LAW_API_OC 설정 필요',code:'LAW_API_OC_REQUIRED'},503);
            return response({query:body.query,results:[{...stored,precId:'12001',caseName:'공식 검색 합성 판례',caseNumber:'2024다12001',officialUrl:'https://www.law.go.kr/precInfoP.do?precSeq=12001'}]});
          }
          if(action==='select'){cf120.sources=[{...stored,id:'source-new',precId:body.precIds[0],caseName:'공식 검색 합성 판례'}];return response(lawPayload(),201);}
        }
        if (method === 'POST' && url.pathname === '/api/report-chapter-collaboration') {`);
      replace("if (url.pathname === '/api/report-authoring/case-law') return response({ sources: [], citations: [], apiConfigured: false });","if (url.pathname === '/api/report-authoring/case-law') return response(lawPayload());");
      replace("if (url.pathname === '/api/report-drafts') return response({ draft, revisions: [], backups: [] });","if (url.pathname === '/api/report-drafts') return response({draft:url.searchParams.get('caseId')==='cf120-other'?{...draft,caseId:'cf120-other',wizardStep:3}:draft,revisions:[],backups:[]});");
      replace('templateLibrary: [], aiConnected: true',"templateLibrary: [], outlineAiConnected:cf120.mode!=='no-ai', aiConnected:true");
      replace("createRoot(document.getElementById('root')!).render(",`
        function RouteFixture(){
          const [key,setKey]=React.useState(0);
          return <PreviewReportStudio key={key} roles={['pm']} onNavigate={path=>{
            history.replaceState({},'',location.pathname+new URL(path,location.origin).search);
            setKey(value=>value+1);
          }}/>;
        }
        createRoot(document.getElementById('root')!).render(`);
      const start=code.lastIndexOf("createRoot(document.getElementById('root')!).render("),end=code.indexOf('\n',start);
      code=code.slice(0,start)+"createRoot(document.getElementById('root')!).render(<RouteFixture/>);"+(end<0?'':code.slice(end));
      return code;
    }
  }]} as any);
  await server.listen();
  const origin=`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`;
  const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(path=>path&&existsSync(path));
  assert.ok(executablePath);
  const browser=await chromium.launch({executablePath,headless:true});
  const errors:string[]=[];
  const load=async(query='')=>{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.setDefaultTimeout(12_000);page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(`${origin}/qa/cf114-studio.html?step=3&${query}`);
    await page.getByRole('button',{name:/^AI (?:추천·판례 검색|검색어 추천)$/u}).waitFor();
    return page;
  };
  const panel=(page:Page)=>page.locator('.report-case-law');
  const topic=(page:Page)=>page.getByRole('textbox',{name:'검색 주제·판례 검색어',exact:true});
  const generate=(page:Page)=>page.getByRole('button',{name:/^AI (?:추천·판례 검색|검색어 추천)$/u}).click();
  const calls=(page:Page)=>page.evaluate(()=>(window as any).cf120.requests);
  const snapshot=(page:Page)=>page.evaluate(()=>(window as any).cf120.snapshot());
  try{
    await t.test('ordinal badges are restored without changing inline title editing',async()=>{
      const page=await load();
      await page.locator('.report-wizard-navigation li:nth-child(2) button').click();
      assert.deepEqual(await page.locator('.report-outline-current-row .report-outline-number').allTextContents(),['01','02']);
      await page.getByRole('button',{name:'CH-01 목차 제목 직접 수정',exact:true}).click();
      const input=page.getByRole('textbox',{name:'CH-01 목차 제목',exact:true});await input.fill('직접 수정 제목');await input.press('Enter');
      assert.match(await page.locator('.report-outline-current-row').first().innerText(),/직접 수정 제목/u);
      assert.equal(await page.getByRole('dialog').count(),0);await page.close();
    });
    await t.test('AI topic recommendations trigger official search and explicit selection only stores verified result identities',async()=>{
      const page=await load(),before=await snapshot(page);
      await topic(page).fill('추가 공사 간접비');await generate(page);
      await page.getByText('공식 검색 합성 판례',{exact:true}).first().waitFor();
      let requests=await calls(page);
      assert.deepEqual(requests.map((item:any)=>item.action),['issues','search']);
      assert.equal(requests[0].body.topic,'추가 공사 간접비');assert.equal(requests[0].body.chapterId,'ch2');
      assert.match(requests[0].body.chapterText,/현장조사 원문/u);
      assert.equal(requests[1].body.query,'공기연장 간접비');
      assert.match(await panel(page).innerText(),/추천.*검색어|검색어.*추천/u);
      assert.deepEqual((await snapshot(page)).sources,before.sources,'recommendation/search do not replace saved evidence');
      await page.getByRole('button',{name:'지체상금 면책',exact:true}).click();
      await page.waitForFunction(()=>(window as any).cf120.requests.filter((item:any)=>item.action==='search').length===2);
      requests=await calls(page);assert.equal(requests[2].body.query,'지체상금 면책');
      await page.locator('.report-case-law__results input[type=checkbox]').first().check();
      await page.getByRole('button',{name:'선택 1건 근거로 저장',exact:true}).click();
      await page.waitForFunction(()=>(window as any).cf120.sources[0].id==='source-new');
      requests=await calls(page);assert.deepEqual(requests.at(-1).body.precIds,['12001']);
      assert.deepEqual((await snapshot(page)).draft,before.draft,'case-law work leaves report body/version untouched');
      await page.close();
    });
    await t.test('missing law/AI settings and provider failure keep saved sources and never fabricate official results',async()=>{
      for(const mode of ['no-oc','no-ai','failure']){
        const page=await load('mode='+mode),before=await snapshot(page);
        await topic(page).fill('공사비 정산');await generate(page);
        if(mode==='no-oc'){
          const official=page.getByRole('link',{name:'공기연장 간접비 · 공식 사이트 검색',exact:true});
          await official.waitFor();
          const href=new URL((await official.getAttribute('href'))!);
          assert.equal(href.hostname,'www.law.go.kr');assert.equal(href.searchParams.get('query'),'공기연장 간접비');
          assert.equal(await official.getAttribute('target'),'_blank');
          assert.equal(await page.getByRole('button',{name:'검색어 그대로 검색',exact:true}).isDisabled(),true);
          await page.getByText('공식 판례 API 연결 안내',{exact:true}).click();
          assert.match(await panel(page).innerText(),/LAW_API_OC/u);
          mkdirSync('tmp/cf120-case-law',{recursive:true});
          await panel(page).screenshot({path:'tmp/cf120-case-law/desktop.png'});
          await page.setViewportSize({width:390,height:844});
          await panel(page).screenshot({path:'tmp/cf120-case-law/mobile.png'});
          assert.ok((await panel(page).boundingBox())!.width<=390,'case-law controls fit the mobile viewport');
          await page.setViewportSize({width:1440,height:1000});
        }else await page.getByRole('alert').filter({hasText:mode==='no-ai'?'AI 연결 설정':'합성 AI 추천 실패'}).waitFor();
        assert.equal((await calls(page)).filter((item:any)=>item.action==='search').length,0);
        assert.equal(await page.locator('.report-case-law__results').count(),0);
        assert.deepEqual((await snapshot(page)).sources,before.sources);
        assert.deepEqual((await snapshot(page)).draft,before.draft);
        if(mode==='no-oc'){
          await page.evaluate(()=>{(window as any).cf120.lawConfigured=true;});
          await panel(page).getByRole('button',{name:'연결 상태 다시 확인',exact:true}).click();
          await page.getByRole('button',{name:'검색어 그대로 검색',exact:true}).click();
          await page.waitForFunction(()=>(window as any).cf120.requests.some((item:any)=>item.action==='search'));
        }
        await page.close();
      }
    });
    await t.test('query/chapter/project changes discard delayed results while query edits preserve stored sources',async()=>{
      for(const [action,change] of [['issues','query'],['search','query'],['search','chapter'],['issues','case']]){
        const page=await load('hold='+action),before=await snapshot(page);
        await topic(page).fill('이전 검색 주제');await generate(page);
        await page.waitForFunction(()=>(window as any).cf120.pending);
        if(change==='query')await topic(page).fill('새로운 검색 주제');
        else if(change==='chapter')await page.getByRole('combobox',{name:'초안을 작성할 챕터',exact:true}).selectOption('ch1');
        else{
          await page.locator('.report-wizard-navigation li:nth-child(1) button').click();
          await page.getByRole('combobox',{name:'프로젝트 선택',exact:true}).selectOption('cf120-other');
          await page.waitForFunction(()=>location.search.includes('cf120-other'));
          await page.getByRole('button',{name:/^AI (?:추천·판례 검색|검색어 추천)$/u}).waitFor();
        }
        await page.evaluate(()=>(window as any).cf120.release());
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.equal((await calls(page)).filter((item:any)=>item.action==='search').length,action==='search'?1:0,change);
        assert.equal(await page.getByRole('button',{name:'공기연장 간접비',exact:true}).count(),0,change);
        assert.equal(await page.locator('.report-case-law__results').count(),0,change);
        if(change==='query'){assert.equal(await topic(page).inputValue(),'새로운 검색 주제');assert.deepEqual((await snapshot(page)).sources,before.sources);}
        await page.close();
      }
    });
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await server.close();}
});
