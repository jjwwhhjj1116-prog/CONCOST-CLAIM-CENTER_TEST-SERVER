import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (...parts: string[]): string => readFileSync(join(process.cwd(), ...parts), 'utf8');

test('CF80 kickoff final minutes follow the approved company table structure', () => {
  const source = read('apps', 'web', 'src', 'workflow', 'WorkflowOperations.tsx');
  const css = read('apps', 'web', 'src', 'workflow', 'WorkflowOperations.css');

  assert.match(source, /company-minutes-table/u);
  assert.match(source, /<caption>회 의 록<\/caption>/u);
  for (const label of ['작성자', '회의일시', '회의장소', '거래처명', '보고부서', '참조부서', '참석자', '회의명', '첨부파일', '회의내용 및 지시사항']) {
    assert.match(source, new RegExp(label, 'u'));
  }
  assert.match(source, /결정사항 · 후속업무/u);
  assert.match(source, /미입력/u);
  assert.match(css, /\.company-minutes-scroll\s*\{[^}]*overflow:\s*auto/su);
  assert.match(css, /\.company-minutes-table\s*\{[^}]*border-collapse:\s*collapse/su);
  assert.match(css, /\.company-minutes-content\s*\{[^}]*vertical-align:\s*top/su);
});

test('CF80 makes the workspace text two times larger without changing A4 export typography', () => {
  const theme = read('apps', 'web', 'src', 'theme-system.css');
  const shell = read('apps', 'web', 'src', 'layout', 'AppShell.tsx');
  const workflow = read('apps', 'web', 'src', 'workflow', 'WorkflowOperations.css');
  const exporter = read('apps', 'web', 'src', 'documents', 'final-document-export.ts');

  assert.match(theme, /:root\s*\{[^}]*font-size:\s*200%/su);
  assert.match(theme, /:root body \{ font-size: 1rem; \}/u);
  assert.match(theme, /button:not\(\.icon-button\):not\(\.sidebar-resize-handle\)[^}]*min-height:\s*2\.6rem/su);
  assert.match(shell, /ACCESSIBLE_DESKTOP_MIN_WIDTH\s*=\s*1500/u);
  assert.doesNotMatch(workflow, /font-size:\s*[0-9]+px/u);
  assert.match(workflow, /@media \(max-width: 1600px\)[^{]*\{[\s\S]*?\.workflow-editor-grid \{ grid-template-columns: 1fr; \}/u);
  assert.match(exporter, /clonedDocument\.documentElement\.style\.fontSize\s*=\s*'100%'/u);
});
