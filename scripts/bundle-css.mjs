import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const STYLESHEET = /<link\b[^>]*\brel=(['"])stylesheet\1[^>]*>/gi;
const attr = (tag, name) => (tag.match(new RegExp(`${name}=(['"])([^'"]*)\\1`, 'i')) || [])[2] || '';

async function htmlFiles(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await htmlFiles(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

// Resolve url(...) and @import targets that are relative to the source file.
function absolutiseUrls(css, cssPath) {
  const dir = path.posix.dirname(cssPath);
  const fix = ref => {
    const value = ref.trim().replace(/^['"]|['"]$/g, '');
    if (!value || /^(data:|https?:|\/|#)/.test(value)) return value;
    return path.posix.normalize(path.posix.join(dir, value));
  };
  return css
    .replace(/url\(\s*([^)]+?)\s*\)/gi, (_, ref) => `url(${fix(ref)})`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (_, q, ref) => `@import ${q}${fix(ref)}${q}`);
}

// Concatenate every local stylesheet a page links (Elementor also injects some in
// the body) into dist/assets/site.css and return the set of hrefs (query stripped)
// that were folded in, so the HTML pass can drop those <link> tags and point at
// the one bundle instead.
export async function bundleCss(distDir) {
  // Home page first so its enqueue order anchors the cascade, then the rest.
  const home = path.join(distDir, 'index.html');
  const files = [home, ...(await htmlFiles(distDir)).filter(f => f !== home).sort((a, b) => a.localeCompare(b))];
  const order = [];
  const seen = new Map(); // href (no query) -> media

  for (const file of files) {
    const html = await readFile(file, 'utf8');
    for (const tag of html.match(STYLESHEET) || []) {
      const href = attr(tag, 'href').split('?')[0];
      if (!href.startsWith('/wp-')) continue;
      if (!seen.has(href)) { seen.set(href, attr(tag, 'media') || 'all'); order.push(href); }
    }
  }
  if (order.length < 2) return new Set();

  const parts = [];
  for (const href of order) {
    let css;
    try { css = await readFile(path.join(distDir, href), 'utf8'); }
    catch { continue; }
    css = absolutiseUrls(css, href);
    const media = seen.get(href);
    if (media && media !== 'all' && media !== 'screen') css = `@media ${media}{\n${css}\n}`;
    parts.push(`/* ${href} */\n${css}`);
  }
  await mkdir(path.join(distDir, 'assets'), { recursive: true });
  await writeFile(path.join(distDir, 'assets', 'site.css'), parts.join('\n\n'));
  return new Set(order);
}

// Drop every bundled stylesheet <link> from a page (head or body) and add one
// bundle link at the end of <head>.
export function relinkCss(html, bundled) {
  if (!bundled.size || !html.includes('</head>')) return html;
  const stripped = html.replace(STYLESHEET, tag => {
    const href = (tag.match(/href=(['"])([^'"]*)\1/) || [])[2] || '';
    return bundled.has(href.split('?')[0]) ? '' : tag;
  });
  return stripped.replace('</head>', '<link rel="stylesheet" href="/assets/site.css"></head>');
}
