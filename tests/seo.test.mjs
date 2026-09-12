import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { optimizePage, seoSettings } from '../scripts/seo.mjs';

const settings = seoSettings({ PUBLIC_SITE_URL: 'https://hotel.example', VERCEL_ENV: 'production' });
const styles = html => [...html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].map(m => m[0]);
const stylesheetLinks = html => [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)].map(m => m[0]);

test('SEO preserves every page body, inline style and original stylesheet reference', async () => {
  const titles = new Set(); let pages = 0; let indexed = 0;
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.name === 'index.html') {
        const original = await readFile(file, 'utf8');
        const route = '/' + path.relative('site', file).split(path.sep).join('/').replace(/index\.html$/, '');
        const { html, canonical, indexable } = optimizePage(original, route, settings);
        assert.equal(html.split('</head>')[1], original.split('</head>')[1], route + ' body changed');
        assert.deepEqual(styles(html), styles(original), route + ' style changed');
        assert.deepEqual(stylesheetLinks(html), stylesheetLinks(original), route + ' fonts/stylesheets changed');
        // Original Elementor HTML widgets embed nested documents, so only the document head is checked.
        const head = html.split('</head>')[0];
        assert.equal((head.match(/<title>/g) || []).length, 1, route + ' head title count');
        assert.equal((head.match(/name="description"/g) || []).length, 1);
        assert.equal((head.match(/name="robots"/g) || []).length, 1);
        assert.equal((head.match(/rel="canonical"/g) || []).length, 1);
        assert.equal(canonical, 'https://hotel.example' + route);
        const schema = head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
        assert.ok(JSON.parse(schema)['@graph'].length >= 2);
        if (indexable) {
          const title = head.match(/<title>(.*?)<\/title>/)[1];
          assert.ok(!titles.has(title), 'Duplicate title: ' + title);
          titles.add(title); indexed++;
          assert.ok(!head.match(/name="robots" content="noindex/));
        }
        pages++;
      }
    }
  }
  await walk('site');
  assert.equal(pages, 37); // 36 captured hotel pages + the staff-only /admin/ dashboard
  assert.equal(indexed, 34);
});

test('the staff admin dashboard is titled for its purpose and never indexed', () => {
  const html = '<html><head><title>x</title></head><body></body></html>';
  const { html: out, indexable } = optimizePage(html, '/admin/', settings);
  assert.equal(indexable, false);
  assert.match(out, /<title>Enquiries — Staff<\/title>/);
  assert.match(out, /name="robots" content="noindex,follow"/);
});

test('production domain validation and preview indexing', () => {
  // No config: default live domain, indexable.
  assert.equal(seoSettings({}).origin, 'https://centrepointnagpur.com');
  assert.equal(seoSettings({}).indexable, true);
  // Non-production environments stay out of the index.
  assert.equal(seoSettings({ VERCEL_ENV: 'preview' }).indexable, false);
  assert.equal(seoSettings({ RAILWAY_ENVIRONMENT_NAME: 'pr-42' }).indexable, false);
  assert.equal(seoSettings({ RAILWAY_ENVIRONMENT_NAME: 'production' }).indexable, true);
  // PUBLIC_SITE_URL overrides the origin.
  assert.equal(seoSettings({ PUBLIC_SITE_URL: 'https://hotel.example' }).origin, 'https://hotel.example');
  assert.equal(seoSettings({ VERCEL_PROJECT_PRODUCTION_URL: 'hotel.vercel.app', VERCEL_ENV: 'production' }).origin, 'https://hotel.vercel.app');
  for (const value of ['http://hotel.example','https://hotel.example/path','https://secret@hotel.example','https://hotel.example/?q=1']) {
    assert.throws(() => seoSettings({ PUBLIC_SITE_URL: value }));
  }
});
