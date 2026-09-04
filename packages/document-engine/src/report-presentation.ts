// Presentation metadata travels with the versioned editor JSON, not the body text.
// A metadata-only document has no content: callers must keep the Markdown fallback.
export interface ReportHeader { enabled: boolean; text: string | null }
type EditorDocument = { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };

export function splitReportPresentation<T extends EditorDocument>(document: T | null | undefined): { body: T | null; header: ReportHeader } {
  const value = document?.attrs?.reportHeader as Partial<ReportHeader> | undefined;
  const header = { enabled: value?.enabled !== false, text: typeof value?.text === 'string' ? value.text.slice(0, 1000) : null };
  if (!document || !Array.isArray(document.content)) return { body: null, header };
  const { reportHeader: _header, ...attrs } = document.attrs ?? {};
  const body = { ...document };
  if (Object.keys(attrs).length) body.attrs = attrs;
  else delete body.attrs;
  return { body, header };
}

export function joinReportPresentation<T extends EditorDocument>(body: T | null, header: ReportHeader) {
  if (header.enabled && header.text === null) return body;
  return { ...(body ?? { type: 'doc' }), attrs: { ...body?.attrs, reportHeader: { enabled: header.enabled, text: header.text?.slice(0, 1000) ?? null } } };
}
