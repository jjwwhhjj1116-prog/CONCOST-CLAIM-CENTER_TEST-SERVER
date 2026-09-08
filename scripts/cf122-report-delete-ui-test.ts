import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';

// Fresh local browser contexts, actual React/CSS, synthetic records, blocked live APIs.
test('CF122 report deletion and compact project lists UI', async t => {
  const { createServer } = await import('../apps/web/node_modules/vite/dist/node/index.js');
  const server = await createServer({
    root: fileURLToPath(new URL('../apps/web', import.meta.url)),
    server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error',
    plugins: [{ name: 'cf122-isolated-library', enforce: 'pre', transform(_code: string, id: string) {
      if (!id.replaceAll('\\', '/').endsWith('/qa/cf114-studio.tsx')) return;
      return `
        import React, {useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {ReportLibraryView} from '../src/reports/ReportLibraryView';
        import {ProposalLibraryView} from '../src/proposals/ProposalLibraryView';
        import {IntakeLibraryView} from '../src/intakes/IntakeLibraryView';
        import appHtml from '../index.html?raw';
        import '../src/proposals/ProposalLibraryView.css';
        import '../src/intakes/IntakeLibraryView.css';
        import '../src/preview-theme.css';
        import '../src/theme-system.css';
        document.head.prepend(...Array.from(new DOMParser().parseFromString(appHtml,'text/html').head.querySelectorAll('style')).map(node=>node.cloneNode(true)));
        document.documentElement.dataset.theme='light';
        document.querySelector('body>nav').remove();
        const root=document.getElementById('root');root.style.marginLeft='0';root.style.maxWidth='1200px';root.style.marginInline='auto';
        const params=new URLSearchParams(location.search), kind=params.get('kind')||'reports', mode=params.get('mode')||'database';
        function Fixture(){const [path,setPath]=useState('');const View=kind==='intakes'?IntakeLibraryView:kind==='proposals'?ProposalLibraryView:ReportLibraryView;return <><View mode={mode} onNavigate={setPath}/><output data-testid="navigation">{path}</output></>}
        createRoot(root).render(<Fixture/>);
      `;
    } }]
  } as any);
  await server.listen();
  const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(path => path && existsSync(path));
  assert.ok(executablePath, 'A local Chromium binary is required');
  const browser = await chromium.launch({ executablePath, headless: true });
  const errors: string[] = [], unexpectedRequests: string[] = [];
  const longTitle = 'CF122 합성 장문 프로젝트 재건축 공사비 및 공기연장 클레임 기술검토 현장조사 물량산출 근거분석 보고서 검수';
  const workspaces = [1, 2, 3].map(n => ({
    caseId: `cf122-case-${n}`, caseNumber: `CF122-00${n}`, caseTitle: n === 1 ? longTitle : `CF122 합성 프로젝트 ${n}`,
    claimType: 'TYPE-01', reportTitle: n === 1 ? `${longTitle} 보고서` : `CF122 합성 보고서 ${n}`, version: 4 - n,
    wizardStep: n === 3 ? 5 : 3, selectedChapterId: 'CH-01', updatedAt: '2026-09-08T00:00:00Z', updatedByName: '합성 검수자', contentLength: 1234
  }));
  const proposals = workspaces.map((row, n) => ({
    id: `cf122-proposal-${n + 1}`, caseId: row.caseId, caseNumber: row.caseNumber, caseTitle: row.caseTitle,
    proposalNumber: `PROP-CF122-${n + 1}`, proposalTitle: `${row.caseTitle} 제안서`, revisionLabel: 'v1', clientName: 'CF122 합성 발주처',
    sentAt: `2026-09-0${8 - n}T00:00:00Z`, responseDueOn: null, proposedAmountKrw: null,
    awardStatus: n === 1 ? 'WON' : 'PENDING', verificationStatus: 'VERIFIED', documentUrl: n === 0 ? `${origin}/cf122-synthetic.pdf` : null,
    documentSha256: '1'.repeat(64), createdByName: '합성 검수자', createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z',
    version: 1, catalogVersion: 1, listHidden: false, driveArchiveUrl: null, driveArchivedAt: null
  }));
  const intakes = workspaces.map(row => ({
    id: row.caseId, caseNumber: row.caseNumber, title: row.caseTitle, description: `${row.caseTitle}의 합성 의뢰 설명입니다. 현장조사와 근거를 확인합니다.`,
    claimType: 'TYPE-01', status: 'INQUIRY', version: 1, clientLegalPosition: '발주자', clientPositionDetail: '합성 데이터',
    createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z', createdByName: '합성 검수자', listHidden: false,
    dbDeleted: false, catalogVersion: 1, driveArchiveUrl: null, driveArchivedAt: null, driveArchivedByName: null
  }));
  const load = async (options: { kind?: string; mode?: string; canDelete?: boolean; getError?: boolean } = {}) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => { (window as any).__CLAIM_API_ORIGIN__ = window.location.origin; });
    const state = {
      workspaces: structuredClone(workspaces), canDelete: options.canDelete ?? true,
      calls: [] as { method: string; path: string; search: string; body: any }[],
      getError: options.getError ?? false, deleteError: null as null | { status: number; error: string; code: string },
      deleteGate: null as Promise<void> | null
    };
    await context.route('**/*', async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      if (url.origin !== origin) { unexpectedRequests.push(url.origin); await route.abort(); return; }
      if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
      state.calls.push({ method, path: url.pathname, search: url.search, body: route.request().postDataJSON() });
      const reply = (payload: unknown, status = 200) => route.fulfill({ status, json: payload });
      if (url.pathname === '/api/report-workspaces' && method === 'GET') {
        return state.getError ? reply({ error: 'CF122 합성 조회 실패' }, 503) : reply({ workspaces: state.workspaces, canDelete: state.canDelete });
      }
      if (/^\/api\/report-workspaces\/cf122-case-[123]\/delete$/.test(url.pathname) && method === 'POST') {
        if (state.deleteGate) await state.deleteGate;
        if (state.deleteError) return reply(state.deleteError, state.deleteError.status);
        const caseId = url.pathname.split('/')[3];
        state.workspaces = state.workspaces.filter(row => row.caseId !== caseId);
        return reply({ ok: true, deleted: true, caseId });
      }
      const query = (url.searchParams.get('q') ?? '').toLocaleLowerCase();
      if (url.pathname === '/api/proposal-catalog' && method === 'GET') {
        const award = url.searchParams.get('awardStatus');
        return reply({ proposals: proposals.filter(row => (!query || JSON.stringify(row).toLocaleLowerCase().includes(query)) && (!award || row.awardStatus === award)) });
      }
      if (url.pathname === '/api/cases/catalog' && method === 'GET') return reply({ intakes: intakes.filter(row => !query || JSON.stringify(row).toLocaleLowerCase().includes(query)) });
      unexpectedRequests.push(`${method} ${url.pathname}`);
      return reply({ error: 'Unmocked API is blocked' }, 503);
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/qa/cf114-studio.html?kind=${options.kind ?? 'reports'}&mode=${options.mode ?? 'database'}`);
    await page.getByRole('heading', { name: /보고서 DB관리|프로젝트별 보고서 목록|프로젝트별 제안서 목록|프로젝트 의뢰 목록/ }).waitFor();
    return { page, state, close: () => context.close() };
  };
  const targetRow = (page: Page) => page.locator('tbody tr').filter({ hasText: workspaces[0].caseNumber });
  const deleteButton = (page: Page) => targetRow(page).getByRole('button', { name: /삭제/ });
  const mutations = (state: Awaited<ReturnType<typeof load>>['state']) => state.calls.filter(call => call.method !== 'GET');
  try {
    await t.test('confirmation cancel never sends a mutation and preserves rows and counters', async () => {
      const { page, state, close } = await load();
      await deleteButton(page).waitFor();
      let confirmation = '';
      page.once('dialog', async dialog => { confirmation = dialog.message(); await dialog.dismiss(); });
      await deleteButton(page).click();
      assert.match(confirmation, /CF122-001/u);
      assert.ok(confirmation.includes(workspaces[0].reportTitle));
      assert.match(confirmation, /Drive|드라이브/u);
      assert.match(confirmation, /이력|보존/u);
      assert.equal(mutations(state).length, 0);
      assert.equal(await page.locator('tbody tr').count(), 3);
      assert.deepEqual(await page.locator('.proposal-library__summary strong').allTextContents(), ['3', '2', '1', '6']);
      await close();
    });
    await t.test('busy prevents duplicate mutation and success removes only selected report', async () => {
      const { page, state, close } = await load();
      await deleteButton(page).waitFor();
      let release!: () => void;
      state.deleteGate = new Promise<void>(resolve => { release = resolve; });
      page.once('dialog', dialog => dialog.accept());
      await deleteButton(page).click();
      await page.getByRole('button', { name: /삭제 중/ }).waitFor();
      assert.equal(await page.locator('tbody button').filter({ hasText: /삭제/ }).evaluateAll(nodes => nodes.every(node => (node as HTMLButtonElement).disabled)), true);
      assert.equal(mutations(state).length, 1);
      assert.deepEqual(mutations(state)[0].body, { expectedVersion: 3 });
      assert.equal(mutations(state)[0].path, '/api/report-workspaces/cf122-case-1/delete');
      release();
      await page.getByRole('status').filter({ hasText: /삭제/ }).waitFor();
      assert.equal(await targetRow(page).count(), 0);
      assert.equal(await page.locator('tbody tr').count(), 2);
      assert.deepEqual(await page.locator('.proposal-library__summary strong').allTextContents(), ['2', '1', '1', '3']);
      await page.reload();
      await page.locator('tbody tr').first().waitFor();
      assert.equal(await targetRow(page).count(), 0);
      assert.equal(mutations(state).length, 1);
      await close();
    });
    await t.test('failure is visible while report rows remain available for retry', async () => {
      const { page, state, close } = await load();
      await deleteButton(page).waitFor();
      state.deleteError = { status: 503, error: 'CF122 합성 삭제 실패: 기존 보고서를 유지합니다.', code: 'DELETE_UNAVAILABLE' };
      page.once('dialog', dialog => dialog.accept());
      await deleteButton(page).click();
      await page.getByRole('alert').filter({ hasText: /CF122 합성 삭제 실패/ }).waitFor();
      assert.equal(await page.locator('tbody tr').count(), 3);
      assert.equal(await deleteButton(page).isEnabled(), true);
      assert.deepEqual(await page.locator('.proposal-library__summary strong').allTextContents(), ['3', '2', '1', '6']);
      state.deleteError = null;
      page.once('dialog', dialog => dialog.accept());
      await deleteButton(page).click();
      await page.getByRole('status').filter({ hasText: /삭제/ }).waitFor();
      assert.equal(await targetRow(page).count(), 0);
      assert.equal(mutations(state).length, 2);
      await close();
    });
    await t.test('non-admin capability and project-list mode expose no delete action', async () => {
      const router = readFileSync(new URL('../apps/web/src/routes/Router.tsx', import.meta.url), 'utf8');
      assert.match(router, /path: '\/reports\/database'[^\n]+allowedRoles: ADMIN_ONLY/u);
      for (const options of [{ canDelete: false }, { mode: 'projects' }]) {
        const { page, state, close } = await load(options);
        await page.getByText(workspaces[0].reportTitle, { exact: true }).first().waitFor();
        assert.equal(await page.getByRole('button', { name: /삭제/ }).count(), 0);
        assert.equal(mutations(state).length, 0);
        await close();
      }
    });
    await t.test('version conflict retains report and explicit refresh uses current version', async () => {
      const { page, state, close } = await load();
      await deleteButton(page).waitFor();
      state.deleteError = { status: 409, error: 'CF122 합성 동시 편집: 목록을 새로고침하세요.', code: 'VERSION_CONFLICT' };
      page.once('dialog', dialog => dialog.accept());
      await deleteButton(page).click();
      await page.getByRole('alert').filter({ hasText: 'CF122 합성 동시 편집' }).waitFor();
      assert.equal(await targetRow(page).count(), 1);
      state.workspaces[0].version = 4;
      state.deleteError = null;
      await page.getByRole('button', { name: '목록 새로고침', exact: true }).click();
      await targetRow(page).getByText('v4', { exact: true }).waitFor();
      page.once('dialog', dialog => dialog.accept());
      await deleteButton(page).click();
      await page.getByRole('status').filter({ hasText: /삭제/ }).waitFor();
      assert.deepEqual(mutations(state).map(call => call.body.expectedVersion), [3, 4]);
      assert.equal(await targetRow(page).count(), 0);
      await close();
    });
    await t.test('compact project lists preserve search, navigation and all existing actions', async () => {
      for (const kind of ['reports', 'proposals', 'intakes']) {
        const { page, state, close } = await load({ kind, mode: 'projects' });
        const cards = page.locator('.compact-record-list > article, .intake-record-list > article, .proposal-project-list > article');
        await cards.first().waitFor();
        assert.equal(await cards.count(), 3);
        const first = cards.filter({ hasText: 'CF122-001' });
        const names = kind === 'reports' ? ['저장 지점에서 이어쓰기'] : kind === 'proposals' ? ['이 프로젝트 제안서 작성', '접수·수주 상태 확인', '목록에서 숨기기'] : ['의뢰 열기', '제안서 작성', '목록에서 숨기기'];
        for (const name of names) assert.equal(await first.getByRole('button', { name, exact: true }).isVisible(), true, `${kind}: ${name} remains visible`);
        if (kind === 'proposals') assert.equal(await first.getByRole('link', { name: '확정 파일 열기' }).getAttribute('href'), `${origin}/cf122-synthetic.pdf`);
        if (kind === 'intakes') {
          const disclosure = first.locator('summary');
          await disclosure.press('Enter');
          assert.equal(await first.getByText(intakes[0].description, { exact: true }).isVisible(), true, 'full description remains accessible by keyboard');
          await disclosure.press('Enter');
        }
        await first.getByRole('button', { name: names[0], exact: true }).click();
        const expectedPath = kind === 'reports' ? '/reports/studio?caseId=cf122-case-1' : kind === 'proposals' ? '/proposals/editor?caseId=cf122-case-1' : '/cases/new?caseId=cf122-case-1';
        assert.equal(await page.getByTestId('navigation').textContent(), expectedPath);
        const search = page.getByRole('textbox');
        await search.fill('CF122-002');
        await cards.filter({ hasText: 'CF122-001' }).waitFor({ state: 'detached' });
        await cards.filter({ hasText: 'CF122-002' }).waitFor();
        assert.equal(await cards.count(), 1);
        assert.match(await cards.first().innerText(), /CF122-002/u);
        await search.fill('CF122-missing');
        await cards.first().waitFor({ state: 'detached' });
        await page.getByText(/없습니다/u).first().waitFor();
        assert.match(await page.locator('body').innerText(), /없습니다/u);
        assert.equal(mutations(state).length, 0);
        await close();
      }
    });
    await t.test('desktop and mobile compact rows, long titles and database actions fit their scroll regions', async () => {
      mkdirSync('output/playwright/cf122', { recursive: true });
      const layouts: unknown[] = [];
      for (const kind of ['reports', 'proposals', 'intakes', 'database']) {
        const { page, close } = await load({ kind: kind === 'database' ? 'reports' : kind, mode: kind === 'database' ? 'database' : 'projects' });
        const cards = page.locator(kind === 'database' ? 'tbody tr' : '.compact-record-list > article, .intake-record-list > article, .proposal-project-list > article');
        await cards.first().waitFor();
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
          await page.setViewportSize(viewport);
          const geometry = await page.evaluate(() => ({
            width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
            rows: Array.from(document.querySelectorAll('.compact-record-list>article,.intake-record-list>article,.proposal-project-list>article,tbody tr')).map(node => ({ height: node.getBoundingClientRect().height })),
            regions: Array.from(document.querySelectorAll('.proposal-db-table')).map(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth }))
          }));
          assert.ok(geometry.scrollWidth <= viewport.width, `${kind} ${viewport.width}: page overflow ${geometry.scrollWidth}`);
          if (viewport.width === 1440 && kind !== 'database') assert.ok(geometry.rows.every(row => row.height <= 240), `${kind}: desktop rows should be compact`);
          if (kind === 'database') {
            await deleteButton(page).scrollIntoViewIfNeeded();
            assert.equal(await deleteButton(page).isVisible(), true);
          } else {
            const bounds = await cards.locator('button').evaluateAll(nodes => nodes.map(node => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, height: rect.height }; }));
            assert.ok(bounds.every(rect => rect.left >= 0 && rect.right <= viewport.width), `${kind}: actions fit viewport`);
          }
          layouts.push({ kind, viewport: viewport.width, ...geometry });
          await page.locator(kind === 'database' ? '.report-db-card' : '.compact-record-list,.intake-record-list,.proposal-project-list').screenshot({ path: `output/playwright/cf122/${kind}-${viewport.width}.png` });
        }
        await close();
      }
      t.diagnostic(JSON.stringify({ layout: layouts }));
    });
    assert.deepEqual(errors, [], 'no browser page errors');
    assert.deepEqual(unexpectedRequests, [], 'all outside or unmocked requests are blocked');
  } finally {
    await browser.close();
    await server.close();
  }
});
