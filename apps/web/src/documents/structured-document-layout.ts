export const inferredTableColumnWeight = (header: string, longestValueLength: number): number => {
  const normalized = header.replace(/\s+/gu, '').toLocaleLowerCase('ko-KR');
  if (/^(?:no|번호|순번|단계)$/iu.test(normalized)) return 0.45;
  if (/(?:연면적|면적|금액|공사비|단가|총액|합계|수량|비율|세대수)/iu.test(normalized)) return 0.9;
  if (/(?:연도|년도|지역|층수|동수|구분|상태)/iu.test(normalized)) return 0.7;
  if (/(?:내용|세부|업무|산출물|비고|설명|검토|의견|범위)/iu.test(normalized)) return 2.1;
  if (/(?:발주자|법무법인|현장명|프로젝트|사업명|회사명|성명|제목)/iu.test(normalized)) return 1.5;
  return Math.min(1.8, Math.max(0.8, 0.55 + Math.sqrt(Math.min(100, longestValueLength)) / 3));
};

export const normalizeColumnWidths = (widths: number[], targetTotal: number, inferredWeights: number[] = []): { widths: number[]; repaired: boolean } => {
  const positiveTotal = widths.reduce((sum, width) => sum + (Number.isFinite(width) && width > 0 ? width : 0), 0);
  const average = positiveTotal > 0 ? positiveTotal / Math.max(1, widths.length) : 0;
  const missing = widths.map((width) => !Number.isFinite(width) || width <= 0 || (average > 0 && width < average * 0.15));
  const missingCount = missing.filter(Boolean).length;
  if (missingCount === widths.length && inferredWeights.length === widths.length) {
    const weightTotal = inferredWeights.reduce((sum, weight) => sum + Math.max(0.1, weight), 0);
    return {
      widths: inferredWeights.map((weight) => Math.max(0.1, weight) / weightTotal * targetTotal),
      repaired: true
    };
  }
  const defaultWidth = targetTotal / Math.max(1, widths.length);
  const remaining = Math.max(0, targetTotal - defaultWidth * missingCount);
  const knownTotal = widths.reduce((sum, width, index) => sum + (missing[index] ? 0 : width), 0);
  const normalized = widths.map((width, index) => missing[index]
    ? defaultWidth
    : (knownTotal > 0 ? width / knownTotal * remaining : defaultWidth));
  return { widths: normalized, repaired: missingCount > 0 };
};
