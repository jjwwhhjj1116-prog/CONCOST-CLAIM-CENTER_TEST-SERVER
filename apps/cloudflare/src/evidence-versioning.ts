import { GoogleDriveError, sha256Hex } from './google-drive';

interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface EvidenceDatabase { prepare(sql: string): Statement }
export interface EvidenceRecord {
  id: string; category: string; originalName: string; mimeType: string; byteSize: number;
  sha256: string; chunkCount: number; storageProvider: string; uploadedBy: string;
  uploadedAt: string; googleFileId?: string; googleFolderId?: string;
  requestFingerprint?: string; idempotencyKey?: string;
  versionNumber?: number; isLatest?: boolean; groupId?: string; changeSummary?: string[];
}
export interface VersionAnalysis {
  existing_file_id: string; similarity_score: number; is_subsequent_version: boolean;
  change_summary: string[]; recommendation: 'REPLACE_AS_LATEST' | 'KEEP_AS_NEW_SEPARATE';
}

export function parseVersionAnalysis(value: unknown, candidateIds: string[]): VersionAnalysis {
  const v = value as VersionAnalysis | null;
  if (!v || !candidateIds.includes(v.existing_file_id) || typeof v.similarity_score !== 'number'
    || !Number.isFinite(v.similarity_score) || v.similarity_score < 0 || v.similarity_score > 1
    || typeof v.is_subsequent_version !== 'boolean' || !Array.isArray(v.change_summary)
    || v.change_summary.length > 3 || v.change_summary.some((s) => typeof s !== 'string' || s.length > 500)
    || !['REPLACE_AS_LATEST', 'KEEP_AS_NEW_SEPARATE'].includes(v.recommendation)) {
    throw new GoogleDriveError('INVALID_VERSION_ANALYSIS', 502, '문서 비교 결과를 확인하지 못했습니다. 다시 시도해 주세요.');
  }
  return v;
}

export function evidenceDisplayName(file: EvidenceRecord): string {
  return file.isLatest === false ? `[OLD] ${file.originalName}` : `[FINAL_v${file.versionNumber ?? 1}] ${file.originalName}`;
}

export async function evidenceVersions(db: EvidenceDatabase, caseId: string, files: EvidenceRecord[], strict = false): Promise<EvidenceRecord[]> {
  // Older read-only databases stay readable; new uploads require the migration.
  const rows = await db.prepare('SELECT evidence_id AS id,group_id AS groupId,version_num AS versionNumber,is_latest AS isLatest,change_summary_json AS summary FROM preview_evidence_versions WHERE organization_id=? AND case_id=?')
    .bind('concost', caseId).all<{ id: string; groupId: string; versionNumber: number; isLatest: number; summary: string }>().catch((error) => { if (strict || !/no such table.*preview_evidence_versions/iu.test(String(error))) throw error; return { results: [] }; });
  const byId = new Map(rows.results.map((row) => [row.id, row]));
  return files.map((file) => {
    const row = byId.get(file.id);
    return { ...file, groupId: row?.groupId ?? file.id, versionNumber: Number(row?.versionNumber ?? 1), isLatest: row ? row.isLatest === 1 : true, changeSummary: row ? JSON.parse(row.summary) as string[] : [] };
  });
}

export async function categoryEvidence(db: EvidenceDatabase, caseId: string, category: string): Promise<EvidenceRecord[]> {
  const select = 'id,workflow_category AS category,original_name AS originalName,mime_type AS mimeType,byte_size AS byteSize,sha256,uploaded_by_name AS uploadedBy,uploaded_at AS uploadedAt,idempotency_key AS idempotencyKey,request_fingerprint AS requestFingerprint';
  const local = await db.prepare(`SELECT ${select},chunk_count AS chunkCount,storage_provider AS storageProvider FROM preview_case_evidence WHERE organization_id=? AND case_id=? AND workflow_category=?`).bind('concost', caseId, category).all<EvidenceRecord>();
  const google = await db.prepare(`SELECT ${select},0 AS chunkCount,'GOOGLE_DRIVE' AS storageProvider,google_file_id AS googleFileId,google_folder_id AS googleFolderId FROM preview_google_case_evidence WHERE organization_id=? AND case_id=? AND workflow_category=?`).bind('concost', caseId, category).all<EvidenceRecord>();
  return evidenceVersions(db, caseId, [...local.results, ...google.results].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || a.id.localeCompare(b.id)), true);
}

export function duplicateEvidenceResponse(file: EvidenceRecord): Response {
  return Response.json({ status: 'DUPLICATE_EXACT', code: 'DUPLICATE_EXACT', error: '이미 등록된 파일과 100% 일치합니다.', message: '이미 등록된 파일과 100% 일치합니다.', existing_file: { id: file.id, name: file.originalName, uploader: file.uploadedBy, created_at: file.uploadedAt }, file: { id: file.id, originalName: file.originalName, storageProvider: file.storageProvider, driveUrl: null, downloadUrl: `/api/cases/evidence/${file.id}/download` } }, { status: 409 });
}

export interface EvidenceVersionPlan {
  lockId: string; caseId: string; category: string; base: EvidenceRecord | null;
  versionNumber: number; summary: string[]; modelCode: string; reviewId: string | null;
  externalWriteStarted: boolean; committed: boolean;
}

export async function prepareEvidenceVersion(input: {
  db: EvidenceDatabase; caseId: string; category: string; userId: string;
  sha256: string; fingerprint: string; form: FormData; fileName: string;
  analyze: (candidates: EvidenceRecord[]) => Promise<{ analysis: VersionAnalysis; modelCode: string }>;
}): Promise<{ response?: Response; plan?: EvidenceVersionPlan }> {
  const { db, caseId, category, userId } = input;
  try { await db.prepare('SELECT id FROM preview_evidence_upload_reviews LIMIT 0').all(); }
  catch { throw new GoogleDriveError('EVIDENCE_SCHEMA_UPGRADE_REQUIRED', 503, '자료실 버전 관리 마이그레이션이 필요합니다. 관리자에게 알려 주세요.'); }
  const files = await categoryEvidence(db, caseId, category);
  const duplicate = files.find((file) => file.sha256 === input.sha256);
  if (duplicate) return { response: duplicateEvidenceResponse(duplicate) };
  const snapshot = await sha256Hex(files.filter((f) => f.isLatest).map((f) => `${f.id}:${f.sha256}`).sort().join('|'));
  const reviewId = input.form.get('reviewId');
  const choice = input.form.get('versionChoice');
  let base: EvidenceRecord | null = null;
  let summary: string[] = [];
  let modelCode = '';
  if (reviewId || choice) {
    if (typeof reviewId !== 'string' || !['REPLACE_AS_LATEST', 'KEEP_AS_NEW_SEPARATE'].includes(String(choice))) throw new GoogleDriveError('INVALID_VERSION_CHOICE', 400, '최신본 또는 별도 저장을 다시 선택해 주세요.');
    const review = await db.prepare('SELECT base_id AS baseId,snapshot_hash AS snapshot,analysis_json AS analysis,model_code AS modelCode FROM preview_evidence_upload_reviews WHERE id=? AND organization_id=? AND case_id=? AND category=? AND user_id=? AND fingerprint=? AND expires_at>? AND consumed_at IS NULL')
      .bind(reviewId, 'concost', caseId, category, userId, input.fingerprint, new Date().toISOString()).first<{ baseId: string; snapshot: string; analysis: string; modelCode: string }>();
    if (!review || review.snapshot !== snapshot) throw new GoogleDriveError('VERSION_REVIEW_STALE', 409, '파일 목록이 변경되었거나 확인 시간이 지났습니다. 파일을 다시 올려 비교해 주세요.');
    const analysis = parseVersionAnalysis(JSON.parse(review.analysis), files.filter((f) => f.isLatest).map((f) => f.id));
    base = choice === 'REPLACE_AS_LATEST' ? files.find((f) => f.id === review.baseId) ?? null : null;
    summary = analysis.change_summary; modelCode = review.modelCode;
  } else {
    const supported = /\.(pdf|hwpx|docx|xlsx|txt|csv)$/iu;
    // ponytail: compare the five latest active documents; add search indexing if a category outgrows this review window.
    const candidates = supported.test(input.fileName) ? files.filter((f) => f.isLatest && supported.test(f.originalName)).slice(0, 5) : [];
    if (candidates.length) {
      const result = await input.analyze(candidates);
      const analysis = parseVersionAnalysis(result.analysis, candidates.map((f) => f.id));
      summary = analysis.change_summary; modelCode = result.modelCode;
      if (analysis.similarity_score >= 0.75 || analysis.is_subsequent_version) {
        const id = crypto.randomUUID();
        await db.prepare('INSERT INTO preview_evidence_upload_reviews(id,organization_id,case_id,category,user_id,fingerprint,base_id,snapshot_hash,analysis_json,model_code,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
          .bind(id, 'concost', caseId, category, userId, input.fingerprint, analysis.existing_file_id, snapshot, JSON.stringify(analysis), modelCode, new Date(Date.now() + 30 * 60_000).toISOString()).run();
        const existing = candidates.find((f) => f.id === analysis.existing_file_id)!;
        return { response: Response.json({ status: 'VERSION_CONFLICT_CONFIRMATION', code: 'VERSION_CONFLICT_CONFIRMATION', reviewId: id, analysis, existing_file: { id: existing.id, name: existing.originalName, uploader: existing.uploadedBy, created_at: existing.uploadedAt, version: existing.versionNumber }, nextVersion: (existing.versionNumber ?? 1) + 1 }, { status: 409 }) };
      }
    }
  }
  const lockId = crypto.randomUUID();
  const reservation = await db.prepare('INSERT OR IGNORE INTO preview_evidence_upload_locks(organization_id,case_id,category,id,user_id,created_at) VALUES(?,?,?,?,?,?)').bind('concost', caseId, category, lockId, userId, new Date().toISOString()).run();
  if (reservation.meta?.changes !== 1) throw new GoogleDriveError('UPLOAD_IN_PROGRESS', 409, '이 자료 구분에 다른 업로드가 진행 중이거나 저장 확인이 필요합니다. 잠시 후 다시 시도해 주세요.');
  try {
    const latest = await categoryEvidence(db, caseId, category);
    const same = latest.find((f) => f.sha256 === input.sha256);
    const currentSnapshot = await sha256Hex(latest.filter((f) => f.isLatest).map((f) => `${f.id}:${f.sha256}`).sort().join('|'));
    if (same || currentSnapshot !== snapshot) {
      await db.prepare('DELETE FROM preview_evidence_upload_locks WHERE id=?').bind(lockId).run();
      return { response: same ? duplicateEvidenceResponse(same) : Response.json({ code: 'VERSION_REVIEW_STALE', error: '다른 파일이 먼저 저장되었습니다. 다시 비교해 주세요.' }, { status: 409 }) };
    }
    return { plan: { lockId, caseId, category, base, versionNumber: base ? (base.versionNumber ?? 1) + 1 : 1, summary, modelCode, reviewId: typeof reviewId === 'string' ? reviewId : null, externalWriteStarted: false, committed: false } };
  } catch (error) { await db.prepare('DELETE FROM preview_evidence_upload_locks WHERE id=?').bind(lockId).run(); throw error; }
}

export function evidenceVersionStatements(db: EvidenceDatabase, plan: EvidenceVersionPlan, evidenceId: string): Statement[] {
  const insert = (id: string, group: string, version: number, parent: string | null, summary: string[], model: string) => db.prepare('INSERT INTO preview_evidence_versions(evidence_id,organization_id,case_id,category,group_id,version_num,is_latest,supersedes_id,change_summary_json,model_code) VALUES(?,?,?,?,?,?,1,?,?,?)').bind(id, 'concost', plan.caseId, plan.category, group, version, parent, JSON.stringify(summary), model);
  const statements: Statement[] = [];
  if (plan.base) statements.push(db.prepare('INSERT OR IGNORE INTO preview_evidence_versions(evidence_id,organization_id,case_id,category,group_id,version_num,is_latest,change_summary_json,model_code) VALUES(?,?,?,?,?,?,1,?,?)').bind(plan.base.id, 'concost', plan.caseId, plan.category, plan.base.groupId ?? plan.base.id, plan.base.versionNumber ?? 1, JSON.stringify(plan.base.changeSummary ?? []), ''));
  statements.push(insert(evidenceId, plan.base?.groupId ?? evidenceId, plan.versionNumber, plan.base?.id ?? null, plan.summary, plan.modelCode));
  if (plan.reviewId) statements.push(db.prepare('UPDATE preview_evidence_upload_reviews SET consumed_at=? WHERE id=? AND consumed_at IS NULL').bind(new Date().toISOString(), plan.reviewId));
  return statements;
}
