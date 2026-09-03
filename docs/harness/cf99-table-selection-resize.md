# CF99 — 표 선택·치수·실행 취소와 4장 A4 기본 배치

## 재현한 원인과 수정 경계

- 실제 CH04 6열 / CH09 5열의 미지정 colwidth에서 경계 클릭만으로 첫 열이 늘어났다. TableView가 DOM의 px와 이미 변환한 %를 다시 입력값으로 읽어 폭을 반복 증폭했다. Ctrl+Z가 JSON을 복원해도 colgroup의 잘못된 %는 남았다. 이제 표시 폭은 문서 노드에서만 계산한다.
- 셀 선택용 absolute 오버레이에 기준 셀이 없어 페이지 전체가 파랗게 덮였다. 셀을 relative로 제한하고 표·행·열 선택 버튼 및 표 안 Ctrl+A를 CellSelection에 연결했다. 텍스트 드래그는 기존 편집기 선택을 유지한다.
- 열 경계 드래그는 인접 열 합계를 보존하고, 축소 배율을 한 번만 환산한다. 전체 열 배열을 병합 셀 TableMap에 기록한다. 클릭·Esc는 변경하지 않고, 완료한 제스처 하나는 undo 한 단계다. 현재 좁은 열보다 큰 최소폭을 강요하지 않는다.
- 행 아래 경계는 안내선으로 조절한 뒤 rowHeightMm만 기록한다. 숫자 너비/높이 적용을 분리하고 자동 행높이도 즉시 적용한다. 내용이 잘리는 높이까지 줄이지는 않는다.
- v2의 명시적 좁은 열, 행높이, 정렬은 손상 복구 대상에서 제외한다. JSON/HTML 모두 rowspan 점유 열을 건너뛰며 colwidth 전체 배열을 보존한다.
- 표 문단에 유입된 본문용 최소높이·16px 하단 간격을 편집기/미리보기 공통으로 제거한다. 일반 보고서와 A4의 CSS 우선순위를 함께 검사한다.
- CH04 미지정 프로필 이미지 기본폭은 360px, 기본 표 여백은 4px/6px다. 사용자가 명시한 이미지 width와 compact/comfortable 설정은 유지한다. 최초 Markdown에도 normal 밀도를 부여해 첫 열기와 편집 후 배치가 같다.

API·DB·환경변수·내보내기 엔진·업무 데이터는 변경하지 않는다. 길이가 긴 실적 장은 기존 표 행 단위 페이지 나눔을 유지하며, 모든 고정 장을 무조건 한 페이지로 축소하지 않는다. 기존 좌우 편집 배율·배치와 직접작성/F4 기능을 보존한다.

## 자동 검수

```powershell
node node_modules/tsx/dist/cli.mjs --test --test-reporter=spec scripts/cf07-report-autosave-test.ts scripts/cf60-structured-document-editor-test.ts scripts/cf66-proposal-preview-parity-test.ts scripts/cf67-document-workflow-test.ts scripts/cf68-structured-output-normalization-test.ts scripts/cf69-final-document-export-test.ts scripts/cf91-proposal-workflow-portrait-test.ts scripts/cf93-proposal-a4-editor-parity-test.ts scripts/cf94-proposal-typography-table-stability-test.ts scripts/cf95-proposal-pagination-hwp-test.ts scripts/cf96-document-spacing-test.ts scripts/cf98-authoring-toolbar-test.ts scripts/cf99-table-selection-resize-test.ts
corepack pnpm cf:build
```

- 42/42 Node 계약 통과, 타입 검사/프로덕션 빌드 통과. 기존 큰 번들 경고는 유지한다.
- 로컬 `/qa/document-review.html` 왕복 검증 버튼: 기존19 + 실제 Editor/TableView/DOM 플러그인 CF99 10 = 29/29 통과.
- 새 계약은 75% 열 드래그·두 번 undo·행 조절·2x2 셀 서식·선택 오버레이·병합 셀 재열기·24px 열폭·읽기전용·최초 HTML 밀도를 포함한다. 합성 DOM 이벤트 계약과 실제 마우스 검증을 구분한다.
- 코드 검수에서 rowspan/colspan 3개 형태를 각5회 정규화, 열 최소폭9건/행 경계12건을 추가 확인했다. 레이아웃 정적 검사 0건, diff 공백 검사 통과.

## 실제 Chrome 검수

- CH04/CH09 경계 클릭만 할 때 JSON·DOM·undo 기록 불변.
- CH09 75%에서 24px 드래그: 첫 열 35.086→59.086, 인접 열117.211→93.211, 전체504px 유지. Ctrl+Z로 원본 치수와 DOM 복원.
- 빠른 연속 두 번 드래그를 각 Ctrl+Z 한 번씩 복원.
- CH04 행 드래그: 높이21.445→45.352 화면px, rowHeightMm16, 다른 행null 유지. Ctrl+Z로 완전 복원.
- 표 안 Ctrl+A는36셀만 선택. 14px 서식은 셀에만 적용되고 표 밖 본문·이미지는 보존.
- CH04 처음 열기/Markdown 재열기 모두1페이지. 이미지1개, 표6행, 마지막 문단 유지. 좌우 미리보기와 별도4단계 렌더러의 페이지 수·텍스트 일치.
- 콘솔 오류0. 기존 사용자 업무 탭은 새로고침/저장/편집하지 않았다.

스크린샷은 작업 출력 폴더의 `cf99-local/ch04-final-onepage.png`, `cf99-local/ch09-final-undo.png`에 보관한다. 테스트는 로컬 격리 양식에서 수행했고, 원본 업무 레코드 수정이나 HWP 파일 자체의 별도 검수는 이 변경 범위에 포함하지 않는다.
