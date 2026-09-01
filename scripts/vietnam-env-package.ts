import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { parseDotEnv } from './cf-environment-parity.js';

const PACKAGE_VERSION = 1;
const PACKAGE_AAD = Buffer.from('CONCOST_VIETNAM_ENV_V1', 'utf8');

type VietnamEnvPackage = {
  version: 1;
  algorithm: 'RSA-OAEP-SHA256+AES-256-GCM';
  createdAt: string;
  wrappedKeyBase64: string;
  ivBase64: string;
  authTagBase64: string;
  ciphertextBase64: string;
};

export function validateVietnamEnvironment(values: Record<string, string>): string[] {
  const errors: string[] = [];
  const required = [
    'NODE_ENV', 'PORT', 'CLAIM_VOLUME_ROOT', 'DATABASE_URL', 'CLAIM_ALLOWED_ORIGINS',
    'CLAIM_BACKUP_SIGNING_KEY_REF', 'GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY_REF',
    'AI_CREDENTIAL_MASTER_KEY_REF'
  ];
  for (const key of required) if (!values[key]) errors.push(`베트남 운영 환경값이 없습니다: ${key}`);
  if (values.NODE_ENV && values.NODE_ENV !== 'production') errors.push('NODE_ENV는 production이어야 합니다.');
  if (values.PORT && (!/^\d{2,5}$/u.test(values.PORT) || Number(values.PORT) > 65535)) errors.push('PORT가 올바르지 않습니다.');
  if (values.CLAIM_VOLUME_ROOT && !(/^\//u.test(values.CLAIM_VOLUME_ROOT) || /^[A-Za-z]:[\\/]/u.test(values.CLAIM_VOLUME_ROOT))) errors.push('CLAIM_VOLUME_ROOT는 절대 경로여야 합니다.');
  if (values.DATABASE_URL && !/^(?:file:\/|postgres(?:ql)?:\/\/)/u.test(values.DATABASE_URL)) errors.push('DATABASE_URL 형식이 올바르지 않습니다.');
  for (const origin of (values.CLAIM_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean)) {
    try {
      const parsed = new URL(origin.trim());
      if (parsed.origin !== origin.trim() || parsed.protocol !== 'https:' || origin.includes('*')) errors.push('CLAIM_ALLOWED_ORIGINS에는 정확한 HTTPS origin만 허용됩니다.');
    } catch {
      errors.push('CLAIM_ALLOWED_ORIGINS 형식이 올바르지 않습니다.');
    }
  }
  for (const refName of ['CLAIM_BACKUP_SIGNING_KEY_REF', 'GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY_REF', 'AI_CREDENTIAL_MASTER_KEY_REF']) {
    const reference = values[refName];
    if (!reference) continue;
    if (!/^ENV_[A-Z][A-Z0-9_]*$/u.test(reference)) {
      errors.push(`${refName}는 ENV_로 시작하는 참조여야 합니다.`);
      continue;
    }
    const resolvedName = reference.slice(4);
    const resolvedValue = values[resolvedName];
    if (!resolvedValue) errors.push(`${refName}이 가리키는 ${resolvedName} 값이 없습니다.`);
    else if (!/^[0-9a-f]{64}$/iu.test(resolvedValue) && !/^[A-Za-z0-9_-]{43}$/u.test(resolvedValue)) errors.push(`${resolvedName}은 정확히 32바이트 키여야 합니다.`);
  }
  if (values.GOOGLE_WORKSPACE_PROVIDER_MODE === 'REAL') {
    for (const refName of ['GOOGLE_WORKSPACE_CLIENT_ID_REF', 'GOOGLE_WORKSPACE_CLIENT_SECRET_REF']) {
      const reference = values[refName];
      if (!reference || !/^ENV_[A-Z][A-Z0-9_]*$/u.test(reference) || !values[reference.slice(4)]) errors.push(`${refName}과 참조 대상 값이 필요합니다.`);
    }
    for (const key of ['GOOGLE_WORKSPACE_REDIRECT_URI', 'GOOGLE_WORKSPACE_REDIRECT_ORIGINS']) if (!values[key]) errors.push(`Google REAL 모드에 ${key}가 필요합니다.`);
  }
  if (values.ALLOW_TEST_GOOGLE_MODES === 'true' || values.ALLOW_TEST_AI_MODES === 'true') errors.push('운영 환경에는 test/fake provider 모드를 사용할 수 없습니다.');
  for (const [key, value] of Object.entries(values)) {
    if (/CHANGE_ME|CHANGE_TO_|example\.invalid/iu.test(value)) errors.push(`${key}에 예시 또는 미설정 값이 남아 있습니다.`);
    if (/\r|\n|\u0000/u.test(value)) errors.push(`${key} 값에 허용되지 않은 제어문자가 있습니다.`);
  }
  return [...new Set(errors)];
}

function parsePackage(source: string): VietnamEnvPackage {
  const value = JSON.parse(source) as Partial<VietnamEnvPackage>;
  if (value.version !== PACKAGE_VERSION || value.algorithm !== 'RSA-OAEP-SHA256+AES-256-GCM' ||
    typeof value.createdAt !== 'string' || typeof value.wrappedKeyBase64 !== 'string' ||
    typeof value.ivBase64 !== 'string' || typeof value.authTagBase64 !== 'string' || typeof value.ciphertextBase64 !== 'string') {
    throw new Error('베트남 환경 패키지 형식이 올바르지 않습니다.');
  }
  return value as VietnamEnvPackage;
}

export function encryptVietnamEnvironment(plainText: string, publicKeyPem: string, createdAt = new Date().toISOString()): VietnamEnvPackage {
  const values = parseDotEnv(plainText);
  const errors = validateVietnamEnvironment(values);
  if (errors.length) throw new Error(errors.join('\n'));
  const publicKey = createPublicKey(publicKeyPem);
  if (!['rsa', 'rsa-pss'].includes(publicKey.asymmetricKeyType ?? '')) throw new Error('베트남 수신 공개키는 RSA 키여야 합니다.');
  const contentKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', contentKey, iv);
  cipher.setAAD(PACKAGE_AAD);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plainText, 'utf8')), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const wrappedKey = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, contentKey);
  contentKey.fill(0);
  return {
    version: PACKAGE_VERSION,
    algorithm: 'RSA-OAEP-SHA256+AES-256-GCM',
    createdAt,
    wrappedKeyBase64: wrappedKey.toString('base64'),
    ivBase64: iv.toString('base64'),
    authTagBase64: authTag.toString('base64'),
    ciphertextBase64: ciphertext.toString('base64')
  };
}

export function decryptVietnamEnvironment(packaged: VietnamEnvPackage, privateKeyPem: string): string {
  const privateKey = createPrivateKey(privateKeyPem);
  const contentKey = privateDecrypt({
    key: privateKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256'
  }, Buffer.from(packaged.wrappedKeyBase64, 'base64'));
  try {
    const decipher = createDecipheriv('aes-256-gcm', contentKey, Buffer.from(packaged.ivBase64, 'base64'));
    decipher.setAAD(PACKAGE_AAD);
    decipher.setAuthTag(Buffer.from(packaged.authTagBase64, 'base64'));
    const plainText = Buffer.concat([decipher.update(Buffer.from(packaged.ciphertextBase64, 'base64')), decipher.final()]).toString('utf8');
    const errors = validateVietnamEnvironment(parseDotEnv(plainText));
    if (errors.length) throw new Error('복호화된 베트남 환경 설정이 운영 계약을 통과하지 못했습니다.');
    return plainText;
  } finally {
    contentKey.fill(0);
  }
}

function argument(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function requiredPath(root: string, value: string | undefined, label: string, requireLocal = false): string {
  if (!value) throw new Error(`${label} 경로가 필요합니다.`);
  const path = isAbsolute(value) ? value : resolve(root, value);
  if (!existsSync(path)) throw new Error(`${label} 파일을 찾을 수 없습니다.`);
  if (requireLocal && !path.endsWith('.local')) throw new Error(`${label} 파일은 Git에서 제외되는 .local 확장자로 끝나야 합니다.`);
  return path;
}

export function main(argv = process.argv.slice(2), root = process.cwd()): void {
  const command = argv[0];
  if (!['validate', 'encrypt', 'decrypt'].includes(command ?? '')) throw new Error('validate, encrypt 또는 decrypt 명령이 필요합니다.');
  if (command === 'validate') {
    const envPath = requiredPath(root, argument(argv, '--env') ?? '.env.vietnam.local', '베트남 env', true);
    const errors = validateVietnamEnvironment(parseDotEnv(readFileSync(envPath, 'utf8')));
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('베트남 운영 env 계약 검증 완료. 값은 출력하지 않았습니다.');
    return;
  }
  if (command === 'encrypt') {
    const envPath = requiredPath(root, argument(argv, '--env') ?? '.env.vietnam.local', '베트남 env', true);
    const publicKeyPath = requiredPath(root, argument(argv, '--public-key'), '베트남 수신 공개키');
    const outputArg = argument(argv, '--out');
    if (!outputArg) throw new Error('--out <*.vietnam-env.enc.json> 경로가 필요합니다.');
    const outputPath = isAbsolute(outputArg) ? outputArg : resolve(root, outputArg);
    if (!outputPath.endsWith('.vietnam-env.enc.json')) throw new Error('암호화 패키지는 .vietnam-env.enc.json으로 끝나야 합니다.');
    if (existsSync(outputPath)) throw new Error('기존 암호화 패키지를 덮어쓰지 않습니다. 새 파일명을 사용하세요.');
    const packaged = encryptVietnamEnvironment(readFileSync(envPath, 'utf8'), readFileSync(publicKeyPath, 'utf8'));
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(packaged, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    console.log(`베트남 env 암호화 패키지 생성 완료: ${basename(outputPath)}. 원문 값은 출력하지 않았습니다.`);
    return;
  }
  const packagePath = requiredPath(root, argument(argv, '--package'), '암호화 패키지');
  const privateKeyPath = requiredPath(root, argument(argv, '--private-key'), '베트남 수신 개인키');
  const outputArg = argument(argv, '--out') ?? '.env';
  const outputPath = isAbsolute(outputArg) ? outputArg : resolve(root, outputArg);
  if (existsSync(outputPath)) throw new Error('기존 .env를 덮어쓰지 않습니다. 백업·검토 후 별도 경로를 사용하세요.');
  const plainText = decryptVietnamEnvironment(parsePackage(readFileSync(packagePath, 'utf8')), readFileSync(privateKeyPath, 'utf8'));
  writeFileSync(outputPath, plainText, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  console.log(`베트남 서버 env 복호화 완료: ${basename(outputPath)}. 값은 출력하지 않았습니다.`);
}

if (process.argv[1]?.endsWith('vietnam-env-package.ts')) {
  try {
    main();
  } catch (reason) {
    console.error(reason instanceof Error ? reason.message : '베트남 env 패키지 작업이 실패했습니다.');
    process.exitCode = 1;
  }
}
