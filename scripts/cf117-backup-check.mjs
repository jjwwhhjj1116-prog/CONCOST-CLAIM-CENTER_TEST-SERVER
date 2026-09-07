// CF117: local-only signed D1 restore/rehearsal with exact data preservation during the reviewed rebuild.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const [mode, database, beforePath, otherPath, pin, requestedMigration] = process.argv.slice(2);
assert.ok(['sign', 'verify', 'preflight', 'compare'].includes(mode), 'Use sign|verify|preflight|compare database before.sql [manifest/after.sql] [pin] [migration]');
assert.ok(['78094a1c-abe0-451d-bc12-68d0d37166d8', '16d1f25b-60c8-4489-95ed-4fa7de161c9f'].includes(database), 'explicit release database');
const migration = requestedMigration ?? '0061_cf117_hourly_backup_pattern.sql';
assert.ok(['0059_cf114_report_workspace_version_guard.sql', '0060_cf116_workflow_import_access_guard.sql', '0061_cf117_hourly_backup_pattern.sql', '0062_cf121_law_api_settings.sql'].includes(migration), 'explicit reviewed migration');
const sql = readFileSync('apps/cloudflare/migrations/' + migration, 'utf8');
const backupTable = 'preview_report_hourly_backups';
const rebuildsBackup = migration === '0061_cf117_hourly_backup_pattern.sql';
const addsLawSettings = migration === '0062_cf121_law_api_settings.sql';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? { blob: Buffer.from(item).toString('base64') } : item);
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const load = path => {
  if (path.endsWith('.sqlite')) return new DatabaseSync(path, { readOnly: true });
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(path, 'utf8')); return db;
};
const tables = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all().map(row => row.name);
const rows = (db, name) => db.prepare('SELECT * FROM ' + quote(name)).all();
const sortedRows = (db, name) => rows(db, name).map(json).sort();
const inventory = db => Object.fromEntries(tables(db).map(name => { const values = sortedRows(db, name); return [name, { count: values.length, sha256: hash(json(values)) }]; }));
const schema = db => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all().map(row => ({ ...row, sql: row.sql?.replace(/\s+/g, ' ').trim() }));
const integrity = db => {
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
};
const preserve = (before, after) => {
  assert.deepEqual(tables(after), [...tables(before), ...(addsLawSettings ? ['preview_law_api_settings'] : [])].sort(), 'only the reviewed table may be added');
  if (addsLawSettings) assert.equal(rows(after, 'preview_law_api_settings').length, 0, 'deployment must not provision any law API credential');
  for (const name of tables(before)) {
    const previous = sortedRows(before, name), current = sortedRows(after, name);
    if (name === 'd1_migrations') assert.ok(previous.every(row => current.includes(row)), 'preserve the original migration ledger');
    else assert.equal(hash(json(current)), hash(json(previous)), 'preserve every existing value: ' + name);
  }
  if (rebuildsBackup) {
    const columns = (db, name) => db.prepare('PRAGMA table_info(' + quote(name) + ')').all();
    assert.deepEqual(columns(after, backupTable), columns(before, backupTable), 'replacement backup columns remain identical');
  }
};
const runPending = db => {
  if (rows(db, 'd1_migrations').some(row => row.name === migration)) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').run(migration);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  integrity(db);
  return true;
};

const before = load(beforePath);
try {
  integrity(before);
  if (mode === 'sign') {
    const manifest = { kind: 'CF117_D1_BACKUP', database, createdAt: new Date().toISOString(), sqlSha256: hash(readFileSync(beforePath)), tables: inventory(before), schemaSha256: hash(json(schema(before))), migration, migrationSha256: hash(sql) };
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const envelope = { manifest, publicKey: publicKey.export({ type: 'spki', format: 'pem' }), signature: sign(null, Buffer.from(json(manifest)), privateKey).toString('base64') };
    writeFileSync(otherPath, JSON.stringify(envelope, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ valid: true, database, tables: tables(before).length, sqlSha256: manifest.sqlSha256, publicKeySha256: hash(envelope.publicKey) }));
  } else if (mode === 'verify') {
    const envelope = JSON.parse(readFileSync(otherPath, 'utf8'));
    assert.match(pin ?? '', /^[0-9a-f]{64}$/);
    assert.equal(hash(envelope.publicKey), pin, 'public key matches the separately recorded pin');
    assert.ok(verify(null, Buffer.from(json(envelope.manifest)), envelope.publicKey, Buffer.from(envelope.signature, 'base64')), 'manifest signature is valid');
    assert.equal(envelope.manifest.kind, 'CF117_D1_BACKUP');
    assert.equal(envelope.manifest.database, database);
    assert.equal(envelope.manifest.migration, migration);
    assert.equal(hash(readFileSync(beforePath)), envelope.manifest.sqlSha256);
    assert.deepEqual(inventory(before), envelope.manifest.tables, 'all table values, including settings and credentials, match the signed inventory');
    assert.equal(hash(json(schema(before))), envelope.manifest.schemaSha256);
    assert.equal(hash(sql), envelope.manifest.migrationSha256);
    console.log(JSON.stringify({ valid: true, database, signatureVerified: true, restoreVerified: true, checksumsVerified: true }));
  } else {
    if (rebuildsBackup) {
      assert.ok(tables(before).includes(backupTable), 'the original backup table exists');
      const inbound = tables(before).flatMap(name => before.prepare('PRAGMA foreign_key_list(' + quote(name) + ')').all().filter(key => key.table === backupTable).map(key => ({ table: name, column: key.from })));
      assert.deepEqual(inbound, [], 'a backup-table rebuild requires no inbound foreign keys');
    }
    const expected = load(beforePath);
    try {
      assert.equal(runPending(expected), true, 'exact pending migration');
      preserve(before, expected);
      const snapshot = inventory(expected), expectedSchema = schema(expected);
      const oldLedger = rows(before, 'd1_migrations'), newLedger = rows(expected, 'd1_migrations');
      assert.equal(newLedger.length, oldLedger.length + 1, 'exactly one ledger entry is added');
      assert.equal(newLedger.filter(row => row.name === migration).length, 1);
      assert.equal(runPending(expected), false, 'migration runner skips the already-applied migration');
      assert.deepEqual(inventory(expected), snapshot, 'second run changes no values or ledger entries');
      assert.deepEqual(schema(expected), expectedSchema, 'second run changes no schema');
      integrity(expected);
      if (mode === 'compare') {
        const actual = load(otherPath);
        try {
          integrity(actual);
          preserve(before, actual);
          assert.deepEqual(schema(actual), expectedSchema, 'deployed schema equals the rehearsed schema exactly');
          const withoutTime = db => rows(db, 'd1_migrations').map(({ applied_at, ...row }) => json(row)).sort();
          assert.deepEqual(withoutTime(actual), withoutTime(expected), 'only migration application timestamps may differ');
        } finally { actual.close(); }
      }
      console.log(JSON.stringify({ valid: true, mode, database, preservedTables: tables(before).length, preservedBackupRows: rows(expected, backupTable).length, noInboundBackupForeignKeys: rebuildsBackup ? true : undefined, migration, migrationSha256: hash(sql), secondRunNoOp: true }));
    } finally { expected.close(); }
  }
} finally { before.close(); }
