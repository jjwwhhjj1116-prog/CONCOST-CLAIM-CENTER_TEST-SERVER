import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium, type Page } from 'playwright-core';

// Exercise the actual React studio with the existing synthetic CF114 fixture.
// The fixture is transformed only in this Vite process; no app API or account is used.
test('CF116 report save failures pause autosave, remain visible and preserve navigation protection', async t => {
  const { createServer } = await import('../apps/web/node_modules/vite/dist/node/index.js');
  const server = await createServer({ root: fileURLToPath(new URL('../apps/web', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
    name: 'cf116-report-save-fixture', enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/qa/cf114-studio.tsx')) return;
      const replace = (before: string, after: string) => { assert.ok(code.includes(before), `Fixture anchor missing: ${before}`); code = code.replace(before, after); };
      replace('window.fetch = async (input, init) => {', `
        const cf116 = { requests: [], gets: 0, mode: 'success', loadFailure: false, draftExists: !params.has('new'), release: null };
        if (params.has('new')) {
          draft = { ...draft, content: '', editorJson: null, version: 0, wizardStep: 1 };
          outline = { ...outline, status: 'DRAFT', version: 0, items: [] };
        }
        window.cf116 = cf116;
        window.fetch = async (input, init) => {`);
      replace("if (method === 'PUT' && url.pathname === '/api/report-drafts') {\n    const body = JSON.parse(String(init?.body));", `if (method === 'PUT' && url.pathname === '/api/report-drafts') {
        const body = JSON.parse(String(init?.body));
        cf116.requests.push(body);
        if (cf116.mode === 'hold') await new Promise(resolve => { cf116.release = resolve; });
        if (cf116.mode === 'conflict') return response({ error: '합성 버전 충돌', code: 'VERSION_CONFLICT' }, 409);
        if (cf116.mode === 'failure') return response({ error: '합성 보고서 저장 실패: 잠시 후 다시 시도하세요.', code: 'REPORT_DRAFT_WRITE_FAILED' }, 503);
        if (cf116.mode === 'empty') return response({});
        cf116.draftExists = true;`);
      replace("if (url.pathname === '/api/report-drafts') return response({ draft, revisions: [], backups: [] });", `if (url.pathname === '/api/report-drafts') {
        cf116.gets++;
        if (cf116.loadFailure) return response({ error: '합성 최신본 조회 실패' }, 503);
        return response({ draft: cf116.draftExists ? draft : null, revisions: [], backups: [] });
      }`);
      return code;
    }
  }] });
  await server.listen();
  const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(path => path && existsSync(path));
  assert.ok(executablePath, 'Set CHROME_PATH to an installed Chrome/Chromium executable.');
  const browser = await chromium.launch({ executablePath, headless: true });
  const errors: string[] = [];
  const requests = (page: Page) => page.evaluate(() => (window as any).cf116.requests as { content: string; expectedVersion: number; saveKind: string; wizardStep: number }[]);
  const mode = (page: Page, value: string) => page.evaluate(value => { (window as any).cf116.mode = value; }, value);
  const open = async (query: string) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', reason => errors.push(reason.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/qa/cf114-studio.html?${query}`);
    await page.waitForFunction(() => document.querySelector('.report-wizard-navigation li:nth-child(2) button:not(:disabled)'));
    return page;
  };
  const step = (page: Page) => page.locator('.report-authoring-studio').getAttribute('data-wizard-step');
  const saveAlert = (page: Page) => page.getByRole('alert', { name: '보고서 저장 오류' });
  const editor = (page: Page) => page.locator('.report-step-card--3 .ProseMirror[contenteditable=true]').first();
  try {
    await t.test('new report stays on step 1 after failed canonical save; explicit retry unblocks step 2', async () => {
      const page = await open('step=1&new=1');
      try {
        assert.equal(await page.getByText('2단계에서 변경한 목차를 확정해 주세요.', { exact: true }).count(), 0, 'a fresh outline is not described as an unsaved modification');
        await mode(page, 'failure');
        await page.locator('.report-wizard-navigation li:nth-child(2) button').click();
        await saveAlert(page).waitFor();
        assert.match(await saveAlert(page).innerText(), /합성 보고서 저장 실패/u);
        assert.equal(await step(page), '1');
        assert.equal((await requests(page))[0].expectedVersion, 0);
        await page.locator('.report-wizard-navigation li:nth-child(2) button').click();
        await page.getByRole('button', { name: '이 단계 완료 · 다음 단계 →', exact: true }).click();
        assert.equal((await requests(page)).length, 1, 'ordinary navigation must not silently retry paused writes');
        assert.equal(await step(page), '1');
        await mode(page, 'success');
        await page.getByRole('button', { name: '저장 다시 시도', exact: true }).click();
        await saveAlert(page).waitFor({ state: 'detached' });
        assert.equal((await requests(page))[1].expectedVersion, 0, 'retry never changes the expected version to force an overwrite');
        assert.equal(await step(page), '1');
        await page.locator('.report-wizard-navigation li:nth-child(2) button').click();
        await page.waitForFunction(() => document.querySelector('.report-authoring-studio')?.getAttribute('data-wizard-step') === '2');
        assert.equal((await requests(page)).at(-1)?.wizardStep, 2);
      } finally { await page.close(); }
    });

    await t.test('dirty document triggers one failed AUTO request, stops retries even after edits, and Ctrl+S resumes', async () => {
      const page = await open('step=3');
      try {
        await mode(page, 'failure');
        await editor(page).fill('자동 저장 실패 후에도 남아야 하는 본문');
        await saveAlert(page).waitFor({ timeout: 10_000 });
        assert.equal((await requests(page)).length, 1);
        assert.equal((await requests(page))[0].saveKind, 'AUTO');
        await editor(page).fill('실패 뒤 추가한 미저장 본문');
        await page.waitForTimeout(6500);
        assert.equal((await requests(page)).length, 1, 'paused autosave must not create another 3-second retry loop');
        assert.equal((await editor(page).innerText()).trimEnd(), '실패 뒤 추가한 미저장 본문');
        await mode(page, 'success');
        await page.keyboard.press('Control+s');
        await saveAlert(page).waitFor({ state: 'detached' });
        assert.equal((await requests(page)).length, 2);
        assert.equal((await requests(page))[1].saveKind, 'MANUAL');
        assert.match((await requests(page))[1].content, /실패 뒤 추가한 미저장 본문/u);
      } finally { await page.close(); }
    });

    await t.test('409 keeps the body and version; cancelling latest reload and menu navigation preserves unsaved work', async () => {
      const page = await open('step=3');
      try {
        await mode(page, 'conflict');
        await editor(page).fill('충돌이 나도 보존할 담당자 원문');
        await page.keyboard.press('Control+s');
        await saveAlert(page).waitFor();
        assert.match(await saveAlert(page).innerText(), /서버의 보고서 버전이 변경/u);
        const gets = await page.evaluate(() => (window as any).cf116.gets);
        page.once('dialog', async dialog => { assert.equal(dialog.type(), 'confirm'); await dialog.dismiss(); });
        await page.getByRole('button', { name: '최신본 다시 불러오기', exact: true }).click();
        assert.equal(await page.evaluate(() => (window as any).cf116.gets), gets);
        assert.equal((await editor(page).innerText()).trimEnd(), '충돌이 나도 보존할 담당자 원문');
        await page.locator('#qa-navigate').click();
        await page.getByRole('dialog').filter({ hasText: '보고서 작업을 저장하고 이동할까요?' }).waitFor();
        await page.getByRole('button', { name: '계속 작성', exact: true }).click();
        await page.getByRole('button', { name: '저장 다시 시도', exact: true }).click();
        await page.waitForFunction(() => (window as any).cf116.requests.length === 2);
        assert.deepEqual((await requests(page)).map(request => request.expectedVersion), [1, 1]);
        assert.equal(await step(page), '3');
        assert.equal((await editor(page).innerText()).trimEnd(), '충돌이 나도 보존할 담당자 원문');
      } finally { await page.close(); }
    });

    await t.test('generic feature error does not pause or get cleared by successful autosave', async () => {
      const page = await open('step=3');
      try {
        await page.getByRole('button', { name: '현재 챕터에서 쟁점 찾기', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'CF114: 미등록 합성 쓰기 차단' }).waitFor();
        assert.equal(await saveAlert(page).count(), 0);
        await editor(page).fill('판례 검색 오류와 무관하게 자동 저장할 본문');
        await page.waitForFunction(() => (window as any).cf116.requests.length === 1);
        assert.equal((await requests(page))[0].saveKind, 'AUTO');
        assert.match((await requests(page))[0].content, /자동 저장할 본문/u);
        assert.equal(await saveAlert(page).count(), 0);
        assert.equal(await page.getByRole('alert').filter({ hasText: 'CF114: 미등록 합성 쓰기 차단' }).isVisible(), true);
        assert.doesNotMatch(await page.getByLabel('지금 저장 상태').textContent() ?? '', /일시 중단/u);
      } finally { await page.close(); }
    });

    await t.test('HTTP 200 without a canonical draft is treated as a visible paused save failure', async () => {
      const page = await open('step=1&new=1');
      try {
        await mode(page, 'empty');
        await page.locator('.report-wizard-navigation li:nth-child(2) button').click();
        await saveAlert(page).waitFor();
        assert.match(await saveAlert(page).innerText(), /저장 완료 응답을 확인하지 못했습니다/u);
        assert.equal(await step(page), '1');
      } finally { await page.close(); }
    });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
