import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from './server.mjs';

test('health check, allowed frontend, rejected origin and missing routes', async t => {
  const server = createServer({ origins: 'https://hotel.vercel.app' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
  response = await fetch(`${base}/api/health`, { headers: { Origin: 'https://hotel.vercel.app' } });
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://hotel.vercel.app');
  response = await fetch(`${base}/api/health`, { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(`${base}/api/missing`)).status, 404);
  assert.equal((await fetch(`${base}/api/health`, { method: 'POST' })).status, 405);
});
