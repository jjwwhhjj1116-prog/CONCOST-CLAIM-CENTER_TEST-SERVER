# CF116 — 회의록 자동정리 실패 / 보고서 단계 이동 오류 안내

## 범위와 실제 원인

2026-09-07 수정. CF115 이후 사용자 재신고 두 건만 다룬다. 기존 문서·회사의 계정/비밀 키·프로젝트 배정은 변경하지 않는다.

### 회의록 자동정리

- 가오픈 CC-2026-00015의 `회의록_AI자동작성_테스트.xlsx` v1 (16.8KB)을 자료실의 AI 회의록 작성으로 다시 실행하여 재현했다. 파일 업로드 자체는 성공했으며, 실패 원본을 재업로드하거나 교체하지 않았다.
- 11:45:35 KST 요청의 Wrangler tail: `D1_ERROR: workflow AI import is outside approved data policy`, SQL constraint trigger, CPU 14ms. CPU 초과가 아니었다.
- 앱의 `accessiblePreviewCase`는 관리자 또는 명시적으로 배정된 사용자를 허용한다. 그러나 migration 0032의 AI 처리 이력 INSERT guard는 관리자도 반드시 프로젝트에 직접 배정되어야 한다고 검사했다. 해당 프로젝트의 활성 관리자 두 명 모두 직접 배정 0이었다.
- 회사 유료/비학습 승인 설정은 정상이다. 새 migration 0060은 현재 접근 정책과 guard를 맞춘다. INTERNAL/CONFIDENTIAL/RESTRICTED 외부 AI 처리의 승인 조건은 유지하며, 외부 전송이 없는 `LOCAL_STRUCTURED_FALLBACK`만 정확히 구분한다. 미배정 일반 사용자·비활성 관리자·삭제 프로젝트·다른 조직 접근은 계속 차단한다.
- AI 이력 DB 오류도 JSON 오류 코드로 응답한다. 제공자 오류 코드는 감사 기록에 보존하되 본문/키/원시 제공자 응답은 기록하지 않는다.
- 빈 후속업무 배열, 유효한 HH:mm:ss, 한국어 요일을 포함한 날짜를 처리한다. 빈 AI 본문은 실제 양식 본문 또는 음성 전사로 복구하며, 전체 청취 불가/빈 양식/셀 주소 덤프를 정상 회의록으로 만들지 않는다.
- 실제 재검수에서 추가 발견한 컨코스트/거래처 참석자 혼합 및 고정 양식 안내의 메모 혼입도 보완했다. 회사 양식의 두 참석자 표제와 본문을 인식한 경우 양식 필드·참석자·날짜·본문은 원문 추출값을 사용한다. 빈 작성자/부서에 기본값을 다시 넣지 않는다. AI 분석에는 해당 기본 정보와 실제 본문만 전달하고, 원문 전체는 별도로 보존한다. AI가 올바른 원본 필드를 재작성하거나 고정 안내를 회의 후속업무로 해석하지 않게 한다.
- 원문에 없는 '기한: 즉시'가 생성된 사례를 추가로 발견했다. 기한 표제에 붙은 일부 상대 기한은 원문에 같은 표현이 없으면 '확인 필요'로 표시하며 원문/본문 자체는 바꾸지 않는다. 이는 제한적인 문자 일치 안전장치다. 모든 날짜·맥락의 사실 검증은 아니며, 복합 기한을 일부만 잘라 바꾸지 않는다. 작성자(author) 등 알려진 누락 필드도 한국어 이름으로 표시한다.

### 보고서 단계 이동

- Step2 표시상 '열림'과 별개로 이동 전 canonical draft 저장이 필요하다. 저장 실패 문구가 Step2/4 안에만 있어 Step1에서 원인을 볼 수 없었다.
- 초기 INSERT의 모든 DB 예외가 409로 변환되던 코드를 수정했다. 실제 경쟁 저장이 존재할 때만 409, 저장소/제약 오류는 503 `REPORT_STORAGE_FAILED`로 구분한다.
- 저장 오류는 공통 상단에 표시한다. AUTO 반복 요청을 멈추고 명시적 재시도만 허용한다. 일반 판례/기능 오류와 저장 오류를 분리했다. 입력 본문, expectedVersion, 미저장 경고와 저장 후 이동 원칙은 유지한다.
- CC-2026-00012 실제 DB에는 초안이 없었고, 기존 백업의 격리 사본에서 동일한 초기 저장은 성공했다. **사용자의 최초 실패 원인까지 확정된 것은 아니다.** 실제 단계 이동은 빈 초안 저장을 수반하므로 추가 허용을 요청했다. 허용 전 사용자 서버의 초안/단계는 조작하지 않는다.

## 배포

동일 빌드와 Worker 소스를 양쪽에 반영했다. `/health`, `/readiness` 200, 회사 Drive 연결 유지, 익명 확정 문서 401, 원격 JS/CSS와 로컬 빌드 SHA 일치.

- 테스트: `https://concost-claim-center-development.jjwwhhjj1116.workers.dev`
  - version `8e7e9d1d-6cf1-4c94-85f2-caaed004b246`
- 가오픈: `https://concost-claim-center-preview.jjwwhhjj1116.workers.dev`
  - version `0983a66f-c20f-4591-acaa-c2c78d30f3a5`
- 9월 7일 업데이트 팝업 v3에 추가 수정 사항을 기록했다. 기존 8월 31일 이후 누적 안내는 유지한다.

## 데이터 보존과 migration

신규: `apps/cloudflare/migrations/0060_cf116_workflow_import_access_guard.sql`

- 기존 migration을 수정하지 않았으며 테이블·행·컬럼 삭제나 프로젝트 자동 배정은 없다. Cloudflare 전용 `preview_workflow_ai_imports` trigger만 교체한다. Node/Prisma에는 해당 테이블/trigger가 없어 대응 스키마 변경이 없으며, 무의미한 Node migration은 추가하지 않았다. 베트남 Node 서버는 이번 배포 대상이 아니다.
- 각 서버 RELEASE_MAINTENANCE=1 및 503 확인 → D1 export → Ed25519 서명과 독립 pin 검증 → 로컬 격리 복원 → migration 실행 및 재실행 no-op → 원격 Wrangler migration → 적용 후 export → 기존 모든 행·전체 schema·migration 원장 대조 → RELEASE_MAINTENANCE=0 순서.
- 테스트 115개, 가오픈 114개 테이블의 기존 모든 값/PK/설정이 동일했다. 새 migration 원장 행만 추가됐다. integrity 정상, FK 위반 0. credential vault 및 암호화 키 설정을 수정하지 않았다.
- 로컬 Wrangler D1 emulator는 권한 재시도 후에도 시작 단계에서 진행되지 않아 중단했다. populated backup의 SQL 적용/보존/재실행 검증은 Node SQLite 격리 사본에서 수행했다. **로컬 Wrangler populated-clone 검증을 통과했다고 주장하지 않는다.** 원격 적용은 실제 Wrangler runner로 수행했다.
- 백업은 `artifacts/backups/cf116-{development,gaopen}-{before,after}-20260907.sql`, 서명은 각 before manifest. 비공개 자료로 Git/배포/소스 전달물에서 제외한다.
- migration SHA256: `5a5b87e91250043128895a12afd797269267ae24ba4d70407f61d5b66ba7f16a`
- 테스트 backup SHA256: `4a3eafea0ff2debcd2aacab8001dbfd5572ca3b41d96b400ae0ba74756641737`, public-key pin: `c1a55cd906c603fd38176c5f17561d0dac818e500ea2837727f5cb0fa83e9120`
- 가오픈 backup SHA256: `208629688a3e9ab68a7566aff7b40b5213ebbc0b13ac6d72493c9c175fd95f6e`, public-key pin: `1dd1baf0af766997dfd52d7b96e7df9a5b14448f63a8a6942cce638b694defc9`
- 백업 검사: `node scripts/cf114-backup-check.mjs <sign|verify|preflight|compare> <DB-ID> <before.sql> <manifest|after.sql|unused> <pin|unused> 0060_cf116_workflow_import_access_guard.sql`
- 롤백 시 임의 reverse SQL/DB 교체를 하지 않는다. 유지보수 모드에서 서명 검증된 해당 서버 백업과 직전 Worker 버전을 사용하며, 업데이트 이후 자료 유무를 먼저 확인한다.

## 검증과 남은 제한

- 실제 React/headless Chrome 저장 오류/재시도/타이핑 유지/409/일반 오류/잘못된 성공 응답 검사.
- 실제 Worker + 전체 migration SQLite: 빈 보고서 최초 저장/시간별 백업/Step2 재진입, 마지막 INSERT 실패 시 전체 rollback, 스키마 오류와 경합 구분, 원인 제거 후 재시도.
- migration 권한·승인 매트릭스와 NULL 우회 방어, 기존 이력 보존.
- 문서 추출 및 양식 parser, 전체 원문 경계값, PDF/PNG/WAV native 바이트·MIME 전달, 실패/타임아웃/잘못된 응답 시 기존 업무 보존.
- Web 및 Worker 타입 검사와 production build 통과. 기존 큰 JS chunk 경고는 남아 있다.
- 최종 10개 스크립트를 test-concurrency=1로 실행하여 77/77 통과했다. 최초 병렬 실행에서는 workflow UI 초기 표시가 15초 안에 뜨지 않아 69/70이었다. 동일 코드의 직렬 전체 실행은 해당 UI 8개를 포함하여 통과했으며 병렬 실행까지 무조건 통과했다고 주장하지 않는다.
- 테스트 서버 12:05 KST 기존 XLSX의 실제 Gemini 자동정리와 양식 반영 확인. 셀 주소 덤프 없음. 업무 저장/파일 추가/교체 0회.
- 가오픈 12:07 KST 동일 실패 원본의 Gemini 성공 및 DB `SUCCEEDED` 기록 확인. source SHA256 `3bffeeff73051a997125e4d3cfc72062cb83b34355f6e4b8efee6300dcac369b`가 로컬 원본과 일치한다. 이때 발견한 위의 참석자/고정 안내 오류까지 추가 보완 후 재배포했다.
- 가오픈 12:18 KST 같은 v1 재검수: 날짜 2026-08-21 14:00–15:30, 내부 참석자 '실무총괄 1명, 담당 1명', 거래처 '조합장, 총무이사, 조합 직원 1명', 원문 본문 B17:B30 14줄/526자 반영. 작성자/소속 등 실제 빈 필드는 빈 값 유지. '거래처 명함은 PDF파일로 업로드'는 회의 메모에 없고 고정 양식 안내에만 있다. 마지막 3개 업무와 미확정 금액/월도 보존됐다. 여기서 발견한 원문 없는 즉시 기한 및 영문 누락 필드 표기를 마지막 배포에 추가 반영했다.
- 최종 배포 후 가오픈 12:31:51 동일 v1 실제 Gemini 재분석, 12:32:48 완료 UI 확인. 526자·14줄/마지막 3항목/참석자 구분/날짜·시간/공란 모두 유지. 셀 주소 덤프, 메모·요약·후속업무 내 양식 안내, 영어 필드 경고가 없었다. 기한은 모두 '확인 필요'이며 '기한: 즉시'가 없었다. '아직 업무 기록은 저장하지 않았습니다' 상태로 결과만 검수했다. 업무 저장·확정·파일 추가/교체·실보고서 단계 저장은 0회다.
- 실제 녹음 자료는 해당 자료실에 0건이다. Windows 파일 선택 도구는 URL 확인 안전 문제로 중단되어 우회하지 않았다. 합성 WAV의 코드 경로 검사는 통과했으나 **실제 Gemini 음성 인식 성공은 아직 미검증**이다.

## 주요 실행 명령

```text
corepack pnpm cf:build
node node_modules/typescript/bin/tsc --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM apps/cloudflare/src/asset-modules.d.ts apps/cloudflare/src/index.ts
node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 scripts/cf116-import-access-test.ts scripts/cf116-workflow-import-parser-test.ts scripts/cf116-report-navigation-test.ts scripts/cf116-report-storage-test.ts scripts/cf115-workflow-import-parser-test.ts scripts/cf115-evidence-import-test.ts scripts/cf115-workflow-ui-test.ts scripts/cf115-intake-completeness-test.ts scripts/cf39-integrated-project-workspace-test.ts scripts/cf114-report-save-test.ts
node scripts/cf114-live-smoke.mjs development gaopen
```
