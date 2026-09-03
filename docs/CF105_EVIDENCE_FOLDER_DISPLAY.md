# CF105 — 자료실 저장 폴더·업로더 표시

2026-09-03. CF104 후속 사용자 요청: 파일 목록에서 저장 폴더명과 업로더를 함께 확인.

## 변경

- 공통 CaseEvidencePanel을 폴더별 목록으로 표시한다. 폴더명·업로더·파일 수를 제목으로, 각 파일에도 업로더를 별도 줄로 표시한다. 최신본은 바로 보이고 이전 버전은 해당 폴더 안에서 펼친다.
- 자료실·착수회의·현장조사·물량산출·납품의 공통 패널에 적용한다. 파일명과 긴 폴더명은 줄바꿈하고 좁은 패널에서는 다운로드 버튼을 다음 행에 둔다.
- 권한 확인 후 서버가 기록된 저장 폴더의 현재 이름을 Drive에서 읽는다. 명명 규칙으로 이름을 추정하지 않는다. 프로젝트 appProperties와 원장에 기록된 폴더 ID의 교집합만 제공한다.
- 응답의 `folder`는 `{key, name}`이며 key는 프로젝트+폴더 ID의 SHA-256이다. Google ID·직접 Drive URL은 제공하지 않는다. 같은 이름의 다른 폴더 및 ARCHIVE만 남은 폴더를 보존한다.
- 조회는 OAuth token refresh부터 JSON 본문까지 동일한 6초 AbortSignal, 최대 3페이지(페이지당 최대 1,000폴더)로 제한한다. 부분 결과를 유지하며 미확인 이름은 `null`이다. UI는 '폴더명 확인 불가'와 재확인 버튼을 보여주되 기존 파일·업로더·다운로드는 유지한다.
- 업로드 응답의 폴더명은 실제 생성/재사용 반환값을 사용하며 기존 재요청도 같은 공개 투영 경로를 사용한다.

새 의존성·DB migration·데이터 재작성 없음. 기존 Google Drive 파일 이동·이름 변경·삭제·공유 권한 변경 없음. 외부에서 파일 자체를 다른 폴더로 이동한 경우의 추적은 포함하지 않으며, 원장에 기록된 **저장 폴더** 이름을 표시한다. 빈 폴더나 스튜디오 밖에서 추가한 파일을 탐색하는 Drive 전체 탐색기가 아니다. 기존 최근 200개 파일 조회 및 compact 최신 6개 제한은 유지한다.

## 검증

- 관련 Worker/API/문서 가져오기/업로드 대화상자/폴더 그룹 검사 62개 통과, 실제 SQLite 보존 검사 1개 통과(합계 63).
- Web TypeScript 검사·production build 통과. 기존 대형 JS chunk 경고 유지. 개발 설정 Worker dry-run bundle 통과.
- 내장 브라우저의 로컬 합성 fixture에서 데스크톱 1,280px / 좁은 화면 390px 검수. 동명 2폴더 분리, ARCHIVE-only 폴더 표시·펼침, 이름 조회 실패 안내, 긴 폴더명/파일명 줄바꿈 확인. 가로 넘침 없음, HTML 문자열의 이미지 DOM 생성 없음, 콘솔 오류/경고 없음. viewport는 검수 후 복원했다.
- 회사 파일로 업로드·교체·이동 테스트는 하지 않았다. Chrome 전문 검수 세션에 탭 소유권 오류가 있어 루트의 별도 초기 브라우저 연결로 로컬 UI를 검증했다. 실제 배포·인증된 화면 결과는 배포 후 별도 기록한다.

```powershell
node node_modules/tsx/dist/cli.mjs --test scripts/cf104-drive-versioning-test.ts scripts/cf105-evidence-folders-test.ts scripts/cf104-upload-dialog-test.ts scripts/cf16-case-evidence-library-test.ts scripts/cf05-google-drive-test.ts scripts/cf76-drive-project-scope-test.ts scripts/cf85-drive-department-recovery-test.ts scripts/cf39-integrated-project-workspace-test.ts scripts/cf47-intake-source-test.ts
node node_modules/tsx/dist/cli.mjs --test scripts/cf104-sqlite-migration-test.ts
corepack pnpm cf:build
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config wrangler.development.jsonc --outdir outputs/cf105/worker
```

폴더 조회는 [Google Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)의 필드 선택·페이지 토큰과 [프로젝트 appProperties 검색](https://developers.google.com/workspace/drive/api/guides/search-files)을 사용한다.
