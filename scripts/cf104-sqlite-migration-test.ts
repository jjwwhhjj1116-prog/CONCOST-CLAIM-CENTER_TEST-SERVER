import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { databaseUrlFor, migrateDatabase } from '../packages/database/src/db-engine';

test('CF104 actual SQLite migration runner preserves populated identities and checksums on repeat', async () => {
  const SQL=await initSqlJs();const db=new SQL.Database();db.exec('PRAGMA foreign_keys=ON');
  const migrationName='20260903160000_cf104_evidence_versions';
  const directory=resolve('packages/database/prisma/migrations');
  db.exec('CREATE TABLE "_P04Migration" (name TEXT PRIMARY KEY,checksum TEXT NOT NULL,appliedAt TEXT NOT NULL)');
  for(const name of readdirSync(directory).filter(name=>name!==migrationName).sort()){
    let sql:string;try{sql=readFileSync(join(directory,name,'migration.sql'),'utf8');}catch{continue;}
    db.exec(sql);db.run('INSERT INTO "_P04Migration" VALUES(?,?,?)',[name,createHash('sha256').update(sql).digest('hex'),'2026-09-03T00:00:00Z']);
  }
  db.run('INSERT INTO Organization(id,name,createdAt,updatedAt) VALUES(?,?,?,?)',['cf104-preserved-org','보존 검수 조직','2026-09-03T00:00:00Z','2026-09-03T00:00:00Z']);
  db.run('INSERT INTO User(id,email,passwordHash,name,organizationId,isActive,createdAt,updatedAt) VALUES(?,?,?,?,?,1,?,?)',['cf104-preserved-user','qa@example.invalid','synthetic-not-a-credential','보존 검수 회원','cf104-preserved-org','2026-09-03T00:00:00Z','2026-09-03T00:00:00Z']);
  db.run('INSERT INTO CaseItem(id,organizationId,caseNumber,title,claimType,updatedAt) VALUES(?,?,?,?,?,?)',['cf104-preserved-case','cf104-preserved-org','CF104-TEST','보존 검수 프로젝트','TYPE-01','2026-09-03T00:00:00Z']);
  db.run('INSERT INTO Document(id,caseId,title,source,updatedAt) VALUES(?,?,?,?,?)',['cf104-preserved-doc','cf104-preserved-case','보존 원본','RECEIVED','2026-09-03T00:00:00Z']);
  db.run('INSERT INTO DocumentVersion(id,documentId,versionNumber,originalName,displayName,storageKey,fileSize,mimeType,sha256,uploadedById) VALUES(?,?,1,?,?,?,?,?,?,?)',['cf104-preserved-version','cf104-preserved-doc','원본.txt','원본.txt','synthetic-original.txt',8,'text/plain',createHash('sha256').update('original').digest('hex'),'cf104-preserved-user']);
  const identityQuery='SELECT * FROM Organization;SELECT * FROM User;SELECT * FROM CaseItem;SELECT * FROM Document;SELECT * FROM DocumentVersion;';
  const identities=JSON.stringify(db.exec(identityQuery));
  const ledger=JSON.stringify(db.exec('SELECT name,checksum FROM _P04Migration ORDER BY name'));
  const output=resolve('outputs/cf104');mkdirSync(output,{recursive:true});
  const path=join(mkdtempSync(join(output,'migration-')),'isolated.db');writeFileSync(path,db.export());db.close();
  await migrateDatabase(databaseUrlFor(path));
  let migrated=new SQL.Database(readFileSync(path));
  assert.equal(JSON.stringify(migrated.exec(identityQuery)),identities);
  assert.equal(JSON.stringify(migrated.exec(`SELECT name,checksum FROM _P04Migration WHERE name<>'${migrationName}' ORDER BY name`)),ledger);
  assert.equal(migrated.exec('PRAGMA integrity_check')[0].values[0][0],'ok');assert.equal(migrated.exec('PRAGMA foreign_key_check').length,0);
  migrated.exec('PRAGMA foreign_keys=ON');
  migrated.run('INSERT INTO EvidenceVersion(id,organizationId,caseId,category,documentVersionId,groupId,versionNumber) VALUES(?,?,?,?,?,?,1)',['cf104-v1','cf104-preserved-org','cf104-preserved-case','MEETING_MINUTES','cf104-preserved-version','cf104-group']);
  migrated.run('INSERT INTO EvidenceVersion(id,organizationId,caseId,category,groupId,versionNumber,supersedesId) VALUES(?,?,?,?,?,2,?)',['cf104-v2','cf104-preserved-org','cf104-preserved-case','MEETING_MINUTES','cf104-group','cf104-v1']);
  assert.deepEqual(migrated.exec('SELECT id,isLatest FROM EvidenceVersion ORDER BY versionNumber')[0].values,[['cf104-v1',0],['cf104-v2',1]]);
  assert.throws(()=>migrated.exec("UPDATE EvidenceVersion SET versionNumber=4 WHERE id='cf104-v2'"),/immutable/);
  assert.throws(()=>migrated.exec("DELETE FROM EvidenceVersion WHERE id='cf104-v1'"),/retained/);
  assert.equal(migrated.exec('PRAGMA foreign_key_check').length,0);
  const after=JSON.stringify(migrated.exec('SELECT name,checksum FROM _P04Migration ORDER BY name'));writeFileSync(path,migrated.export());migrated.close();
  await migrateDatabase(databaseUrlFor(path));migrated=new SQL.Database(readFileSync(path));
  assert.equal(JSON.stringify(migrated.exec('SELECT name,checksum FROM _P04Migration ORDER BY name')),after);
  assert.deepEqual(migrated.exec('SELECT id,isLatest FROM EvidenceVersion ORDER BY versionNumber')[0].values,[['cf104-v1',0],['cf104-v2',1]]);
  assert.equal(JSON.stringify(migrated.exec(identityQuery)),identities);migrated.close();
});
