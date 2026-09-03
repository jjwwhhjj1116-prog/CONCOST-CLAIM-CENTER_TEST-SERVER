export type IntakeSourceKind = 'AUDIO' | 'TEXT' | 'SPREADSHEET';

export interface IntakeSource {
  kind: IntakeSourceKind;
  mimeType: string;
  extractedText: string | null;
}

export class IntakeSourceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'IntakeSourceError';
  }
}

const MAX_EXTRACTED_CHARACTERS = 100_000;
const MAX_ZIP_ENTRY_BYTES = 8_000_000;
const AUDIO_MIME_TYPES = new Set(['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'ogg', 'webm']);

function extensionOf(fileName: string): string {
  return fileName.trim().toLowerCase().split('.').pop() ?? '';
}

function read16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function read32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function audioMagic(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'audio/mpeg') return (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') return new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WAVE';
  if (mimeType === 'audio/mp4') return new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp';
  if (mimeType === 'audio/ogg') return new TextDecoder().decode(bytes.slice(0, 4)) === 'OggS';
  return mimeType === 'audio/webm' && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '').trim();
    if (!text || text.includes('\u0000')) throw new Error('empty or binary');
    if (text.length > MAX_EXTRACTED_CHARACTERS) throw new IntakeSourceError('INTAKE_SOURCE_TOO_LARGE', 'AI가 정리할 텍스트는 100,000자 이하여야 합니다. 파일을 나누어 올려 주세요.');
    return text;
  } catch (error) {
    if (error instanceof IntakeSourceError) throw error;
    throw new IntakeSourceError('INVALID_INTAKE_TEXT', '텍스트·CSV 파일은 UTF-8 형식이어야 하며 빈 파일은 사용할 수 없습니다.');
  }
}

function xmlText(value: string): string {
  return value
    .replace(/<[^>]+>/gu, '')
    .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'").replace(/&amp;/gu, '&')
    .replace(/&#(\d+);/gu, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function zipEntries(bytes: Uint8Array): ZipEntry[] {
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (read32(bytes, offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new IntakeSourceError('INVALID_INTAKE_XLSX', 'Excel 파일 구조를 읽을 수 없습니다. .xlsx 파일인지 확인해 주세요.');
  const totalEntries = read16(bytes, eocd + 10);
  const centralOffset = read32(bytes, eocd + 16);
  if (totalEntries < 1 || totalEntries > 2_000 || centralOffset >= bytes.length) throw new IntakeSourceError('INVALID_INTAKE_XLSX', 'Excel 파일의 압축 구조가 올바르지 않습니다.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  try {
    for (let index = 0; index < totalEntries; index += 1) {
      if (read32(bytes, offset) !== 0x02014b50) throw new Error('central directory');
      const flags = read16(bytes, offset + 8);
      const method = read16(bytes, offset + 10);
      const compressedSize = read32(bytes, offset + 20);
      const uncompressedSize = read32(bytes, offset + 24);
      const nameLength = read16(bytes, offset + 28);
      const extraLength = read16(bytes, offset + 30);
      const commentLength = read16(bytes, offset + 32);
      const localOffset = read32(bytes, offset + 42);
      const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength)).replaceAll('\\', '/');
      entries.push({ name, method, flags, compressedSize, uncompressedSize, localOffset });
      offset += 46 + nameLength + extraLength + commentLength;
    }
  } catch {
    throw new IntakeSourceError('INVALID_INTAKE_XLSX', 'Excel 파일의 압축 목록이 손상되었습니다.');
  }
  return entries;
}

async function unzipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  if ((entry.flags & 1) === 1 || ![0, 8].includes(entry.method) || entry.uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
    throw new IntakeSourceError('UNSUPPORTED_INTAKE_XLSX', '암호화되었거나 지나치게 큰 Excel 시트는 사용할 수 없습니다.');
  }
  if (read32(bytes, entry.localOffset) !== 0x04034b50) throw new IntakeSourceError('INVALID_INTAKE_XLSX', 'Excel 시트 위치가 올바르지 않습니다.');
  const nameLength = read16(bytes, entry.localOffset + 26);
  const extraLength = read16(bytes, entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = bytes.slice(start, start + entry.compressedSize);
  if (start + entry.compressedSize > bytes.length) throw new IntakeSourceError('INVALID_INTAKE_XLSX', 'Excel 시트 데이터가 잘렸습니다.');
  let output: Uint8Array;
  if (entry.method === 0) output = compressed;
  else {
    try {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > MAX_ZIP_ENTRY_BYTES || size > entry.uncompressedSize) { await reader.cancel(); throw new Error('expanded ZIP limit'); }
        chunks.push(next.value);
      }
      output = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    } catch {
      throw new IntakeSourceError('INVALID_INTAKE_XLSX', 'Excel 시트 압축을 해제할 수 없습니다.');
    }
  }
  if (output.length !== entry.uncompressedSize || output.length > MAX_ZIP_ENTRY_BYTES) throw new IntakeSourceError('INVALID_INTAKE_XLSX', 'Excel 시트 크기 검증에 실패했습니다.');
  return output;
}

function textNodes(xml: string): string {
  return [...xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>/giu)].map((match) => xmlText(match[1])).join('');
}

async function extractXlsx(bytes: Uint8Array): Promise<string> {
  if (read32(bytes, 0) !== 0x04034b50) throw new IntakeSourceError('INVALID_INTAKE_XLSX', '선택한 파일은 유효한 .xlsx 파일이 아닙니다.');
  const entries = zipEntries(bytes);
  // HWP/Excel and third-party spreadsheet writers do not always preserve the
  // canonical OOXML part-name casing. ZIP member lookup therefore has to be
  // case-insensitive even though the worksheet path matcher already is.
  const byName = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
  const worksheetEntries = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/iu.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, 20);
  if (!worksheetEntries.length || !byName.has('[content_types].xml')) throw new IntakeSourceError('INVALID_INTAKE_XLSX', 'Excel 통합문서에서 워크시트를 찾을 수 없습니다.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const shared: string[] = [];
  const sharedEntry = byName.get('xl/sharedstrings.xml');
  if (sharedEntry) {
    const sharedXml = decoder.decode(await unzipEntry(bytes, sharedEntry));
    for (const match of sharedXml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si>/giu)) shared.push(textNodes(match[1]));
  }
  const lines: string[] = [];
  let cellCount = 0;
  let characterCount = 0;
  for (const entry of worksheetEntries) {
    const xml = decoder.decode(await unzipEntry(bytes, entry));
    lines.push(`[${entry.name.replace(/^xl\/worksheets\//u, '').replace(/\.xml$/u, '')}]`);
    // Empty formatted cells are commonly serialized as <c .../>. Match those
    // atomically so they cannot swallow the next populated cell and shift all
    // references/values in company meeting-minute templates.
    for (const match of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c>)/giu)) {
      cellCount += 1;
      if (cellCount > 20_000) throw new IntakeSourceError('INTAKE_SOURCE_TOO_LARGE', 'Excel 셀이 20,000개를 넘습니다. 필요한 시트만 남겨 다시 올려 주세요.');
      const attrs = match[1];
      const body = match[2] ?? '';
      const ref = /\br="([^"]+)"/iu.exec(attrs)?.[1] ?? `CELL-${cellCount}`;
      const type = /\bt="([^"]+)"/iu.exec(attrs)?.[1] ?? '';
      const raw = /<(?:[A-Za-z_][\w.-]*:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v>/iu.exec(body)?.[1] ?? '';
      let value = '';
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = textNodes(body);
      else value = xmlText(raw);
      value = value.replace(/\s+/gu, ' ').trim();
      if (!value) continue;
      const line = `${ref}: ${value}`;
      characterCount += line.length + 1;
      if (characterCount > MAX_EXTRACTED_CHARACTERS) throw new IntakeSourceError('INTAKE_SOURCE_TOO_LARGE', 'Excel에서 추출한 내용이 100,000자를 넘습니다. 필요한 시트만 남겨 다시 올려 주세요.');
      lines.push(line);
    }
  }
  const text = lines.join('\n').trim();
  if (!text || cellCount === 0) throw new IntakeSourceError('EMPTY_INTAKE_XLSX', 'Excel 파일에 AI가 정리할 셀 내용이 없습니다.');
  return text;
}

export async function extractIntakeSource(fileName: string, suppliedMimeType: string, bytes: Uint8Array): Promise<IntakeSource> {
  const extension = extensionOf(fileName);
  const mimeType = suppliedMimeType.trim().toLowerCase();
  if (AUDIO_EXTENSIONS.has(extension) && AUDIO_MIME_TYPES.has(mimeType)) {
    if (!audioMagic(bytes, mimeType)) throw new IntakeSourceError('INVALID_AUDIO_SIGNATURE', '녹음 파일의 실제 형식과 확장자·MIME 형식이 일치하지 않습니다.');
    return { kind: 'AUDIO', mimeType, extractedText: null };
  }
  if (extension === 'txt' && ['', 'text/plain', 'application/octet-stream'].includes(mimeType)) {
    return { kind: 'TEXT', mimeType: 'text/plain', extractedText: decodeUtf8(bytes) };
  }
  if (extension === 'csv' && ['', 'text/csv', 'application/csv', 'application/vnd.ms-excel', 'application/octet-stream'].includes(mimeType)) {
    return { kind: 'SPREADSHEET', mimeType: 'text/csv', extractedText: decodeUtf8(bytes) };
  }
  if (extension === 'xlsx' && ['', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'].includes(mimeType)) {
    return { kind: 'SPREADSHEET', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extractedText: await extractXlsx(bytes) };
  }
  throw new IntakeSourceError('UNSUPPORTED_INTAKE_SOURCE', '녹음(mp3·m4a·wav·ogg·webm), 텍스트(txt·csv) 또는 Excel(.xlsx) 파일만 사용할 수 있습니다.');
}

/** Office/HWPX text shares the bounded ZIP reader used by the spreadsheet importer. */
export async function extractEvidenceText(fileName: string, mimeType: string, bytes: Uint8Array): Promise<string> {
  const extension = extensionOf(fileName);
  if (['txt', 'csv', 'xlsx'].includes(extension)) return (await extractIntakeSource(fileName, mimeType, bytes)).extractedText ?? '';
  if (!['docx', 'hwpx'].includes(extension)) throw new IntakeSourceError('UNSUPPORTED_EVIDENCE_TEXT', '문서 텍스트 추출을 지원하지 않는 형식입니다.');
  const entries = zipEntries(bytes).filter((entry) => extension === 'docx' ? /^word\/(document|header\d+|footer\d+)\.xml$/iu.test(entry.name) : /^Contents\/section\d+\.xml$/iu.test(entry.name));
  if (!entries.length || entries.length > 100) throw new IntakeSourceError('INVALID_EVIDENCE_DOCUMENT', '문서 본문을 읽을 수 없습니다.');
  const parts: string[] = [];
  let length = 0;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(await unzipEntry(bytes, entry));
    const text = [...xml.matchAll(/<(?:[\w.-]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?t>/giu)].map((match) => xmlText(match[1])).join('\n');
    length += text.length;
    if (length > MAX_EXTRACTED_CHARACTERS) throw new IntakeSourceError('INTAKE_SOURCE_TOO_LARGE', '문서 내용이 100,000자를 넘습니다. 비교할 문서를 나누어 주세요.');
    parts.push(text);
  }
  const result = parts.join('\n').trim();
  if (!result) throw new IntakeSourceError('EMPTY_EVIDENCE_DOCUMENT', '문서에서 비교할 텍스트를 찾지 못했습니다.');
  return result;
}
