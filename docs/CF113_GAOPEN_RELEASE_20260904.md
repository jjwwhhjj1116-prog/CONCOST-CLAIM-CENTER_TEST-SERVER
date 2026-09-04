# CF113 — 2026-09-04 가오픈 업데이트

## 배포 결과

- 사용자 요청: 테스트 서버의 최신 소스를 가오픈 서버에도 반영하고 금일 날짜의 업데이트 내역 팝업 표시.
- 소스 커밋: `b69e347` (CF111/112 소스 `70411d2` 및 그 이전 테스트 서버 개선사항 포함).
- 가오픈: https://concost-claim-center-preview.jjwwhhjj1116.workers.dev
  - 최종 Worker: `ca006acc-e1c4-45ee-9f36-b4fc1cdad31e`
  - 직전 Worker: `1afcbb47-8f86-4990-a0fb-5a5eda84db18` (2026-08-31)
  - 점검 모드 Worker: `b70f9eba-840d-4604-881c-03993423a0ba`
- 테스트: https://concost-claim-center-development.jjwwhhjj1116.workers.dev
  - 최종 Worker: `5a698dbf-c50b-4d9a-9363-04ffe63a9ed1`
- 두 서버 모두 `RELEASE_MAINTENANCE=0`, `/health`, `/readiness`, `/reports/studio` HTTP 200.
- 두 서버 `/readiness`의 `googleDriveConnected=true` 확인. 실제 Drive 업로드/AI 유료 호출/메일 발송은 이번 배포 검증에서 수행하지 않았다.

## 공지

- 날짜: **2026년 9월 4일**, 제목: **가오픈 업데이트 안내**.
- ‘이번 배포에 포함된 최근 개선사항’으로 누적 배포임을 명시했다. 과거 개발 내용을 모두 9월 4일에 개발한 것으로 표현하지 않는다.
- 보고서 AI 작성, A4 페이지/목차/머리글, 제안서 편집, 일정/PM/업무 UI, 회의록 Excel, Drive/명함 6개 그룹.
- 브라우저별·인증 사용자 ID별 한 번 자동 표시. 날짜/버전별 localStorage 키를 사용하고 저장소 차단 시에도 닫기 가능.
- 상단 **업데이트** 버튼으로 언제든 재열기. 권한별 업무 접근 규칙이나 실제 알림 읽음 기록을 변경하지 않는다.
- 업데이트 → 업무 알림 → 처음 사용 가이드 순서. 가이드를 이미 닫은 경우 업데이트 재열기로 다시 표시하지 않는다.
- native modal의 키보드 포커스 제어, Escape 닫기, 기존 버튼 포커스 복귀. PC 2열/모바일 1열, 본문만 스크롤.
- AI/Drive 연결 설정·권한 필요, 메일 화면은 준비 기능이며 실제 발송 아님, 제출 전 파일 확인 안내 포함.

## 운영 데이터 보존

테스트 DB를 가오픈 DB로 복사하지 않았다. 사용자 DB, 업로드 파일, 비밀키/OAuth master key/AI route를 교체하지 않았다.

- 가오픈 D1: `78094a1c-abe0-451d-bc12-68d0d37166d8`
- 테스트 D1: `16d1f25b-60c8-4489-95ed-4fa7de161c9f` (이번 작업에서는 migration 불필요)
- 가오픈 미적용 migration **0052~0058, 7개**만 기존 파일 그대로 적용.
- 0054는 기본 지침/프롬프트 패키지 갱신이다. 적용 전 실제 가오픈의 세트 6/6, 챕터 41/41, 지침 6/6이 0051까지 재현한 기본값과 일치하고 별도 커스텀 행이 없음을 독립 검증했다. 기존 챕터/지침의 현재 원문 history도 모두 일치했다.
- 0055는 활성 회원에 기존 이용 연속성을 위해 CLAIM_CENTER 부서와 version+1을 부여한다. 감사 테이블 재생성 전후 모든 기존 행·PK·값 보존을 확인했다.
- 0053의 client_name, 0057의 workspace ID 컬럼은 NULL 추가. credential 암호문 및 기존 설정은 전후 동일하다.

절차:

1. 사전 D1 export, 격리 메모리 SQLite에서 7개 migration을 순서대로 재현.
2. 가오픈 점검 모드 배포, `/health`, `/readiness`, `/api/auth/session` 모두 `503 RELEASE_MAINTENANCE` 확인.
3. 점검 중 최종 D1 export → Ed25519 서명 → 별도 공개키 pin으로 서명/해시/복원/migration checksum 검증.
4. 실제 데이터 복원 사본에서 재검증 후 가오픈에 0052~0058 적용.
5. 변경 후 D1 export와 사전 복원 결과를 비교. **기존 104개 테이블의 데이터 보존 규칙, 이력, PK, schema, credential, 업무본문 검증 통과**, 최종 114개 테이블.
6. migration으로 생성한 시각/이력 UUID만 예상 결과 비교에서 정규화. 모든 기존 history 행은 정규화 없이 별도로 전체값 대조.
7. migration runner의 두 번째 실행은 적용 원장에 따라 no-op임을 확인. SQL 파일 자체의 중복 실행을 허용한다는 의미가 아니다.
8. 양쪽 `migrations list`: **No migrations to apply**. 점검 해제 후 서비스 검증.

최종 백업(로컬 보관, Git/배포/전달 ZIP에 포함하지 않음):

- `artifacts/backups/cf113-gaopen-quiesced-20260904.sql`
- `artifacts/backups/cf113-gaopen-quiesced-20260904.manifest.json`
- SQL SHA256: `df1f13bf64aed9e8b34fe3682cc694458cbe983df997ba4375290a2fed8c6f17`
- 독립 기록 공개키 SHA256 pin: `a8b4527f7f6140623fe000b438531d8a39da5c48e7cacc07913aede8c9e4edc5`
- 변경 후 비교본: `artifacts/backups/cf113-gaopen-after-20260904.sql`
- 사전 백업과 점검 중 최종 백업의 SQL SHA256도 같아 검사 사이 데이터 변경 없음.

재검증 명령:

```powershell
node scripts/cf113-gaopen-backup-check.mjs verify artifacts/backups/cf113-gaopen-quiesced-20260904.sql artifacts/backups/cf113-gaopen-quiesced-20260904.manifest.json a8b4527f7f6140623fe000b438531d8a39da5c48e7cacc07913aede8c9e4edc5
node scripts/cf113-gaopen-backup-check.mjs preflight artifacts/backups/cf113-gaopen-quiesced-20260904.sql
node scripts/cf113-gaopen-backup-check.mjs compare artifacts/backups/cf113-gaopen-quiesced-20260904.sql artifacts/backups/cf113-gaopen-after-20260904.sql
```

복구가 필요한 경우 먼저 점검 모드로 새 쓰기를 막는다. 위 pin으로 최종 백업을 다시 검증하고 격리 복원본을 확인한 뒤, 승인된 복구 절차로 해당 DB snapshot과 직전 Worker를 함께 복구한다. 운영 DB 위로 SQL을 무작정 import하거나 reverse SQL을 적용하지 않는다. 이번 배포에서 복구 작업은 필요하지 않았다.

## 환경 검사 예외 — 비밀키는 동기화하지 않음

`cf-environment-parity.ts check-local`은 통과했다. `check-remote`는 **가오픈에만 기존 GEMINI_API_KEY 이름이 있는 차이** 때문에 실패한다. 이를 정상 통과로 보고하지 않는다. 테스트 서버에는 조직별 암호화 credential 방식이 있을 수 있으며, 소스 업데이트 요청이 기존 키 삭제/복사를 허가한 것은 아니다.

따라서 `sync`나 `secret bulk/delete`를 실행하지 않았다. 기존 가오픈 Gemini 키와 양쪽 master key 이름을 유지하고, 가오픈 전용 바인딩/redirect/필수 master key, 미적용 migration 0개, 자체 readiness와 credential/설정 데이터 보존을 별도 검증한 뒤 명시적 Wrangler 배포를 수행했다. `cf:deploy:gaopen`이 기본적으로 요구하는 두 환경 설정의 완전 동등성을 주장하지 않는다.

## 검수 증거

- 관련 회귀 **31/31 PASS**, skip 0 (신규 CF113 5개 포함).
- 공지 저장 헬퍼 실제 실행 10단언 PASS, 백업 helper 적대 합성 검사 10단언 PASS.
- `corepack pnpm cf:build` 타입 검사/프로덕션 빌드 PASS. 기존 대형 번들 경고는 남아 있음.
- 가오픈 Wrangler dry-run PASS, 올바른 별도 D1 바인딩 확인.
- Impeccable 레이아웃 검사 0건, diff whitespace 검사 PASS.
- 실제 AppShell을 사용하는 합성 API fixture: `apps/web/qa/cf113-release.html`.
  - PC 공지 960px, 모바일 390px viewport 공지 약 329px, 가로 넘침 0.
  - 날짜/6그룹, 닫기/Escape/포커스, 계정별 1회·다시보기, 알림·가이드 순차 표시 PASS.
- 실제 가오픈 로그인 후 UI 검수는 로그인 세션이 없어 수행하지 못했다. 로그인 화면과 배포된 자산은 별도 확인하며, 합성 fixture 결과를 실제 업무 기록 검수로 표현하지 않는다.

양쪽 서버가 모두 로컬 빌드와 동일한 SHA256으로 제공하는 파일:

| 파일 | SHA256 |
| --- | --- |
| `index-B30mPSRn.js` | `3f174825eb02ec3e7937389a88f7ad61fee539703bba2638c101e5cd3044d95a` |
| `index-BH2C6781.css` | `01411ffaa844b29fd955c32f4335af1a079cc414ca4982db359375591b7358f3` |
| `index.es-BaxMnr1V.js` | `32d8101f1281084e71031c3640263adb9e98ea7a826064993f2c6fa4c519eefd` |
