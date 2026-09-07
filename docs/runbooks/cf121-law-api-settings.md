# CF121 국가법령정보 판례 API 관리자 설정

## 사용자 경로

설정 → 관리자 설정 → 국가법령정보 · 판례 API 연결. 승인받은 OC 인증값을 저장한 후 `저장된 인증값 연결 확인`을 누른다. 입력 중인 값이 있으면 연결 확인을 실행하지 않는다. 오류와 성공 안내는 해당 입력란 바로 아래에 표시한다.

Google 로그인과 Claude/Gemini 키는 이 연결에 사용하지 않는다. 테스트와 가오픈은 별도의 DB이므로 각각 등록해야 한다. 승인 전에는 공개 판례 검색 링크만 사용 가능하며, UI 구현/배포를 API 승인·실제 연결 성공으로 간주하지 않는다.

## 저장·권한 경계

- 관리자만 `/api/settings/law-api` GET/PUT, `/api/settings/law-api/test` POST 사용 가능.
- 기존 서버 master key와 AES-GCM 함수를 재사용하되 OC 전용 AAD로 암호화. 응답에는 원문 대신 저장 여부·버전만 반환한다.
- D1 설정 우선, 설정 행이 없을 때 기존 LAW_API_OC 환경변수 사용. 저장값 복호화 실패 시 환경변수로 우회하지 않는다.
- PUT 및 연결 확인 모두 expectedVersion을 검사한다. 확인 중 다른 관리자가 값을 바꾸면 이전 결과를 성공으로 표시하지 않는다.
- 연결 확인은 공개 검색어 `공사`로 실제 공식 판례 후보가 반환되는지 검사하며 보고서·선택 판례를 저장하지 않는다.

## 배포 및 보존

새 migration: `apps/cloudflare/migrations/0062_cf121_law_api_settings.sql`. OC 전용 테이블과 보호 트리거만 추가하며 기존 행, AI/Google 설정 및 master key는 변경하지 않는다.

Cloudflare 두 서버만 이번 구현·배포 대상이다. 베트남 Node 서버 코드는 변경하지 않았다. Node에는 `20260827090000_server_settings_adapter`의 generic ServerSetting 암호화 저장소가 이미 있으므로 같은 기능을 이식할 때 해당 저장소를 재사용한다. 이번 D1 전용 테이블을 Node에 복제하거나 기존 dev.db를 교체하지 않는다. Node 기능은 이번 릴리스에 구현되지 않았다.

배포 전 두 Worker의 현 배포 버전을 기록한다. Worker의 기존 RELEASE_MAINTENANCE=1로 업무 쓰기를 차단한 후 각 D1을 별도 SQL 파일로 export한다. `scripts/cf117-backup-check.mjs`의 sign/verify/preflight에 해당 DB ID 및 새 migration 파일명을 명시해 서명·복원·전후 무결성·기존 모든 값 보존·2회 실행 no-op을 확인한다. 운영 비밀 원문은 export/출력하지 않으며 기존 secret 및 외부 Drive 파일은 유지한다.

그 다음 정확히 새 migration 하나만 적용하고 유지보수 상태에서 다시 export하여 compare로 검증한다. 정상 확인 후 RELEASE_MAINTENANCE=0으로 배포하여 health/readiness, 관리자 경로 인증 차단, 자산 일치 및 Drive 연결 상태를 확인한다. 실패 시 유지보수를 유지하고 직전 코드 버전과 검증된 백업으로 복구하며 reverse SQL을 임의 실행하지 않는다. 새 테이블이 비어 있음을 확인하고 실제 OC는 사용자가 직접 등록한다.

백업·인증값·로그인 토큰·master key는 Git/전달 ZIP에 포함하지 않는다.

## 2026-09-07 배포 검수 기록

- 관련 API·권한·설정 회귀 18개와 데스크톱/모바일 UI 계약 8개 통과. Worker 타입 검사 및 프로덕션 빌드 통과.
- 두 서버의 서명 백업 복원본에 실제 Wrangler migration runner로 0062만 적용했다. 기존 모든 값·스키마 비교 및 무결성 검증 통과, 실제 runner 두 번째 실행은 변경 없음.
- 테스트 서버: 배포 후 export와 기존 백업을 비교하여 기존 115개 테이블의 모든 값 보존 확인.
- 가오픈 서버: 배포 후 전체 DB 재반출은 보안 검토에서 차단되었다. 대신 서버 측 읽기 전용 집계로 기존 114개 테이블의 행 수와 version 합계 보존, 새 OC 테이블 0행을 확인했다. 가오픈 배포 후 전체 값 체크섬 비교까지 수행한 것으로 간주하지 않는다.
- 두 서버 모두 점검 해제 후 health/readiness 200, 기존 Google Drive 연결 상태 유지, 비로그인 설정 API 401, 배포 JS/CSS SHA-256 일치 확인.
- 실제 승인된 OC는 아직 입력하지 않았다. 관리자 로그인 상태의 실제 OC 저장·공식 응답 검수는 사용자 등록 후 확인 대상이다. 현재 UI 저장·연결 테스트는 격리된 테스트 환경에서 검증했다.
- 공개 버전: 테스트 `f95b1730-7cd3-4083-86ea-6e6e64ca0cca`, 가오픈 `342b68dc-02ff-4909-bf43-34422f389566`.
- 설정 URL: 테스트 `https://concost-claim-center-development.jjwwhhjj1116.workers.dev/settings?section=admin`, 가오픈 `https://concost-claim-center-preview.jjwwhhjj1116.workers.dev/settings?section=admin`.
