import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const origins = {
  development: 'https://concost-claim-center-development.jjwwhhjj1116.workers.dev',
  gaopen: 'https://concost-claim-center-preview.jjwwhhjj1116.workers.dev',
};
const targets = process.argv.slice(2);
assert.ok(targets.length && targets.every((name) => Object.hasOwn(origins, name)), 'Use development or gaopen');
const dist = new URL('../apps/web/dist/', import.meta.url);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const request = (url) => fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
const assets = (await readdir(new URL('assets/', dist))).filter((name) => /\.(js|css)$/.test(name));
for (const name of targets) {
  const origin = origins[name];
  const checks = {};
  for (const path of ['/health', '/readiness']) {
    const response = await request(origin + path);
    assert.equal(response.status, 200, `${name} ${path}`);
    const body = await response.json();
    assert.equal(body.status, path === '/health' ? 'ok' : 'ready');
    checks[path] = body;
  }
  const protectedDocument = await request(origin + '/api/report-finalizations/00000000-0000-4000-8000-000000000001/document');
  assert.equal(protectedDocument.status, 401, `${name} anonymous snapshot access`);
  const page = await request(origin + '/reports/studio');
  assert.equal(page.status, 200);
  const html = await page.text();
  const hashes = {};
  for (const asset of assets) {
    const local = await readFile(new URL('assets/' + asset, dist));
    const remote = await request(origin + '/assets/' + asset);
    assert.equal(remote.status, 200, `${name} ${asset}`);
    hashes[asset] = sha(Buffer.from(await remote.arrayBuffer()));
    assert.equal(hashes[asset], sha(local), `${name} asset mismatch: ${asset}`);
    if (/^index-[^.]+\.(js|css)$/.test(asset) && local.length > 400_000) assert.ok(html.includes(asset), `${name} HTML points to current ${asset}`);
  }
  console.log(JSON.stringify({ passed: true, name, origin, checks, anonymousSnapshotStatus: protectedDocument.status, assets: hashes }));
}
