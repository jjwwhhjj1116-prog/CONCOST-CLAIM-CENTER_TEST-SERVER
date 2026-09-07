// CF114: local-only signed D1 backup, exact trigger migration rehearsal and comparison.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const [mode, database, beforePath, otherPath, pin] = process.argv.slice(2);
assert.ok(['78094a1c-abe0-451d-bc12-68d0d37166d8','16d1f25b-60c8-4489-95ed-4fa7de161c9f'].includes(database), 'explicit release database');
const migration = '0059_cf114_report_workspace_version_guard.sql';
const sql = readFileSync('apps/cloudflare/migrations/' + migration, 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? {blob:Buffer.from(item).toString('base64')} : item);
const load = path => { const db=new DatabaseSync(':memory:'); db.exec(readFileSync(path,'utf8')); return db; };
const tables = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all().map(row=>row.name);
const rows = (db,name) => db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all();
const inventory = db => Object.fromEntries(tables(db).map(name=>[name,{count:rows(db,name).length,sha256:hash(json(rows(db,name).map(json).sort()))}]));
const schema = db => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all().map(row=>({...row,sql:row.sql?.replace(/\s+/g,' ').trim()}));
const integrity = db => { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok'); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]); };
const preserve = (before,after) => {
  assert.deepEqual(tables(before),tables(after));
  for(const name of tables(before)){
    const oldRows=rows(before,name).map(json).sort(), newRows=rows(after,name).map(json).sort();
    if(name==='d1_migrations') assert.ok(oldRows.every(row=>newRows.includes(row)));
    else assert.deepEqual(newRows,oldRows,'preserve every existing value: '+name);
  }
};
const runPending = db => {
  if(rows(db,'d1_migrations').some(row=>row.name===migration))return false;
  db.exec('BEGIN IMMEDIATE');
  try { db.exec(sql); db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').run(migration); db.exec('COMMIT'); }
  catch(error){db.exec('ROLLBACK');throw error;}
  integrity(db); return true;
};
const before=load(beforePath); integrity(before);
if(mode==='sign'){
  const manifest={kind:'CF114_D1_BACKUP',database,createdAt:new Date().toISOString(),sqlSha256:hash(readFileSync(beforePath)),tables:inventory(before),schemaSha256:hash(json(schema(before))),migration,migrationSha256:hash(sql)};
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const envelope={manifest,publicKey:publicKey.export({type:'spki',format:'pem'}),signature:sign(null,Buffer.from(json(manifest)),privateKey).toString('base64')};
  writeFileSync(otherPath,JSON.stringify(envelope,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({valid:true,database,tables:tables(before).length,sqlSha256:manifest.sqlSha256,publicKeySha256:hash(envelope.publicKey)}));
}else if(mode==='verify'){
  const envelope=JSON.parse(readFileSync(otherPath,'utf8'));
  assert.match(pin??'',/^[0-9a-f]{64}$/);assert.equal(hash(envelope.publicKey),pin);
  assert.ok(verify(null,Buffer.from(json(envelope.manifest)),envelope.publicKey,Buffer.from(envelope.signature,'base64')));
  assert.equal(envelope.manifest.database,database);assert.equal(hash(readFileSync(beforePath)),envelope.manifest.sqlSha256);
  assert.deepEqual(inventory(before),envelope.manifest.tables);assert.equal(hash(json(schema(before))),envelope.manifest.schemaSha256);
  assert.equal(hash(sql),envelope.manifest.migrationSha256);
  console.log(JSON.stringify({valid:true,database,signatureVerified:true,restoreVerified:true,checksumsVerified:true}));
}else if(mode==='preflight'||mode==='compare'){
  const expected=load(beforePath);
  assert.equal(runPending(expected),true,'exact pending migration');
  preserve(before,expected);const snapshot=inventory(expected);assert.equal(runPending(expected),false);assert.deepEqual(inventory(expected),snapshot);
  if(mode==='compare'){
    const actual=load(otherPath);integrity(actual);preserve(before,actual);assert.deepEqual(schema(actual),schema(expected));
    const withoutTime=db=>rows(db,'d1_migrations').map(({applied_at,...row})=>json(row)).sort();
    assert.deepEqual(withoutTime(actual),withoutTime(expected));actual.close();
  }
  console.log(JSON.stringify({valid:true,mode,database,preservedTables:tables(before).length,migration,migrationSha256:hash(sql),secondRunNoOp:true}));
  expected.close();
}else throw Error('Use sign|verify|preflight|compare database before.sql [manifest/after.sql] [pin]');
before.close();
