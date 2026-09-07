import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';

// Use the existing Vite app and an isolated Chrome instance: browser DOMPurify,
// Marked and Tiptap parsers must all run, not a mocked serializer or source regex.
test('CF114 real editor preserves formatting and emits changes only for document edits', async t => {
  const { createServer } = await import('../apps/web/node_modules/vite/dist/node/index.js');
  const server = await createServer({ root: fileURLToPath(new URL('../apps/web', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
    name: 'cf114-editor-test-harness',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url !== '/cf114-editor-test.html') { next(); return; }
        const html = await server.transformIndexHtml(request.url, '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/cf114-editor-test-entry.js"></script></body></html>');
        response.setHeader('Content-Type', 'text/html'); response.end(html);
      });
    },
    resolveId: id => id === '/cf114-editor-test-entry.js' ? '\0cf114-editor-test-entry' : undefined,
    load: id => id === '\0cf114-editor-test-entry' ? `
      import React, { useState, createRef } from 'react';
      import { createRoot } from 'react-dom/client';
      import { StructuredDocumentEditor } from '/src/documents/StructuredDocumentEditor.tsx';
      const ref = createRef(); let changes = 0;
      function Harness() {
        const [readOnly, setReadOnly] = useState(false);
        const [value, setValue] = useState('검수 원문');
        const [editorJson, setEditorJson] = useState(undefined);
        globalThis.cf114EditorTest = { ref, setReadOnly, changes: () => changes };
        return React.createElement(StructuredDocumentEditor, { ref, label: 'CF114 합성 편집기', value, editorJson, readOnly,
          onChange: (markdown, json) => { changes++; setValue(markdown); setEditorJson(json); } });
      }
      createRoot(document.getElementById('root')).render(React.createElement(Harness));
    ` : undefined
  }] });
  await server.listen();
  const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(value => value && existsSync(value));
  assert.ok(executablePath, 'Set CHROME_PATH to an installed Chrome/Chromium executable.');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    const browserErrors: string[] = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/cf114-editor-test.html`);
    await t.test('rich Markdown round trips preserve alignment, underline, highlight and inline text while sanitizing unsafe markup', async () => {
    const result = await page.evaluate(async () => {
      const modulePath = '/src/documents/StructuredDocumentEditor.tsx';
      const { editorHtmlToMarkdown, parseStructuredDocumentMarkdown, renderStructuredDocumentHtml } = await import(modulePath);
      const source = '<h2 style="text-align:center">검토 <strong>제목</strong></h2><p style="text-align:right"><u><strong>금액 &lt;유지&gt;</strong></u> <mark><em>중요 근거</em></mark></p><p><u>일반 밑줄</u> <mark>일반 강조</mark></p><p style="text-align:justify">양쪽 정렬</p>';
      const markdown = editorHtmlToMarkdown(source);
      const first = renderStructuredDocumentHtml(parseStructuredDocumentMarkdown(markdown));
      const second = renderStructuredDocumentHtml(parseStructuredDocumentMarkdown(editorHtmlToMarkdown(first)));
      const body = new DOMParser().parseFromString(second, 'text/html').body;
      const paragraphs = [...body.querySelectorAll('p')];
      const unsafe = editorHtmlToMarkdown('<p style="text-align:center" onclick="alert(1)"><u>안전한 본문</u><script>alert(1)</script></p>');
      const normal = editorHtmlToMarkdown('<h2>일반 제목</h2><p>일반 본문</p>');
      return { markdown, first, second, headingAlignment: (body.querySelector('h2') as HTMLElement)?.style.textAlign, paragraphAlignments: paragraphs.map(item => item.style.textAlign), text: body.textContent, underline: [...body.querySelectorAll('u')].map(item => item.textContent), highlight: [...body.querySelectorAll('mark')].map(item => item.textContent), nestedBold: body.querySelector('u strong,strong u')?.textContent, nestedItalic: body.querySelector('mark em,em mark')?.textContent, unsafe, normal };
    });
    assert.equal(result.headingAlignment, 'center');
    assert.deepEqual(result.paragraphAlignments, ['right', '', 'justify']);
    assert.deepEqual(result.underline, ['금액 <유지>', '일반 밑줄']);
    assert.deepEqual(result.highlight, ['중요 근거', '일반 강조']);
    assert.equal(result.nestedBold, '금액 <유지>'); assert.equal(result.nestedItalic, '중요 근거');
    assert.equal(result.text, '검토 제목금액 <유지> 중요 근거일반 밑줄 일반 강조양쪽 정렬');
    assert.equal(result.first, result.second, 'repeated save/import must not accumulate markup or lose formatting');
    assert.doesNotMatch(result.unsafe, /onclick|script|alert/u); assert.match(result.unsafe, /안전한 본문/u);
    assert.equal(result.normal, '## 일반 제목\n\n일반 본문', 'ordinary Markdown remains ordinary Markdown');
    });
    await t.test('readOnly toggles do not emit onChange; typing and matching replacement do; a stale replacement is refused', async () => {
      const editor = page.locator('.tiptap').first();
      await editor.waitFor({ state: 'visible', timeout: 10_000 }).catch(async () => assert.fail(JSON.stringify({ browserErrors, body: await page.locator('body').innerText() })));
      const read = () => page.evaluate(() => {
        const harness = (globalThis as any).cf114EditorTest;
        return { changes: harness.changes(), document: harness.ref.current.getJSON(), markdown: harness.ref.current.getMarkdown() };
      });
      const initial = await read();
      assert.equal(initial.changes, 0);
      for (let index = 0; index < 4; index++) {
        for (const readOnly of [true, false]) {
          await page.evaluate(value => { (globalThis as any).cf114EditorTest.setReadOnly(value); }, readOnly);
          await page.locator(`.tiptap[contenteditable="${!readOnly}"]`).waitFor({ state: 'visible' });
        }
      }
      assert.deepEqual(await read(), initial, 'saving/readOnly status alone must not dirty or change the document');
      await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' 추가 입력');
      const typed = await read();
      assert.ok(typed.changes > 0); assert.match(typed.markdown, /검수 원문 추가 입력/u);
      const stale = await page.evaluate(() => (globalThis as any).cf114EditorTest.ref.current.replaceRange(1, 6, '지연된 AI 응답', '이미 변경된 원문'));
      assert.equal(stale, false); assert.deepEqual(await read(), typed, 'stale AI offsets must not change the document or emit a change');
      const accepted = await page.evaluate(() => (globalThis as any).cf114EditorTest.ref.current.replaceRange(1, 6, '검수 수정', '검수 원문'));
      const replaced = await read();
      assert.equal(accepted, true); assert.ok(replaced.changes > typed.changes);
      assert.match(replaced.markdown, /검수 수정 추가 입력/u); assert.doesNotMatch(replaced.markdown, /검수 원문|지연된 AI 응답/u);
    });
  } finally { await browser.close(); await server.close(); }
});
