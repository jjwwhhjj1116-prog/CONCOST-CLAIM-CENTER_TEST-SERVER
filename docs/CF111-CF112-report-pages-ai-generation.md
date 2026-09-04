# CF111 / CF112 — Report pages and AI draft actions

## Scope

- Report preview now renders fixed landscape A4 sheets (1123 × 794), with page gaps and page numbers. The same sheets are supplied to final-document export.
- Continuous editor remains unchanged, with an explicit guide to the paginated preview. Saved body, table/image presentation and optional header settings are preserved.
- Added `챕터별 자동작성(권장)` and `전체 한 번에 작성`. Whole-report action uses the existing chapter endpoint sequentially for unwritten chapters; it does not request an entire long report in a single model response.
- Every chapter is merged into the structured document and saved before the next request. Intermediate failure stops generation and preserves saved chapters; re-running the whole action skips those chapters.
- Draft save pending no longer silently disables generation: the action saves first. Permission, outline, key and active-job conditions remain enforced with explanations beside the actions.
- Config refresh does not reload or overwrite the current draft. No API, database schema, credentials or production business data were changed.

## Verification

- `corepack pnpm cf:build`: PASS; existing bundle-size advisory only.
- Independent combined regression: 87/87 PASS, no skips. Includes provider mock, credential, role, outline, backup, contact archive, document and output contracts.
- New merge guards reject mismatched, duplicated and nested generation markers; unrelated structured nodes and document attributes remain unchanged.
- Browser synthetic pagination: 16 body pages with header; 13 without; exact original content preserved, 28 table data rows, manual break respected. All sheets 1123 × 794 at fit / 75% / 100%; no page-count change from zoom.
- Independent headless layout: seven cases (long formatted paragraph, long list item, reversed list, rowspan, nested table, oversized image, manual page break) passed. Oversized images stay present but block clipped export.
- Browser AI fixtures: two-chapter whole run, second-chapter 502 then resume, post-generation save 503, missing-key explanation; existing paragraph/table/image preserved. No external model calls.
- Desktop chapter/legal panels are equal 531px columns; mobile stacks without application-wide horizontal overflow.
- Impeccable layout-only source scan found no new findings. Existing visual system and navigation/approval gating retained.
- Development Worker dry-run: PASS, development D1 binding only. Initial sandbox log-write warning was resolved by the approved dry-run.

## Explicit limits

- Live `/reports/studio` reached the login screen. The user's authenticated config and actual provider response have not been verified; login was requested.
- DOCX/PDF/HWP capture now consumes the same fitted-page elements after image/font refit. A new authenticated final file was not downloaded in this session.
- New UI page labels are preview-only; the existing printed footer retains physical page numbers (cover is page 1).
- Pagination refuses oversized indivisible rows/images instead of shrinking reviewed content or silently clipping it.

## Deployment

Development-only target: `concost-claim-center-development`, config `wrangler.development.jsonc`. No migration required.

- Source: `70411d2`, pushed to `test-server/fix/CF73-workflow-minutes-parity`.
- Worker version: `c441f140-0a0a-4363-a6c7-3e8cc0f6c6ea`.
- `/health`, `/readiness`, `/reports/studio`: HTTP 200.
- Public JS `index-DO_hhDrD.js`, `index.es-B69yvL1s.js` and CSS `index-FmMz0pmV.css`: HTTP 200 and SHA-256 matches local build.
- `RELEASE_MAINTENANCE=0`; no migration, credential change or live project write performed.
- URL: https://concost-claim-center-development.jjwwhhjj1116.workers.dev/reports/studio
