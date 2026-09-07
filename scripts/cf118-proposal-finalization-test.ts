import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';

// Existing synthetic API fixture + production ProposalView and all production
// CSS. The app's actual base stylesheet and scroll ancestors matter: a bare
// component without .main-content cannot reproduce the sticky failure.
test('CF118 proposal finalization keeps its actions reachable without changing confirmation or reception', async t => {
  const { createServer } = await import('../apps/web/node_modules/vite/dist/node/index.js');
  const baseStyles = readFileSync('apps/web/index.html', 'utf8').match(/<style>([\s\S]*?)<\/style>/u)?.[1];
  assert.ok(baseStyles);
  const server = await createServer({ root: resolve('apps/web'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
    name: 'cf118-proposal-shell',
    configureServer(server: any) {
      server.middlewares.use(async (request: any, response: any, next: () => void) => {
        if (!request.url?.startsWith('/cf118-proposal-test.html')) { next(); return; }
        const html = await server.transformIndexHtml(request.url, `<!doctype html><html lang="ko" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${baseStyles}</style></head><body><div class="app-shell" data-workspace-section="proposal"><header class="topbar"><strong>CF118 합성 검수</strong><output id="qa-navigation"></output></header><div class="shell-body"><main id="root" class="main-content"></main></div></div><script type="module" src="/qa/cf102-workflows.tsx"></script></body></html>`);
        response.setHeader('Content-Type', 'text/html'); response.end(html);
      });
    },
  }] } as any);
  await server.listen();
  const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(path => path && existsSync(path));
  assert.ok(executablePath);
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());

  const load = async (query = '', width = 1440, height = 900) => {
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}/cf118-proposal-test.html?view=proposal${query}`);
    const step4 = page.getByRole('button', { name: /전체 미리보기·확정/u });
    await step4.waitFor({ state: 'visible' });
    assert.equal(await step4.getAttribute('aria-disabled'), 'false');
    await page.evaluate(() => {
      const original = window.fetch;
      (window as any).cf118Requests = [];
      window.fetch = async (input, init) => {
        if (init?.method === 'POST' && String(input).includes('/reviews')) {
          (window as any).cf118Requests.push(JSON.parse(String(init.body)));
          if ((window as any).cf118Hold) await new Promise<void>(resolve => { (window as any).cf118Release = resolve; });
        }
        return original(input, init);
      };
    });
    await step4.click();
    await page.locator('.proposal-finalization-workspace').waitFor({ state: 'visible' });
    await page.locator('.proposal-final-chapter[data-page-fit-overflow="false"]').first().waitFor();
  };
  const rail = () => page.locator('.proposal-finalization-layout > .proposal-finalization-actions');
  const footer = () => page.locator('.proposal-finalization-workspace > footer');
  const requests = () => page.evaluate(() => (window as any).cf118Requests as Array<Record<string, unknown>>);
  const navigation = () => page.locator('#qa-navigation').innerText();
  const frame = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const scroll = async (y: number) => { await page.evaluate(value => window.scrollTo(0, value), y); await frame(); };
  const assertSticky = async (y: number) => {
    await scroll(y);
    const railBox = await rail().boundingBox();
    const topbar = await page.locator('.topbar').boundingBox();
    assert.ok(railBox && topbar);
    assert.ok(Math.abs(railBox.y - (topbar.y + topbar.height + 16)) < 2, `Rail must remain 16px below the live topbar: ${JSON.stringify({ y: railBox.y, topbarBottom: topbar.y + topbar.height })}`);
  };

  try {
    await t.test('desktop document scroll keeps the right rail visible and restores a non-exported bottom action', async () => {
      await load();
      assert.equal(await footer().count(), 1, 'Step 4 must include a bottom action after the long preview.');
      assert.equal(await rail().getByRole('button', { name: '확정 · 프로젝트 접수로', exact: true }).count(), 1);
      assert.equal(await footer().getByRole('button', { name: '확정 · 프로젝트 접수로', exact: true }).count(), 1);
      assert.equal(await page.locator('.proposal-final-export-source button').count(), 0, 'Action buttons must not enter the exported document.');
      const columns = await page.locator('.proposal-finalization-layout').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
      assert.equal(columns, 2);
      await assertSticky(2000);
      await assertSticky(4000);
      await page.locator('.topbar').evaluate(element => { (element as HTMLElement).style.minHeight = '132px'; });
      await frame();
      await assertSticky(5000);
      assert.equal(await footer().evaluate(element => getComputedStyle(element).position), 'static', 'Bottom action must follow the preview, not cover it.');
      await footer().scrollIntoViewIfNeeded();
      const box = await footer().boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= 901);
      assert.equal(await navigation(), '');
      assert.equal((await requests()).length, 0);
    });

    await t.test('both draft controls preserve the confirmation dialog and cancelling does not write or navigate', async () => {
      await load();
      for (const controls of [rail(), footer()]) {
        await controls.getByRole('button', { name: '확정 · 프로젝트 접수로', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible' });
        assert.match(await dialog.innerText(), /제안서를 최종 확정할까요/u);
        assert.equal((await requests()).length, 0);
        await dialog.getByRole('button', { name: '아니요 · 다시 확인' }).click();
        assert.equal(await dialog.count(), 0);
        assert.equal(await navigation(), '');
      }
      assert.equal((await requests()).length, 0);
    });

    await t.test('confirmation preserves the version payload, blocks a second click, and navigates only after success', async () => {
      await load();
      await page.evaluate(() => { (window as any).cf118Hold = true; });
      await footer().getByRole('button', { name: '확정 · 프로젝트 접수로', exact: true }).click();
      const yes = page.getByRole('dialog').getByRole('button', { name: '네 · 제안서 확정' });
      await yes.click();
      await page.waitForFunction(() => (window as any).cf118Requests.length === 1);
      assert.equal(await yes.isDisabled(), true);
      assert.equal(await rail().getByRole('button', { name: '확정 · 프로젝트 접수로', exact: true }).isDisabled(), true);
      assert.equal(await footer().getByRole('button', { name: '확정 · 프로젝트 접수로', exact: true }).isDisabled(), true);
      assert.equal(await navigation(), '');
      const [payload] = await requests();
      assert.equal(payload.action, 'CONFIRM'); assert.equal(payload.versionId, 'version-1'); assert.equal(payload.version, 1);
      await page.evaluate(() => { (window as any).cf118Release(); });
      await page.waitForFunction(() => document.querySelector('#qa-navigation')?.textContent?.includes('/workflow/award?'));
      assert.equal(await navigation(), '이동 요청: /workflow/award?caseId=case-1&proposalId=proposal-1');
      assert.equal((await requests()).length, 1);
    });

    await t.test('failed confirmation retains the draft and dialog without entering reception', async () => {
      await load('&fail=1');
      await footer().getByRole('button', { name: '확정 · 프로젝트 접수로', exact: true }).click();
      const yes = page.getByRole('dialog').getByRole('button', { name: '네 · 제안서 확정' });
      await yes.click();
      await page.getByText('CF102 의도된 확정 실패 · 이동하면 안 됨', { exact: true }).waitFor();
      assert.equal(await navigation(), '');
      assert.equal((await requests()).length, 1);
      assert.equal(await yes.isDisabled(), false);
      assert.equal(await page.getByRole('dialog', { name: '제안서를 최종 확정할까요?' }).count(), 1);
      assert.equal(await page.getByRole('dialog', { name: '제안서 작업 확인' }).count(), 1);
      assert.equal(await page.getByRole('button', { name: '확정 제안서 PDF 내려받기', exact: true }).count(), 0);
    });

    await t.test('narrow approved preview keeps a top rail, bottom reception and matching navigation without exporting controls', async () => {
      await load('&approved=1', 900, 900);
      await assertSticky(2000);
      for (const width of [900, 390]) {
        await page.setViewportSize({ width, height: 900 }); await frame();
        await assertSticky(3000);
        const measurements = await page.evaluate(() => {
          const rail = document.querySelector('.proposal-finalization-layout > .proposal-finalization-actions')!;
          const source = document.querySelector('.proposal-final-export-source')!;
          const box = rail.getBoundingClientRect();
          return { left: box.left, right: box.right, height: box.height, viewport: innerWidth,
            precedesSource: Boolean(rail.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING),
            controlsInExport: source.querySelectorAll('button').length };
        });
        assert.equal(measurements.precedesSource, true, 'Mobile visual order and keyboard order must both place the rail before the document.');
        assert.ok(measurements.left >= 0 && measurements.right <= measurements.viewport + 1);
        assert.ok(measurements.height < 450, 'The narrow rail must leave document reading space.');
        assert.equal(measurements.controlsInExport, 0);
      }
      for (const controls of [rail(), footer()]) {
        await controls.getByRole('button', { name: '프로젝트 접수로 →', exact: true }).click();
        assert.equal(await navigation(), '이동 요청: /workflow/award?caseId=case-1&proposalId=proposal-1');
        await page.locator('#qa-navigation').evaluate(element => { element.textContent = ''; });
      }
      assert.equal((await requests()).length, 0);
    });
  } finally { await browser.close(); await server.close(); }
});
