const CLAIM_TYPE_LABELS: Record<string, string> = {
  'TYPE-01': '현장조사 및 수량산출 클레임',
  'TYPE-02': '분석 보고서 작성 클레임',
  'TYPE-03': '일반적인 클레임',
  'TYPE-04': '재건축·재개발 공사비 협상',
  'TYPE-05': '사감정보고서',
  'TYPE-06': '물가변동'
};

export function claimTypeLabel(code: string): string {
  return CLAIM_TYPE_LABELS[code] ?? code;
}
