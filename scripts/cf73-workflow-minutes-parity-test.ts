import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';

const rootFile = (...parts: string[]): string => join(process.cwd(), ...parts);

test('CF73 keeps existing workflow data while adding the site-survey output ledger', async () => {
  const SQL = await initSqlJs();
  const sql = new SQL.Database();
  sql.run('PRAGMA foreign_keys = ON');
  sql.exec(`
    CREATE TABLE preview_users (id TEXT PRIMARY KEY, is_active INTEGER NOT NULL);
    CREATE TABLE preview_cases (id TEXT PRIMARY KEY);
    CREATE TABLE preview_site_surveys (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      survey_date TEXT NOT NULL,
      scope_text TEXT NOT NULL
    );
  `);
  sql.run('INSERT INTO preview_users VALUES (?,1)', ['user-1']);
  sql.run('INSERT INTO preview_cases VALUES (?)', ['case-1']);
  sql.run('INSERT INTO preview_site_surveys VALUES (?,?,?,?,?)', ['survey-1', 'case-1', 'concost', '2030-08-14', '기존 현장조사 범위']);

  const migration = readFileSync(rootFile('apps', 'cloudflare', 'migrations', '0048_cf73_workflow_minutes_parity.sql'), 'utf8');
  sql.exec(migration);
  sql.exec(migration);
  assert.equal(sql.exec("SELECT scope_text FROM preview_site_surveys WHERE id='survey-1'")[0].values[0][0], '기존 현장조사 범위');

  sql.run(
    'INSERT INTO preview_site_survey_outputs VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ['survey-1', 'case-1', 'concost', '균열 확인', '', '[]', 'DRAFTED', 1, 'user-1', '2030-08-14T00:00:00.000Z', '2030-08-14T00:00:00.000Z']
  );
  sql.run(
    'UPDATE preview_site_survey_outputs SET summary_text=?,timeline_json=?,version=2,updated_at=? WHERE survey_id=?',
    ['현장조사 자동 정리', '[{"order":1,"title":"균열","detail":"동측 균열 확인"}]', '2030-08-14T00:00:00.001Z', 'survey-1']
  );
  assert.deepEqual(sql.exec('SELECT source_notes,summary_text,version FROM preview_site_survey_outputs')[0].values[0], ['균열 확인', '현장조사 자동 정리', 2]);
  assert.throws(() => sql.run('DELETE FROM preview_site_survey_outputs WHERE survey_id=?', ['survey-1']), /cannot be deleted/u);
  sql.close();
});

test('CF73 exposes independent import, automatic writing, persistent save, and right-side review for both workflows', () => {
  const source = readFileSync(rootFile('apps', 'web', 'src', 'workflow', 'WorkflowOperations.tsx'), 'utf8');
  const worker = readFileSync(rootFile('apps', 'cloudflare', 'src', 'index.ts'), 'utf8');
  const css = readFileSync(rootFile('apps', 'web', 'src', 'workflow', 'WorkflowOperations.css'), 'utf8');

  assert.match(source, /1\. 파일 가져오기/u);
  assert.match(source, /2\. 자동작성·정리/u);
  assert.match(source, /3\. 회의 원문 저장/u);
  assert.match(source, /4\. 저장본 자동작성·정리/u);
  assert.match(source, /3\. 조사 원문 저장/u);
  assert.match(source, /현장조사 최종본 · 관찰사항 · 후속확인/u);
  assert.match(source, /파일 자동작성 결과 · 저장 전/u);
  assert.match(source, /archiveWorkflowResult/u);
  assert.match(source, /MEETING_MINUTES/u);
  assert.match(source, /Google Drive 자동 저장 완료/u);
  assert.match(source, /임시 보관 완료/u);
  assert.ok(source.indexOf('/workflow/kickoff`,') < source.indexOf('await persistSharedSchedule({ startDate: meetingDate'));
  assert.ok(source.indexOf('/workflow/site-survey`,') < source.indexOf('await persistSharedSchedule({ startDate: survey.surveyDate'));
  assert.match(worker, /site-survey-summary/u);
  assert.match(worker, /site-survey-confirm/u);
  assert.match(worker, /LOCAL_STRUCTURED_FALLBACK/u);
  assert.match(css, /workflow-autodraft-button/u);
  assert.match(css, /workflow-survey-ledger-card/u);
  assert.match(css, /workflow-drive-state/u);
  assert.match(css, /align-items:\s*stretch/u);
});
