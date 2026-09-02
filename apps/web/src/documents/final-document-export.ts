import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { AlignmentType, Document, ImageRun, Packer, PageOrientation, Paragraph } from 'docx';
import { BLANK_HWPX_BASE64 } from './hwpx-blank-template';

export type FinalDocumentFormat = 'docx' | 'pdf' | 'hwp';
export type FinalDocumentOrientation = 'landscape' | 'portrait';

interface CapturedPage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

const capturedPageCache = new WeakMap<HTMLElement, { key: string; pages: Promise<CapturedPage[]> }>();

export interface FinalDocumentExportResult {
  byteSize: number;
  fileName: string;
  pageCount: number;
  sha256: string;
}

const pageLayout = (orientation: FinalDocumentOrientation) => orientation === 'portrait'
  ? { ratio: 297 / 210, widthHwp: 59_520, heightHwp: 84_180, widthPx: 794, heightPx: 1_123, docxWidth: 11_906, docxHeight: 16_838, imageWidth: 785, imageHeight: 1_110 }
  : { ratio: 210 / 297, widthHwp: 84_180, heightHwp: 59_520, widthPx: 1_123, heightPx: 794, docxWidth: 16_838, docxHeight: 11_906, imageWidth: 1_110, imageHeight: 785 };

const xmlEscape = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const fileSafe = (value: string): string => value
  .replace(/[\\/:*?"<>|]+/gu, '_')
  .replace(/\s+/gu, ' ')
  .trim()
  .slice(0, 150) || '클레임센터_확정본';

const decodeBase64 = (value: string): Uint8Array => {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
};

const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const digestInput = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', digestInput);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
};

const waitForImages = async (root: HTMLElement): Promise<void> => {
  await document.fonts?.ready;
  const images = [...root.querySelectorAll('img')];
  await Promise.all(images.map(async (image) => {
    if (image.complete && image.naturalWidth > 0) return;
    if (image.complete) throw new Error(`이미지를 불러오지 못했습니다: ${image.alt || image.src}`);
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error(`이미지를 불러오지 못했습니다: ${image.alt || image.src}`)), 15_000);
      image.addEventListener('load', () => { window.clearTimeout(timeout); resolve(); }, { once: true });
      image.addEventListener('error', () => { window.clearTimeout(timeout); reject(new Error(`이미지를 불러오지 못했습니다: ${image.alt || image.src}`)); }, { once: true });
    });
  }));
};

const canvasPage = async (source: HTMLCanvasElement, top: number, height: number, orientation: FinalDocumentOrientation): Promise<CapturedPage> => {
  const layout = pageLayout(orientation);
  const a4Canvas = document.createElement('canvas');
  a4Canvas.width = source.width;
  a4Canvas.height = Math.round(source.width * layout.ratio);
  const a4Context = a4Canvas.getContext('2d');
  if (!a4Context) throw new Error('A4 문서 페이지를 만들지 못했습니다.');
  a4Context.fillStyle = '#ffffff';
  a4Context.fillRect(0, 0, a4Canvas.width, a4Canvas.height);
  const scale = Math.min(a4Canvas.width / source.width, a4Canvas.height / height);
  const drawWidth = source.width * scale;
  const drawHeight = height * scale;
  a4Context.drawImage(source, 0, top, source.width, height, (a4Canvas.width - drawWidth) / 2, 0, drawWidth, drawHeight);
  const blob = await new Promise<Blob>((resolve, reject) => {
    a4Canvas.toBlob((value) => value ? resolve(value) : reject(new Error('A4 문서 이미지를 압축하지 못했습니다.')), 'image/jpeg', 0.91);
  });
  const result = { bytes: new Uint8Array(await blob.arrayBuffer()), width: a4Canvas.width, height: a4Canvas.height };
  a4Canvas.width = 1;
  a4Canvas.height = 1;
  return result;
};

const capturePages = async (root: HTMLElement, orientation: FinalDocumentOrientation, onProgress?: (message: string) => void): Promise<CapturedPage[]> => {
  const layout = pageLayout(orientation);
  const elements = [...root.querySelectorAll<HTMLElement>('[data-export-page]')];
  if (!elements.length) throw new Error('내보낼 미리보기 페이지가 없습니다. 화면을 다시 불러온 뒤 시도해 주세요.');
  const visibleText = root.innerText;
  if (/<\/?[a-z][^>]{0,500}>/iu.test(visibleText)) {
    throw new Error('미리보기에 HTML 코드가 노출되어 내보내기를 중단했습니다. 담당자 검수에서 해당 장을 확인해 주세요.');
  }
  await waitForImages(root);
  window.dispatchEvent(new Event('final-document:refit'));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
  for (const element of elements.filter((page) => page.dataset.exportPagePolicy === 'fit')) {
    const viewport = element.querySelector<HTMLElement>('.proposal-final-chapter__viewport');
    const content = element.querySelector<HTMLElement>('.proposal-final-chapter__fit');
    const scale = Number(element.dataset.pageFitScale ?? '1');
    const chapterOverflow = viewport && content
      ? element.dataset.pageFitOverflow === 'true'
        || content.scrollHeight * scale > viewport.clientHeight + 2
        || content.scrollWidth * scale > viewport.clientWidth + 2
      : element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2;
    if (chapterOverflow) {
      const pageNumber = element.dataset.pageNumber ?? '?';
      throw new Error(`제안서 ${pageNumber}페이지 내용이 A4 영역을 넘었습니다. 담당자 검수에서 문단·표·이미지 크기를 조정한 뒤 다시 내보내 주세요.`);
    }
  }
  const result: CapturedPage[] = [];
  for (let index = 0; index < elements.length; index += 1) {
    const isFittedSheet = elements[index].dataset.exportPagePolicy === 'fit';
    if (index === 0 || index === elements.length - 1 || (index + 1) % 3 === 0) onProgress?.(`미리보기 ${index + 1}/${elements.length} 페이지를 고해상도로 변환하고 있습니다.`);
    const captureId = `final-export-page-${Date.now()}-${index}`;
    elements[index].dataset.finalExportCapture = captureId;
    const canvas = await html2canvas(elements[index], {
      backgroundColor: '#ffffff',
      imageTimeout: 15_000,
      logging: false,
      removeContainer: true,
      scale: 1.25,
      useCORS: true,
      windowWidth: 1400,
      onclone: (clonedDocument) => {
        const clonedPage = clonedDocument.querySelector<HTMLElement>(`[data-final-export-capture="${captureId}"]`);
        if (!clonedPage) return;
        clonedPage.style.width = `${layout.widthPx}px`;
        clonedPage.style.maxWidth = 'none';
        if (isFittedSheet) clonedPage.style.height = `${layout.heightPx}px`;
        clonedPage.style.minHeight = `${layout.heightPx}px`;
        if (isFittedSheet) clonedPage.style.overflow = 'hidden';
        clonedPage.style.margin = '0';
        clonedPage.style.boxSizing = 'border-box';
      },
    });
    delete elements[index].dataset.finalExportCapture;
    if (isFittedSheet) {
      // One reviewed proposal sheet is one physical A4 page. Never cut it at an
      // arbitrary pixel boundary: the proposal preview must fit before capture.
      result.push(await canvasPage(canvas, 0, canvas.height, orientation));
    } else {
      // Legacy report pages are allowed to flow until their own editor gains the
      // explicit fitted-sheet contract. Preserve their previous export behaviour.
      const pageHeight = Math.max(1, Math.floor(canvas.width * layout.ratio));
      for (let top = 0; top < canvas.height; top += pageHeight) {
        result.push(await canvasPage(canvas, top, Math.min(pageHeight, canvas.height - top), orientation));
      }
    }
    canvas.width = 1;
    canvas.height = 1;
  }
  return result;
};

const createDocx = async (pages: CapturedPage[], orientation: FinalDocumentOrientation): Promise<Uint8Array> => {
  const layout = pageLayout(orientation);
  // Use docx's standards-compliant OOXML relationships and drawing records. The previous
  // handwritten DrawingML package contained the JPEG files but Word ignored the incomplete
  // drawing records, which produced apparently valid, blank documents.
  const document = new Document({
    creator: '클레임센터 스튜디오',
    description: '화면 미리보기와 동일한 A4 확정본',
    sections: [{
      properties: {
        page: {
          size: { width: layout.docxWidth, height: layout.docxHeight, orientation: orientation === 'portrait' ? PageOrientation.PORTRAIT : PageOrientation.LANDSCAPE },
          margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0, gutter: 0 },
        },
      },
      children: pages.map((page, index) => new Paragraph({
        alignment: AlignmentType.CENTER,
        pageBreakBefore: index > 0,
        spacing: { before: 0, after: 0, line: 1 },
        children: [new ImageRun({
          type: 'jpg',
          data: page.bytes,
          // Keep a narrow safety area for Word's paragraph mark so it cannot overflow
          // onto an extra blank page, while preserving the A4 preview aspect ratio.
          transformation: { width: layout.imageWidth, height: layout.imageHeight },
          altText: {
            title: `확정 문서 페이지 ${index + 1}`,
            description: `미리보기 ${index + 1}페이지`,
            name: `page-${index + 1}.jpg`,
          },
        })],
      })),
    }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(document));
};

const createPdf = (pages: CapturedPage[], orientation: FinalDocumentOrientation): Uint8Array => {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation, compress: true });
  const dimensions = orientation === 'portrait' ? { width: 210, height: 297 } : { width: 297, height: 210 };
  pages.forEach((page, index) => {
    if (index > 0) pdf.addPage('a4', orientation);
    pdf.addImage(page.bytes, 'JPEG', 0, 0, dimensions.width, dimensions.height, `page-${index + 1}`, 'FAST');
  });
  return new Uint8Array(pdf.output('arraybuffer'));
};

const hwpxPicture = (index: number, page: CapturedPage, orientation: FinalDocumentOrientation): string => {
  const layout = pageLayout(orientation);
  const id = 910_000_000 + index;
  const nativeWidth = Math.max(1, Math.round(page.width * 75));
  const nativeHeight = Math.max(1, Math.round(page.height * 75));
  const displayHeight = layout.heightHwp - 1_200;
  const displayWidth = Math.min(layout.widthHwp, Math.round(displayHeight / layout.ratio));
  const scaleX = (displayWidth / nativeWidth).toFixed(6);
  const scaleY = (displayHeight / nativeHeight).toFixed(6);
  // Keep the canonical HWPX picture child order. Hancom-compatible converters can
  // silently preserve the page count while dropping a picture whose hc:img appears
  // before imgRect/imgClip/imgDim or whose native dimensions use screen pixels.
  return `<hp:run charPrIDRef="0"><hp:pic id="${id}" zOrder="${index}" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${id}" reverse="0"><hp:offset x="0" y="0"/><hp:orgSz width="${nativeWidth}" height="${nativeHeight}"/><hp:curSz width="${displayWidth}" height="${displayHeight}"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="${Math.round(displayWidth/2)}" centerY="${Math.round(displayHeight/2)}" rotateimage="1"/><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="${scaleX}" e2="0" e3="0" e4="0" e5="${scaleY}" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo><hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${nativeWidth}" y="0"/><hc:pt2 x="${nativeWidth}" y="${nativeHeight}"/><hc:pt3 x="0" y="${nativeHeight}"/></hp:imgRect><hp:imgClip left="0" right="${nativeWidth}" top="0" bottom="${nativeHeight}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="${nativeWidth}" dimheight="${nativeHeight}"/><hc:img binaryItemIDRef="pageImage${index}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/><hp:sz width="${displayWidth}" widthRelTo="ABSOLUTE" height="${displayHeight}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="CENTER" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment>확정 문서 페이지 ${index}</hp:shapeComment></hp:pic></hp:run>`;
};

const renderedSvgHasInk = async (svg: string): Promise<boolean> => {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const embeddedImages = [...parsed.querySelectorAll('image')].filter((image) => {
    const href = image.getAttribute('href') ?? image.getAttribute('xlink:href') ?? '';
    return href.length > 512;
  });
  if (!embeddedImages.length) return false;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('HWP 페이지 렌더링 시간이 초과되었습니다.')), 20_000);
      image.onload = () => { window.clearTimeout(timeout); resolve(); };
      image.onerror = () => { window.clearTimeout(timeout); reject(new Error('HWP 페이지 렌더링 결과를 읽지 못했습니다.')); };
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 226;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const pixelCount = canvas.width * canvas.height;
    let inkPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 32 && pixels[index] + pixels[index + 1] + pixels[index + 2] < 735) inkPixels += 1;
    }
    const hasInk = inkPixels >= pixelCount * .0015;
    canvas.width = 1;
    canvas.height = 1;
    return hasInk;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const orientedSection = (sectionProperties: string, orientation: FinalDocumentOrientation): string => sectionProperties.replace(/<hp:pagePr\b([^>]*)>/u, (_match, attributes: string) => {
  const layout = pageLayout(orientation);
  let next = attributes
    .replace(/\swidth="[^"]*"/u, ` width="${layout.widthHwp}"`)
    .replace(/\sheight="[^"]*"/u, ` height="${layout.heightHwp}"`);
  const landscapeValue = orientation === 'portrait' ? 'NARROWLY' : 'WIDELY';
  next = /\slandscape="[^"]*"/u.test(next)
    ? next.replace(/\slandscape="[^"]*"/u, ` landscape="${landscapeValue}"`)
    : `${next} landscape="${landscapeValue}"`;
  return `<hp:pagePr${next}>`;
}).replace(/<hp:margin\b([^>]*)\/>/u, (_match, attributes: string) => {
  let next = attributes;
  for (const name of ['header', 'footer', 'gutter', 'left', 'right', 'top', 'bottom']) {
    next = new RegExp(`\\s${name}="[^"]*"`, 'u').test(next)
      ? next.replace(new RegExp(`\\s${name}="[^"]*"`, 'u'), ` ${name}="0"`)
      : `${next} ${name}="0"`;
  }
  return `<hp:margin${next}/>`;
});

const createHwpx = (pages: CapturedPage[], title: string, orientation: FinalDocumentOrientation): Uint8Array => {
  const layout = pageLayout(orientation);
  const unpacked = unzipSync(decodeBase64(BLANK_HWPX_BASE64));
  const content = strFromU8(unpacked['Contents/content.hpf']);
  const section = strFromU8(unpacked['Contents/section0.xml']);
  const sectionOpen = section.match(/^<\?xml[^>]*>\s*<hs:sec[^>]*>/u)?.[0];
  const rawSectionProperties = section.match(/<hp:run charPrIDRef="0"><hp:secPr[\s\S]*?<\/hp:run>/u)?.[0];
  const sectionProperties = rawSectionProperties ? orientedSection(rawSectionProperties, orientation) : undefined;
  if (!sectionOpen || !sectionProperties) throw new Error('HWPX 기본 문서 구조를 읽지 못했습니다.');
  const metadata = content.replace(/<opf:title\/>/u, `<opf:title>${xmlEscape(title)}</opf:title>`).replace('</opf:manifest>', `${pages.map((_, index) => `<opf:item id="pageImage${index + 1}" href="BinData/page-${String(index + 1).padStart(3, '0')}.jpg" media-type="image/jpeg" isEmbeded="1"/>`).join('')}</opf:manifest>`);
  const paragraphs = pages.map((page, index) => `<hp:p id="${920_000_000 + index}" paraPrIDRef="0" styleIDRef="0" pageBreak="${index === 0 ? 0 : 1}" columnBreak="0" merged="0">${index === 0 ? sectionProperties : ''}${hwpxPicture(index + 1, page, orientation)}<hp:run charPrIDRef="0"><hp:t/></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000" baseline="850" spacing="600" horzpos="0" horzsize="${layout.widthHwp}" flags="393216"/></hp:linesegarray></hp:p>`).join('');
  unpacked['Contents/content.hpf'] = strToU8(metadata);
  unpacked['Contents/section0.xml'] = strToU8(`${sectionOpen}${paragraphs}</hs:sec>`);
  pages.forEach((page, index) => { unpacked[`BinData/page-${String(index + 1).padStart(3, '0')}.jpg`] = Uint8Array.from(page.bytes); });
  const archive: Zippable = {};
  Object.entries(unpacked).forEach(([path, bytes]) => { archive[path] = path === 'mimetype' ? [bytes, { level: 0 }] : bytes; });
  return zipSync(archive, { level: 6 });
};

const createHwp = async (pages: CapturedPage[], title: string, orientation: FinalDocumentOrientation, onProgress?: (message: string) => void): Promise<Uint8Array> => {
  onProgress?.('A4 확정본을 HWP 문서로 변환하고 있습니다.');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-12000px;top:0;width:1200px;height:900px;opacity:0;pointer-events:none;';
  document.body.append(host);
  const { createEditor } = await import('@rhwp/editor');
  const configuredStudioUrl = (window as Window & { __CLAIM_CENTER_RHWP_STUDIO_URL__?: string }).__CLAIM_CENTER_RHWP_STUDIO_URL__;
  const editor = await createEditor(host, { renderer: 'canvas2d', requestTimeoutMs: 180_000, ...(configuredStudioUrl ? { studioUrl: configuredStudioUrl } : {}) });
  try {
    const hwpx = createHwpx(pages, title, orientation);
    const loaded = await editor.loadFile(hwpx, `${fileSafe(title)}.hwpx`, { suppressDialogs: true, skipUnsavedGuard: true });
    if (loaded.pageCount !== pages.length) throw new Error(`HWP 변환 페이지 수가 미리보기와 다릅니다. (${loaded.pageCount}/${pages.length})`);
    const hwp = await editor.exportHwp();
    const oleSignature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    if (hwp.byteLength <= 512 || oleSignature.some((value, index) => hwp[index] !== value)) throw new Error('완성된 HWP 파일 형식 검증에 실패했습니다.');
    onProgress?.('완성된 HWP 파일을 다시 열어 백지·페이지 누락을 검사하고 있습니다.');
    const reopened = await editor.loadFile(hwp, `${fileSafe(title)}.hwp`, { suppressDialogs: true, skipUnsavedGuard: true });
    if (reopened.pageCount !== pages.length) throw new Error(`완성된 HWP 재열기 검증에서 페이지가 누락되었습니다. (${reopened.pageCount}/${pages.length})`);
    onProgress?.(`완성된 HWP ${pages.length}페이지의 본문 이미지를 검사하고 있습니다.`);
    for (let index = 0; index < pages.length; index += 1) {
      const svg = await editor.getPageSvg(index);
      if (svg.length < 1_024 || !await renderedSvgHasInk(svg)) throw new Error(`HWP ${index + 1}페이지가 백지로 변환되어 다운로드를 중단했습니다.`);
    }
    return hwp;
  } finally {
    editor.destroy();
    host.remove();
  }
};

export async function downloadFinalDocument(options: {
  root: HTMLElement;
  format: FinalDocumentFormat;
  fileName: string;
  orientation?: FinalDocumentOrientation;
  onProgress?: (message: string) => void;
}): Promise<FinalDocumentExportResult> {
  const orientation = options.orientation ?? 'landscape';
  const revision = options.root.querySelector<HTMLElement>('[data-export-document-revision]')?.dataset.exportDocumentRevision?.trim() ?? '';
  const imageSignature = [...options.root.querySelectorAll('img')].map((image) => `${image.currentSrc || image.src}:${image.naturalWidth}x${image.naturalHeight}`).join('|');
  const cacheKey = `${orientation}:${revision}:${options.root.innerHTML.length}:${imageSignature}`;
  const cached = revision ? capturedPageCache.get(options.root) : undefined;
  let pagePromise: Promise<CapturedPage[]>;
  if (cached?.key === cacheKey) {
    options.onProgress?.('검수 완료된 A4 페이지를 다시 캡처하지 않고 재사용합니다.');
    pagePromise = cached.pages;
  } else {
    pagePromise = capturePages(options.root, orientation, options.onProgress);
    if (revision) capturedPageCache.set(options.root, { key: cacheKey, pages: pagePromise });
  }
  let pages: CapturedPage[];
  try { pages = await pagePromise; }
  catch (error) { if (revision && capturedPageCache.get(options.root)?.pages === pagePromise) capturedPageCache.delete(options.root); throw error; }
  const baseName = fileSafe(options.fileName.replace(/\.(?:docx|pdf|hwp)$/iu, ''));
  options.onProgress?.(`${pages.length}개 A4 페이지를 ${options.format.toUpperCase()}로 묶고 있습니다.`);
  const bytes = options.format === 'docx'
    ? await createDocx(pages, orientation)
    : options.format === 'pdf'
      ? createPdf(pages, orientation)
      : await createHwp(pages, baseName, orientation, options.onProgress);
  const expectedSignature = options.format === 'docx'
    ? [0x50, 0x4b, 0x03, 0x04]
    : options.format === 'pdf'
      ? [0x25, 0x50, 0x44, 0x46, 0x2d]
      : [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (bytes.byteLength <= 512 || expectedSignature.some((value, index) => bytes[index] !== value)) {
    throw new Error(`${options.format.toUpperCase()} 확정본의 파일 형식 검증에 실패했습니다. 다운로드를 중단했습니다.`);
  }
  const extension = options.format;
  const fileName = `${baseName}.${extension}`;
  const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await sha256(bytes);
  downloadBlob(new Blob([payload], { type: options.format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : options.format === 'pdf' ? 'application/pdf' : 'application/x-hwp' }), fileName);
  return { byteSize: bytes.byteLength, fileName, pageCount: pages.length, sha256: digest };
}
