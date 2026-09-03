# CF100 — 이미지 8방향 조절과 저장·미리보기 치수 일치

## 재현과 수정 경계

- CH04 기본 프로필은 `img:not([width])` 규칙으로 360px였다. 설치된 Tiptap Image가 resize-managed width/height DOM 속성을 생략해, 드래그 뒤에도 이 기본폭 규칙이 남았다. 75% 화면에서 가로 24px 이동 후 style은392px인데 실제폭은360px로 막혔다.
- 미리보기의 `height:auto`/`object-fit:contain`이 저장한 높이를 무시했다. JSON width/height, 편집 DOM의 속성·px 스타일, HTML/Markdown, 본문·우측·최종 미리보기를 같은 치수로 연결했다. 명시한 높이는 이미지 전체를 해당 높이로 표시한다.
- native node view의 update는 undo/F4로 바뀐 치수를 DOM에 적용하지 않았다. 공개 onUpdate/onResize/onCommit을 보완하고, 드래그 완료만 하나의 undo transaction으로 기록한다. 클릭·Esc는 저장하지 않는다.
- 기존 native resize를 재사용한다. 4모서리와 4변 중앙에서 총8방향을 지원하며, 축소 배율을 환산한다. 기본은 자유 축 조절, Shift는 비율 유지다. 측면 조절은 조작하지 않은 기존 축을 제한값으로 강제 변경하지 않는다.
- 신규 조절은 가로 최소80px/본문 최대폭, 세로40~680px 범위다. 기존에 저장된 범위 밖 치수는 불러오기만으로 바꾸지 않는다. 가로·세로 숫자 입력과 Enter 적용을 제공한다. 이미지 크기 마우스 작업도 F4 마지막 작업에 기록한다.
- HTML의 width/height 속성과 px 스타일이 섞인 기존 자료도 보존한다. HTML 정규화는 누락 축의 기존 스타일을 삭제하지 않으며, native undo에서는 누락된 치수를 제거해 기본값으로 복원한다.
- 검수 중 같은 src의 이미지2개를 넣으면 제안서 미리보기에서1개가 사라지는 기존 URL 중복 제거를 발견했다. 중복 제거는 회사 기본 이미지 자동 구성에만 남기고, 담당자가 작성한 JSON/최종 Markdown의 이미지 개수·순서를 보존한다.

CF99 표 선택/열·행 조절 코드는 변경하지 않는다. 기존 책 형태의 좌우 배치, A4 양식, 내보내기 엔진, API·DB·사용자 업무 데이터는 변경하지 않는다. 외부 라이브러리는 추가하지 않는다.

## 검증 명령과 fixture

```powershell
node node_modules/tsx/dist/cli.mjs --test --test-reporter=spec scripts/cf07-report-autosave-test.ts scripts/cf60-structured-document-editor-test.ts scripts/cf66-proposal-preview-parity-test.ts scripts/cf67-document-workflow-test.ts scripts/cf68-structured-output-normalization-test.ts scripts/cf69-final-document-export-test.ts scripts/cf91-proposal-workflow-portrait-test.ts scripts/cf93-proposal-a4-editor-parity-test.ts scripts/cf94-proposal-typography-table-stability-test.ts scripts/cf95-proposal-pagination-hwp-test.ts scripts/cf96-document-spacing-test.ts scripts/cf98-authoring-toolbar-test.ts scripts/cf99-table-selection-resize-test.ts scripts/cf100-image-resize-test.ts
corepack pnpm cf:build
```

로컬 `/qa/document-review.html`은 업무 데이터와 연결하지 않은 Vite 전용 검증 화면이다.

- `왕복 검증 실행`: 기존 빈 줄·서식·표29개 계약.
- `이미지 검증 실행`: 실제 native node view에 DOM 마우스 이벤트를 전달하는25개 계약. 100%/70% 모든 방향, 한 드래그=undo1회, undo/redo DOM+JSON 복원, CH04 무치수 기본값, 클릭/Esc 불변, 연속 undo, Shift, 최소/최대, 5회왕복, 비조작 축 보존, 혼합 HTML 치수, 읽기전용을 검사한다.
- image.decode 대기 중 StarterKit이 자동 마지막 문단을 추가해 테스트 초기 undo가 오염되지 않도록 fixture 시작값에 마지막 빈 문단을 포함한다. 초기 자동 문단과 실제 사용자 드래그 기록을 혼동하지 않는다.
- `이미지 2개 검증`: 동일 원본의 두 이미지에 마우스·숫자 작업 후 실제 React F4, 우측/본문/4단계 미리보기 개수·치수를 검증한다.
- `4장 실제 공통 양식`, `9장 실제 공통 양식`: 첫 CH04 1페이지 유지와 기존 표 편집 회귀를 확인한다.

실제 브라우저 조작과 합성 DOM 계약 결과는 구분해서 기록한다. 테스트에는 사용자 업무 레코드 편집, 기존 작업 탭 새로고침, HWP 네이티브 뷰어 재검수를 포함하지 않는다.

## 최종 검수 결과

- Node46/46, 이미지 DOM25/25, 기존 DOM29/29 통과. 타입 검사·프로덕션 빌드·diff 검사 통과. 큰 번들 경고는 기존과 동일하다.
- 75% 실제 CH04 가로 핸들24px 이동: 360→392px, 높이290px 유지. 편집·미리보기 실제294×217.5px 일치. Ctrl+Z로 무치수 기본 이미지 복원.
- 75% 실제 세로 핸들24px 이동: 360×180→360×212. 다른 이미지에 F4 적용 후 동일 치수. 숫자420×230+Enter와 F4도 두 이미지에 적용되고 Ctrl+Z/redo로 복원.
- 100% 실제 모서리24/40px 이동: 360×180→384×220. 강제 비율 없이 두 축 변경, 편집·미리보기 실제384×219.984px 일치.
- 동일 원본2개420×230이 JSON/Markdown 재열기, 본문/우측/4단계/보고서에 모두2개 유지된다. CF66 검증식도 최종 호출의 자동 자산 구성 비활성화를 명시적으로 요구하도록 강화했다.
- CH04 기본360px 사진·6행 인력표·1페이지 유지. CH09 실제75% 열 드래그/undo 후 원본 치수·DOM 복원. 콘솔 오류0.
- Shift·70% 8방향·5회 왕복은 자동 DOM 계약으로 검증했다. 실제 키를 누른 채 Shift 마우스 조작을 별도 시행했다고 주장하지 않는다.
- 세 전문 읽기 전용 검수 결과의 미해결 차단 문제0. 총괄이 화면 증거를 직접 확인했다.

증거: 작업 출력 폴더 `outputs/cf100-local/two-images-md-final.png`, `outputs/cf100-local/ch04-default-final.png`. 최초 재현은 `outputs/cf100-baseline/ch04-resize-mismatch.png`.

## 개발 배포

테스트 원격 `test-server`, 브랜치 `fix/CF73-workflow-minutes-parity`만 사용한다. 빌드 결과를 `wrangler.development.jsonc`의 `concost-claim-center-development`에 배포한다. DB migration/seed/환경변수 변경은 없다.

배포 뒤 새 읽기 전용 탭과 HTTP 응답에서 최신 asset을 확인한다. 사용 중인 편집창은 자동저장 완료 후 사용자가 새로고침한다.
