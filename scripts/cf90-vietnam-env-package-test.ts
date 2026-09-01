import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { decryptVietnamEnvironment, encryptVietnamEnvironment, validateVietnamEnvironment } from './vietnam-env-package.js';
import { parseDotEnv } from './cf-environment-parity.js';

const keyPair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

const secretMarker = `secret-${'x'.repeat(48)}`;
const envText = [
  'NODE_ENV=production',
  'PORT=8080',
  'CLAIM_VOLUME_ROOT=/srv/concost-claim-center',
  'DATABASE_URL=file:/srv/concost-claim-center/database/claim-center.db',
  'CLAIM_ALLOWED_ORIGINS=https://claimcenterstudio.con-cost.co.kr',
  'CLAIM_BACKUP_SIGNING_KEY_REF=ENV_CLAIM_BACKUP_SIGNING_KEY',
  `CLAIM_BACKUP_SIGNING_KEY=${'a'.repeat(64)}`,
  'GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY_REF=ENV_GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY',
  `GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY=${'b'.repeat(64)}`,
  'AI_CREDENTIAL_MASTER_KEY_REF=ENV_AI_CREDENTIAL_MASTER_KEY',
  `AI_CREDENTIAL_MASTER_KEY=${'c'.repeat(64)}`,
  `OPENAI_API_KEY=${secretMarker}`
].join('\n');

test('CF90 Vietnam env package validates production settings and encrypts without plaintext leakage', () => {
  assert.deepEqual(validateVietnamEnvironment(parseDotEnv(envText)), []);
  const packaged = encryptVietnamEnvironment(envText, keyPair.publicKey, '2026-09-01T00:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(packaged), new RegExp(secretMarker));
  assert.equal(decryptVietnamEnvironment(packaged, keyPair.privateKey), envText);
});

test('CF90 Vietnam env package rejects fake production values', () => {
  const invalid = validateVietnamEnvironment(parseDotEnv(envText.replace('NODE_ENV=production', 'NODE_ENV=development')));
  assert.match(invalid.join('\n'), /production/u);
});
