import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';

// Actual React event handlers; only the existing synthetic fixture's API timing changes.
test('CF117 report workflow preserves concurrent edits and keeps reference-only templates separate', async t => {
  const { createServer } = await import('../apps/web/node_modules/vite/dist/node/index.js');
  const server = await createServer({ root: fileURLToPath(new URL('../apps/web', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
    name: 'cf117-report-workflow-fixture', enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/qa/cf114-studio.tsx')) return;
      const replace = (before: string, after: string) => { assert.ok(code.includes(before), `Fixture anchor missing: ${before}`); code = code.replace(before, after); };
      replace('window.fetch = async (input, init) => {', `
        const cf117 = { pending: false, release: null, gets: 0, puts: [], outlineWrites: [] };
        const templateLibrary = params.has('reference') ? [
          { id:'reference-01', categoryCode:'REF-01', displayName:'현재 유형 작성 원본', primaryClaimType:'TYPE-01', secondaryClaimTypes:[], matchesCurrentType:true, expectedSourceCount:1, uploadedSourceCount:0, analysisVersion:1, analysisSummary:'TYPE-01 원본', files:[], outline:['1. TYPE01 전용 검토 결론','2. TYPE01 전용 현장조사'] },
          { id:'reference-04', categoryCode:'REF-04', displayName:'다른 유형 참고 원본', primaryClaimType:'TYPE-04', secondaryClaimTypes:[], matchesCurrentType:false, expectedSourceCount:1, uploadedSourceCount:0, analysisVersion:1, analysisSummary:'TYPE-04 원본', files:[], outline:['1. TYPE04 참고 전용 보수비','2. TYPE04 참고 전용 기성금'] }
        ] : [];
        window.cf117 = cf117;
        window.fetch = async (input, init) => {`);
      replace("if (method === 'POST' && url.pathname === '/api/report-chapter-collaboration') {\n    const body = JSON.parse(String(init?.body));", `if (method === 'POST' && url.pathname === '/api/report-chapter-collaboration') {
        const body = JSON.parse(String(init?.body));
        if (body.action === 'APPLY') {
          cf117.pending = true;
          await new Promise(resolve => { cf117.release = () => { cf117.pending = false; resolve(); }; });
        }`);
      replace("if (method === 'PUT' && url.pathname === '/api/report-drafts') {\n    const body = JSON.parse(String(init?.body));", `if (method === 'PUT' && url.pathname === '/api/report-drafts') {
        const body = JSON.parse(String(init?.body)); cf117.puts.push(body);`);
      replace("if (method === 'PUT' && url.pathname === '/api/report-authoring/outline') {\n    const body = JSON.parse(String(init?.body));", "if (method === 'PUT' && url.pathname === '/api/report-authoring/outline') {\n    const body = JSON.parse(String(init?.body)); cf117.outlineWrites.push(body);");
      replace("if (url.pathname === '/api/report-drafts') return response({ draft, revisions: [], backups: [] });", "if (url.pathname === '/api/report-drafts') { cf117.gets++; return response({ draft, revisions: [], backups: [] }); }");
      replace('templateLibrary: [], aiConnected: true', 'templateLibrary, outlineAiConnected: false, aiConnected: true');
      return code;
    }
  }] });
  await server.listen();
  const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(path => path && existsSync(path));
  assert.ok(executablePath, 'Set CHROME_PATH to an installed Chrome/Chromium executable.');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await t.test('APPLY cannot discard report or outline titles typed during its response', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', reason => errors.push(reason.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/qa/cf114-studio.html?step=4`);
    const title = page.getByRole('textbox', { name: '보고서 제목', exact: true });
    const outlineTitle = page.getByRole('textbox', { name: '챕터 제목', exact: true });
    await title.waitFor();
    const previousTitle = await title.inputValue(), previousOutlineTitle = await outlineTitle.inputValue();
    await page.locator('.report-chapter-collaboration > summary').click();
    await page.getByRole('button', { name: '검수본을 전체 보고서에 반영', exact: true }).click();
    await page.waitForFunction(() => (window as any).cf117.pending);
    const canEditTitle = await title.isEditable(), canEditOutlineTitle = await outlineTitle.isEditable();
    // Either prevent edits during APPLY, or preserve edits through the follow-up GET.
    // On CF116 both fields are editable and the unconditional reload loses them.
    if (canEditTitle) await title.fill('응답 대기 중 작성한 새 보고서 제목');
    if (canEditOutlineTitle) await outlineTitle.fill('응답 대기 중 작성한 새 목차 제목');
    await page.evaluate(() => (window as any).cf117.release());
    await page.getByText('CH-02 검수본을 보고서 최신 버전에 반영했습니다. 이전 본문은 버전 이력에 보존됩니다.', { exact: true }).waitFor({ state: 'attached' });
    const actual = { title: await title.inputValue(), outline: await outlineTitle.inputValue() };
    const expected = { title: canEditTitle ? '응답 대기 중 작성한 새 보고서 제목' : previousTitle, outline: canEditOutlineTitle ? '응답 대기 중 작성한 새 목차 제목' : previousOutlineTitle };
    assert.deepEqual(actual, expected, 'APPLY must block concurrent title edits or retain them; a successful server reload must never silently erase accepted input');
    assert.equal(await page.evaluate(() => (window as any).cf117.gets), 2, 'the actual APPLY reload path ran');
    assert.deepEqual(await page.evaluate(() => (window as any).cf117.puts), [], 'APPLY may not race an unrelated report autosave');
    assert.deepEqual(errors, []);
    await page.close();
    });
    await t.test('browsing a different claim type cannot replace the current type outline during local fallback', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors: string[] = []; page.on('pageerror', reason => errors.push(reason.message));
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await page.goto(`${origin}/qa/cf114-studio.html?step=1&reference=1`);
      await page.locator('#report-template-preview-type').selectOption('REF-04');
      await page.getByRole('button', { name: '선택 템플릿 완제품 보기', exact: true }).click();
      await page.getByText('참고 열람 전용 · 현재 프로젝트 유형은 TYPE-01, 이 원본의 주 유형은 TYPE-04입니다.', { exact: true }).waitFor();
      await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
      await page.locator('.report-wizard-navigation li:nth-child(2) button').click();
      await page.getByRole('button', { name: '✦ AI·템플릿으로 목차 자동 만들기', exact: true }).click();
      await page.getByRole('button', { name: /목차 편집 화면 보기/u }).click();
      await page.getByRole('button', { name: '수정한 목차 저장', exact: true }).click();
      await page.waitForFunction(() => (window as any).cf117.outlineWrites.length === 1);
      const saved = await page.evaluate(() => (window as any).cf117.outlineWrites[0].items.map((item: any) => ({ chapterCode: item.chapterCode, chapterTitle: item.chapterTitle })));
      assert.deepEqual(saved, [
        { chapterCode: 'CH-01', chapterTitle: 'TYPE01 전용 검토 결론' },
        { chapterCode: 'CH-02', chapterTitle: 'TYPE01 전용 현장조사' }
      ], 'a reference-only TYPE-04 selection may not silently become the saved TYPE-01 authoring outline');
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally { await browser.close(); await server.close(); }
});
