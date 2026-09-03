# CF104 — 자료실 접근권한·중복·최신본 관리

2026-09-03. 기준: 사용자가 제공한 `CODEX_CLAIM_STUDIO_DRIVE_SPEC.md`.

## 적용 범위와 상태

현재 화면이 사용하는 Cloudflare `/api/cases/:caseId/evidence`와 서버 다운로드 경로에 구현했다. 중앙 자료실의 13개 자료 구분, 착수회의·현장조사 자료 업로드, 회의록 자동작성 결과 보관, 보고서의 HWP·XLSX 원본 연결이 같은 업로드 절차를 사용한다.

**이 문서 작성 시 실제 Cloudflare 배포, D1/운영 SQLite migration, 회사 Drive 파일 변경은 실행하지 않았다.** 이전 배포 권한 요청이 거절된 상태이므로 명시적인 대상 서버 적용 승인이 필요하다. 기본 production Wrangler 설정으로 실행하지 않는다.

### 반영한 계약

- 로그인 세션 검증. 소관 부서 또는 프로젝트 배정 권한을 서버에서 확인하고, 권한 없는 요청은 403으로 거절한다. 로그인하지 않은 요청은 401이다.
- 현재 클레임센터 프로젝트의 기존 소관 부서 정책은 `CLAIM_CENTER`, `MANAGEMENT_SUPPORT`이며 관리자는 기존 권한을 유지한다. 타 부서 회원도 해당 프로젝트에 명시적으로 배정되어 있으면 접근한다. API와 D1 저장 트리거가 같은 정책을 사용한다.
- 직접 Google Drive 링크 대신 스튜디오 서버 다운로드만 노출한다. Drive 파일 ID·폴더 ID·OAuth 비밀정보는 응답에 포함하지 않는다.
- 동일 프로젝트·자료 구분의 전체 원본 SHA-256을 검사한다. 이전 버전도 중복 검사 대상이며 이름만 바꿔 다시 올려도 409 `DUPLICATE_EXACT`다. 이 단계에서는 Gemini와 Drive 업로드를 호출하지 않는다.
- 성공한 같은 idempotency key의 재요청은 기존 결과를 돌려준다. 새 파일로 다시 저장하지 않는다.
- 최근 활성 문서 최대 5개와 비교한다. 유사도 0.75 이상 또는 후속 버전이면 409 `VERSION_CONFLICT_CONFIRMATION`으로 변경 요약과 선택창을 보여준다. 사용자가 대체/별도 저장을 결정하기 전에는 파일을 저장하지 않는다.
- 서버 확인 토큰은 사용자·프로젝트·자료 구분·파일 지문·목록 snapshot에 묶이며 30분 후 만료된다. 목록이 바뀌면 다시 비교해야 한다. 브라우저가 전송한 임의의 버전 번호나 대체 파일 ID를 신뢰하지 않는다.
- 최신본은 `[FINAL_vN] 원본명`으로 Drive에 저장한다. 대체된 원본은 명세의 방법 2인 `[OLD_날짜] 원본명`으로 rename한다. 바이너리는 덮어쓰거나 삭제하지 않는다.
- 버전 상태는 별도 원장에 저장한다. 기존의 변경 불가 원본 레코드는 유지한다. 이전 버전은 ARCHIVE로 접고 언제든 스튜디오 다운로드로 확인한다. 새 독립 문서는 v1로 시작한다.
- 목록은 초록 FINAL / 회색 ARCHIVE, 버전·업로더·등록 시각, 접이식 변경 요약을 표시한다. 모달은 native dialog로 초점 이동·Esc·키보드 조작을 제공한다.
- 회의록/보고서 가져오기에서 동일 원본이 발견되면 새 저장은 하지 않되, 서버가 확인한 기존 원본을 재사용하여 AI 재작성·XLSX 다른 범위 발췌를 계속할 수 있다. 순수 자료실 업로드의 409 동작은 그대로 유지한다.

### 문서 분석과 외부 전송

- TXT/CSV/XLSX/DOCX/HWPX는 기존 파서·표준 압축 API를 재사용한다. 압축 해제 크기·항목 수·텍스트 길이를 제한한다. 추가 파서 라이브러리는 도입하지 않았다.
- PDF는 Gemini의 native PDF inline 입력을 사용한다. 로컬 PDF 텍스트 추출기를 구현한 것은 아니다. [공식 문서 처리 안내](https://ai.google.dev/gemini-api/docs/document-processing).
- 기존 회사 Gemini credential과 승인된 조직 모델 설정을 사용한다. `PAID_NO_PRODUCT_IMPROVEMENT` 또는 `VERTEX_AI_ENTERPRISE` 정책과 회사 기밀자료 처리 승인이 있어야 한다. 설정이 없으면 403/503으로 중단하며 임의의 공개·무료 경로로 대체하지 않는다.
- 비교 요청은 기존 문서와 새 문서를 포함해 총 바이너리 20MB, 개별 업로드 10MB, 텍스트당 100,000자 이내다. PDF 이외 텍스트는 기존 개인정보 마스킹 경로를 사용한다. PDF는 승인된 정책 아래 원본을 제공하므로 자동 개인정보 마스킹이 된다고 안내하면 안 된다.
- 결과는 JSON 필드 타입, 0~1 점수, 실제 비교 후보 ID, 최대 3줄 요약을 검증한다. 원본의 지시문은 명령이 아닌 비교 대상 데이터다. 분석 오류는 자동 저장 허용으로 전환하지 않는다.
- 지원하지 않는 바이너리(사진·녹음·구형 HWP 등)는 SHA 중복 검사 후 독립 v1로 저장한다. 내용 유사도 분석을 수행했다고 표시하지 않는다.

## 운영상 주의와 남은 범위

- `project_access`라는 중복 테이블 대신 기존 프로젝트 배정 테이블을 재사용했다. 임의 5명을 지정하는 별도 공유 관리 UI나 최대 5명 제한을 추가한 것은 아니다. 다른 부서 소관 프로젝트를 확장하려면 프로젝트 담당 부서 매핑 정책도 함께 확장해야 한다.
- Native Node `/documents` API는 로컬 저장을 사용하는 별도 실행 경로다. 이번 SQLite migration은 버전 원장 구조를 전달하기 위한 준비이며 **Node의 Drive 업로드·다운로드·AI 비교 API를 구현한 것은 아니다.** 베트남 서버에 동일 기능이 구현됐다고 공지하지 않는다.
- 중앙 자료실 밖의 명함/제안서·의뢰 보관 화면 및 기존 Node GoogleWorkspace 도구의 직접 Drive 링크는 이번 13개 자료 구분 작업에서 바꾸지 않았다. 앱 전체 Zero Direct Access를 달성했다고 공지하지 않는다.
- 기존 Google 링크/공유 ACL을 회수하거나 회사 Google 계정에 이미 있는 사람의 직접 접근을 제거하지 않는다. 해당 계정·공유 설정 변경은 별도 관리자 작업이다.
- 기존 최신본은 읽을 때 v1로 취급하며 원본 DB를 일괄 갱신하지 않는다. 기존 Drive 파일을 일괄 rename하지 않는다. 목록 조회의 기존 최근 200개 제한은 유지된다.
- 실제 Google/Gemini 서비스는 합성 응답으로 검증했다. 실제 파일로 비교 품질·Drive 저장 성공을 검증한 상태가 아니다. 모바일/좁은 viewport 검수는 수행하지 못했다.

## 실패 복구: 원본을 먼저 보존

자료 구분 단위 잠금을 원격 업로드 전에 획득한다. Drive 업로드가 시작된 이후 응답 유실, 이름 변경 실패, DB 저장 실패가 발생하면 추가 업로드를 차단하고 `RECONCILIATION_REQUIRED` 상태를 남긴다. 성공 응답을 받은 Google 파일 ID는 원장에 보존한다.

외부 실패에서 잠금을 시간 만료로 자동 해제하면 같은 파일을 재업로드할 위험이 있으므로 자동 해제하지 않는다. 관리자 확인 없이 파일이나 잠금을 삭제하지 않는다.

관리자 복구 시:

1. 서명 백업과 해당 프로젝트·자료 구분·operation ID·원격 파일 ID를 보존한다. 토큰/본문을 로그나 문의에 붙이지 않는다.
2. 관리자 서버 연결로 원격 파일의 존재, 크기·해시, 원본과 이전 파일을 대조한다. 업로드 응답 자체가 유실돼 ID가 없으면 예약된 operation provenance로 원격 상태를 확인한다. 새 업로드로 확인하지 않는다.
3. DB latest 상태와 Drive 이름이 다를 수 있다. rename은 성공했으나 DB가 실패했다면 이전 DB 최신본의 bytes는 남아 있고 이름만 OLD일 수 있다.
4. 별도 승인된 복구 작업으로 원격/DB 상태를 일치시킨 뒤 잠금을 해제한다. 이 변경에는 자동 재조정·삭제 UI를 추가하지 않았다.

## Migration·배포 절차

새 migration:

- D1: `apps/cloudflare/migrations/0058_cf104_evidence_versions.sql`
- Native SQLite: `packages/database/prisma/migrations/20260903160000_cf104_evidence_versions/migration.sql`

기존 migration 파일은 수정하지 않았다. 원본 파일, DocumentVersion, OAuth/AI credential 레코드를 재작성하지 않는다. 잠금/확인/버전 테이블이 없는 DB에서 신규 업로드는 503으로 차단하고 기존 자료는 읽을 수 있게 유지한다.

승인 후 적용 담당자는 AGENTS.md의 백업 절차를 먼저 이행한다:

1. 실제 대상 서버·기존 DB 절대 경로를 확인한다. 파일이 없으면 새 DB를 만들지 않고 중단한다.
2. 유지보수 모드로 신규 쓰기를 막고 관리자 서명 백업을 생성·검증한 뒤 API를 중지한다. DB, 업로드, Google vault, 암호화 키/환경변수 저장소를 함께 보존한다.
3. 검증된 백업을 격리 경로에 복원하고 실제 migration runner를 먼저 실행한다. 기존 PK·설정·파일 수, migration checksum, `integrity_check`, `foreign_key_check`를 전후 비교한다.
4. Native SQLite는 실제 기존 DB의 절대 `DATABASE_URL`을 지정한 뒤 `pnpm db:migrate`만 사용한다. `db:reset`, seed, 샘플 DB 덮어쓰기 금지. D1은 승인된 개발 DB의 백업·migration 운영 경로만 사용하며 production 기본 설정을 사용하지 않는다.
5. DB가 준비된 뒤 같은 커밋의 Worker/web 코드를 배포한다. 기존 OAuth credential, master key, 환경변수를 그대로 유지한다.
6. API 시작 후 `/readiness`, 로그인, 관리자 설정, Drive 연결, AI credential 메타데이터를 확인한다. 합성 파일로 중복/대체/이전 버전 다운로드를 점검한다.
7. 실패 시 임의 reverse SQL이 아니라 검증된 직전 백업과 이전 커밋으로 복구한다. 원격 파일에 수행된 rename/업로드는 DB 롤백만으로 되돌아가지 않으므로 위 재조정 절차를 따른다.

소스 전달물에는 실제 `dev.db`, `.env`, OAuth 토큰, API 키, master key, 검수용 DB를 넣지 않는다. 커밋 SHA는 전달 시 `git log -1 --format=%H -- docs/CF104_DRIVE_VERSIONING_HANDOFF.md`로 확인한다.

## 재현 검수

최종 로컬 결과: 아래 관련 테스트 58/58 통과, Prisma schema 검증·TypeScript 검사·production web 빌드 통과. 기존 대형 JS chunk 경고는 유지된다.

```powershell
node node_modules/tsx/dist/cli.mjs --test scripts/cf104-drive-versioning-test.ts scripts/cf104-sqlite-migration-test.ts scripts/cf104-upload-dialog-test.ts scripts/cf16-case-evidence-library-test.ts scripts/cf05-google-drive-test.ts scripts/cf76-drive-project-scope-test.ts scripts/cf85-drive-department-recovery-test.ts scripts/cf39-integrated-project-workspace-test.ts scripts/cf47-intake-source-test.ts
node packages/database/node_modules/prisma/build/index.js validate --schema packages/database/prisma/schema.prisma
corepack pnpm cf:build
git diff --check
```

CF104에는 권한·해시·확인 토큰·이력·Drive 실패·DB 실패·동시 업로드·안전한 파서·기존 SQLite 데이터 보존·중복 원본 재사용 검수가 포함된다. SQLite 검수는 실제 runner를 기존 조직/회원/프로젝트/문서 버전 데이터가 있는 격리 DB에서 실행하고, 두 번 실행해 동일성을 검사한다.

UI 합성 fixture: `apps/web/qa/cf104-evidence.html`. 실제 회사 API 대신 mock fetch만 사용한다. FINAL/ARCHIVE·대체/별도 저장·Esc·초점 복귀·잠금 해제·콘솔 오류를 Chrome에서 확인했다. 운영 경로 또는 회사 파일 검수와 혼동하지 않는다.
