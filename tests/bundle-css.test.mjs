import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bundlePageCss } from '../scripts/bundle-css.mjs';

void test('page CSS preserves inline cascade boundaries, media and content versioning', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'cp-css-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'wp-content'));
  await writeFile(path.join(root, 'wp-content/a.css'), '.x { color: red; background:url(img.png) }');
  await writeFile(path.join(root, 'wp-content/b.css'), '.x { color: blue }');
  const html = '<head><link rel="stylesheet" href="/wp-content/a.css"><style>.x{color:gold}</style><link rel="stylesheet" href="/wp-content/b.css" media="screen"></head>';
  const out = await bundlePageCss(html, root);
  const links = [...out.matchAll(/href="([^"]+)"/g)].map(x => x[1]);
  assert.equal(links.length, 2);
  assert.ok(out.indexOf(links[0]) < out.indexOf('<style>'));
  assert.ok(out.indexOf(links[1]) > out.indexOf('</style>'));
  assert.match(await readFile(path.join(root, links[0]), 'utf8'), /\/wp-content\/img.png/);
  assert.match(await readFile(path.join(root, links[1]), 'utf8'), /@media screen/);
  await writeFile(path.join(root, 'wp-content/a.css'), '.x { color: green }');
  assert.notEqual(await bundlePageCss(html, root), out);
});
