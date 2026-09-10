import test from 'node:test';
import assert from 'node:assert/strict';
import { relinkCss } from '../scripts/bundle-css.mjs';

const bundled = new Set(['/wp-content/themes/hoteller/css/core/screen.css', '/wp-content/themes/hoteller-child/style.css']);

test('relinkCss keeps the bundle where the first stylesheet was, ahead of the Customizer inline styles', () => {
  const html = [
    '<head>',
    '<link rel="stylesheet" href="/wp-content/themes/hoteller/css/core/screen.css?ver=1">',
    '<style id="hoteller-screen-inline-css">.x{}</style>',
    '<link rel="stylesheet" href="/wp-content/themes/hoteller-child/style.css?ver=1">',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto">',
    '<style id="wp-custom-css">.y{}</style>',
    '<style id="kirki-inline-styles">body{color:#b8860b}</style>',
    '</head>',
  ].join('');

  const out = relinkCss(html, bundled);

  // Exactly one bundle link, and it sits before both inline override blocks.
  assert.equal((out.match(/\/assets\/site\.css/g) || []).length, 1);
  assert.ok(out.indexOf('/assets/site.css') < out.indexOf('wp-custom-css'));
  assert.ok(out.indexOf('/assets/site.css') < out.indexOf('kirki-inline-styles'));
  // Non-bundled stylesheets (Google Fonts) and inline styles are left intact.
  assert.ok(out.includes('fonts.googleapis.com'));
  assert.ok(out.includes('id="kirki-inline-styles"'));
  // Bundled <link> tags are gone.
  assert.ok(!out.includes('hoteller-child/style.css'));
  assert.ok(!out.includes('core/screen.css'));
});

test('relinkCss falls back to </head> when a page links none of the bundled sheets', () => {
  const html = '<head><link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto"></head>';
  const out = relinkCss(html, bundled);
  assert.equal((out.match(/\/assets\/site\.css/g) || []).length, 1);
  assert.ok(out.includes('fonts.googleapis.com'));
  assert.ok(out.endsWith('<link rel="stylesheet" href="/assets/site.css"></head>'));
});

test('relinkCss is a no-op with an empty bundle', () => {
  const html = '<head><link rel="stylesheet" href="/wp-content/themes/hoteller-child/style.css"></head>';
  assert.equal(relinkCss(html, new Set()), html);
});
