// Local-only signed backup and exact seven-migration rehearsal. Never connects to D1.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const DATABASE = '78094a1c-abe0-451d-bc12-68d0d37166d8';
const folder = 'apps/cloudflare/migrations/';
const migrations = readdirSync(folder).filter(name => /^005[2-8]_.*\.sql$/.test(name)).sort();
assert.equal(migrations.length, 7);
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, (_key, entry) => entry instanceof Uint8Array ? { blob: Buffer.from(entry).toString('base64') } : entry);
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const load = path => { const db = new DatabaseSync(':memory:'); db.exec(readFileSync(path, 'utf8')); return db; };
const tables = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all().map(row => row.name);
const rows = (db, name) => db.prepare(`SELECT * FROM ${quote(name)}`).all();
const canonical = values => values.map(json).sort();
const inventory = db => Object.fromEntries(tables(db).map(name => [name, { count: rows(db, name).length, sha256: hash(json(canonical(rows(db, name)))) }]));
const schema = db => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all().map(row => ({...row, sql: row.sql?.replace(/\s+/g, ' ').trim()}));
const integrity = db => { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0); };
const checksums = () => Object.fromEntries(migrations.map(name => [name, hash(readFileSync(folder + name))]));
function runPending(db) {
  const applied = new Set(rows(db, 'd1_migrations').map(row => row.name));
  const pending = migrations.filter(name => !applied.has(name));
  for (const name of pending) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(readFileSync(folder + name, 'utf8')); db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').run(name); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    integrity(db);
  }
  return pending;
}
const changedDefaults = new Set(['preview_report_type_guidelines','preview_report_prompt_sets','preview_report_chapter_prompts','preview_report_prompt_source_basis']);
const appendOnly = new Set(['preview_report_type_guideline_history','preview_report_prompt_history','preview_report_template_categories','d1_migrations']);
function preserve(before, after) {
  for (const name of tables(before)) {
    const oldRows = rows(before, name), newRows = rows(after, name);
    if (changedDefaults.has(name)) {
      const key = row => name === 'preview_report_type_guidelines' ? json([row.organization_id,row.claim_type]) : row[name === 'preview_report_prompt_source_basis' ? 'prompt_id' : 'id'];
      const keys = new Set(newRows.map(key));
      assert.ok(oldRows.every(row => keys.has(key(row))), `preserve default record IDs: ${name}`);
      continue;
    }
    if (appendOnly.has(name)) {
      const records = new Set(canonical(newRows));
      assert.ok(canonical(oldRows).every(row => records.has(row)), `preserve complete history: ${name}`);
      continue;
    }
    const projected = newRows.map(row => {
      const copy = {...row};
      if (name === 'preview_users') {
        assert.equal(copy.department_code, copy.is_active === 1 ? 'CLAIM_CENTER' : 'UNASSIGNED');
        delete copy.department_code; if (copy.is_active === 1) copy.version -= 1;
      }
      if (name === 'preview_cases') { assert.equal(copy.client_name, null); delete copy.client_name; }
      if (name === 'preview_ai_credentials' || name === 'preview_ai_credential_history') { assert.equal(copy.provider_workspace_id, null); delete copy.provider_workspace_id; }
      return copy;
    });
    assert.equal(hash(json(canonical(projected))), hash(json(canonical(oldRows))), `preserve every existing value: ${name}`);
  }
}
// Only migration-generated timestamps/UUIDs vary between local rehearsal and D1.
// Existing history rows are still compared byte-for-byte by preserve().
const volatile = {
  preview_report_type_guidelines:['updated_at'], preview_report_prompt_sets:['updated_at'], preview_report_chapter_prompts:['updated_at'],
  preview_report_prompt_source_basis:['analyzed_at'], preview_report_type_guideline_history:['id','changed_at'], preview_report_prompt_history:['id','changed_at'],
  preview_report_template_categories:['updated_at'], preview_report_guideline_packages:['installed_at'], preview_report_guideline_active:['activated_at'],
  d1_migrations:['applied_at'],
};
const normalized = (db, name) => canonical(rows(db,name).map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !(volatile[name] ?? []).includes(key)))));
const [mode, beforePath, otherPath, pin] = process.argv.slice(2);
const before = load(beforePath); integrity(before);
if (mode === 'sign') {
  const manifest = { kind:'CF113_GAOPEN_D1_BACKUP', database:DATABASE, createdAt:new Date().toISOString(), sqlSha256:hash(readFileSync(beforePath)), tables:inventory(before), schemaSha256:hash(json(schema(before))), migrations:checksums() };
  const {publicKey,privateKey} = generateKeyPairSync('ed25519');
  const envelope = {manifest, publicKey:publicKey.export({type:'spki',format:'pem'}), signature:sign(null,Buffer.from(json(manifest)),privateKey).toString('base64')};
  writeFileSync(otherPath,JSON.stringify(envelope,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({valid:true,database:DATABASE,tableCount:tables(before).length,sqlSha256:manifest.sqlSha256,publicKeySha256:hash(envelope.publicKey)}));
} else if (mode === 'verify') {
  const envelope = JSON.parse(readFileSync(otherPath,'utf8'));
  assert.match(pin ?? '',/^[0-9a-f]{64}$/); assert.equal(hash(envelope.publicKey),pin,'independent public key pin');
  assert.ok(verify(null,Buffer.from(json(envelope.manifest)),envelope.publicKey,Buffer.from(envelope.signature,'base64')));
  assert.equal(envelope.manifest.database,DATABASE); assert.equal(hash(readFileSync(beforePath)),envelope.manifest.sqlSha256);
  assert.equal(hash(json(inventory(before))),hash(json(envelope.manifest.tables))); assert.equal(hash(json(schema(before))),envelope.manifest.schemaSha256);
  assert.deepEqual(checksums(),envelope.manifest.migrations);
  console.log(JSON.stringify({valid:true,database:DATABASE,signatureVerified:true,restoreVerified:true,migrationChecksumsVerified:true}));
} else if (mode === 'preflight' || mode === 'compare') {
  const expected = load(beforePath);
  const applied = runPending(expected); assert.deepEqual(applied,migrations,'exact pending migration list');
  preserve(before,expected); const snapshot = inventory(expected);
  assert.deepEqual(runPending(expected),[],'runner second pass is a no-op'); assert.deepEqual(inventory(expected),snapshot);
  if (mode === 'compare') {
    const actual = load(otherPath); integrity(actual); preserve(before,actual);
    assert.deepEqual(tables(actual),tables(expected)); assert.deepEqual(schema(actual),schema(expected));
    for (const name of tables(expected)) assert.equal(hash(json(normalized(actual,name))),hash(json(normalized(expected,name))),`exact migration result: ${name}`);
    actual.close();
  }
  console.log(JSON.stringify({valid:true,mode,database:DATABASE,migrations:applied,preservedTables:tables(before).length,postTables:tables(expected).length,secondRunNoOp:true,checksums:checksums()}));
  expected.close();
} else throw new Error('Use sign before.sql new-manifest.json | verify before.sql manifest.json pinnedKeyHash | preflight before.sql | compare before.sql after.sql');
before.close();
