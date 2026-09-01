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

test('CF81 restores normal workspace type and enlarges authoring fields only', () => {
  const theme = read('apps', 'web', 'src', 'theme-system.css');
  const shell = read('apps', 'web', 'src', 'layout', 'AppShell.tsx');
  const workflow = read('apps', 'web', 'src', 'workflow', 'WorkflowOperations.css');

  assert.doesNotMatch(theme, /font-size:\s*200%/u);
  assert.match(theme, /:root body \{ font-size: calc\(16px \* var\(--user-font-scale\)\); \}/u);
  assert.match(theme, /\.sidebar \{ width: 352px; flex-basis: 352px; min-width: 300px; max-width: 480px/u);
  assert.match(shell, /window\.innerWidth <= 1024/u);
  assert.doesNotMatch(workflow, /font-size:\s*[0-9]+px/u);
  assert.match(workflow, /\.workflow-form-grid label\s*\{[^}]*font-size:\s*1\.25rem/su);
  assert.match(workflow, /\.workflow-form-grid textarea\s*\{[\s\S]*?font-size:\s*1\.5rem/su);
  assert.match(workflow, /\.workflow-record-save-button,[\s\S]*?font-size:\s*1\.5rem\s*!important/su);
  assert.match(workflow, /@media \(max-width: 980px\)[^{]*\{[\s\S]*?\.workflow-form-grid \{ grid-template-columns: 1fr; \}/u);
  assert.match(workflow, /@media \(max-width: 1100px\)[^{]*\{[\s\S]*?\.workflow-editor-grid \{ grid-template-columns: 1fr; \}/u);
});
