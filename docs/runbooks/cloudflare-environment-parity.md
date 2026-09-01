# Cloudflare 테스트·가오픈 환경 동기화

## 원칙

- `.env` 원문, API key, OAuth client secret, refresh token, 암호화 master key는 Git에 커밋하거나 로그에 출력하지 않는다.
- 테스트와 가오픈은 Worker와 D1을 분리한다. `name`, `database_id`, `GOOGLE_OAUTH_REDIRECT_ORIGIN`은 서로 달라야 한다.
- 나머지 공통 일반 환경값과 Worker secret 이름은 같아야 한다.
- Worker 진입점, compatibility date, placement, asset routing, observability, migration 경로도 같아야 한다.
- 관리자 화면에서 저장한 AI·Google OAuth 값은 각 D1에 AES-256-GCM 암호문으로 보관되며 `.env`가 아니다. D1 암호문을 다른 서버로 복사하지 않는다.
- 가오픈 배포는 사용자의 명시적 지시가 있을 때만 수행한다.

## 한 번만 준비할 공통 secret 원본

1. `.env.cloudflare.shared.example`을 `.env.cloudflare.shared.local`로 복사한다.
2. 실제 API/OAuth 값을 `.local` 파일에 한 번 입력한다. 이 파일은 `.gitignore`에 포함되어 있다.
3. 값에는 두 환경에서 정말 공유할 서버 전용 secret만 넣는다. redirect origin과 D1 ID는 넣지 않는다.

암호화 master key는 routine bulk sync 대상이 아니다. 현재 저장된 D1 암호문은 기존 master key로만 복호화되므로, 별도 재암호화 migration 없이 `GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY` 또는 `AI_CREDENTIAL_MASTER_KEY`를 덮어쓰지 않는다.

Cloudflare에 저장된 Worker secret은 원문을 다시 내려받을 수 없다. 따라서 기존 테스트 Worker/D1의 암호문에서 `.env` 파일을 재생성하지 않는다. 공통 원본이 없다면 각 공급자 콘솔의 현재 키를 이 파일에 한 번만 입력하거나 새 키를 발급해 두 환경을 동시에 교체한다.

## 검사

로컬 구성 계약만 검사:

```powershell
npm run cf:env:check
```

Cloudflare 원격 secret 이름과 두 D1의 미적용 migration까지 검사:

```powershell
npm run cf:env:check:remote
```

검사는 secret 값을 읽지 않는다. 다음 중 하나라도 발견하면 실패한다.

- 필수 secret 누락
- 한 Worker에만 존재하는 공통 secret 이름
- 공통 일반 환경값 불일치
- redirect origin 또는 D1 미분리
- 테스트/가오픈 D1의 미적용 migration
- AI route, 조직 credential 존재 상태, Anthropic Workspace 존재 상태, OAuth/Drive 연결 상태 차이

## 동기화

평소 테스트 서버에만 동기화:

```powershell
npm run cf:env:sync:test -- --file .env.cloudflare.shared.local
```

사용자가 가오픈 반영을 명시한 배포일에만 두 Worker 동시 동기화:

```powershell
npm run cf:env:sync:both -- --file .env.cloudflare.shared.local
```

`wrangler secret bulk`는 Worker별 새 버전을 즉시 배포한다. 따라서 가오픈 동기화 명령은 일반 테스트 수정 중 실행하지 않는다. 공통 파일에서 빠진 routine secret은 stale 값을 남기지 않도록 두 Worker에서 함께 제거되지만, 암호화 master key는 삭제·교체하지 않는다.

## D1 관리자 설정

테스트 관리자 화면에 저장한 OpenAI·Claude·Gemini 키와 Workspace ID, Google OAuth 앱/refresh token은 테스트 D1 설정이다. 이는 소스 배포로 사라지지 않지만 가오픈 D1로 자동 복사되지도 않는다.

공통 Worker secret fallback을 사용하면 AI 공급자 키는 두 환경에서 같은 원본을 사용할 수 있다. Google Drive OAuth 연결은 redirect URI와 refresh token이 환경별이므로 가오픈에서 최초 1회 별도 연결한다. 이후 소스 업데이트에서는 가오픈 D1과 master key를 유지하면 연결이 보존된다.

## 배포 명령의 안전 기본값

`cf:dev`, `cf:upload`, `cf:deploy`, `cf:d1:migrate:local`, `cf:d1:migrate:remote`는 모두 테스트 설정을 기본으로 사용한다. 가오픈은 이름에 `:gaopen`이 명시된 명령만 대상으로 하며, `cf:deploy:gaopen`은 원격 parity 검사를 통과하지 못하면 배포하지 않는다.
