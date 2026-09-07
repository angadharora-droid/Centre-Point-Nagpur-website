import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSiteServer, validateEnquiry } from './server.mjs';

async function start(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cp-api-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Home</title>');
  const server = createSiteServer({ staticDir: root, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('serves static files and 404s unknown paths', async t => {
  const base = await start(t);
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<title>Home<\/title>/);
  assert.equal((await fetch(`${base}/missing/`)).status, 404);
  assert.equal((await fetch(`${base}/../../etc/passwd`)).status, 404);
});

test('health reports db state; storage is unconfigured without MONGODB_URI', async t => {
  const base = await start(t);
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.status, 'ok');
  assert.equal(health.db.configured, false);

  const post = await fetch(`${base}/api/enquiries`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A' }),
  });
  assert.equal(post.status, 503);
});

test('CORS: same-origin allowed, listed origin echoed, others rejected', async t => {
  const base = await start(t, { origins: 'https://allowed.example' });
  const host = base.replace('http://', '');

  let res = await fetch(`${base}/api/health`, { headers: { Origin: base } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), base);

  res = await fetch(`${base}/api/health`, { headers: { Origin: 'https://allowed.example' } });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://allowed.example');

  res = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.ok(host);
});

test('GET /api/enquiries requires the admin token', async t => {
  const base = await start(t, { adminToken: 'secret' });
  assert.equal((await fetch(`${base}/api/enquiries`)).status, 401);
  assert.equal((await fetch(`${base}/api/enquiries`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  // Correct token, but storage still unconfigured in this test:
  assert.equal((await fetch(`${base}/api/enquiries`, { headers: { Authorization: 'Bearer secret' } })).status, 503);
});

test('enquiry validation', () => {
  const bad = validateEnquiry({ name: 'X', email: 'not-an-email' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['email', 'eventDate', 'eventType', 'guests', 'meals', 'name', 'phone']);

  const ok = validateEnquiry({
    name: 'Asha Rao', email: 'asha@example.com', phone: '+91 90000 00000',
    eventType: 'Wedding', eventDate: '12/25/2026', guests: '250', meals: 'Dinner',
    message: 'Sangeet + reception', page: '/banquet-hall/',
  });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.data.name, 'Asha Rao');
  assert.equal(ok.data.message.length <= 4000, true);
});
