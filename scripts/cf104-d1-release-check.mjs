// Local deployment backup checks only. Never connects to D1 or prints database contents.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [mode,beforePath,otherPath,pinnedPublicKeyHash]=process.argv.slice(2);
const digest=value=>createHash('sha256').update(value).digest('hex');
const load=path=>{const db=new DatabaseSync(':memory:');db.exec(readFileSync(path,'utf8'));return db;};
const select=(db,sql)=>{const statement=db.prepare(sql);const columns=statement.columns().map(column=>column.name);return {columns,values:statement.all().map(row=>columns.map(column=>row[column]))};};
const rows=(db,sql)=>select(db,sql).values;
const quoted=name=>'"'+name.replaceAll('"','""')+'"';
const canonicalRow=row=>JSON.stringify(row,(_key,value)=>value instanceof Uint8Array?{blob:Buffer.from(value).toString('base64')}:value);
const table=(db,name)=>{
  const result=select(db,`SELECT * FROM ${quoted(name)}`);
  const records=(result?.values??[]).map(canonicalRow).sort();
  return {count:records.length,sha256:digest(JSON.stringify([result?.columns??rows(db,`PRAGMA table_info(${quoted(name)})`).map(row=>row[1]),records]))};
};
const inventory=db=>Object.fromEntries(rows(db,"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").map(([name])=>[name,table(db,name)]));
const schema=db=>rows(db,"SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").map(row=>row.map(value=>typeof value==='string'?value.replace(/\s+/g,' ').trim():value));
const integrity=db=>{assert.equal(rows(db,'PRAGMA integrity_check')[0]?.[0],'ok','integrity check');assert.equal(rows(db,'PRAGMA foreign_key_check').length,0,'foreign keys');};

if(mode==='sign'){
  const db=load(beforePath);integrity(db);
  const manifest={kind:'CF104_D1_SQL_BACKUP',database:'16d1f25b-60c8-4489-95ed-4fa7de161c9f',createdAt:new Date().toISOString(),sqlSha256:digest(readFileSync(beforePath)),tables:inventory(db),schemaSha256:digest(JSON.stringify(schema(db)))};
  const payload=JSON.stringify(manifest);const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const envelope={manifest,publicKey:publicKey.export({type:'spki',format:'pem'}),signature:sign(null,Buffer.from(payload),privateKey).toString('base64')};
  assert.ok(verify(null,Buffer.from(payload),publicKey,Buffer.from(envelope.signature,'base64')));
  writeFileSync(otherPath,JSON.stringify(envelope,null,2),{flag:'wx',mode:0o600});
  db.close();console.log(JSON.stringify({valid:true,tableCount:Object.keys(manifest.tables).length,sqlSha256:manifest.sqlSha256,publicKeySha256:digest(envelope.publicKey),manifest:resolve(otherPath)}));
}else if(mode==='verify'){
  const envelope=JSON.parse(readFileSync(otherPath,'utf8'));
  assert.match(pinnedPublicKeyHash??'',/^[0-9a-f]{64}$/,'independently recorded public key fingerprint is required');
  assert.equal(digest(envelope.publicKey),pinnedPublicKeyHash,'pinned public key fingerprint');
  assert.ok(verify(null,Buffer.from(JSON.stringify(envelope.manifest)),envelope.publicKey,Buffer.from(envelope.signature,'base64')),'signature');
  assert.equal(digest(readFileSync(beforePath)),envelope.manifest.sqlSha256,'backup SQL hash');
  const db=load(beforePath);integrity(db);assert.deepEqual(inventory(db),envelope.manifest.tables);assert.equal(digest(JSON.stringify(schema(db))),envelope.manifest.schemaSha256);db.close();
  console.log(JSON.stringify({valid:true,sqlSha256:envelope.manifest.sqlSha256,publicKeySha256:digest(envelope.publicKey)}));
}else if(mode==='preflight'){
  const db=load(beforePath);integrity(db);const original=inventory(db);
  const migration=readFileSync('apps/cloudflare/migrations/0058_cf104_evidence_versions.sql','utf8');
  db.exec('BEGIN IMMEDIATE');db.exec(migration);
  const migrated=inventory(db);
  for(const [name,value] of Object.entries(original))assert.deepEqual(migrated[name],value,`preserve ${name}`);
  db.exec("INSERT INTO d1_migrations(name) VALUES ('0058_cf104_evidence_versions.sql')");db.exec('COMMIT');integrity(db);db.close();
  writeFileSync(otherPath,readFileSync(beforePath,'utf8')+'\n'+migration+"\nINSERT INTO d1_migrations(name) VALUES ('0058_cf104_evidence_versions.sql');\n",{flag:'wx',mode:0o600});
  console.log(JSON.stringify({valid:true,engine:'Node SQLite on local restored business-data copy',preservedTables:Object.keys(original).length,output:resolve(otherPath)}));
}else if(mode==='compare'){
  const before=load(beforePath);const actual=load(otherPath);integrity(before);integrity(actual);
  const original=inventory(before);const oldLedger=rows(before,'SELECT name FROM d1_migrations ORDER BY name').flat();
  const oldLedgerRows=rows(before,'SELECT * FROM d1_migrations ORDER BY name');
  before.exec(readFileSync('apps/cloudflare/migrations/0058_cf104_evidence_versions.sql','utf8'));integrity(before);
  const expected=inventory(before);const after=inventory(actual);
  for(const [name,entry] of Object.entries(expected))if(name!=='d1_migrations')assert.deepEqual(after[name],entry,`preserve ${name}`);
  assert.deepEqual(Object.keys(after),Object.keys(expected),'table inventory');assert.deepEqual(schema(actual),schema(before),'schema matches exact migration');
  assert.deepEqual(rows(actual,'SELECT name FROM d1_migrations ORDER BY name').flat(),[...oldLedger,'0058_cf104_evidence_versions.sql'].sort(),'migration ledger');
  assert.deepEqual(rows(actual,"SELECT * FROM d1_migrations WHERE name<>'0058_cf104_evidence_versions.sql' ORDER BY name"),oldLedgerRows,'preserve complete old migration records');
  console.log(JSON.stringify({valid:true,preservedTables:Object.keys(original).filter(name=>name!=='d1_migrations').length,newEmptyTables:Object.keys(after).filter(name=>!original[name]),beforeRows:Object.fromEntries(Object.entries(original).filter(([name])=>name!=='d1_migrations').map(([name,value])=>[name,value.count]))}));
  before.close();actual.close();
}else throw new Error('Use sign <backup.sql> <new-manifest.json>, verify <backup.sql> <manifest.json> <pinned-public-key-sha256>, preflight <before.sql> <new-local-after.sql>, or compare <before.sql> <after.sql>');
