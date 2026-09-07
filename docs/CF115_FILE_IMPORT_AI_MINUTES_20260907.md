# CF115 파일 가져오기·AI 회의록 연계 검수

기준일: 2026-09-07. 대상은 Cloudflare 개발 Worker와 가오픈 Worker이다. 기존 업무 기록, 수주 상태, ERP 연결, API 키 값과 Drive 인증 정보는 교체하지 않는다.

## 확인한 원인

1. 원본 업로드 전에 실행하는 AI 버전 비교가 정책/연결 오류로 실패하면 가져오기 전체가 막혔다.
2. 가져오기와 자동정리가 분리되어 파일을 선택해도 양식과 정리본이 채워지지 않았다.
3. XLSX·DOCX·HWPX를 텍스트로 추출하지 않고 Gemini에 원본 바이너리로 넘겼다.
4. AI 응답 계약에 회사 회의록 필드가 없었고, 저장 API가 가져온 정리본을 원문과 함께 저장하지 않았다.
5. 로컬 대체 처리가 첫 12줄을 AI 요약처럼 표시하고 긴 원문·시트·항목을 무통보로 잘랐다.
6. 기존 정리본이 새 가져오기 결과보다 먼저 표시되거나, 늦은 응답이 다른 프로젝트 입력에 적용될 위험이 있었다.
7. JSON이 파싱되면 출력 한도로 중단된 AI 응답도 성공으로 취급했다.
8. 요약 생성 중 다른 담당자가 같은 밀리초에 원문을 저장하면, 버전·시각 대조만으로는 건너뛴 쓰기를 성공으로 오인하고 완료 이력을 남길 수 있었다. 실제 수정 행 수와 트랜잭션 내 이벤트 조건으로 차단했다.

## 반영 범위

- 착수회의·현장조사 공통: 파일 선택 → 원본 보관 → AI 분석 → 양식·본문·논의/결정/후속업무 반영. 최종 업무 기록은 담당자가 확인한 뒤 저장한다.
- AI 결과와 원문을 동일한 버전 검증으로 함께 저장하고 재진입 시 복원한다. 원문을 편집하면 이전 AI 정리본을 자동 재사용하지 않는다.
- 녹음·이미지·스캔 PDF는 Gemini의 네이티브 입력으로, Office 문서는 검증된 텍스트 추출로 처리한다.
- 자료실의 회의·조사 자료에는 해당 기록의 AI 작성 진입 버튼을 연결했다. 다른 프로젝트의 파일을 잘못 연결하는 경우를 검사한다.
- 실패한 단계 재시도, 진행 중 프로젝트/입력 잠금, 미저장 이동 확인, 늦은 응답 중단을 적용했다.
- AI가 확인 필요 항목을 내부 필드 키로 반환해도 알려진 항목은 한국어 양식 이름으로 표시한다.
- 미확인 날짜는 이전 기록/오늘 날짜로 채우지 않고 입력을 요구한다. 원문에 없는 담당자·기한·금액은 만들어내지 않도록 지시하고 확인 항목을 표시한다.
- 비교 서비스 불가 시에만 사용자 동의를 받아 기존 파일을 보존한 별도 v1 자료로 저장한다. SHA 중복·교체 확인·권한·잠금은 유지한다.
- 저장 원문 자동정리도 동일한 회사 승인 정책과 실제 AI 호출을 사용한다. 로컬 추출은 AI 미실행으로 명확히 구분한다.
- 2026년 9월 7일 업데이트 안내에 이번 수정 내용을 추가하고 계정별 새 안내 버전을 표시한다.

## 형식과 한계

| 입력 | 처리 |
| --- | --- |
| TXT·CSV·XLSX·DOCX·HWPX | 서버 텍스트 추출 후 AI 정리 |
| PNG·JPG·WEBP | 이미지 읽기/OCR |
| PDF | 텍스트·이미지/스캔 내용 읽기 |
| MP3·M4A·WAV·OGG·WEBM | 음성 전사와 정리 |
| 구형 HWP·DOC·XLS | 원본 보관 가능, 자동정리 전 지원 형식으로 변환 안내 |

원본 파일 10MB, 회의·조사 원문 50,000자, 요약 30,000자, 후속 항목 20개/항목 상세 1,200자 한계를 초과하면 명시적으로 거절한다. 추출기 자체의 시트/셀/문자 제한도 무통보 절삭을 하지 않는다. 날짜 일련번호의 기준 체계가 확인되지 않으면 날짜를 추측하지 않는다.

AI 출력 중단(MAX_TOKENS·SAFETY·RECITATION 등)은 구문상 정상 JSON이어도 실패로 처리한다. 실제 음성/OCR의 정확도를 자동 보장하지 않으며 담당자의 원문 대조가 필요하다.

## 승인과 데이터 보존

- 사용자가 유료 결제·회사 자료 전송 승인을 확인하고 설정 반영을 허용했다.
- 두 Worker 관리자 화면에서 유료·비학습 정책과 회사 자료 전송 허용을 저장했다.
- 두 서버의 기존 조직 공용 Gemini 키 연결 검사가 HEALTHY였다. 가오픈 첫 검사 형식 오류는 재검사에서 정상 응답했다.
- 새 키를 읽거나 복사하지 않았다. 원격 환경 이름 비교에서 GEMINI_API_KEY secret 이름 차이가 남아 있으며, 두 DB의 조직 키는 각각 정상 동작하므로 비밀값을 동기화하지 않는다.
- 새 migration 없음. DB 덮어쓰기·seed·수주 확정·ERP 전송·업무 기록 수정 없음.
- 코드 배포는 기존 서버별 변수/비밀값을 유지한다. 베트남 별도 Node 서버와 DNS는 이번 대상이 아니다.

## 재현 검수

실제 XLSX 생성/재추출, 회사 양식 12개 필드, 끝 원문 보존, 허용 MIME/바이너리 전달, 잘못된 AI 결과, 정책 차단, 저장/재시작, 버전 충돌, 생성 중 동시 편집, 실제 React 편집/미리보기 경로를 검증한다.

최종 통합 회귀검사 90/90 통과, 웹·Worker TypeScript 검사와 배포 빌드 통과. 반복 검사에서 드러난 동일 밀리초 경합은 시간을 고정한 재현 검사로 수정 후 재검증했다. 빌드의 기존 대형 청크 경고는 남아 있다.

```powershell
node node_modules/tsx/dist/cli.mjs --test scripts/cf11-project-workflow-test.ts scripts/cf39-integrated-project-workspace-test.ts scripts/cf47-intake-source-test.ts scripts/cf73-workflow-minutes-parity-test.ts scripts/cf80-company-minutes-accessible-type-test.ts scripts/cf102-workflow-usability-test.ts scripts/cf104-drive-versioning-test.ts scripts/cf104-sqlite-migration-test.ts scripts/cf104-upload-dialog-test.ts scripts/cf115-evidence-import-test.ts scripts/cf115-intake-completeness-test.ts scripts/cf115-workflow-import-parser-test.ts scripts/cf115-workflow-ui-test.ts
node node_modules/typescript/bin/tsc --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM apps/cloudflare/src/asset-modules.d.ts apps/cloudflare/src/index.ts
corepack pnpm cf:build
node scripts/cf114-live-smoke.mjs development gaopen
```

브라우저 합성 fixture는 scripts/cf115-import-browser-fixture.* 이며 production 진입점에 포함하지 않는다. 합성 테스트 미디어는 scripts/cf115-create-test-media.py 및 cf115-create-test-audio.ps1로 재생성할 수 있다. 실제 OCR/전사 정확도 검증과 mock API 계약 검증은 구분해서 기록한다.

## 배포 및 라이브 확인

개발 Worker 최종 배포: `e9b9208c-3716-4cf1-b87e-1d8f1a89e765`.

사용자가 합성 검수 원본 추가를 허용했지만 OS 파일 선택창 접근 문제로 실제 추가는 0건이다. 사용자의 파일 선택 요청은 취소하고 기존 회사 회의록을 자료실에서 불러오는 경로로 실서버 검수를 진행했다. 실제 OCR·음성 전사는 완료한 것으로 보고하지 않는다. 기존 업무 기록 저장·확정 및 파일 교체는 수행하지 않았다.

가오픈 Worker 최종 배포: `e42a4651-84e1-4a74-9cda-6a540b15725c`.

양쪽 `/health`·`/readiness` 200, Drive 연결 ready, 익명 보호 문서 접근 401을 확인했다. 두 서버의 모든 JS·CSS 배포 파일은 최종 로컬 빌드와 SHA-256이 일치한다. 주요 앱 파일은 `index-DORYj8kQ.js` / `4f14ccaf02630f2f62da1310ffdbb9280dbff72b1e11df949144ae16869cb6a3`이다.

실제 자료실의 기존 `착수회의_회의록_2026-09-03.xlsx`(v1/7.7KB)를 `AI 회의록 작성`으로 불러와 서버 권한 다운로드 → 실제 Gemini 분석 → 착수회의 입력·미리보기 반영을 확인했다. `원본 보관 완료`, `Gemini 자동정리 완료`, `아직 업무 기록은 저장하지 않았습니다` 안내를 확인했다.

서버 처리 이력에서도 해당 파일의 `KICKOFF / SUCCEEDED / error_code=null`(2026-09-07T02:06:47.070Z)을 읽기 전용 조회로 교차 확인했다. API 키·본문은 조회하지 않았다.

- 회의명·일시·작성자·소속·장소·참석자를 자동 입력했다. 제목은 단순 서식 제목인 `회 의 록`이 아닌 실제 안건이었다.
- 메모 117자에 시트·셀 주소가 섞이지 않았고, 우측 회사 양식 본문 348자에 실제 정리 결과가 표시됐다. 제목과 첨부파일명이 일치했다.
- 직급·거래처명·종료시간 등 문서에 없는 값은 빈칸, 참조부서는 `모든 부서`였다. 과거 `저장된 회의 원문 미리보기` 안내는 없었다.
- 실서버에서는 저장·확정·새 파일 추가·교체를 모두 수행하지 않았다. 저장 후 재열기와 충돌 동작은 격리된 API·실제 React 브라우저 회귀검사에서 검증했다.
- 기존 XLSX의 실서버 AI 분석 성공과 PDF·PNG·WAV의 전송 계약 검사 성공은 별개의 증거다. 실제 스캔 OCR·음성 전사 정확도는 추가 검수가 필요하다.
