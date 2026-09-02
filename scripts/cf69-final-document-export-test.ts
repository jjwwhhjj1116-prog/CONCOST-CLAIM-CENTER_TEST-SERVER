import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string): string => readFileSync(path, 'utf8');

test('CF69 proposals and reports export the reviewed preview directly as DOCX PDF and HWP', () => {
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const report = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const exporter = read('apps/web/src/documents/final-document-export.ts');
  const icon = read('apps/web/src/documents/FileFormatIcon.tsx');

  assert.match(proposal, /ref=\{finalPreviewRef\}/u);
  assert.match(proposal, /downloadFinalDocument/u);
  assert.match(proposal, /download\('docx'\)/u);
  assert.match(proposal, /download\('pdf'\)/u);
  assert.match(proposal, /download\('hwp'\)/u);
  assert.match(report, /ref=\{finalReportPreviewRef\}/u);
  assert.match(report, /downloadFinalReport\('docx'\)/u);
  assert.match(report, /downloadFinalReport\('pdf'\)/u);
  assert.match(report, /downloadFinalReport\('hwp'\)/u);
  assert.match(proposal, /activeProposal\?\.status!==['"]DRAFT['"]/u);
  assert.match(icon, /FileFormatIcon/u);
  assert.match(icon, /docx: 'W'/u);
  assert.match(icon, /pdf: 'PDF'/u);
  assert.match(icon, /hwp: '한'/u);

  assert.match(exporter, /querySelectorAll<HTMLElement>\('\[data-export-page\]'\)/u);
  assert.match(exporter, /미리보기에 HTML 코드가 노출되어 내보내기를 중단/u);
  assert.match(exporter, /createDocx\(pages, orientation\)/u);
  assert.match(exporter, /new Document\(/u);
  assert.match(exporter, /new ImageRun\(/u);
  assert.match(exporter, /Packer\.toArrayBuffer/u);
  assert.doesNotMatch(exporter, /docxDocumentXml/u);
  assert.match(exporter, /createPdf\(pages, orientation\)/u);
  assert.match(exporter, /createHwp\(pages/u);
  assert.doesNotMatch(exporter, /exportHwpVerify/u);
  assert.match(exporter, /loadFile\(hwp/u);
  assert.match(exporter, /완성된 HWP 재열기 검증/u);
  assert.match(exporter, /getPageSvg\(index\)/u);
  assert.match(exporter, /oleSignature/u);
  assert.match(exporter, /widthPx: 1_123, heightPx: 794/u);
  assert.match(exporter, /widthPx: 794, heightPx: 1_123/u);
  assert.match(exporter, /PageOrientation\.LANDSCAPE/u);
  assert.match(exporter, /PageOrientation\.PORTRAIT/u);
  assert.match(exporter, /orientation \?\? 'landscape'/u);
  assert.match(exporter, /dimensions\.width, dimensions\.height/u);
  assert.match(exporter, /orientation === 'portrait' \? 'WIDELY' : 'NARROWLY'/u);
  assert.match(exporter, /const paperWidth = Math\.min\(layout\.widthHwp, layout\.heightHwp\)/u);
  assert.match(exporter, /svgOrientationMatches\(svg, orientation\)/u);
  assert.match(exporter, /scale: 1\.25/u);
  assert.match(exporter, /imageTimeout: 15_000/u);
  assert.match(exporter, /removeContainer: true/u);
  assert.match(exporter, /expectedSignature/u);
  assert.match(exporter, /treatAsChar="1"/u);
  assert.doesNotMatch(exporter, /textWrap="BEHIND_TEXT"/u);
  assert.doesNotMatch(exporter, /dataUrl: string/u);
  assert.match(proposal, /onChange=\{\(next,json\)=>\{setChapters[\s\S]*?setDirty\(true\)/u);
  assert.match(proposal, /data-export-document-kind="PROPOSAL"/u);
  assert.match(proposal, /orientation:'portrait'/u);
  assert.match(proposal, /proposal-template-logo/u);
  assert.match(report, /data-export-document-kind="REPORT"/u);
});

test('CF69 reception lists remain searchable scrollable and visibly selected', () => {
  const workflow = read('apps/web/src/workflow/ProposalAwardWorkflow.tsx');
  const css = read('apps/web/src/workflow/ProposalAwardWorkflow.css');
  assert.match(workflow, /reception-list-search/u);
  assert.match(workflow, /reception-status-list__body/u);
  assert.match(workflow, /aria-pressed=\{active\}/u);
  assert.match(workflow, /✓ 선택됨/u);
  assert.match(css, /max-height: 360px; overflow-y: auto/u);
  assert.match(css, /is-ready \.reception-status-list__body > button\.is-active/u);
  assert.match(css, /is-won \.reception-status-list__body > button\.is-active/u);
  assert.match(css, /focus-visible/u);
  assert.match(workflow, /if \(!selectedItem \|\| !searchable\.includes\(needle\)\) setSelectedReceptionId\(''\)/u);
});

test('CF69 approved proposal assets resolve immutable versions', () => {
  const worker = read('apps/cloudflare/src/index.ts');
  const migration = read('apps/cloudflare/migrations/0046_cf69_proposal_asset_versions.sql');
  const docx = read('apps/cloudflare/src/proposal-docx.ts');
  assert.match(migration, /preview_proposal_company_asset_versions/u);
  assert.match(migration, /PRIMARY KEY \(organization_id, asset_key, version\)/u);
  assert.match(worker, /url\.searchParams\.get\('v'\)/u);
  assert.match(worker, /FROM preview_proposal_company_asset_versions/u);
  assert.match(worker, /INSERT INTO preview_proposal_company_asset_versions/u);
  assert.doesNotMatch(docx, /paragraph\(block\.text, 'Normal', '<w:jc w:val="both"\/>'\)/u);
});

test('CF70 development deploy is isolated from the soft-launch Worker and D1', () => {
  const softLaunch = JSON.parse(read('wrangler.jsonc')) as { name: string; d1_databases: Array<{ database_name: string; database_id: string }> };
  const development = JSON.parse(read('wrangler.development.jsonc')) as { name: string; d1_databases: Array<{ database_name: string; database_id: string }>; vars: { GOOGLE_OAUTH_REDIRECT_ORIGIN: string } };
  const packageJson = read('package.json');

  assert.notEqual(development.name, softLaunch.name);
  assert.notEqual(development.d1_databases[0].database_name, softLaunch.d1_databases[0].database_name);
  assert.notEqual(development.d1_databases[0].database_id, softLaunch.d1_databases[0].database_id);
  assert.equal(development.name, 'concost-claim-center-development');
  assert.match(development.vars.GOOGLE_OAUTH_REDIRECT_ORIGIN, /concost-claim-center-development/u);
  assert.match(packageJson, /cf:deploy:development/u);
  assert.match(packageJson, /wrangler deploy --config wrangler\.development\.jsonc/u);
  assert.match(packageJson, /cf:d1:migrate:development/u);
});
