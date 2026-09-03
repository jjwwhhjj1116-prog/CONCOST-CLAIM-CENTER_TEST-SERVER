/** Physical document spacing is stored in CSS pixels, independently of font metrics. */
export const normalizeSpacerHeight = (value: unknown): number => {
  const parsed = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.min(240, Math.max(1, Math.round(parsed))) : 16;
};

export const spacerMarker = (height: unknown): string => `<!-- DOCUMENT-SPACER:${normalizeSpacerHeight(height)} -->`;

export const expandDocumentSpacingMarkers = (markdown: string): string => markdown
  .replace(/<!--\s*DOCUMENT-PAGE-BREAK\s*-->/gu, '\n<div data-document-page-break="true"></div>\n')
  .replace(/<!--\s*DOCUMENT-SPACER:([\d.]+)\s*-->/gu, (_match, height: string) => {
    const pixels = normalizeSpacerHeight(height);
    return `\n<div data-document-spacer="${pixels}" style="height:${pixels}px;min-height:${pixels}px;margin:0;padding:0;line-height:0"></div>\n`;
  });
