# CF108 · 검수 중 목차 제목 수정

## 변경 범위

- 2단계에서 목차 제목 저장 시 이미 작성된 본문의 대응 챕터 제목도 저장한다.
- 4단계에 `목차 제목 수정` 선택·입력·저장 영역을 추가한다. 본문 재생성, 챕터 추가·삭제·순서 변경은 하지 않는다.
- 본문 JSON의 해당 heading 텍스트만 수정하고 attrs/marks 및 다른 노드를 보존한다. 저장용 content는 기존 편집기의 HTML→Markdown 정규화 경로를 사용한다.
- JSON 없는 Markdown/HTML 문서는 heading만 식별한다. 코드 블록·표 안의 제목·본문 문구는 제외한다. 챕터 코드 또는 유일한 기존 제목으로 식별할 수 없는 경우 자동으로 덮어쓰지 않고 안내한다.
- 원본 AI/MANUAL 마커를 유지한다. 협업 검수본 APPLY도 배정 당시 제목 대신 최신 저장 목차 제목을 사용한다.
- 보고서 선택 챕터 ID 검증에서 UUID뿐 아니라 기본 템플릿의 `PROMPT-TYPE-01-CH-01`도 허용한다. caseId UUID, PM/관리자 권한, 버전 충돌 검사는 변경하지 않는다.

## 저장 보호

- 목차·본문 API는 별도 요청이며 원자적 트랜잭션이 아니다. 목차 성공 후 본문 저장 실패 시 완료로 표시하지 않는다.
- 화면에 수정본을 유지하고 `본문 제목 저장 다시 시도`를 제공한다. 미완료 중 다음 단계 잠금·자동 저장 중지·화면 이탈 경고를 유지한다.
- 현재 문서/버전을 ref에서 읽어 같은 렌더의 연속 저장·탐색에서도 이전 본문을 저장하지 않는다.
- 목차 저장 중 편집·협업 반영을 잠그고 기존 파일 가져오기 잠금도 유지한다.
- JSON 렌더 실패는 목차 API 호출 전에 중단해 빈 본문 저장을 방지한다.
- 버전 충돌에서 최신본 불러오기는 기존 동작이며, 로컬 미저장 수정을 버릴 수 있으므로 사용자 선택이 필요하다.

## 검증

```powershell
node node_modules/tsx/dist/cli.mjs --test scripts/cf108-report-outline-sync-test.ts scripts/cf18-report-outline-evidence-test.ts scripts/cf29-report-memory-learning-test.ts scripts/cf67-document-workflow-test.ts scripts/cf68-structured-output-normalization-test.ts scripts/cf96-document-spacing-test.ts scripts/cf77-cf78-collaboration-business-card-test.ts scripts/cf107-workflow-report-layout-test.ts scripts/cf20-visual-hierarchy-test.ts
corepack pnpm cf:build
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config wrangler.development.jsonc --outdir outputs/cf108-worker
git diff --check
```

- 37/37 테스트 통과, 타입 검사·프로덕션 빌드·개발 Worker dry-run 통과. 기존 번들 크기 경고는 유지된다.
- 실제 Worker API + 격리 SQL.js DB에서 기본 템플릿 ID/UUID 저장, 잘못된 ID 400, 비담당 회원 403, 오래된 버전 409, 최신 목차 제목 협업 APPLY와 다른 본문 보존을 검증했다.
- 합성 브라우저 화면 `apps/web/qa/cf108-outline.html`은 실제 컴포넌트를 사용하며 모든 fetch를 합성 응답으로 처리한다. 저장은 이 검수 화면 전용 sessionStorage이며 업무 서버 요청으로 넘어가지 않는다. 프로덕션 빌드에 포함되지 않는다.
- 브라우저에서 4→2 제목 저장→4, 4단계 직접 저장, 저장 실패·재시도·다음 단계 잠금, 새로고침 후 제목 유지, 제목 서식·표·이미지 크기 보존을 확인했다.
- HTML 가져오기 고유 제목, 한 HTML 블록의 여러 제목, 링크·리터럴 특수문자·CRLF 본문·코드 블록 보존 검사 통과.
- 최종 비제목 노드 렌더 HTML 비교 동일. 합성 JSON의 생략된 기본값(textAlign 등)과 옛 속성 별칭은 기존 편집기의 정상 저장 경로에서 정규화되므로 직렬화 문자열 비교는 다를 수 있다. 실제 텍스트·이미지 src/240×120·표 열너비 180/220은 동일하다.
- 390px에서 새 제목 입력 영역이 세로 배치되고 가로 넘침 없음. 읽기 전용 역할의 제목 수정/저장과 본문 편집은 비활성.
- 스크린샷 연결 오류로 최종 검수는 DOM 실측으로 확인했다. 브라우저에서 개발 서버 주소 연결이 실패하여 로그인된 실제 업무 화면은 확인하지 못했다.
- 기존 CF18 화면 문구 단언과 CF67 이탈 경고 단언을 현재 요구사항에 맞게 갱신했다.

## 배포 범위

개발 환경 `wrangler.development.jsonc` / `concost-claim-center-development`만 대상으로 한다. DB migration·회사 데이터 변경·운영 서버 배포는 없다. 로그인된 실제 업무 레코드 저장과 합성 화면 검수는 구분한다.

## 개발 서버 배포 결과 · 2026-09-04

- 기능 소스 커밋 `50d70a3`, 추가 검수 기록 `2ed6468`, 개발 전용 원격 `test-server/fix/CF73-workflow-minutes-parity`에 푸시.
- Worker 버전 `4c2957d0-d62e-4c3e-852d-85bc8c09ec85`.
- URL: https://concost-claim-center-development.jjwwhhjj1116.workers.dev/reports/studio
- `/health` 200 `ok`, `/readiness` 200 `ready`, 보고서 경로 200 확인.
- 배포 HTML이 새 `index-Dg14gh88.js`를 참조한다. 해당 JS, `index.es-BFSfMzUf.js`, `index-zwz1EwQc.css`의 SHA-256이 검증한 로컬 빌드와 일치한다.
- 브라우저 도구의 DNS 오류와 별개로 배포 후 HTTP 상태·자산 검증은 성공했다. 로그인된 실제 업무 레코드 편집 검수는 하지 않았다.
