# CF122 목록 간소화 및 보고서 DB관리 삭제

## 변경 범위

- 프로젝트별 보고서·제안서 목록을 제목, 작성 정보, 상태, 작업 버튼의 간결한 행으로 표시한다. 기존 검색·이어쓰기·제안서 열기·접수/수주·확정 파일 열기·숨기기 기능을 유지한다.
- 함께 요청된 스크린샷의 프로젝트 의뢰 목록도 간소화한다. 긴 사건 설명은 `사건 설명 보기`를 펼치면 원문 그대로 볼 수 있다.
- 보고서 DB관리에 관리자용 `삭제` 버튼과 대상 확인창을 추가한다. 취소 시 요청하지 않으며, 처리 중 중복 클릭을 막고 실패 시 목록 새로고침/재시도를 제공한다.
- 편집기, 출력 형식, AI/Google/국가법령정보 설정은 변경하지 않는다.

## 삭제의 의미와 보존 범위

`POST /api/report-workspaces/:caseId/delete`에 현재 `expectedVersion`을 전달한다. 관리자·프로젝트 권한·동일 출처·JSON 형식·버전을 검사한 뒤 기존 `preview_case_activities`에 `REPORT_WORKSPACE_DELETED` 이벤트 하나만 추가한다. SQL의 단일 INSERT SELECT로 버전 및 중복 삭제를 검사한다.

보고서 본문, 표/이미지 구조, 기존 버전·백업·승인/확정 출력 이력과 프로젝트·Drive 원본은 물리 삭제하지 않는다. 보고서 목록에서는 제외되며 이후 이어쓰기·자동저장·목차/챕터 수정·신규 승인/확정은 차단한다. 이미 확정된 출력물은 기존 권한으로 열람할 수 있다. 삭제 전 시작한 외부 AI 요청의 취소 기능은 이번 범위가 아니며 생성 결과의 보고서 적용은 저장 차단으로 방지한다.

삭제 복원 UI와 동일 프로젝트의 새 작업공간 재생성은 이번 범위에 포함하지 않는다. 보존된 감사 이벤트를 임의 SQL로 삭제하지 않는다. 실제 업무 레코드를 삭제하는 테스트는 실행하지 않았다.

## 검증

- CF122 API 13개와 CF07/08/09/114/116/18/77/78 회귀를 합쳐 43개 통과. 삭제와 본문·목차·챕터 저장·승인/확정 경합 시 보존 데이터 및 알림/메일 대기열까지 비교한다.
- CF47 의뢰 가져오기/저장/제안서 연결 회귀 10개 통과.
- CF122 격리 브라우저 테스트 8개 통과: 실제 React/CSS, 데스크톱 1440px 및 모바일 390px, 확인 취소·중복 방지·실패·409 재조회·권한·검색·목록 이동·펼침. 업무 데이터 대신 합성 API 응답을 사용하고 모든 외부 요청을 차단했다.
- Worker 타입 검사 및 프런트엔드 프로덕션 빌드 통과. 기존 번들 크기 경고는 남아 있다.
- 기존 CF18의 옛 버튼 문구 단언 한 줄만 현행 `목차 확정` 분기에 맞췄으며 확정 상태 검사는 유지했다.
- 추가 시도한 CF41은 기존 Router의 `ProposalFinalization.css` 직접 import를 Node 테스트 실행기가 해석하지 못해 테스트 수집이 중단됐다. CF41 전체 통과로 계산하지 않는다. 목록의 실제 UI 동작은 위 격리 브라우저 테스트로 검사했다.
- 사용자 Chrome에서 로그인된 대상 탭을 확보하지 못했으므로 인증된 라이브 삭제를 검수했다고 간주하지 않는다. 배포 후에는 공개 경로, 인증 차단, health/readiness, 배포 자산 일치를 확인한다.

## 배포와 롤백

신규 migration 없음. 기존 테이블·행을 변경하는 배포 스크립트, DB export/reset/seed, 환경 동기화, secret 교체를 실행하지 않는다. Cloudflare 테스트/가오픈만 대상이며 베트남 Node 서버는 변경하지 않는다.

빌드: `corepack.cmd pnpm cf:build`.

배포: `node node_modules/wrangler/bin/wrangler.js deploy --config <config> --var RELEASE_MAINTENANCE:0`.

- 테스트 config: `wrangler.development.jsonc`; 직전 버전 `f95b1730-7cd3-4083-86ea-6e6e64ca0cca`.
- 가오픈 config: `wrangler.jsonc`; 직전 버전 `342b68dc-02ff-4909-bf43-34422f389566`.

UI만 문제면 현재 삭제 차단 로직은 유지한 채 UI를 이전 모습으로 재배포한다. CF122 이전 Worker로 전체 롤백하면 이미 삭제 처리된 보고서가 다시 노출/편집될 수 있으므로 사용자가 삭제한 이후에는 단순 이전 버전 롤백을 하지 않는다. 먼저 쓰기를 차단하고 삭제 이벤트 존재 여부를 읽기 전용으로 확인한 뒤 삭제 차단을 유지하는 수정 버전을 배포한다. 데이터 역변환이나 물리 삭제는 하지 않는다.

## 확인 경로

- 테스트: https://concost-claim-center-development.jjwwhhjj1116.workers.dev/reports/projects
- 가오픈: https://concost-claim-center-preview.jjwwhhjj1116.workers.dev/reports/projects
- 각 서버의 `/proposals/projects`, `/cases/intakes`, `/reports/database`에서 목록과 관리자 삭제 기능을 확인한다.

## 2026-09-08 배포 결과

- 테스트 배포 버전: `26d309d7-537e-4721-8e8c-76f6d5841e3b`.
- 가오픈 배포 버전: `adb1ea46-179d-4a27-9762-d4acd54380de`.
- 두 서버 모두 `/health`·`/readiness` 200, `googleDriveConnected: true`, 네 목록 경로 200, 비로그인 삭제/확정 출력 열람 API 401을 확인했다.
- `scripts/cf114-live-smoke.mjs development` 및 `gaopen`에서 배포된 모든 JS/CSS SHA-256이 로컬 빌드와 일치했다. 메인 JS `index-BVQ0nmIG.js`: `80bcebc668719a2b11cbd77b8870abd7c1f2ed2970190be5836707ae3da23d01`; CSS `index-DwUh-l9G.css`: `3d5babc3676d6e09541aa167e14a6c7918f16a0f382b05d8449b36c8843f93fd`.
- 실제 업무 보고서 삭제, DB migration, 환경변수/인증값 동기화는 수행하지 않았다.
