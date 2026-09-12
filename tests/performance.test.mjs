import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deferScripts, rewriteImages } from '../scripts/performance.mjs';

void test('deferred scripts retain dependency order and leave data scripts intact', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'cp-js-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = await deferScripts('<script src="/jquery.js"></script><script>jQuery(init)</script><script type="application/ld+json">{}</script>', root);
  assert.match(out, /^<script src="\/jquery.js" defer><\/script>/);
  const url = out.match(/src="(\/assets\/inline.[^"]+)"/)[1];
  assert.equal(await readFile(path.join(root, url), 'utf8'), 'jQuery(init)');
  assert.ok(out.endsWith('<script type="application/ld+json">{}</script>'));
});

void test('images use explicit WebP with accurate width descriptors and fallback sizes', () => {
  const variants = [{width:480,url:'/assets/s.webp'},{width:1280,url:'/assets/l.webp'}];
  const map = new Map([['/wp-content/hero.jpg', variants], ['/assets/brochure.png', variants]]);
  const out = rewriteImages('<img src="/wp-content/hero.jpg" srcset="/wp-content/old.jpg 2560w"><img src="/assets/brochure.png"><style>.hero{background:url(/wp-content/hero.jpg)}</style>', map);
  assert.match(out, /src="\/assets\/l.webp"/);
  assert.match(out, /srcset="\/assets\/s.webp 480w, \/assets\/l.webp 1280w"/);
  assert.ok(!out.includes('/assets/brochure.png'));
  assert.ok(!out.includes('2560w'));
  assert.match(out, /background:url\(\/assets\/l.webp\)/);
});

void test('responsive backgrounds do not rewrite CSS-looking strings in scripts', async () => {
  const { responsiveBackgroundCss } = await import('../scripts/performance.mjs');
  const variants = [{width:768,url:'/assets/image-768.aaaaaaaaaaaaaaaa.webp'}, {width:1920,url:'/assets/image-1920.bbbbbbbbbbbbbbbb.webp'}];
  const map = new Map([['/wp-content/hero.jpg', variants]]);
  const html = rewriteImages('<script>const x = "url(/wp-content/hero.jpg)";</script><style>.hero{background:url(/wp-content/hero.jpg)}</style>', map);
  assert.match(html, /const x = "url\(\/assets\/image-1920.bbbbbbbbbbbbbbbb.webp\)"/);
  assert.match(html, /background:var\(--cp-image-/);
  assert.match(responsiveBackgroundCss(map), /max-width:767px/);
  assert.match(responsiveBackgroundCss(map), /image-768.aaaaaaaaaaaaaaaa.webp/);
});

void test('plugin removal keeps sliders and carts when corresponding UI exists', async () => {
  const { removeUnusedPlugins } = await import('../scripts/performance.mjs');
  const script = '<script src="/wp-content/plugins/LayerSlider/slider.js"></script>';
  assert.equal(removeUnusedPlugins(script), '');
  assert.ok(removeUnusedPlugins('<div class="ls-wp-container"></div>' + script).includes('slider.js'));
  const shop = '<link rel="stylesheet" href="/wp-content/plugins/woocommerce/shop.css">';
  assert.equal(removeUnusedPlugins(shop), '');
  assert.ok(removeUnusedPlugins('<form class="woocommerce-checkout"></form>' + shop).includes('shop.css'));
});
