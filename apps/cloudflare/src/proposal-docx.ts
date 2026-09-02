import { normalizeMixedDocumentBlocks } from './document-content-normalizer';

export interface ProposalExportChapter {
  number: number;
  title: string;
  body: string;
}

export interface ProposalExportAsset {
  assetKey: string;
  chapterNumber: number;
  title: string;
  altText: string;
  mimeType: 'image/jpeg';
  fileName: string;
  width: number;
  height: number;
  data: Uint8Array;
  placement?: 'AUTO' | 'INLINE';
}

export interface ProposalExportDocument {
  proposalId: string;
  versionId: string;
  versionNumber: number;
  projectTitle: string;
  clientName: string;
  subtitle: string;
  submissionDate: string;
  caseNumber: string;
  claimType: string;
  preparedBy: string;
  contentSha256: string;
  chapters: ProposalExportChapter[];
  assets?: ProposalExportAsset[];
}

const encoder = new TextEncoder();

const xml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const u16 = (value: number): Uint8Array => new Uint8Array([value & 255, (value >>> 8) & 255]);
const u32 = (value: number): Uint8Array => new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);

const concat = (parts: Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
};

function zipStore(files: Array<{ name: string; content: string | Uint8Array }>): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const crc = crc32(data);
    const header = concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name]);
    local.push(header, data);
    central.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += header.length + data.length;
  }
  const directory = concat(central);
  return concat([...local, directory, concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(directory.length), u32(offset), u16(0)])]);
}

const textRun = (value: string, properties = ''): string => `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(value)}</w:t></w:r>`;

const paragraph = (value: string, style = 'Normal', extraProperties = '', runProperties = ''): string =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extraProperties}</w:pPr>${textRun(value, runProperties)}</w:p>`;

function markdownTable(header: string[], rows: string[][]): string {
  const columnCount = Math.max(1, header.length, ...rows.map((row) => row.length));
  const columns = Array.from({ length: columnCount });
  const cellWidth = Math.max(900, Math.floor(9300 / columnCount));
  const row = (cells: string[], heading: boolean): string => `<w:tr>${columns.map((_column, index) => `<w:tc><w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/>${heading ? '<w:shd w:fill="EAF2FF"/>' : ''}<w:vAlign w:val="center"/></w:tcPr>${paragraph(cells[index] ?? '', 'Normal', '<w:spacing w:after="40"/>', heading ? '<w:b/><w:color w:val="17326D"/><w:sz w:val="17"/>' : '<w:sz w:val="16"/>')}</w:tc>`).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="9300" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="6" w:color="B8C8DA"/><w:left w:val="single" w:sz="6" w:color="B8C8DA"/><w:bottom w:val="single" w:sz="6" w:color="B8C8DA"/><w:right w:val="single" w:sz="6" w:color="B8C8DA"/><w:insideH w:val="single" w:sz="4" w:color="D6E0EA"/><w:insideV w:val="single" w:sz="4" w:color="D6E0EA"/></w:tblBorders><w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>${header.length ? row(header, true) : ''}${rows.map((cells) => row(cells, false)).join('')}</w:tbl>${paragraph('', 'Normal', '<w:spacing w:after="100"/>')}`;
}

function markdownParagraphs(body: string, imageXmlByKey: ReadonlyMap<string,string> = new Map()): string {
  const output: string[] = [];
  for (const block of normalizeMixedDocumentBlocks(body)) {
    if (block.kind === 'asset') {
      const image = imageXmlByKey.get(block.key);
      if (image) output.push(image);
      continue;
    }
    if (block.kind === 'table') {
      output.push(markdownTable(block.header, block.rows));
      continue;
    }
    if (block.kind === 'heading') {
      output.push(paragraph(block.text, `Heading${block.level}`));
      continue;
    }
    if (block.kind === 'list') {
      output.push(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${textRun(block.text)}</w:p>`);
      continue;
    }
    output.push(paragraph(block.text, 'Normal'));
  }
  return output.join('');
}

const proposalAssetAnchor: Readonly<Record<string,RegExp>> = {
  CH04_EXPERT_PROFILE:/대표이사|전문가 현황|현동명/u,
  CH06_ORG_CHART:/조직 체계|조직도|조직 구성/u,
  CH06_BUSINESS_AREAS:/업무 영역/u,
  CH10_DEGREE:/학위/u,
  CH10_APPRAISER:/감정사|자격증/u,
  CH10_PUBLICATIONS:/저서|논문/u
};

function proposalBodyWithAssetMarkers(body:string, assets:readonly ProposalExportAsset[]):string {
  const lines=body.replaceAll('\r\n','\n').split('\n');
  const pending=[...assets];
  const output:string[]=[];
  for(const line of lines){
    const explicit=pending.find((asset)=>line.includes(`/assets/${asset.assetKey}`)||line.includes(`[PROPOSAL_ASSET:${asset.assetKey}]`));
    if(explicit){
      output.push(`[PROPOSAL_ASSET:${explicit.assetKey}]`);
      pending.splice(pending.indexOf(explicit),1);
      continue;
    }
    output.push(line);
    for(let index=pending.length-1;index>=0;index-=1){
      const asset=pending[index];
      if(asset.placement==='INLINE')continue;
      const anchor=proposalAssetAnchor[asset.assetKey];
      if(anchor?.test(line)){
        output.push('',`[PROPOSAL_ASSET:${asset.assetKey}]`,'');
        pending.splice(index,1);
      }
    }
  }
  for(const asset of pending){if(asset.placement!=='INLINE')output.push('',`[PROPOSAL_ASSET:${asset.assetKey}]`,'');}
  return output.join('\n');
}

function proposalImageDrawing(asset: ProposalExportAsset, relationshipId: string, drawingId: number): string {
  const maxWidth = 5_850_000;
  const maxHeight = 7_300_000;
  const scale = Math.min(maxWidth / asset.width, maxHeight / asset.height);
  const width = Math.max(1, Math.round(asset.width * scale));
  const height = Math.max(1, Math.round(asset.height * scale));
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="180" w:after="80"/></w:pPr><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${drawingId}" name="${xml(asset.title)}" descr="${xml(asset.altText)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${drawingId}" name="${xml(asset.fileName)}" descr="${xml(asset.altText)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>${paragraph(asset.title, 'Subtitle', '<w:spacing w:after="180"/>', '<w:b/><w:color w:val="17326D"/><w:sz w:val="18"/>')}`;
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="맑은 고딕"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="140" w:line="320" w:lineRule="auto"/><w:widowControl/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="맑은 고딕"/><w:sz w:val="21"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="2200" w:after="260"/><w:keepNext/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="맑은 고딕"/><w:b/><w:color w:val="17326D"/><w:sz w:val="40"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:after="180"/></w:pPr><w:rPr><w:color w:val="4A6386"/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:pageBreakBefore/><w:spacing w:before="240" w:after="180"/><w:outlineLvl w:val="0"/><w:pBdr><w:bottom w:val="single" w:sz="16" w:space="8" w:color="31A6D8"/></w:pBdr></w:pPr><w:rPr><w:b/><w:color w:val="17326D"/><w:sz w:val="31"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="E36B2C"/><w:sz w:val="25"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="100"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="2C6A8A"/><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="80"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="8640"/></w:tabs><w:spacing w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="17326D"/><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="TOCTitle"><w:name w:val="TOC Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:keepNext/><w:spacing w:before="300" w:after="360"/></w:pPr><w:rPr><w:b/><w:color w:val="17326D"/><w:sz w:val="34"/></w:rPr></w:style>
</w:styles>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="맑은 고딕"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

export function generateProposalMarkdown(input: ProposalExportDocument): string {
  const heading = `# ${input.projectTitle}\n\n${input.subtitle}\n\n- 클라이언트: ${input.clientName}\n- 제출일: ${input.submissionDate}\n- 제안사: 주식회사 컨코스트 · 클레임센터\n- 프로젝트: ${input.caseNumber} · ${input.claimType}\n\n---\n\n## 목차\n\n${input.chapters.map((chapter) => `${chapter.number}. ${chapter.title}`).join('\n')}\n`;
  const body = input.chapters.map((chapter) => `\n---\n\n## ${chapter.number}. ${chapter.title}\n\n${chapter.body.trim()}\n`).join('');
  return `${heading}${body}\n---\n\n문서 무결성: ${input.contentSha256}\n제안서 ID: ${input.proposalId} · 버전 ID: ${input.versionId}\n`;
}

const proposalPdfHex = (value: string): string => Array.from(value)
  .map((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0xffff) return codePoint.toString(16).padStart(4, '0');
    const adjusted = codePoint - 0x10000;
    const high = 0xd800 + (adjusted >> 10);
    const low = 0xdc00 + (adjusted & 0x3ff);
    return `${high.toString(16).padStart(4, '0')}${low.toString(16).padStart(4, '0')}`;
  })
  .join('')
  .toUpperCase();

type ProposalPdfBlock = { kind:'text'; lines:string[] } | { kind:'image'; asset:ProposalExportAsset };

const wrapProposalPdfLines = (lines: readonly string[]): string[] => lines.flatMap((line) => line.length > 46
  ? Array.from({ length: Math.ceil(line.length / 46) }, (_, index) => line.slice(index * 46, (index + 1) * 46))
  : [line]);

function proposalPdfBlocks(input: ProposalExportDocument): ProposalPdfBlock[] {
  const assets=(input.assets??[]).filter((asset)=>asset.mimeType==='image/jpeg'&&asset.data.byteLength>0);
  const blocks:ProposalPdfBlock[]=[];
  const pushText=(lines:readonly string[])=>{
    const wrapped=wrapProposalPdfLines(lines);
    for(let index=0;index<wrapped.length;index+=28)blocks.push({kind:'text',lines:wrapped.slice(index,index+28)});
  };
  pushText([
    'CONCOST CLAIM CENTER · APPROVED PROPOSAL',input.projectTitle,input.subtitle,
    `제출처 ${input.clientName} · 제출일 ${input.submissionDate}`,
    '주식회사 컨코스트 / 하파트 공사비 연구소',
    '(06616) 서울시 송파구 법원로4길 18, 5C. TOWER 5F',
    `프로젝트 ${input.caseNumber} · ${input.claimType} · v${input.versionNumber}`,'','목 차',
    ...input.chapters.map((chapter)=>`${chapter.number}. ${chapter.title}`)
  ]);
  for(const chapter of input.chapters){
    const chapterAssets=assets.filter((asset)=>asset.chapterNumber===chapter.number);
    let textLines=[`${chapter.number}. ${chapter.title}`];
    for(const block of normalizeMixedDocumentBlocks(proposalBodyWithAssetMarkers(chapter.body,chapterAssets))){
      if(block.kind!=='asset'){
        if(block.kind==='table'){
          if(block.header.length)textLines.push(block.header.join(' | '));
          textLines.push(...block.rows.map((row)=>row.join(' | ')));
        }else textLines.push(block.text);
        continue;
      }
      if(textLines.some((value)=>value.trim()))pushText(textLines);
      textLines=[];
      const asset=chapterAssets.find((item)=>item.assetKey===block.key);
      if(asset)blocks.push({kind:'image',asset});
    }
    if(textLines.some((value)=>value.trim()))pushText(textLines);
  }
  pushText([`문서 무결성 ${input.contentSha256}`,`제안서 ${input.proposalId} · 버전 ${input.versionNumber}`]);
  return blocks;
}

export function generateProposalPdf(input: ProposalExportDocument): Uint8Array {
  const blocks=proposalPdfBlocks(input);
  const objects = new Map<number, Uint8Array>();
  let nextObjectId=5;
  const pages=blocks.map((block)=>{
    const pageId=nextObjectId;
    nextObjectId+=block.kind==='text'?2:3;
    return block.kind==='text'?{...block,pageId,contentId:pageId+1}:{...block,pageId,contentId:pageId+1,imageId:pageId+2};
  });
  const pageIds=pages.map((page)=>page.pageId);
  const objectText = (id: number, value: string): void => { objects.set(id, encoder.encode(value)); };
  objectText(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objectText(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  objectText(3, '<< /Type /Font /Subtype /Type0 /BaseFont /HYSMyeongJo-Medium /Encoding /UniKS-UCS2-H /DescendantFonts [4 0 R] >>');
  objectText(4, '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYSMyeongJo-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >> >>');
  for(const page of pages){
    const {pageId,contentId}=page;
    if(page.kind==='text'){
      const commands=['BT','/F1 11 Tf','45 794 Td','17 TL',...page.lines.flatMap((line,lineIndex)=>[`<${proposalPdfHex(line)}> Tj`,lineIndex===page.lines.length-1?'':'T*']).filter(Boolean),'ET'].join('\n');
      objectText(pageId,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
      objectText(contentId,`<< /Length ${encoder.encode(commands).length} >>\nstream\n${commands}\nendstream`);
      continue;
    }
    const {asset,imageId}=page;
    const maxWidth=505; const maxHeight=752; const scale=Math.min(maxWidth/asset.width,maxHeight/asset.height);
    const width=Math.max(1,asset.width*scale); const height=Math.max(1,asset.height*scale); const x=(595-width)/2; const y=(842-height)/2;
    const commands=`q\n${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im1 Do\nQ`;
    objectText(pageId,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objectText(contentId,`<< /Length ${encoder.encode(commands).length} >>\nstream\n${commands}\nendstream`);
    objects.set(imageId,concat([encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${asset.width} /Height ${asset.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${asset.data.byteLength} >>\nstream\n`),asset.data,encoder.encode('\nendstream')]));
  }
  const chunks:Uint8Array[]=[encoder.encode('%PDF-1.7\n%CONCOST-PROPOSAL\n')];
  let outputLength=chunks[0].byteLength;
  const offsets: number[] = [0];
  for (let id = 1; id < nextObjectId; id += 1) {
    offsets[id] = outputLength;
    const object=objects.get(id) ?? encoder.encode('<<>>');
    const prefix=encoder.encode(`${id} 0 obj\n`); const suffix=encoder.encode('\nendobj\n');
    chunks.push(prefix,object,suffix); outputLength+=prefix.byteLength+object.byteLength+suffix.byteLength;
  }
  let trailer=`xref\n0 ${nextObjectId}\n0000000000 65535 f \n`;
  for(let id=1;id<nextObjectId;id+=1)trailer+=`${String(offsets[id]).padStart(10,'0')} 00000 n \n`;
  trailer+=`trailer\n<< /Size ${nextObjectId} /Root 1 0 R >>\nstartxref\n${outputLength}\n%%EOF`;
  chunks.push(encoder.encode(trailer));
  return concat(chunks);
}

export function generateProposalDocx(input: ProposalExportDocument): Uint8Array {
  const assets=(input.assets??[]).filter((asset)=>asset.mimeType==='image/jpeg'&&asset.data.byteLength>0);
  const imageRelationships=assets.map((asset,index)=>({asset,index,relationshipId:`rIdImage${index+1}`,target:`media/company-${String(index+1).padStart(2,'0')}.jpg`}));
  const cover = [
    paragraph('CONCOST CLAIM CENTER', 'Subtitle', '', '<w:b/><w:color w:val="E36B2C"/>'),
    paragraph(input.projectTitle, 'Title'),
    paragraph(input.subtitle, 'Subtitle'),
    paragraph(input.clientName, 'Subtitle', '<w:spacing w:before="240" w:after="120"/>', '<w:b/>'),
    paragraph(input.submissionDate, 'Subtitle'),
    paragraph('주식회사 컨코스트 / 하파트 공사비 연구소', 'Subtitle', '<w:spacing w:before="1100" w:after="0"/>', '<w:b/><w:color w:val="17326D"/>'),
    paragraph('(06616) 서울시 송파구 법원로4길 18, 5C. TOWER 5F · Tel. 02) 2203-1463, 1467 · Fax. 02) 2203-1464, 1468', 'Subtitle'),
    paragraph('www.con-cost.com · E-mail. ceo@con-cost.com', 'Subtitle'),
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
  ].join('');
  const toc = [
    paragraph('목 차', 'TOCTitle'),
    ...input.chapters.map((chapter) => paragraph(`${chapter.number}. ${chapter.title}`, 'TOC1')),
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
  ].join('');
  const chapters = input.chapters.map((chapter) => {
    const chapterImages=imageRelationships.filter((item)=>item.asset.chapterNumber===chapter.number);
    const imageXmlByKey=new Map(chapterImages.map((item)=>[item.asset.assetKey,proposalImageDrawing(item.asset,item.relationshipId,item.index+1)]));
    const markedBody=proposalBodyWithAssetMarkers(chapter.body,chapterImages.map((item)=>item.asset));
    return `${paragraph(`${chapter.number}. ${chapter.title}`, 'Heading1')}${markdownParagraphs(markedBody,imageXmlByKey)}`;
  }).join('');
  const metadata = paragraph(`문서 무결성 SHA-256 ${input.contentSha256} · 제안서 ${input.proposalId} · 버전 ${input.versionNumber}`, 'Normal', '<w:spacing w:before="360"/><w:jc w:val="center"/>', '<w:i/><w:color w:val="64748B"/><w:sz w:val="16"/>');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${cover}${toc}${chapters}${metadata}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="425" w:footer="425"/><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const documentRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${imageRelationships.map((item)=>`<Relationship Id="${item.relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${item.target}"/>`).join('')}</Relationships>`;
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/><w:defaultTabStop w:val="720"/></w:settings>`;
  const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="4" w:color="31A6D8"/></w:pBdr></w:pPr>${textRun(`CONCOST CLAIM CENTER · ${input.caseNumber}`, '<w:b/><w:color w:val="17326D"/><w:sz w:val="16"/>')}</w:p></w:hdr>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> PAGE </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>${xml(input.projectTitle)}</dc:title><dc:subject>CONCOST PROPOSAL</dc:subject><dc:creator>${xml(input.preparedBy)}</dc:creator><cp:lastModifiedBy>${xml(input.preparedBy)}</cp:lastModifiedBy><cp:revision>${input.versionNumber}</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${new Date().toISOString()}</dcterms:created><cp:keywords>ProposalId:${xml(input.proposalId)};VersionId:${xml(input.versionId)};SHA256:${xml(input.contentSha256)}</cp:keywords></cp:coreProperties>`;
  return zipStore([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRelationships },
    { name: 'word/document.xml', content: documentXml },
    { name: 'word/_rels/document.xml.rels', content: documentRelationships },
    { name: 'word/styles.xml', content: stylesXml },
    { name: 'word/numbering.xml', content: numberingXml },
    { name: 'word/settings.xml', content: settings },
    { name: 'word/header1.xml', content: header },
    { name: 'word/footer1.xml', content: footer },
    { name: 'docProps/core.xml', content: core },
    ...imageRelationships.map((item)=>({name:`word/${item.target}`,content:item.asset.data}))
  ]);
}
