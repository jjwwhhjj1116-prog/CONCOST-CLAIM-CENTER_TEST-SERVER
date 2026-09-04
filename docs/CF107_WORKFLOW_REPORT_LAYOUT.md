# CF107 · 업무·보고서 선택 화면 정리

## 요청 범위

- 착수회의·현장조사·물량산출 및 내역: 현재 프로젝트 선택 왼쪽, 기준 일정 오른쪽. 좁은 화면에서는 같은 순서로 세로 배치한다.
- 해당 세 업무 화면의 상단 6단계 메뉴를 제거한다. 사이드바 이동 경로는 유지한다.
- 산출 담당자 선택의 표시명만 `산출 및 내역 PM`으로 바꾼다. 기존 `memberName` 저장 및 전체 프로젝트 담당 PM은 변경하지 않는다.
- 보고서 1단계: 프로젝트 선택/원본 템플릿 선택을 좌우로 묶고 참고자료 준비상태를 아래에 배치한다. 중복 현재 프로젝트 배너와 유형·승인 템플릿·자동저장 요약 카드는 제거한다.
- 보고서 제목을 계약·판례·현장 근거 중심의 작성 안내로 바꾸고 5단계 카드의 크기와 글자를 키운다.

## 보존한 동작

- 프로젝트 선택의 탐색·미저장 보호, 기준 일정 권한·버전 충돌·저장 동작, 담당자 배정 데이터.
- 템플릿 원본 열람과 실제 적용 유형의 분리, 보고서 단계 완료 조건·잠금·자동저장·복구·출력.
- 관리자 전용 프롬프트 설정 진입점과 `/ai-config` 접근 제한.
- 실제 자동저장 상태 표시와 오류 시 다시 불러오기. 템플릿 미등록 사유는 1단계 조건부 경고로 유지한다.
- 보고서 2~5단계의 현재 프로젝트 배너. API·DB·migration 변경 없음.

## 검수

```powershell
node node_modules/tsx/dist/cli.mjs --test scripts/cf107-workflow-report-layout-test.ts scripts/cf20-visual-hierarchy-test.ts scripts/cf67-document-workflow-test.ts scripts/cf73-workflow-minutes-parity-test.ts
node node_modules/tsx/dist/cli.mjs --test --test-name-pattern='CF40 responsible PM|CF70 linked schedule|CF77 shares|CF77 enforces|CF84 keeps package' scripts/cf39-integrated-project-workspace-test.ts scripts/cf77-cf78-collaboration-business-card-test.ts scripts/cf84-claim-report-guideline-package-test.ts
corepack pnpm cf:build
git diff --check
```

- UI·문서 검사 20개, API·권한 회귀 5개 통과. 타입 검사 및 프로덕션 빌드 통과.
- 기존 CF20 단계 메뉴/CF67 필수 프로젝트 라벨 기대값을 이번 요청에 맞게 갱신했다.
- `apps/web/qa/cf107-layout.html`: 실제 컴포넌트와 앱 기본 스타일을 사용하는 합성 브라우저 검수. 모든 요청을 mock에서 처리하고 비GET 요청은 409로 차단하므로 실제 회사 데이터는 저장하지 않는다. 기본 프로덕션 빌드에는 포함되지 않는다.
- 변경 전부터 존재하던 CF71의 옛 백업 버튼 문구 기대값 실패는 범위 밖으로 유지했다.
- Impeccable layout 검사 0건. 1440/1050/390px 브라우저 DOM 실측에서 페이지 가로 넘침 0, HWP 메뉴가 헤더 경계 안에 표시됨을 확인했다. 5단계 카드는 약 96px이며 좁은 컨테이너는 내부 가로 스크롤을 사용한다.
- 선택 영역이 밀리지 않도록 보고서 히어로 높이를 조정했다(1440px 화면 414→272px). 모바일 단계 메뉴는 고정을 해제해 입력 화면을 가리지 않는다.
- 일반 PM의 프롬프트 설정 버튼 0개/관리자 1개, 미등록 템플릿 경고, 세 업무 화면의 6단계 메뉴 0개 및 산출 PM 라벨을 확인했다.
- 화면 캡처 연결 오류 때문에 보정 후 최종 검증은 DOM 실측으로 진행했다. 다크 테마는 스타일 적용만 확인했으며 전체 시각 가독성 검수 완료로 취급하지 않는다. 로컬 근거: `outputs/cf107-visual/layout-measurements.json`, `layout-final-measurements.json`.

## 배포 제한

개발 환경 `wrangler.development.jsonc` / `concost-claim-center-development`에만 배포한다. 실제 Chrome 세션은 로그인 화면이므로 로그인된 업무 데이터로의 사용자 경로 검수와 합성 화면 검수를 구분한다.

## 개발 서버 배포 결과 · 2026-09-04

- 소스 커밋 `c5d605a`, `test-server/fix/CF73-workflow-minutes-parity`에 푸시.
- Worker 버전 `2cb37017-9831-4733-b53c-6075c2351f2b`.
- URL: https://concost-claim-center-development.jjwwhhjj1116.workers.dev
- `/health` 200 `ok`, `/readiness` 200 `ready`, Google Drive 연결 유지.
- `/reports/studio`의 HTML에서 새 `index-DqsWzJJ6.js` 참조를 확인했다. 해당 JS, `index.es-CIKpov5t.js`, `index-Bjn473Uk.css`의 배포 SHA-256이 검증한 로컬 빌드와 일치한다.
- 개발 환경만 반영. DB migration·실제 회사 데이터 수정 없음. 로그인된 실제 업무 경로와 최종 시각 캡처는 앞서 명시한 검수 한계로 남긴다.
