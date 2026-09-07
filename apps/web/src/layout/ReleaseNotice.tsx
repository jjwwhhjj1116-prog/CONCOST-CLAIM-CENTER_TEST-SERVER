import { useEffect, useRef } from 'react';
import { Button } from '@claim-studio/ui';
import './ReleaseNotice.css';

export const RELEASE_DATE = '2026-09-07';
export const RELEASE_DATE_LABEL = '2026년 9월 7일';
const noticeKey = (userId: string) => `claim-studio-release-${RELEASE_DATE}-v3:${userId}`;
export function hasSeenRelease(userId: string): boolean {
  try { return localStorage.getItem(noticeKey(userId)) === 'seen'; } catch { return false; }
}
export function markReleaseSeen(userId: string): void {
  try { localStorage.setItem(noticeKey(userId), 'seen'); } catch { /* Storage may be blocked; closing still works. */ }
}

export const RELEASE_UPDATES = [
  { title: '9월 7일 추가 수정 · 회의록 자동정리 권한', text: '관리자가 프로젝트를 열 수 있는데도 AI 처리 기록이 차단되던 권한 불일치를 수정했습니다. 원본 보관과 자동정리 실패를 구분하고, 빈 후속업무·초 단위 시간·요일이 붙은 날짜 등 회의록 변형 양식의 처리를 보완했습니다. 회사 자료의 외부 AI 전송 승인 조건은 유지합니다.' },
  { title: '9월 7일 추가 수정 · 보고서 단계 이동 안내', text: '초기 저장 실패가 버전 충돌로 잘못 표시되던 경우를 구분했습니다. 저장 오류와 재시도 버튼을 모든 단계 상단에 표시하고, 실패 후 자동 반복 요청을 중지합니다. 편집 내용은 유지하며 저장 성공을 확인한 뒤 다음 단계로 이동합니다.' },
  { title: '파일 가져오기 → AI 회의록·조사기록 작성', text: '파일을 선택하면 원본 보관 후 AI 정리까지 이어집니다. 문서·녹음·사진·스캔 PDF의 내용을 읽어 회의록 양식, 논의·결정사항과 후속 업무에 연결합니다. 정리 결과는 검수 후 기록과 함께 저장하며, 실패한 단계는 원본을 유지한 채 다시 실행할 수 있습니다.' },
  { title: '자료 등록·자동정리 연결', text: '자료실의 회의·조사 자료에서도 AI 작성 화면으로 이어집니다. AI 버전 비교가 불가능할 때는 동의 후 기존 파일을 유지하고 별도 자료로 보관할 수 있습니다. AI가 실행되지 않은 원문 가져오기는 자동정리 완료와 구분하여 표시합니다.' },
  { title: '보고서 저장·협업 안정성', text: '단계·챕터를 이동하는 것만으로 승인 버전이 바뀌지 않도록 수정했습니다. 협업 원고의 미저장 변경을 안내하고, 이동 전 저장과 충돌 확인을 강화했습니다. AI 문장 개선도 원문이 바뀌면 덮어쓰지 않습니다.' },
  { title: '보고서 AI 초안 작성', text: '‘챕터별 자동작성(권장)’과 ‘전체 한 번에 작성’을 구분했습니다. 전체 작성은 미작성 챕터를 순서대로 생성·저장하며, 중단 시 저장된 내용은 유지합니다. 작성 불가 사유와 연결 설정 안내도 표시합니다.' },
  { title: '보고서 편집·A4 페이지', text: '검수 편집기를 전체 폭으로 넓히고 협업·판례·피드백 도구를 접어서 볼 수 있게 정리했습니다. 수동 검수 전환과 챕터 가져오기 시 기존 서식을 보존하며, 목차 제목·머리글 편집, 제목 스타일·목록 도구, 전체화면 사용성을 개선했습니다.' },
  { title: '보고서 출력·파일 호환성', text: 'A4 쪽 구분과 여러 페이지에 걸친 목록 번호를 보완했습니다. 긴 보고서의 Excel 저장 한도를 처리하고, 납품센터에서 승인·확정 당시의 본문과 서식으로 미리보기·재출력할 수 있습니다. 기존 보관 파일은 유지합니다.' },
  { title: '제안서 작성·편집', text: '이미지의 가로·세로·대각선 크기 조절과 표 편집을 개선했습니다. 확정 후 프로젝트 접수로 이동하고, 메일 발송 준비는 별도 5단계로 분리했습니다. Excel·HWP 메뉴의 바깥 클릭 닫기도 적용했습니다.' },
  { title: '프로젝트 일정·업무 화면', text: '일정표에 담당 PM을 별도 표시하고, 전체·프로젝트별 일정표 출력을 구분했습니다. 상세 출력은 프로젝트명과 월별 페이지를 표시합니다. 착수회의·현장조사·산출 화면은 프로젝트 선택과 기준 일정을 나란히 배치했습니다.' },
  { title: '회의록 양식·Excel 출력', text: '착수회의·현장조사 입력 항목을 회의록 양식에 맞추고, 참조부서 기본값을 ‘모든 부서’로 설정했습니다. 회의 메모의 양식 반영과 XLSX 병합 셀 테두리·인쇄 배치를 수정했습니다.' },
  { title: 'Drive 자료실·명함 관리', text: '자료의 저장 폴더·업로더·버전 정보를 표시하고, 회사 로그인 권한으로 업로드·다운로드하도록 정리했습니다. 명함은 관리자가 삭제하고 복원할 수 있습니다.' },
] as const;

export function ReleaseNotice({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);
  return <dialog ref={dialogRef} className="release-notice" aria-labelledby="release-notice-title" aria-describedby="release-notice-description" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><div><time dateTime={RELEASE_DATE}>{RELEASE_DATE_LABEL}</time><h2 id="release-notice-title">가오픈 업데이트 안내</h2></div><button type="button" autoFocus aria-label="업데이트 안내 닫기" onClick={onClose}>×</button></header>
    <div className="release-notice__body">
      <p id="release-notice-description">2026년 8월 31일 가오픈 이후 9월 7일까지의 누적 개선사항입니다.<br/>가오픈·테스트 서버에 동일한 수정 소스를 반영했습니다. 이번 배포에 포함된 최근 개선사항을 확인해 주세요.</p>
      <div className="release-notice__updates">{RELEASE_UPDATES.map((update) => <section key={update.title}><h3>{update.title}</h3><p>{update.text}</p></section>)}</div>
      <aside><strong>사용 전 확인해 주세요</strong><p>AI·Drive는 관리자 연결 설정과 접근 권한에 따라 사용할 수 있습니다. 메일 발송 준비 화면은 실제 메일 발송 기능이 아닙니다. 외부 제출 전 내려받은 문서를 확인해 주세요.</p></aside>
    </div>
    <footer><p>이 브라우저에서 계정별로 한 번 안내합니다.<br/>상단 ‘업데이트’ 버튼으로 다시 볼 수 있습니다.</p><Button onClick={onClose}>확인하고 시작하기</Button></footer>
  </dialog>;
}
