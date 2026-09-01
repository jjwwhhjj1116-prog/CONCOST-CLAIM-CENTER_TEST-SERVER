import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

type TargetName = 'test' | 'gaopen';
type WranglerConfig = {
  name?: string;
  main?: string;
  compatibility_date?: string;
  placement?: unknown;
  rules?: unknown;
  assets?: unknown;
  observability?: unknown;
  d1_databases?: Array<{ binding?: string; database_name?: string; database_id?: string; migrations_dir?: string }>;
  vars?: Record<string, string>;
  secrets?: { required?: string[] };
};

export const TARGETS: Record<TargetName, { config: string; workerName: string; expectedOrigin: string }> = {
  test: {
    config: 'wrangler.development.jsonc',
    workerName: 'concost-claim-center-development',
    expectedOrigin: 'https://concost-claim-center-development.jjwwhhjj1116.workers.dev'
  },
  gaopen: {
    config: 'wrangler.jsonc',
    workerName: 'concost-claim-center-preview',
    expectedOrigin: 'https://concost-claim-center-preview.jjwwhhjj1116.workers.dev'
  }
};

export const SHARED_PUBLIC_VARS = ['GOOGLE_ALLOWED_DOMAIN', 'GOOGLE_ALLOWED_ACCOUNT'] as const;
export const ENVIRONMENT_PUBLIC_VARS = ['GOOGLE_OAUTH_REDIRECT_ORIGIN'] as const;
export const REQUIRED_SHARED_SECRETS = ['GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY'] as const;
const SHARED_CONFIG_FIELDS = ['main', 'compatibility_date', 'placement', 'rules', 'assets', 'observability'] as const;
export const SYNCABLE_SHARED_SECRETS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_WORKSPACE_ID',
  'GEMINI_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'LAW_API_OC',
  'PM_NOTIFICATION_WEBHOOK_URL',
  'PM_NOTIFICATION_WEBHOOK_SECRET',
  'ERP_PROJECT_WEBHOOK_URL',
  'ERP_PROJECT_WEBHOOK_SECRET'
] as const;

export function parseDotEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('공통 secret 파일에 KEY=VALUE 형식이 아닌 줄이 있습니다.');
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) throw new Error(`허용되지 않은 환경변수 이름입니다: ${key}`);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (Object.hasOwn(values, key)) throw new Error(`중복된 환경변수 이름입니다: ${key}`);
    if (value) values[key] = value;
  }
  return values;
}

function readConfig(root: string, target: TargetName): WranglerConfig {
  return JSON.parse(readFileSync(resolve(root, TARGETS[target].config), 'utf8')) as WranglerConfig;
}

export function inspectLocalConfiguration(root = process.cwd()): string[] {
  const errors: string[] = [];
  const test = readConfig(root, 'test');
  const gaopen = readConfig(root, 'gaopen');
  const configs = { test, gaopen };

  for (const target of ['test', 'gaopen'] as const) {
    const config = configs[target];
    const expected = TARGETS[target];
    if (config.name !== expected.workerName) errors.push(`${target}: Worker 이름이 계약과 다릅니다.`);
    if (config.vars?.GOOGLE_OAUTH_REDIRECT_ORIGIN !== expected.expectedOrigin) errors.push(`${target}: Google OAuth redirect origin이 Worker 주소와 다릅니다.`);
    const required = new Set(config.secrets?.required ?? []);
    for (const name of REQUIRED_SHARED_SECRETS) if (!required.has(name)) errors.push(`${target}: 필수 secret 선언이 없습니다: ${name}`);
    const db = config.d1_databases?.find((binding) => binding.binding === 'DB');
    if (!db?.database_id || !db.database_name) errors.push(`${target}: D1 DB binding이 완전하지 않습니다.`);
  }

  for (const name of SHARED_PUBLIC_VARS) {
    if (!test.vars?.[name] || test.vars[name] !== gaopen.vars?.[name]) errors.push(`공통 일반 환경값이 일치하지 않습니다: ${name}`);
  }
  for (const name of ENVIRONMENT_PUBLIC_VARS) {
    if (!test.vars?.[name] || !gaopen.vars?.[name] || test.vars[name] === gaopen.vars[name]) errors.push(`서버별 환경값이 분리되지 않았습니다: ${name}`);
  }
  const testDb = test.d1_databases?.find((binding) => binding.binding === 'DB');
  const gaopenDb = gaopen.d1_databases?.find((binding) => binding.binding === 'DB');
  if (testDb?.database_id === gaopenDb?.database_id) errors.push('테스트와 가오픈은 같은 D1 database_id를 사용하면 안 됩니다.');
  if (testDb?.database_name === gaopenDb?.database_name) errors.push('테스트와 가오픈은 같은 D1 database_name을 사용하면 안 됩니다.');
  if (testDb?.migrations_dir !== gaopenDb?.migrations_dir) errors.push('테스트와 가오픈의 D1 migrations_dir이 다릅니다.');
  for (const field of SHARED_CONFIG_FIELDS) {
    if (JSON.stringify(test[field]) !== JSON.stringify(gaopen[field])) errors.push(`테스트와 가오픈의 공통 Wrangler 설정이 다릅니다: ${field}`);
  }
  return errors;
}

export function inspectRemoteSecretNames(secretNames: Record<TargetName, string[]>): string[] {
  const errors: string[] = [];
  const sets = { test: new Set(secretNames.test), gaopen: new Set(secretNames.gaopen) };
  for (const name of REQUIRED_SHARED_SECRETS) {
    for (const target of ['test', 'gaopen'] as const) if (!sets[target].has(name)) errors.push(`${target}: 필수 Worker secret이 없습니다: ${name}`);
  }
  for (const name of SYNCABLE_SHARED_SECRETS) {
    if (sets.test.has(name) !== sets.gaopen.has(name)) errors.push(`Worker secret 이름이 두 서버에서 다릅니다: ${name}`);
  }
  return errors;
}

export function validateSharedSecrets(values: Record<string, string>): string[] {
  const errors: string[] = [];
  const allowed = new Set<string>(SYNCABLE_SHARED_SECRETS);
  for (const key of Object.keys(values)) if (!allowed.has(key)) errors.push(`공통 secret 파일에 서버별 또는 미등록 키가 있습니다: ${key}`);
  if (Object.keys(values).length === 0) errors.push('동기화할 공통 secret 값이 없습니다.');
  if (values.ANTHROPIC_WORKSPACE_ID && !/^wrkspc_[A-Za-z0-9]{10,100}$/u.test(values.ANTHROPIC_WORKSPACE_ID)) errors.push('ANTHROPIC_WORKSPACE_ID 형식이 올바르지 않습니다.');
  if (Boolean(values.GOOGLE_CLIENT_ID) !== Boolean(values.GOOGLE_CLIENT_SECRET)) errors.push('GOOGLE_CLIENT_ID와 GOOGLE_CLIENT_SECRET은 반드시 함께 입력해야 합니다.');
  if (Boolean(values.ANTHROPIC_API_KEY) !== Boolean(values.ANTHROPIC_WORKSPACE_ID)) errors.push('현재 Claude 키는 ANTHROPIC_API_KEY와 ANTHROPIC_WORKSPACE_ID를 반드시 함께 입력해야 합니다.');
  for (const [key, value] of Object.entries(values)) if (/\r|\n|\u0000/u.test(value)) errors.push(`${key} 값에 허용되지 않은 제어문자가 있습니다.`);
  return errors;
}

function runWrangler(root: string, args: string[], inherit = false, input?: string): string {
  const wranglerEntry = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
  if (!existsSync(wranglerEntry)) throw new Error('로컬 Wrangler 실행 파일을 찾을 수 없습니다. 먼저 의존성을 설치하세요.');
  const result = spawnSync(process.execPath, [wranglerEntry, ...args], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    input,
    stdio: inherit ? ['pipe', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe']
  });
  if (result.status !== 0) throw new Error(`Wrangler 명령이 실패했습니다: ${args.slice(0, 3).join(' ')}`);
  return typeof result.stdout === 'string' ? result.stdout : '';
}

function listSecretNames(root: string, target: TargetName): string[] {
  const output = runWrangler(root, ['secret', 'list', '--config', TARGETS[target].config]);
  const parsed = JSON.parse(output) as Array<{ name?: string }>;
  return parsed.flatMap((item) => typeof item.name === 'string' ? [item.name] : []);
}

function assertNoPendingMigrations(root: string, target: TargetName): void {
  const output = runWrangler(root, ['d1', 'migrations', 'list', 'DB', '--remote', '--config', TARGETS[target].config]);
  if (!/No migrations to apply/iu.test(output)) throw new Error(`${target}: 적용되지 않은 D1 migration이 있습니다.`);
}

function readD1Contract(root: string, target: TargetName): string {
  const sql = [
    "SELECT task_kind,provider_kind,model_code,reasoning_effort,secret_name FROM preview_report_ai_routes WHERE organization_id='concost' ORDER BY task_kind",
    "SELECT provider_kind,status,CASE WHEN provider_workspace_id IS NULL THEN 0 ELSE 1 END AS workspace_configured FROM preview_ai_credentials WHERE organization_id='concost' AND owner_scope='ORGANIZATION' ORDER BY provider_kind",
    "SELECT (SELECT COUNT(*) FROM preview_google_oauth_app_settings) AS oauth_app_rows,(SELECT COUNT(*) FROM preview_google_credentials WHERE scope='https://www.googleapis.com/auth/drive.file') AS drive_connection_rows"
  ].join('; ');
  const output = runWrangler(root, ['d1', 'execute', 'DB', '--remote', '--json', '--command', sql, '--config', TARGETS[target].config]);
  const parsed = JSON.parse(output) as Array<{ results?: Array<Record<string, unknown>> }>;
  return JSON.stringify(parsed.map((statement) => statement.results ?? []));
}

function failIfAny(errors: string[]): void {
  if (!errors.length) return;
  throw new Error(`Cloudflare 환경 parity 검사 실패:\n- ${errors.join('\n- ')}`);
}

function resolveSecretFile(root: string, fileArg: string | undefined): string {
  if (!fileArg) throw new Error('sync에는 --file <.env.cloudflare.shared.local>이 필요합니다.');
  const path = isAbsolute(fileArg) ? fileArg : resolve(root, fileArg);
  if (!existsSync(path)) throw new Error('지정한 공통 secret 파일을 찾을 수 없습니다.');
  if (!path.endsWith('.local')) throw new Error('공통 secret 파일은 Git 제외가 명확한 .local 확장자로 끝나야 합니다.');
  return path;
}

export function main(argv = process.argv.slice(2), root = process.cwd()): void {
  const command = argv[0] ?? 'check-local';
  failIfAny(inspectLocalConfiguration(root));
  if (command === 'check-local') {
    console.log('Cloudflare 로컬 환경 계약 정상: 공통값 일치, redirect/D1 분리, 필수 secret 이름 선언 완료.');
    return;
  }
  if (command === 'check-remote') {
    failIfAny(inspectRemoteSecretNames({ test: listSecretNames(root, 'test'), gaopen: listSecretNames(root, 'gaopen') }));
    assertNoPendingMigrations(root, 'test');
    assertNoPendingMigrations(root, 'gaopen');
    if (readD1Contract(root, 'test') !== readD1Contract(root, 'gaopen')) throw new Error('테스트와 가오픈의 AI route/credential 존재/OAuth·Drive 설정 계약이 다릅니다.');
    console.log('Cloudflare 원격 환경 parity 정상: secret 이름과 D1 migration이 일치합니다.');
    return;
  }
  if (command !== 'sync') throw new Error(`알 수 없는 명령입니다: ${command}`);
  const fileIndex = argv.indexOf('--file');
  const secretFile = resolveSecretFile(root, fileIndex >= 0 ? argv[fileIndex + 1] : '.env.cloudflare.shared.local');
  const values = parseDotEnv(readFileSync(secretFile, 'utf8'));
  failIfAny(validateSharedSecrets(values));
  const targets: TargetName[] = argv.includes('--include-gaopen') ? ['test', 'gaopen'] : ['test'];
  for (const target of targets) {
    const existing = new Set(listSecretNames(root, target));
    const payload: Record<string, string | null> = { ...values };
    for (const name of SYNCABLE_SHARED_SECRETS) if (!Object.hasOwn(values, name) && existing.has(name)) payload[name] = null;
    runWrangler(root, ['secret', 'bulk', '--config', TARGETS[target].config], true, JSON.stringify(payload));
    const names = new Set(listSecretNames(root, target));
    failIfAny(Object.keys(values).filter((name) => !names.has(name)).map((name) => `${target}: 동기화 후 secret 이름 확인 실패: ${name}`));
  }
  console.log(`Cloudflare shared secrets 동기화 완료: ${targets.join(', ')}. 값은 출력하지 않았습니다.`);
}

if (process.argv[1]?.endsWith('cf-environment-parity.ts')) {
  try {
    main();
  } catch (reason) {
    console.error(reason instanceof Error ? reason.message : 'Cloudflare 환경 parity 검사가 실패했습니다.');
    process.exitCode = 1;
  }
}
