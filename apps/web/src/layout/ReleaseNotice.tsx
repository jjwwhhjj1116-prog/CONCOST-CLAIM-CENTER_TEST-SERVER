import { useEffect, useRef } from 'react';
import { Button } from '@claim-studio/ui';
import './ReleaseNotice.css';

export const RELEASE_DATE = '2026-09-04';
const noticeKey = (userId: string) => `claim-studio-release-${RELEASE_DATE}-v1:${userId}`;
export function hasSeenRelease(userId: string): boolean {
  try { return localStorage.getItem(noticeKey(userId)) === 'seen'; } catch { return false; }
}
export function markReleaseSeen(userId: string): void {
  try { localStorage.setItem(noticeKey(userId), 'seen'); } catch { /* Storage may be blocked; closing still works. */ }
}

export const RELEASE_UPDATES = [
  { title: '보고서 AI 초안 작성', text: '‘챕터별 자동작성(권장)’과 ‘전체 한 번에 작성’을 구분했습니다. 전체 작성은 미작성 챕터를 순서대로 생성·저장하며, 중단 시 저장된 내용은 유지합니다. 작성 불가 사유와 연결 설정 안내도 표시합니다.' },
  { title: '보고서 편집·A4 페이지', text: '미리보기를 A4 페이지로 구분하고, 머리글 사용 여부와 내용을 편집할 수 있도록 했습니다. 검수 중 목차 제목을 수정하면 본문 제목에 반영되며, 기존 본문·표·이미지는 유지됩니다.' },
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
    <header><div><time dateTime={RELEASE_DATE}>2026년 9월 4일</time><h2 id="release-notice-title">가오픈 업데이트 안내</h2></div><button type="button" autoFocus aria-label="업데이트 안내 닫기" onClick={onClose}>×</button></header>
    <div className="release-notice__body">
      <p id="release-notice-description">테스트 서버의 최신 소스를 가오픈 서버에 반영했습니다.<br/>이번 배포에 포함된 최근 개선사항을 확인해 주세요.</p>
      <div className="release-notice__updates">{RELEASE_UPDATES.map((update) => <section key={update.title}><h3>{update.title}</h3><p>{update.text}</p></section>)}</div>
      <aside><strong>사용 전 확인해 주세요</strong><p>AI·Drive는 관리자 연결 설정과 접근 권한에 따라 사용할 수 있습니다. 메일 발송 준비 화면은 실제 메일 발송 기능이 아닙니다. 외부 제출 전 내려받은 문서를 확인해 주세요.</p></aside>
    </div>
    <footer><p>이 브라우저에서 계정별로 한 번 안내합니다.<br/>상단 ‘업데이트’ 버튼으로 다시 볼 수 있습니다.</p><Button onClick={onClose}>확인하고 시작하기</Button></footer>
  </dialog>;
}
