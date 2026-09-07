# CF117 — actual workflow verification and report save repair

요약: 보고서 최초 저장 실패를 실제 서버에서 재현해 원인을 수정했습니다.
테스트의 3단계·가오픈의 2단계 이동과 새로고침 후 v1 유지까지 직접 확인했습니다.
Word 첫 본문·Excel 문자·협업 반영 중 입력·참고용 목차 혼입을 보완했고,
일정 조회 실패와 회의록 입력을 분리했습니다. 기존 업무 데이터는 유지했습니다.

## Confirmed live defect (2026-09-07)

Both environments reject the initial empty report save. The test Worker log at
13:04:45 KST identifies `D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR`.
The hourly backup CHECK introduced in migration 0052 uses a 53-byte GLOB;
[Cloudflare D1 permits at most 50 bytes](https://developers.cloudflare.com/d1/platform/limits/).
The entire draft/revision/activity/backup batch rolls back. Default local SQLite
does not impose this small limit; the earlier successful local test was insufficient.

## Data-preserving migration and recovery plan (before execution)

New migration: `0061_cf117_hourly_backup_pattern.sql`. Applied migrations are unchanged.
The equivalent date and time checks use separate patterns under 50 bytes.
SQLite cannot ALTER a CHECK, so a replacement table is unavoidable.

1. Block application writes with RELEASE_MAINTENANCE=1, verify HTTP 503.
2. Export each exact D1 database, sign its full inventory/schema/migration checksum,
   independently verify the signature pin, retain the private export outside Git.
   Do not change credentials, master keys, environment secrets or application data.
3. Rehearse on an isolated populated restore. Verify no inbound foreign keys
   reference the backup table. Create the corrected replacement, copy every column
   and row, then replace only the old table structure within the runner transaction.
   Recreate the original index and immutable UPDATE/DELETE guards.
4. Verify every original value/PK/settings record, full schema, integrity/FKs,
   migration ledger and second-run no-op. A separate SQLite test sets the actual
   D1 pattern limit to 50 and uses populated immutable backups.
5. Run the actual remote migration runner, export again, compare with the exact
   rehearsal, then reopen the application and verify readiness/login/Drive/AI
   connection metadata and real authorized empty-draft navigation.

An archive retaining the original CHECK was rejected in rehearsal: it also breaks
global integrity_check under the D1 limit. Recovery uses the signed pre-migration
export and previous Worker, not ad-hoc reverse SQL. Stop writes first and account
for any subsequent business changes before restoring.

This table is Cloudflare Preview-specific; the Node/Prisma server has no
corresponding table or CHECK. No unrelated Node migration or Vietnam database
replacement is required.

## Additional bounded corrections

- Freeze review fields while applying a collaborator's chapter and exclude
  competing autosave/import operations, preventing newer input from being lost.
- Other claim-type templates remain reference-only during fallback outline creation.
- Preserve ordinary DOCX first paragraphs in the body instead of truncating them
  into a report title; only an explicit Word Title style is treated as a title.
- Decode XLSX numeric XML references once, preserving line breaks and Unicode
  without converting literal entity text twice.

- Word automatic numbering/bullets are explicitly rejected with conversion guidance
  rather than silently losing the numbers. This is not full Word numbering support.
- Calendar outages no longer prevent meeting/site record entry. Calendar-only retry
  preserves entered notes/dates; full record reload requires confirmation when dirty.

## Deployment and preservation results

- Test final version: `c3ad51e4-3665-4194-9109-e3e384ce5107`.
- Gaopen final version: `8e3e20d4-0b95-4c8c-a5fe-bd403bfa0331`.
- Same production build on both; health/readiness 200, Drive connected, anonymous
  finalized snapshot access 401, all JS/CSS SHA-256 values match the local build.
- September 7 release popup v4 adds the confirmed CF117 changes and preserves the
  cumulative August 31 onward update history.
- Maintenance was enabled and HTTP 503 verified before each fresh private export.
  Signed export validation passed, including full rows, schema, credentials/settings
  inventories and independent public-key pins. Keys/settings were not changed.
- Test 115 / gaopen 114 original tables: every existing row and column value
  matched after migration. Only the migration ledger gained 0061.
- Actual Wrangler runner succeeded on both populated isolated backup restores
  before remote execution. Both second executions reported no migrations to apply.
  The runner result SQLite files were opened read-only and compared against the exact
  signed source and rehearsed schema. FK/integrity checks passed.
- The first local SQL-file import stalled and was stopped; an unrelated empty local
  runner successfully initialized. Final populated rehearsal used a NEW direct SQLite
  restore in a separate local Wrangler state directory, then the actual CLI applied
  only 0061. No operational database file was overwritten.
- Live backups had zero hourly rows because the faulty CHECK rejected inserts;
  the separate limit-50 regression deliberately contains six complete synthetic
  backups, including rich JSON and the maximum body, and verifies preservation.

Private exports: `artifacts/backups/cf117-{development,gaopen}-{before,after}-20260907.sql`.
Before export manifests are retained beside them, never committed or included in assets.

| Checksum | Development | Gaopen |
| --- | --- | --- |
| Before SQL SHA256 | 8835219b585256374040509a8fda1bbb78197783265cd5958840dfdfa7608ec0 | b08b75c21ac11051f408d13fe84c6df8a08b32ecc5e88516973d15a271b617ce |
| Manifest public-key pin | 1ef164140dbb5b1246047607aaa098cd6bc727c57333aed285e5b821e0066d2f | db86d015df6b43517dd3e053f1b9c2f500ecca64bc88d152522ca8ce1fbec240 |

Migration SHA256: `0eb097e26143b51aa1bd9cea3ca9768dc94f5fe6b3cba7eede5d410259980f36`.

## Automated verification

The overlapping test batches contained 117 unique Node test/subtest entries plus
6 Python migration tests: 123 passed, no failures/skips. Commands:

```text
corepack pnpm cf:build
node node_modules/typescript/bin/tsc --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM apps/cloudflare/src/asset-modules.d.ts apps/cloudflare/src/index.ts
node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 scripts/cf103-minutes-export-test.ts scripts/cf106-minutes-layout-test.ts scripts/cf108-report-outline-sync-test.ts scripts/cf110-report-header-contacts-test.ts scripts/cf111-report-pagination-generation-test.ts scripts/cf114-output-test.ts scripts/cf115-workflow-import-parser-test.ts scripts/cf116-workflow-import-parser-test.ts scripts/cf114-report-save-test.ts scripts/cf39-integrated-project-workspace-test.ts scripts/cf11-project-workflow-test.ts scripts/cf114-editor-roundtrip-test.ts scripts/cf117-import-output-test.ts
node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 scripts/cf116-report-storage-test.ts scripts/cf116-report-navigation-test.ts scripts/cf115-workflow-ui-test.ts scripts/cf116-workflow-import-parser-test.ts scripts/cf115-evidence-import-test.ts scripts/cf115-intake-completeness-test.ts
node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 scripts/cf117-report-workflow-test.ts scripts/cf117-workflow-schedule-test.ts scripts/cf114-report-save-test.ts scripts/cf116-import-access-test.ts
python scripts/cf117-hourly-backup-test.py
node scripts/cf117-backup-check.mjs <sign|verify|preflight|compare> <DB-ID> <before.sql> <manifest|after.sql|runner.sqlite> <pin>
node scripts/cf114-live-smoke.mjs development gaopen
```

Isolated actual browser fixtures additionally preserved a 16-page document (13 with
header disabled), 28 table rows and explicit page breaks, and a 3-page output DOM
with merged cells, image, nested list starts, full text and no overflow. These are
DOM/pagination checks, not a fresh native Word/HWP rendering certification.
The existing large-bundle Vite warning remains.
After the final file-import menu lock/retry-selection hardening, the actual React
navigation/APPLY/type-fallback suite was repeated: 9/9 passed, followed by a new
production build and matching final assets on both environments.

## Actual user-path verification

- Test CC-2026-00003: 13:27:55 KST initial empty report save and Step3 navigation
  succeeded. Reload retained Step3, zero body characters, saved timestamp; saved
  workspace list confirmed version1. No outline or business body edits.
- Gaopen CC-2026-00012: 13:32:38 KST Step2 click saved the previously blocked
  empty draft. 13:32:54 showed Step2 and saved timestamp. Reload retained Step2
  and zero body characters; saved workspace list confirmed version1. No outline
  generation, confirmation, body edit or finalization was performed.

## Remaining verification boundary

The real WAV-to-Gemini end-to-end test remains unverified. The dedicated test
tab (CC-2026-00003) and 1,636,746-byte synthetic `cf115-meeting.wav` were prepared.
The normal browser file-selection button was clicked once, but no native file
dialog could be reliably identified. Windows capture repeatedly returned no
accessibility data and later an unrelated/desktop image instead of the intended
Chrome state, so input stopped. No file path was typed, no WAV upload was confirmed,
and no meeting Save/Confirm action was performed. The actual audio/transcription
success must not be inferred from MIME/byte/mock tests.

Existing actual XLSX/Gemini success evidence belongs to CF116 and is documented
there; it is not a new CF117 recording test. This release is not a claim that all
possible document formats or business operations are error-free.
