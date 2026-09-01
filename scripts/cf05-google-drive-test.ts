import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import worker from '../apps/cloudflare/src/index';
import {
  GOOGLE_DRIVE_API,
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_DRIVE_UPLOAD_API,
  GOOGLE_OAUTH_AUTHORIZE_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  GoogleDriveError,
  buildAuthorizationUrl,
  createPkce,
  decryptSecret,
  downloadEvidenceFromDrive,
  encryptSecret,
  exchangeAuthorizationCode,
  ensureClaimCenterFolder,
  getDriveAccount,
  isAllowedGoogleAccountEmail,
  refreshAccessToken,
  sha256Hex,
  uploadEvidenceToDrive,
  validateEvidenceFile,
  verifyDriveFolder,
  type GoogleFetch
} from '../apps/cloudflare/src/google-drive';

const MASTER_KEY = '11'.repeat(32);
const DRAFT_KEY = '00000000-0000-4000-8000-000000000000';

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function sessionDb(roles = ['admin']): any {
  return {
    prepare(sql: string) {
      let params: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { params = values; return statement; },
        async first<T>() {
          if (sql.includes('FROM preview_sessions')) {
            return { id: 'user-1', loginId: 'admin', displayName: '관리자', email: 'admin@example.invalid', rolesJson: JSON.stringify(roles) } as T;
          }
          if (sql.includes('preview_google_credentials')) return null;
          return null;
        },
        async all<T>() { return { results: [] as T[] }; },
        async run() { return { success: true, meta: { changes: 1 }, params }; }
      };
      return statement;
    }
  };
}

async function expectGoogleError(promise: Promise<unknown>, code: string): Promise<GoogleDriveError> {
  try {
    await promise;
    assert.fail(`Expected ${code}`);
  } catch (reason) {
    assert.ok(reason instanceof GoogleDriveError);
    assert.equal(reason.code, code);
    return reason;
  }
}

describe('CF05 Google Drive direct storage contract', () => {
  test('01 PKCE challenge hashes the verifier string and state is stored only by hash', async () => {
    const pkce = await createPkce();
    const expected = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pkce.verifier))));
    assert.equal(pkce.challenge, expected);
    assert.equal(pkce.stateHash, await sha256Hex(pkce.state));
    assert.notEqual(pkce.stateHash, pkce.state);
    assert.match(pkce.verifier, /^[A-Za-z0-9_-]{43,128}$/u);
  });

  test('02 OAuth authorization URL is fixed to Google, exact redirect, S256, and drive.file', () => {
    const target = new URL(buildAuthorizationUrl('client-id', 'https://preview.example/api/google/oauth/callback', 'state-1', 'challenge-1'));
    assert.equal(target.origin + target.pathname, GOOGLE_OAUTH_AUTHORIZE_URL);
    assert.equal(target.searchParams.get('redirect_uri'), 'https://preview.example/api/google/oauth/callback');
    assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(target.searchParams.get('scope'), GOOGLE_DRIVE_SCOPE);
    assert.equal(target.searchParams.get('access_type'), 'offline');
    assert.match(target.searchParams.get('prompt') ?? '', /select_account/u);
    assert.match(target.searchParams.get('prompt') ?? '', /consent/u);
  });

  test('03 AES-GCM secret encryption requires the correct key and AAD', async () => {
    const encrypted = await encryptSecret('refresh-token-value', MASTER_KEY, 'concost:google-refresh');
    assert.notEqual(encrypted.ciphertextHex, 'refresh-token-value');
    assert.equal(await decryptSecret(encrypted.ciphertextHex, encrypted.ivHex, MASTER_KEY, 'concost:google-refresh'), 'refresh-token-value');
    assert.equal(await decryptSecret(encrypted.ciphertextHex, encrypted.ivHex, MASTER_KEY, 'other-tenant:google-refresh'), null);
    await expectGoogleError(encryptSecret('x', '00', 'aad'), 'INVALID_MASTER_KEY');
  });

  test('04 valid PDF is hashed by content and normalized to the canonical MIME', async () => {
    const file = new File([new TextEncoder().encode('%PDF-1.7\nsynthetic')], 'claim.pdf', { type: 'application/octet-stream' });
    const validated = await validateEvidenceFile(file);
    assert.equal(validated.mimeType, 'application/pdf');
    assert.equal(validated.sha256, await sha256Hex(validated.bytes));
  });

  test('05 extension spoofing, unsafe names, and empty files fail closed', async () => {
    await expectGoogleError(validateEvidenceFile(new File(['not a PDF'], 'claim.pdf', { type: 'application/pdf' })), 'EVIDENCE_SIGNATURE_MISMATCH');
    await expectGoogleError(validateEvidenceFile(new File(['safe'], '../claim.txt', { type: 'text/plain' })), 'INVALID_FILE_NAME');
    await expectGoogleError(validateEvidenceFile(new File([], 'empty.txt', { type: 'text/plain' })), 'EVIDENCE_TOO_LARGE');
  });

  test('06 authorization-code exchange sends PKCE to the fixed token endpoint and validates scope', async () => {
    let capturedUrl = '';
    let capturedBody = '';
    const fetcher: GoogleFetch = async (input, init) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body);
      return Response.json({ refresh_token: 'refresh-token-12345', access_token: 'access-token-12345', token_type: 'Bearer', scope: GOOGLE_DRIVE_SCOPE });
    };
    const result = await exchangeAuthorizationCode(fetcher, {
      clientId: 'client-id', clientSecret: 'client-secret', code: 'auth-code', verifier: 'pkce-verifier', redirectUri: 'https://preview.example/api/google/oauth/callback'
    });
    assert.equal(capturedUrl, GOOGLE_OAUTH_TOKEN_URL);
    assert.match(capturedBody, /code_verifier=pkce-verifier/u);
    assert.equal(result.scope, GOOGLE_DRIVE_SCOPE);
    assert.equal(result.accessToken, 'access-token-12345');
    await expectGoogleError(exchangeAuthorizationCode(async () => Response.json({ refresh_token: 'refresh-token-12345', access_token: 'access-token-12345', token_type: 'Bearer', scope: 'openid' }), {
      clientId: 'x', clientSecret: 'y', code: 'z', verifier: 'v', redirectUri: 'https://preview.example/api/google/oauth/callback'
    }), 'GOOGLE_SCOPE_MISSING');
  });

  test('06A Drive account verification returns only a canonical account projection', async () => {
    const account = await getDriveAccount(async (input, init) => {
      assert.equal(String(input), `${GOOGLE_DRIVE_API}/about?fields=user(displayName,emailAddress,permissionId)`);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access-token-12345');
      return Response.json({ user: { displayName: 'Claim Admin', emailAddress: 'ADMIN@CON-COST.COM', permissionId: 'permission-1', debugToken: 'must-not-pass-through' } });
    }, 'access-token-12345');
    assert.deepEqual(account, { displayName: 'Claim Admin', email: 'admin@con-cost.com' });
    assert.equal(isAllowedGoogleAccountEmail(account.email, 'con-cost.com'), true);
    assert.equal(isAllowedGoogleAccountEmail('concost0010@gmail.com', 'con-cost.com', 'concost0010@gmail.com'), true);
    assert.equal(isAllowedGoogleAccountEmail('other@gmail.com', 'con-cost.com', 'concost0010@gmail.com'), false);
    assert.equal(isAllowedGoogleAccountEmail('admin@personal.example', 'con-cost.com'), false);
    assert.equal(isAllowedGoogleAccountEmail('admin@sub.con-cost.com', 'con-cost.com'), false);
    await expectGoogleError(getDriveAccount(async () => Response.json({ user: { emailAddress: 'invalid' } }), 'token'), 'GOOGLE_MALFORMED_RESPONSE');
  });

  test('07 access-token refresh accepts only a canonical Bearer token and redacts provider bodies', async () => {
    const token = await refreshAccessToken(async () => Response.json({ access_token: 'access-token-12345', token_type: 'Bearer' }), {
      clientId: 'client-id', clientSecret: 'secret', refreshToken: 'refresh-token'
    });
    assert.equal(token, 'access-token-12345');
    await expectGoogleError(refreshAccessToken(async () => Response.json({ access_token: 'short', token_type: 'Basic', debugToken: 'never-leak' }), {
      clientId: 'x', clientSecret: 'y', refreshToken: 'z'
    }), 'GOOGLE_MALFORMED_RESPONSE');
  });

  test('08 rate limiting returns only bounded Retry-After metadata', async () => {
    const error = await expectGoogleError(refreshAccessToken(async () => new Response('raw-provider-secret', { status: 429, headers: { 'Retry-After': '9999' } }), {
      clientId: 'x', clientSecret: 'y', refreshToken: 'z'
    }), 'GOOGLE_RATE_LIMITED');
    assert.equal(error.retryAfterSeconds, 120);
    assert.equal(error.message.includes('raw-provider-secret'), false);
  });

  test('09 folder binding verifies the exact Drive ID, active folder MIME, and bearer header', async () => {
    let authorization = '';
    const folder = await verifyDriveFolder(async (input, init) => {
      assert.match(String(input), new RegExp(`^${GOOGLE_DRIVE_API}/files/folder_123456789`));
      authorization = new Headers(init?.headers).get('Authorization') ?? '';
      return Response.json({ id: 'folder_123456789', name: '사건 자료', mimeType: 'application/vnd.google-apps.folder', trashed: false });
    }, 'access-token-12345', 'folder_123456789');
    assert.equal(authorization, 'Bearer access-token-12345');
    assert.equal(folder.name, '사건 자료');
    await expectGoogleError(verifyDriveFolder(async () => Response.json({}), 'token', '../unsafe'), 'INVALID_GOOGLE_FOLDER_ID');
  });

  test('10 multipart upload uses the fixed Google endpoint and embeds case evidence provenance', async () => {
    let requestBody = '';
    const result = await uploadEvidenceToDrive(async (input, init) => {
      assert.equal(String(input), `${GOOGLE_DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink`);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access-token-12345');
      requestBody = await (init?.body as Blob).text();
      return Response.json({ id: 'drive_file_123456789', name: 'evidence.pdf', mimeType: 'application/pdf', size: '7', webViewLink: 'https://drive.google.com/file/d/drive_file_123456789/view' });
    }, {
      accessToken: 'access-token-12345', folderId: 'folder_123456789', evidenceId: 'evidence-1', fileName: 'evidence.pdf', mimeType: 'application/pdf', sha256: 'a'.repeat(64), bytes: new TextEncoder().encode('%PDF-1\n')
    });
    assert.equal(result.fileId, 'drive_file_123456789');
    assert.match(requestBody, /claimCenterEvidenceId/u);
    assert.match(requestBody, /folder_123456789/u);
    assert.match(requestBody, /a{64}/u);
  });

  test('11 malformed or ambiguous upload responses never become a successful local record', async () => {
    const input = { accessToken: 'access-token-12345', folderId: 'folder_123456789', evidenceId: 'evidence-1', fileName: 'evidence.pdf', mimeType: 'application/pdf', sha256: 'a'.repeat(64), bytes: new TextEncoder().encode('%PDF-1\n') };
    const malformed = await expectGoogleError(uploadEvidenceToDrive(async () => Response.json({ id: 'drive_file_123456789', name: 'evidence.pdf', mimeType: 'application/pdf', size: '999' }), input), 'GOOGLE_MALFORMED_RESPONSE');
    assert.equal(malformed.uncertain, true);
    const provider = await expectGoogleError(uploadEvidenceToDrive(async () => new Response('opaque body', { status: 503 }), input), 'GOOGLE_PROVIDER_ERROR');
    assert.equal(provider.uncertain, true);
  });

  test('12 download is always the fixed Drive alt=media route with server bearer authorization', async () => {
    const response = await downloadEvidenceFromDrive(async (input, init) => {
      assert.equal(String(input), `${GOOGLE_DRIVE_API}/files/drive_file_123456789?alt=media`);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access-token-12345');
      return new Response('file-bytes', { status: 200 });
    }, 'access-token-12345', 'drive_file_123456789');
    assert.equal(await response.text(), 'file-bytes');
  });

  test('13 upload API fails closed while Drive is disconnected even when test mode is named', async () => {
    const response = await worker.fetch(new Request('https://preview.example/api/preview/evidence', {
      method: 'POST',
      headers: { 'X-Session-Token': 'session-token', 'X-Preview-Draft-Key': DRAFT_KEY, 'Idempotency-Key': crypto.randomUUID() }
    }), { DB: sessionDb(), ALLOW_TEST_GOOGLE_MODES: 'true' });
    const body = await response.json() as { code?: string };
    assert.equal(response.status, 503);
    assert.equal(body.code, 'GOOGLE_DRIVE_NOT_CONNECTED');
  });

  test('14 non-admin users cannot start OAuth and missing production config is truthful', async () => {
    const forbidden = await worker.fetch(new Request('https://preview.example/api/google/oauth/start', { method: 'POST', headers: { 'X-Session-Token': 'staff-token' } }), { DB: sessionDb(['staff']) });
    assert.equal(forbidden.status, 403);
    const unavailable = await worker.fetch(new Request('https://preview.example/api/google/oauth/start', { method: 'POST', headers: { 'X-Session-Token': 'admin-token' } }), { DB: sessionDb(['admin']) });
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json() as { code?: string }).code, 'GOOGLE_OAUTH_NOT_CONFIGURED');
  });

  test('15 status and readiness disclose no client secret, refresh token, or fake connection', async () => {
    const env = { DB: sessionDb(), GOOGLE_CLIENT_ID: 'client-id-secret-marker', GOOGLE_CLIENT_SECRET: 'client-secret-marker' };
    const status = await worker.fetch(new Request('https://preview.example/api/google/status', { headers: { 'X-Session-Token': 'admin-token' } }), env);
    const statusText = await status.text();
    assert.equal(statusText.includes('client-secret-marker'), false);
    assert.equal(statusText.includes('refresh_token'), false);
    assert.equal(statusText.includes('"connected":false'), true);
    const readiness = await worker.fetch(new Request('https://preview.example/readiness'), env);
    const readinessText = await readiness.text();
    assert.equal(readinessText.includes('client-secret-marker'), false);
    assert.equal(readinessText.includes('refresh'), false);
  });

  test('16 additive migration preserves populated CF03 metadata and enforces Google evidence invariants', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const migration = (name: string) => readFileSync(join(process.cwd(), 'apps', 'cloudflare', 'migrations', name), 'utf8');
    for (const name of ['0001_cf02_preview_drafts.sql', '0001_cf_foundation.sql', '0002_cf03_preview_evidence.sql', '0003_cf04_preview_auth.sql']) db.exec(migration(name));
    db.run("INSERT INTO preview_drafts VALUES (?, '', '', ?)", ['a'.repeat(64), new Date(0).toISOString()]);
    db.run('INSERT INTO preview_users VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)', [
      '00000000-0000-4000-8000-000000000001', 'admin', '1'.repeat(32), '2'.repeat(64), 100000, '관리자', 'admin@example.invalid', '["admin"]', new Date(0).toISOString()
    ]);
    db.run('INSERT INTO preview_evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      '00000000-0000-4000-8000-000000000002', 'a'.repeat(64), 'legacy/object', 'legacy.pdf', 'application/pdf', 123, new Date(0).toISOString(), '관리자', 'CLOUDFLARE_R2', 'PENDING_GOOGLE_CONNECTION'
    ]);

    db.exec(migration('0004_cf05_google_drive.sql'));
    const legacy = db.exec("SELECT storage_provider, original_name FROM preview_evidence WHERE object_key='legacy/object'")[0].values[0];
    assert.deepEqual(legacy, ['CLOUDFLARE_R2', 'legacy.pdf']);

    db.run('INSERT INTO preview_google_operations (id,draft_id,idempotency_key,request_fingerprint,status,google_file_id,error_code,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [
      '00000000-0000-4000-8000-000000000005', 'a'.repeat(64), 'upload-key-12345', 'c'.repeat(64), 'PENDING', null, null, '00000000-0000-4000-8000-000000000001', new Date().toISOString(), new Date().toISOString()
    ]);
    db.run('INSERT INTO preview_evidence (id,draft_id,object_key,original_name,mime_type,byte_size,uploaded_at,uploaded_by,storage_provider,drive_status,sha256,google_file_id,google_folder_id,sync_status,reconciliation_status,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
      '00000000-0000-4000-8000-000000000003', 'a'.repeat(64), 'google-drive/drive_file_123456789', 'claim.pdf', 'application/pdf', 7, new Date().toISOString(), '관리자', 'GOOGLE_DRIVE', 'SYNCED_TO_GOOGLE_DRIVE', 'b'.repeat(64), 'drive_file_123456789', 'folder_123456789', 'SYNCED', 'CLEAN', 'upload-key-12345'
    ]);
    db.run("UPDATE preview_google_operations SET status='SUCCEEDED', google_file_id='drive_file_123456789', updated_at=? WHERE id=?", [new Date().toISOString(), '00000000-0000-4000-8000-000000000005']);
    assert.equal(db.exec("SELECT count(*) FROM preview_evidence WHERE storage_provider='GOOGLE_DRIVE'")[0].values[0][0], 1);
    assert.throws(() => db.run("UPDATE preview_google_operations SET status='FAILED', error_code='FORGED' WHERE id=?", ['00000000-0000-4000-8000-000000000005']), /transition is invalid/u);
    assert.throws(() => db.run('INSERT INTO preview_evidence (id,draft_id,object_key,original_name,mime_type,byte_size,uploaded_at,uploaded_by,storage_provider,drive_status,sync_status,reconciliation_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [
      '00000000-0000-4000-8000-000000000004', 'a'.repeat(64), 'google-drive/missing', 'bad.pdf', 'application/pdf', 7, new Date().toISOString(), '관리자', 'GOOGLE_DRIVE', 'SYNCED_TO_GOOGLE_DRIVE', 'SYNCED', 'CLEAN'
    ]), /metadata is incomplete|requires a pending operation/u);
    db.close();
  });

  test('17 project folders are routed under the Claim Center department and legacy folders keep their ID when moved', async () => {
    const calls: Array<{ url: URL; method: string; body: Record<string, unknown> | null }> = [];
    const fetcher: GoogleFetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
      calls.push({ url, method, body });
      if (method === 'GET') {
        const query = url.searchParams.get('q') ?? '';
        if (query.includes("concostFolderKind' and value='ORGANIZATION_ROOT")) return Response.json({ files: [] });
        if (query.includes("concostFolderKind' and value='DEPARTMENT_ROOT")) return Response.json({ files: [] });
        if (query.includes("claimCenterFolderKind' and value='PROJECT_ROOT") && query.includes("'claim_department_12345' in parents")) return Response.json({ files: [] });
        if (query.includes("claimCenterFolderKind' and value='PROJECT_ROOT")) {
          return Response.json({ files: [{ id: 'legacy_project_12345', name: '기존 프로젝트', mimeType: 'application/vnd.google-apps.folder', trashed: false, parents: ['legacy_parent_12345'] }] });
        }
      }
      if (method === 'POST' && body?.appProperties && (body.appProperties as Record<string, unknown>).concostFolderKind === 'ORGANIZATION_ROOT') {
        return Response.json({ id: 'concost_root_12345', name: 'CONCOST 자료실', mimeType: 'application/vnd.google-apps.folder', trashed: false });
      }
      if (method === 'POST' && body?.appProperties && (body.appProperties as Record<string, unknown>).concostFolderKind === 'DEPARTMENT_ROOT') {
        return Response.json({ id: 'claim_department_12345', name: '20_클레임센터', mimeType: 'application/vnd.google-apps.folder', trashed: false, parents: ['concost_root_12345'] });
      }
      if (method === 'PATCH' && url.pathname.endsWith('/legacy_project_12345')) {
        return Response.json({ id: 'legacy_project_12345', name: '기존 프로젝트', mimeType: 'application/vnd.google-apps.folder', trashed: false, parents: ['claim_department_12345'] });
      }
      return new Response('unexpected request', { status: 500 });
    };
    const folder = await ensureClaimCenterFolder(fetcher, {
      accessToken: 'access-token-12345',
      caseId: '10000000-0000-4000-8000-000000000001',
      kind: 'PROJECT_ROOT',
      period: '',
      name: 'CC-2026-00001 테스트 프로젝트'
    });
    assert.deepEqual(folder, { id: 'legacy_project_12345', name: '기존 프로젝트', created: false });
    const move = calls.find((call) => call.method === 'PATCH');
    assert.ok(move);
    assert.equal(move.url.searchParams.get('addParents'), 'claim_department_12345');
    assert.equal(move.url.searchParams.get('removeParents'), 'legacy_parent_12345');
    assert.equal(calls.some((call) => call.method === 'POST' && call.body?.name === 'CC-2026-00001 테스트 프로젝트'), false);
  });
});
