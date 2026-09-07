import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';

// Reuse the CF120 isolated Vite fixture, never a logged-in profile or live API.
test('CF121 administrator law API settings UI', async t => {
  const { createServer } = await import('../apps/web/node_modules/vite/dist/node/index.js');
  const server = await createServer({
    root: fileURLToPath(new URL('../apps/web', import.meta.url)),
    server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error',
    plugins: [{
      name: 'cf121-isolated-settings', enforce: 'pre',
      transform(_code: string, id: string) {
        if (!id.replaceAll('\\', '/').endsWith('/qa/cf114-studio.tsx')) return;
        return `
          import React from 'react';
          import {createRoot} from 'react-dom/client';
          import {PreviewLawApiSettings} from '../src/routes/PreviewLawApiSettings';
          import {PreviewSettings} from '../src/routes/PreviewSettings';
          import appHtml from '../index.html?raw';
          import '../src/preview-theme.css';
          import '../src/theme-system.css';
          import '../src/routes/PreviewSettings.css';
          document.head.prepend(...Array.from(new DOMParser().parseFromString(appHtml,'text/html').head.querySelectorAll('style')).map(node=>node.cloneNode(true)));
          document.documentElement.dataset.theme='light';
          document.querySelector('body>nav').remove();
          const root=document.getElementById('root');root.style.marginLeft='0';root.style.maxWidth='1200px';root.style.marginInline='auto';
          const nonadmin=new URLSearchParams(location.search).has('nonadmin');
          createRoot(root).render(nonadmin?<PreviewSettings roles={['staff']} onNavigate={()=>{throw new Error('Unexpected navigation')}}/>:<PreviewLawApiSettings/>);
        `;
      }
    }]
  } as any);
  await server.listen();
  const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(path => path && existsSync(path));
  assert.ok(executablePath, 'A local Chromium binary is required');
  const browser = await chromium.launch({ executablePath, headless: true });
  const errors: string[] = [], unexpectedRequests: string[] = [];
  const load = async (options: { configured?: boolean; storage?: string; masterKeyReady?: boolean; nonadmin?: boolean; version?: number; getError?: { status: number; error: string; code: string } } = {}) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => { (window as any).__CLAIM_API_ORIGIN__ = window.location.origin; });
    const state = {
      settings: { configured: options.configured ?? false, storage: options.storage ?? 'NONE', version: options.version ?? (options.configured ? 7 : 0), updatedAt: options.configured ? '2026-09-07T00:00:00Z' : null, masterKeyReady: options.masterKeyReady ?? true },
      calls: [] as { method: string; path: string; body: any }[],
      saveError: null as null | { status: number; error: string; code: string },
      testError: null as null | { status: number; error: string; code: string },
      getError: options.getError ?? null as null | { status: number; error: string; code: string }
    };
    await context.route('**/*', async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      if (url.origin !== origin) { unexpectedRequests.push(url.origin); await route.abort(); return; }
      if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
      const body = route.request().postDataJSON();
      state.calls.push({ method, path: url.pathname, body });
      const reply = (payload: unknown, status = 200) => route.fulfill({ status, json: payload });
      if (url.pathname === '/api/settings/law-api' && method === 'GET') {
        if (state.getError) return reply(state.getError, state.getError.status);
        return reply({ settings: state.settings });
      }
      if (url.pathname === '/api/settings/law-api' && method === 'PUT') {
        if (state.saveError) return reply(state.saveError, state.saveError.status);
        state.settings = { ...state.settings, configured: true, storage: 'ENCRYPTED_D1', version: state.settings.version + 1, updatedAt: '2026-09-07T01:00:00Z' };
        return reply({ settings: state.settings });
      }
      if (url.pathname === '/api/settings/law-api/test' && method === 'POST') {
        if (state.testError) return reply(state.testError, state.testError.status);
        return reply({ settings: state.settings, checkedAt: '2026-09-07T02:00:00Z', count: 1 });
      }
      if (url.pathname === '/api/settings/ai-credentials' && method === 'GET') return reply({ personalPriority: true, masterKeyReady: true, canManageOrganization: false, providers: [] });
      unexpectedRequests.push(method + ' ' + url.pathname);
      return reply({ error: 'Unmocked API is blocked' }, 503);
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/qa/cf114-studio.html?section=admin${options.nonadmin ? '&nonadmin=1' : ''}`);
    return { page, state, close: () => context.close() };
  };
  const oc = (page: Page) => page.getByLabel('API 인증값(OC)', { exact: true });
  const save = (page: Page) => page.getByRole('button', { name: 'OC 저장', exact: true });
  const check = (page: Page) => page.getByRole('button', { name: '저장된 인증값 연결 확인', exact: true });
  const ready = (page: Page) => page.locator('.law-api-settings-status').filter({ hasText: /OC 미설정|OC 암호화 저장됨|서버 인증값 설정됨/u }).waitFor();
  const mutations = (state: Awaited<ReturnType<typeof load>>['state']) => state.calls.filter(call => call.method !== 'GET');
  try {
    await t.test('password label, initial gating, safe save, clear and connection test contract', async () => {
      const { page, state, close } = await load();
      await ready(page);
      assert.equal(await oc(page).getAttribute('type'), 'password');
      assert.equal(await oc(page).getAttribute('autocomplete'), 'new-password');
      assert.equal(await oc(page).getAttribute('aria-describedby'), 'law-api-oc-help');
      assert.equal(await oc(page).inputValue(), '');
      assert.equal(await save(page).isDisabled(), true);
      assert.equal(await check(page).isDisabled(), true);
      await oc(page).fill('  cf121_synthetic_oc  ');
      assert.equal(await save(page).isEnabled(), true);
      assert.equal(await check(page).isDisabled(), true);
      await save(page).click();
      await page.getByRole('status').filter({ hasText: 'OC 인증값을 암호화 저장했습니다.' }).waitFor();
      assert.deepEqual(mutations(state), [{ method: 'PUT', path: '/api/settings/law-api', body: { oc: 'cf121_synthetic_oc', expectedVersion: 0 } }]);
      assert.equal(await oc(page).inputValue(), '');
      assert.equal(await check(page).isEnabled(), true);
      assert.equal(await save(page).isDisabled(), true);
      assert.equal((await page.locator('body').innerText()).includes('cf121_synthetic_oc'), false, 'saved OC must not be echoed');
      await check(page).click();
      await page.getByRole('status').filter({ hasText: '연결 정상 · 공식 판례 응답 1건 확인' }).waitFor();
      assert.deepEqual(mutations(state).at(-1), { method: 'POST', path: '/api/settings/law-api/test', body: { expectedVersion: 1 } });
      await oc(page).fill('cf121_replacement');
      assert.equal(await check(page).isDisabled(), true, 'unsaved OC may not be tested as the stored credential');
      assert.match(await page.locator('.law-api-settings').innerText(), /먼저 OC 저장/u);
      await oc(page).fill('');
      await page.reload();
      await ready(page);
      assert.equal(await oc(page).inputValue(), '', 'metadata reload never reveals a stored OC');
      assert.equal(mutations(state).length, 2, 'reload performs no credential mutation');
      await close();
    });
    await t.test('desktop and mobile controls remain visible without horizontal overflow', async () => {
      const { page, close } = await load({ configured: true, storage: 'ENCRYPTED_D1' });
      await ready(page);
      mkdirSync('output/playwright/cf121', { recursive: true });
      const bounds: unknown[] = [];
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        const layout = await page.evaluate(() => ({
          width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          controls: Array.from(document.querySelectorAll('.law-api-settings input,.law-api-settings button')).map(node => {
            const rect = node.getBoundingClientRect(); return { x: rect.x, width: rect.width, right: rect.right, height: rect.height };
          })
        }));
        assert.ok(layout.scrollWidth <= layout.width, 'page must not horizontally overflow');
        assert.ok(layout.controls.every(rect => rect.x >= 0 && rect.right <= layout.width && rect.height > 0), 'every form control fits the viewport');
        bounds.push(layout);
        await page.locator('.law-api-settings').screenshot({ path: `output/playwright/cf121/${viewport.width === 390 ? 'mobile' : 'desktop'}.png` });
      }
      t.diagnostic(JSON.stringify({ layout: bounds }));
      await close();
    });
    await t.test('invalid input never leaves the page and failed saves retain OC through version refresh', async () => {
      const { page, state, close } = await load({ configured: true, storage: 'ENCRYPTED_D1' });
      await ready(page);
      await oc(page).fill('https://www.law.go.kr');
      await save(page).click();
      await page.getByRole('alert').filter({ hasText: 'OC 인증값은 공백 없이' }).waitFor();
      assert.equal(mutations(state).length, 0);
      await oc(page).fill('cf121_unsaved');
      state.saveError = { status: 503, error: '합성 저장소 오류: 입력을 유지합니다.', code: 'LAW_API_SETTINGS_UNAVAILABLE' };
      await save(page).click();
      await page.getByRole('alert').filter({ hasText: '합성 저장소 오류' }).waitFor();
      assert.equal(await oc(page).inputValue(), 'cf121_unsaved');
      assert.equal(await check(page).isDisabled(), true);
      state.saveError = { status: 409, error: '합성 동시 변경', code: 'VERSION_CONFLICT' };
      await save(page).click();
      await page.getByRole('alert').filter({ hasText: '입력값은 유지했습니다' }).waitFor();
      assert.equal(await oc(page).inputValue(), 'cf121_unsaved');
      assert.deepEqual(mutations(state).map(call => call.body.expectedVersion), [7, 7]);
      state.settings.version = 8;
      state.saveError = null;
      await page.getByRole('button', { name: '설정 다시 불러오기', exact: true }).click();
      await ready(page);
      assert.equal(await oc(page).inputValue(), 'cf121_unsaved', 'explicit metadata refresh preserves the unsaved value');
      await save(page).click();
      await page.getByRole('status').filter({ hasText: 'OC 인증값을 암호화 저장했습니다.' }).waitFor();
      assert.equal(mutations(state).at(-1)?.body.expectedVersion, 8);
      assert.equal(await oc(page).inputValue(), '');
      await close();
    });
    await t.test('official connection failure is inline and does not alter stored metadata', async () => {
      const { page, state, close } = await load({ configured: true, storage: 'ENCRYPTED_D1' });
      await ready(page);
      const before = structuredClone(state.settings);
      state.testError = { status: 502, error: '공식 판례 응답을 확인하지 못했습니다. OC 인증값, 판례 API 사용 승인 및 호출 제한을 확인해 주세요. 저장된 값은 변경하지 않았습니다.', code: 'LAW_API_CONNECTION_FAILED' };
      await check(page).click();
      await page.getByRole('alert').filter({ hasText: '저장된 값은 변경하지 않았습니다.' }).waitFor();
      assert.deepEqual(state.settings, before);
      assert.deepEqual(mutations(state), [{ method: 'POST', path: '/api/settings/law-api/test', body: { expectedVersion: 7 } }]);
      assert.equal(await check(page).isEnabled(), true);
      assert.equal(await oc(page).inputValue(), '');
      await close();
    });
    await t.test('missing encryption disables editing but existing environment credential can still be tested', async () => {
      for (const configured of [false, true]) {
        const { page, state, close } = await load({ configured, storage: configured ? 'CLOUDFLARE_SECRET' : 'NONE', version: 0, masterKeyReady: false });
        await ready(page);
        await page.getByRole('alert').filter({ hasText: '서버 암호화 설정이 준비되지 않아 저장할 수 없습니다.' }).waitFor();
        assert.equal(await oc(page).isDisabled(), true);
        assert.equal(await save(page).isDisabled(), true);
        assert.equal(await check(page).isEnabled(), configured);
        assert.equal(mutations(state).length, 0);
        await close();
      }
    });
    await t.test('failed metadata fetch fails closed and explicit reload recovers', async () => {
      const { page, state, close } = await load({ getError: { status: 503, error: '합성 설정 조회 실패', code: 'LAW_API_SETTINGS_UNAVAILABLE' } });
      await page.getByRole('alert').filter({ hasText: '합성 설정 조회 실패' }).waitFor();
      assert.equal(await oc(page).isDisabled(), true);
      assert.equal(await save(page).isDisabled(), true);
      assert.equal(await check(page).isDisabled(), true);
      state.getError = null;
      await page.getByRole('button', { name: '설정 다시 불러오기', exact: true }).click();
      await ready(page);
      assert.equal(await oc(page).isEnabled(), true);
      assert.equal(mutations(state).length, 0);
      await close();
    });
    await t.test('non-admin route cannot reveal or request administrator OC settings', async () => {
      const source = readFileSync(new URL('../apps/web/src/routes/PreviewSettings.tsx', import.meta.url), 'utf8');
      const adminStart = source.indexOf("{section === 'ADMIN' && isAdmin && workspace && <>");
      assert.ok(adminStart >= 0 && source.indexOf('<PreviewLawApiSettings', adminStart) > adminStart, 'OC component remains inside the existing admin-only branch');
      const { page, state, close } = await load({ nonadmin: true });
      await page.getByRole('heading', { name: '로그인 비밀번호 변경', exact: true }).waitFor();
      assert.equal(await page.locator('.law-api-settings').count(), 0);
      assert.equal(await page.locator('#law-api-oc').count(), 0);
      assert.equal(await page.getByRole('button').filter({ hasText: '관리자 설정' }).count(), 0);
      assert.equal(state.calls.some(call => call.path.startsWith('/api/settings/law-api')), false);
      assert.equal(mutations(state).length, 0);
      await close();
    });
    assert.deepEqual(errors, [], 'no browser page errors');
    assert.deepEqual(unexpectedRequests, [], 'no network path beyond the local fixture and explicit API mocks');
  } finally {
    await browser.close();
    await server.close();
  }
});
