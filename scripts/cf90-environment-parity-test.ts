import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectLocalConfiguration, inspectRemoteSecretNames, parseDotEnv, validateSharedSecrets } from './cf-environment-parity.js';

test('CF90 keeps shared public values equal while isolating redirect origin and D1', () => {
  assert.deepEqual(inspectLocalConfiguration(), []);
});

test('CF90 detects Worker secret name drift without reading secret values', () => {
  const master = 'GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY';
  assert.deepEqual(inspectRemoteSecretNames({ test: [master], gaopen: [master] }), []);
  assert.match(inspectRemoteSecretNames({ test: [master], gaopen: [master, 'GEMINI_API_KEY'] }).join('\n'), /GEMINI_API_KEY/u);
});

test('CF90 validates one ignored shared secret source and rejects server-specific values', () => {
  const parsed = parseDotEnv(`ANTHROPIC_API_KEY=sk-ant-${'a'.repeat(32)}\nANTHROPIC_WORKSPACE_ID=wrkspc_01UStfbKRtH45BpwH1mELvFC\n`);
  assert.deepEqual(validateSharedSecrets(parsed), []);
  const invalid = validateSharedSecrets({ ...parsed, GOOGLE_OAUTH_REDIRECT_ORIGIN: 'https://example.invalid' });
  assert.match(invalid.join('\n'), /서버별 또는 미등록 키/u);
  assert.match(validateSharedSecrets({ GEMINI_API_KEY: 'AIza-example', GOOGLE_CLIENT_ID: 'only-id' }).join('\n'), /반드시 함께/u);
  assert.match(validateSharedSecrets({ GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY: 'must-not-rotate' }).join('\n'), /서버별 또는 미등록 키/u);
});
