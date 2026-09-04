import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { strFromU8, unzipSync } from '../apps/web/node_modules/fflate';
import { createHwpx } from '../apps/web/src/documents/final-document-export';

const read = (path: string): string => readFileSync(path, 'utf8');

test('CF95 keeps every reviewed proposal sheet inside one visible A4 page', () => {
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const theme = read('apps/web/src/theme-system.css');
  const editor = read('apps/web/src/documents/StructuredDocumentEditor.tsx');
  const editorCss = read('apps/web/src/documents/StructuredDocumentEditor.css');

  assert.match(proposal, /ProposalFinalChapterPages/u);
  assert.match(proposal, /proposalPageFragments/u);
  assert.match(proposal, /proposal-final-chapter__viewport/u);
  assert.match(proposal, /proposal-final-chapter__fit/u);
  assert.match(proposal, /data-chapter-page-index=\{index\+1\}/u);
  assert.match(proposal, /data-export-page-policy="fit"/u);
  assert.match(proposal, /담당자 검수 크기 100%/u);
  assert.doesNotMatch(proposal, /PROPOSAL_SINGLE_PAGE_MIN_SCALE/u);
  assert.doesNotMatch(proposal, /transform:`scale/u);
  assert.match(proposal, /splitTable/u);
  assert.match(proposal, /표 행·문단 자동 나눔/u);
  assert.match(proposal, /proposal-content-keep-together/u);
  assert.match(proposal, /PROPOSAL_PAGE_BODY_HEIGHT=913/u);
  assert.match(proposal, /child\.hasAttribute\('data-document-page-break'\)\)\{commit\(\);continue;\}/u);
  assert.match(proposal, /previewContent=\{<ProposalFinalChapterPages/u);
  assert.match(proposal, /<ProposalFinalChapterPages item=\{chapter\}/u);
  assert.match(proposal, /data-export-document-revision/u);
  assert.match(theme, /height:1123px;min-height:1123px[^}]*overflow:hidden/u);
  assert.match(theme, /proposal-final-chapter\{[^}]*font-family:'휴먼명조','Noto Serif KR',Batang,serif/u);
  assert.match(theme, /proposal-final-chapter__viewport[^}]*overflow:hidden/u);
  assert.match(theme, /proposal-final-chapter__fit[^}]*transform:scale\(1\)/u);
  assert.match(editor, /DocumentPageBreak/u);
  assert.doesNotMatch(editor, /runLength >= 3[^\n]*documentPageBreak/u);
  assert.match(editor, /현재 위치에서 다음 A4 쪽 시작/u);
  assert.match(editor, /머리글 포함 실제 페이지는 출력 미리보기에서 확인/u);
  assert.match(editorCss, /structured-editor__page-break[^}]*border-top:2px solid #0ea5e9/u);
  assert.doesNotMatch(editorCss, /repeating-linear-gradient\(to bottom[^;]*1118px/u);
});

test('CF95 captures exactly one physical page for each fitted proposal sheet without clipping legacy report pages', () => {
  const exporter = read('apps/web/src/documents/final-document-export.ts');
  assert.match(exporter, /dataset\.exportPagePolicy === 'fit'/u);
  assert.match(exporter, /One reviewed proposal sheet is one physical A4 page/u);
  assert.match(exporter, /result\.push\(await canvasPage\(canvas, 0, canvas\.height, orientation\)\)/u);
  assert.match(exporter, /for \(let top = 0; top < canvas\.height/u);
  assert.match(exporter, /capturedPageCache/u);
  assert.match(exporter, /data-export-document-revision/u);
  assert.match(exporter, /다시 캡처하지 않고 재사용/u);
  assert.match(exporter, /image\.complete\) throw new Error/u);
  assert.match(exporter, /문서 \$\{pageNumber\}페이지 내용이 A4 영역을 넘었습니다/u);
});

test('CF95 emits Hancom-compatible HWPX pictures and rejects blank reopened HWP pages', () => {
  const exporter = read('apps/web/src/documents/final-document-export.ts');
  const pictureStart = exporter.indexOf('return `<hp:run charPrIDRef="0"><hp:pic');
  const pictureEnd = exporter.indexOf('</hp:pic></hp:run>`;', pictureStart);
  assert.ok(pictureStart >= 0 && pictureEnd > pictureStart, 'HWPX picture template must exist');
  const picture = exporter.slice(pictureStart, pictureEnd);
  const rect = picture.indexOf('<hp:imgRect>');
  const clip = picture.indexOf('<hp:imgClip');
  const dimensions = picture.indexOf('<hp:imgDim');
  const image = picture.indexOf('<hc:img');
  assert.ok(rect >= 0 && rect < clip && clip < dimensions && dimensions < image, 'HWPX picture children must use canonical order');
  assert.match(exporter, /page\.width \* 75/u);
  assert.match(exporter, /transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/u);
  assert.match(exporter, /scaMatrix e1="\$\{scaleX\}" e2="0" e3="0" e4="0" e5="\$\{scaleY\}" e6="0"/u);
  assert.match(exporter, /return `<hp:margin\$\{next\}\/>`;/u);
  assert.match(exporter, /getPageSvg\(index\)/u);
  assert.match(exporter, /renderedSvgHasInk\(svg\)/u);
  assert.match(exporter, /HWP \$\{index \+ 1\}페이지가 백지로 변환/u);
  assert.doesNotMatch(exporter, /exportHwpVerify/u);
});

test('CF95 writes true portrait and landscape HWPX page shapes', () => {
  const page = { bytes:new Uint8Array([0xff,0xd8,0xff,0xd9]), width:794, height:1123 };
  const section = (orientation:'portrait'|'landscape') => {
    const files=unzipSync(createHwpx([page],`CF95 ${orientation}`,orientation));
    return strFromU8(files['Contents/section0.xml']);
  };
  const portrait=section('portrait');
  const landscape=section('landscape');
  assert.match(portrait,/<hp:pagePr[^>]*landscape="WIDELY"[^>]*width="59520"[^>]*height="84180"/u);
  assert.match(landscape,/<hp:pagePr[^>]*landscape="NARROWLY"[^>]*width="59520"[^>]*height="84180"/u);
  assert.match(portrait,/<hp:curSz width="\d+" height="82980"/u);
  assert.match(landscape,/<hp:curSz width="\d+" height="58320"/u);
});
