// Exercise the application's own XLSX export, not a substitute workbook generator.
import { mkdirSync, writeFileSync } from 'node:fs';
import { meetingMinutesWorkbook } from '../apps/web/src/proposals/proposal-excel';
mkdirSync('tmp/cf115-fixtures', { recursive: true });
const bytes = meetingMinutesWorkbook({
  author: '김검수', authorDepartment: '합성 시험팀', authorPosition: '연구원',
  clientName: '합성 발주처', reportingDepartment: '합성 시험팀', referenceDepartments: '모든 부서',
  meetingDate: '2026. 09. 07', meetingTime: '10:00', meetingEndTime: '',
  location: '합성 회의실', participants: '김검수, 이확인', clientParticipants: '박요청',
  meetingTitle: 'CF115 검수용 시험 도면 검토 회의', attachmentName: '',
  summary: '실제 업무가 아닌 자동정리 검수 자료입니다.\n김검수는 9월 9일까지 원도면과 수량을 대조하기로 했습니다.\n추가 금액은 아직 미확정입니다.\n누수 여부는 사진만으로 판단할 수 없습니다.\n누수 확인 담당자와 다음 회의 날짜는 정하지 않았습니다.',
  followUps: '원도면 대조 후 추가 조사를 협의합니다.'
});
writeFileSync('tmp/cf115-fixtures/cf115-company-minutes.xlsx', bytes);
console.log('Synthetic company XLSX exported:', bytes.byteLength, 'bytes');
