import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSiteServer } from '../scripts/serve.mjs';

test('site server serves static files, the API and a 404 from one origin', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'cp-serve-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Home</title>');
  const server = createSiteServer(root);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(await home.text(), /<title>Home<\/title>/);

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');

  assert.equal((await fetch(`${base}/api/missing`)).status, 404);
  assert.equal((await fetch(`${base}/nope/`)).status, 404);

  // Directory traversal stays inside the static root.
  assert.equal((await fetch(`${base}/../../etc/passwd`)).status, 404);
});
