// Restore a signed export to a NEW isolated Wrangler SQLite store, never a live DB.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const [source, target] = process.argv.slice(2);
const destination = resolve(target);
assert.ok(destination.startsWith(resolve('tmp') + sep));
assert.ok(destination.endsWith('.sqlite'));
assert.ok(!existsSync(destination), 'never overwrite a database');
mkdirSync(dirname(destination), { recursive: true });
const db = new DatabaseSync(destination);
try {
  db.exec(readFileSync(source, 'utf8'));
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM d1_migrations WHERE name='0061_cf117_hourly_backup_pattern.sql'").get().n, 0);
  console.log(JSON.stringify({ restored: true, pending: '0061', path: destination }));
} finally { db.close(); }
