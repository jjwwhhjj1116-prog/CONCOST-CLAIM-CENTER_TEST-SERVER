# CF114 보고서 편집·출력 전수 흐름 점검 / 2026-09-07

## 배포 범위와 결과

- 기준 소스: `b57a6bf`에서 시작한 `fix/CF73-workflow-minutes-parity` 브랜치. 이 문서와 함께 커밋한 CF114 소스가 배포 대상이다.
- 가오픈 Worker: https://concost-claim-center-preview.jjwwhhjj1116.workers.dev
- 테스트 Worker: https://concost-claim-center-development.jjwwhhjj1116.workers.dev
- 두 서버에 동일한 웹 번들 및 Worker 소스를 적용했다. DB, OAuth redirect, 기존 암호화 키와 secret은 분리·보존했다. 데이터 복제/초기화는 하지 않았다.
- 가오픈 배포 버전: `8c8a60d2-fe59-4116-b6d7-bdb7b143fa6c`
- 테스트 배포 버전: `dbc2a7f8-8b6c-4c6e-9278-7bf3385bdcdf`
- 두 서버 `/health` 및 `/readiness` 200, Drive 연결 메타데이터 유지, 익명 확정 문서 API 401, 대기 migration 0 확인.
- `index-DSg9cklF.js` SHA-256: `c0afabea2773ca23b70b4202ff4edc4244c70b55c348b335acfac01bff175cdd`
- `index-C7245YNn.css` SHA-256: `523b397fa51306506a901f2a614719f6feab7d5d579f7313da9bfcb70dd3d3a2`
- 동적 JS 두 파일까지 로컬 빌드와 양 서버의 바이트 해시가 일치한다. `scripts/cf114-live-smoke.mjs`로 재검증할 수 있다.

## 확인한 오류와 수정

| 분야 | 원인 / 수정 |
| --- | --- |
| 승인 버전 | 단계·챕터 이동 메타데이터까지 새 본문 버전으로 저장하던 문제를 수정. 실제 제목·본문·서식 변경만 새 버전·이력을 생성하며, 오래된 expectedVersion은 그대로 409 거부 |
| 자동저장 반복 | 읽기전용 변경이 편집 변경 이벤트를 발생시켜 저장→dirty→저장을 반복. 문서 변경 transaction만 처리하고 setEditable 갱신 이벤트를 억제 |
| 협업 원고 | 일반 담당자 미저장 원고도 이동·창닫기 보호. 저장 실패 시 원고와 화면 유지, 재시도 성공 후 이동. PM 반영 시 저장된 원고·버전이 일치하는지 검사하고 원자적 갱신 |
| 서식 손실 | 수동 검수 전환·챕터 가져오기·협업 반영 때 전체 JSON을 버리던 경로 제거. 대상 챕터만 병합하고 다른 챕터, 표, 이미지, 머리글 보존 |
| AI 덮어쓰기 | 선택 원문이 바뀌면 대체 거부. 전체 개선은 요청 중 원고 변경 및 구조·서식 변경을 검사하고 안전하게 거부 |
| 편집 공간 | 전역 form-stack 최대 폭 때문에 검수 화면이 좁아짐. 보고서 검수 영역만 전체 폭 사용, 협업·판례·피드백 접기, 고정 단계 바의 편집기 가림 제거 |
| 편집 도구 | 본문/제목1~3, 글머리·번호 목록 추가. 밑줄·강조·정렬의 구조화 편집→문자열 변환 보존. 전체화면의 스크롤 및 Escape 개선 |
| 페이지 | 중첩·이어지는 번호 목록, 연속 강제 쪽 나눔의 빈 페이지 및 중첩 쪽 나눔 처리 보완 |
| 실제 출력 | DOCX 라이브러리가 가로 치수를 다시 뒤집던 문제 수정. html2canvas 복제 문서의 CSS reset으로 사라지는 목록 번호·들여쓰기를 원본 계산 스타일로 복원 |
| 확정본 | 납품센터에서 현재 초안이 아닌 확정 당시 revision의 JSON·본문을 조회해 공통 미리보기·출력 사용. 기존 보관 파일 다운로드는 그대로 유지 |
| Excel | 긴 본문을 셀 문자·줄바꿈 제한 이내 FIELD_CODE 조각으로 저장하고 손실 없이 결합. 조각 누락·중복은 명시적 오류 |
| DOCX 가져오기 | 줄바꿈·탭·표 병합·지원 서식 보존. 지원하지 않는 그림/개체/수식/주석 등은 조용히 삭제하지 않고 가져오기 실패 안내 |

## 업데이트 팝업

- 날짜: **2026년 9월 7일**. 범위: **8월 31일 가오픈 이후 누적 개선사항**.
- 저장·협업, AI 초안, 편집·A4, 출력·파일, 제안서, 일정·PM·업무 화면, 회의록 XLSX, Drive·명함 등 8개 항목.
- 계정·브라우저·릴리스별 한 번 표시하고 상단 업데이트 버튼으로 다시 열 수 있다.
- 관리자 연결/권한 필요 및 메일 준비 화면은 실제 발송 기능이 아니라는 기존 제한도 명시했다.

## 검증 결과

- 관련 23개 파일의 회귀 테스트 **86/86 통과**. 계약 검사뿐 아니라 실제 SQLite/D1 route 실행, XLSX 재읽기, React/Tiptap 브라우저 이벤트 검증 포함.
- 실제 편집기: 읽기전용 4회 왕복 변경 이벤트 0, 문자 입력 정상 이벤트, AI stale 원문 대체 거부/일치 원문 대체 성공.
- 실제 보고서 UI + synthetic API: 제목·본문·서식 편집당 한 번 저장, 추가 입력 없는 27초 동안 반복 저장 없음. 저장 503 시 담당자 원고 보존, 재시도 후 이동. 협업 대상 외 JSON 불변.
- 이미지 8방향 크기 조절, 표 행 편집, 실행 취소, 찾기/바꾸기, 제목·목록, 수동 검수 전환, 전체화면/모바일/Escape 확인.
- 실제 파일 출력: 한글·3/4번 상위 목록·9~12번 중첩 목록·병합 표·이미지를 포함한 3페이지 보고서. PDF 모든 페이지를 이미지로 렌더해 문장/쪽번호/잘림 확인.
- DOCX `16838×11906` twip landscape, PDF `841.89×595.28` pt, HWPX 가로 A4 3페이지. 세 형식의 각 페이지 JPEG 스트림이 동일. HWPX는 최종 HWP 변환 전 중간 포맷 검증이다.
- 장문 XLSX: 85,511자, 4,502개 줄바꿈 및 이모지 재읽기 일치. 구버전 단일 셀 호환 및 조각 오류 검증.
- 알림 팝업: 데스크톱 2열 / 모바일 1열, 가로 넘침 없음, 본문 내부 스크롤, 닫기/확인/Escape/재열기/포커스 복원 확인.
- 납품센터 실제 UI의 synthetic 확정 v7이 현재 초안 v1과 구분되어 표시됨. 로고 누락 시 출력 오류·버튼 복원, 고정 합성 로고 제공 후 DOCX 생성 성공까지 확인.
- 웹 typecheck+production build, Worker typecheck, 환경 계약 검사, diff whitespace 검사 통과. 기존 대형 JS chunk 경고는 남아 있다.

반복 실행:

```powershell
$cf114Tests = Get-ChildItem scripts -File | Where-Object { $_.Name -match '^cf(60|66|67|68|69|77|83|93|94|95|96|100|102|103|106|107|108|110|111|113|114).*-test\.ts$' } | ForEach-Object { $_.FullName }
node node_modules/tsx/dist/cli.mjs --test @cf114Tests
corepack pnpm cf:build
node node_modules/typescript/bin/tsc --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM apps/cloudflare/src/asset-modules.d.ts apps/cloudflare/src/index.ts
node scripts/cf114-live-smoke.mjs development gaopen
```

출력 검수 재현은 `scripts/cf114-final-output-README.md` 참조. `apps/web/qa/cf114-studio.*`와 `cf114-output-export.*`는 로컬 synthetic QA 전용이며 production 빌드 진입점에 포함되지 않는다.

## 데이터 보존 / migration

새 파일: `apps/cloudflare/migrations/0059_cf114_report_workspace_version_guard.sql`

- 이미 적용된 migration은 수정하지 않았다. report workspace version trigger만 교체하며 테이블·행·열을 삭제하지 않는다.
- Node/Prisma의 Report/ReportSection 모델에는 Cloudflare 전용 `preview_report_drafts` 및 해당 trigger가 없다. 이 변경에 대응할 Node 스키마 변경이 없으므로 의미 없는 Node migration을 추가하지 않았다. 베트남 서버 포팅 시 API의 본문/메타데이터 버전 계약을 별도로 이식해야 한다.
- 각 서버 유지보수 503 확인 → D1 export → Ed25519 서명/외부 공개키 해시 pin 검증 → 격리 SQLite 복원 → integrity/FK 및 기존 모든 행 비교 → 실제 0059 적용/재실행 no-op → 원격 적용 → 적용 후 export와 전후 비교 → 서비스 재개 순서.
- 기존 업무 데이터와 Google/AI 설정 등은 테스트 **115개**, 가오픈 **114개** 전체 테이블에서 동일하게 유지됨. 두 DB의 원래 테이블 수 차이는 동기화하지 않았다.
- backup SQL은 비공개 운영 데이터이므로 Git/배포/소스 전달물에서 제외. 로컬 `artifacts/backups/cf114-*-20260907.*`에 보관.

| 검증 항목 | 테스트 | 가오픈 |
| --- | --- | --- |
| 적용 전 SQL SHA256 | 1e9ebeefcc1225978e8411dfb333bf6a5e2874783f1881aa7a3aeabc9f7521bd | c52e0dae6afd172ed331799f3155d812177f211b2f1e70265b6e29de30a99752 |
| 적용 후 SQL SHA256 | 3a964e3dde58a21ee27a67d45298decd378a60de5af4fa8a5190e4cf421b58db | ef94f9ddaac5ed7b62b384e27a0962468f13d1a3a1ce75d5efc589ff6122974c |
| 서명 공개키 SHA256 pin | cc55f884669ed11a64857e6a327f246ff8eecd959b03ad35fb95003450282320 | c80d745d4ade83c0b74204ce9ee21e3861590a50d25fcfc0721886691a0843d7 |
| 직전 Worker 버전 | 5a698dbf-c50b-4d9a-9363-04ffe63a9ed1 | ca006acc-e1c4-45ee-9f36-b4fc1cdad31e |

0059 SHA256: `8b8cfcb6897afc2e93915d95309436912710e6c95229814fbdc097347f85da5b`

복원/재검증 명령은 `scripts/cf114-backup-check.mjs`의 sign/verify/preflight/compare 사용. 원격 적용 명령은 `wrangler d1 migrations apply <정확한 DB명> --remote --config <해당 config>`이며 Node 업무 DB에 D1 SQL을 실행하지 않는다.

롤백 필요 시 새 쓰기를 막고 당시/현재 백업과 secret을 보존한 후 검증된 직전 Worker와 해당 DB 백업으로 복구한다. 운영 중 생긴 신규 데이터를 버리는 DB 복원을 임의로 실행하지 않는다. reverse SQL/DB reset/샘플 DB 덮어쓰기는 금지.

`--keep-vars`로 기존 환경값과 secret을 보존했다. 가오픈에만 존재하던 GEMINI_API_KEY는 기존 환경 차이이므로 삭제하거나 테스트 서버로 복제하지 않았다. strict secret-name parity는 이 차이를 포함하므로 일치했다고 주장하지 않는다.

## 검수 한계 / 별도 확인 항목

- 업무 계정의 로그인된 세션이 없어 실제 운영 레코드 저장·AI 제공자 호출·Drive 파일 전송은 이번에 실행하지 않았다. 로컬에서는 실제 UI/API 함수와 합성 데이터를 사용했고 라이브에서는 공개 응답, 인증 차단, 연결 상태, 배포 해시를 확인했다.
- native Microsoft Word·한컴 앱에서 최종 재열기와 HWP binary 변환은 미검증. 출력 DOCX/PDF는 기존 설계대로 페이지 이미지형이며 편집 가능한 원문/검색 가능한 PDF라고 주장하지 않는다.
- 나눌 수 없는 초대형 병합 셀/이미지 등은 자동 분할 대신 넘침 오류로 차단한다. 미지원 DOCX 기능은 원고 손실 대신 가져오기를 거부한다.
- 별도 회사 도메인 `https://claimcenterstudio.con-cost.co.kr`은 베트남 Node 서버 전달 문서의 도메인이다. 이번 두 Worker와 다른 이전 JS/CSS를 제공하며 2026-09-07 확인 시 `/api/health`, `/api/readiness`가 502였다. 이 서버의 파일·DB·DNS·인증 설정은 변경하지 않았다. 별도 서버 접근 및 운영 담당자 확인이 필요하다.
- 발견한 문제와 명시한 회귀 범위는 해결했으나 모든 입력·브라우저·외부 서비스에서 오류가 전혀 없다는 보증은 아니다.
