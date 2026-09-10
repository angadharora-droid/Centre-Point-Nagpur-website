import { applySeo } from './seo.mjs';
import { bundlePageCss } from './bundle-css.mjs';
import { prepareImages, rewriteImages, deferScripts, filesIn, removeUnusedPlugins, responsiveBackgroundCss, asset } from './performance.mjs';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { imageSizeOf } from './image-size.mjs';
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(await readFile('mirror-report.json', 'utf8'));
if (!report.pages.length) throw new Error('No captured pages');
// The site and API are served from one Railway service, so the frontend calls /api
// on its own origin by default. PUBLIC_API_BASE_URL only needs setting if the API is
// ever split onto a separate origin.
const rawOrigin = process.env.PUBLIC_API_BASE_URL?.trim() || '';
let apiBaseUrl = '';
if (rawOrigin) {
  const url = new URL(rawOrigin);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('PUBLIC_API_BASE_URL must be an HTTPS origin (HTTP allowed for localhost), without credentials, paths or query strings');
  }
  apiBaseUrl = url.origin;
}
let runtimeOnly = process.argv.includes('--runtime-only');
try { await access('dist/index.html'); } catch { runtimeOnly = false; }
if (!runtimeOnly) {
  await rm('dist', { recursive: true, force: true });
  await mkdir('dist', { recursive: true });
  await cp('site', 'dist', { recursive: true });
}
await writeFile('dist/runtime-config.js', `window.CENTREPOINT_CONFIG = Object.freeze(${JSON.stringify({ apiBaseUrl })});\n`);
await writeFile('dist/api-client.js', `window.centrePointApi = Object.freeze({
  async health() {
    const base = window.CENTREPOINT_CONFIG.apiBaseUrl || '';
    const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Backend returned ' + response.status);
    return response.json();
  }
});\n`);
await cp(path.join(here, 'assets', 'forms.js'), 'dist/forms.js');
// Rewrite on-site links so navigation (logo, menus, footer) stays within this copy
// instead of jumping to the live original site. The captured pages in site/ keep the
// absolute URLs; only the built output in dist/ is localised.
const sourceOrigin = new URL(report.source).origin;
const escapedOrigin = sourceOrigin.replaceAll('/', '\\/'); // as it appears in inline JSON/JS
function localizeLinks(html) {
  return html
    .replaceAll(`href="${sourceOrigin}/`, 'href="/')
    .replaceAll(`href="${sourceOrigin}"`, 'href="/"')
    .replaceAll(`action="${sourceOrigin}/`, 'action="/')
    .replaceAll(`action="${sourceOrigin}"`, 'action="/"')
    // Script config vars (ajaxurl, REST roots, …) → same-origin so they hit this server.
    .replaceAll(`"${escapedOrigin}\\/`, '"\\/')
    .replaceAll(`'${sourceOrigin}/`, "'/");
}

// Only the first sizeable image on a page (the LCP candidate) loads eagerly; every
// other image — including slider slides the theme marked eager — is lazied. Also
// stamp intrinsic width/height on <img> that lack them so the layout doesn't shift.
const TINY_IMG = /\b(?:mobile-icon|icon|logo|Untitled-298|favicon|spinner|loader)\b/i;
const dimCache = new Map();

async function dimsFor(src) {
  const clean = src.split(/[?#]/)[0];
  if (!clean.startsWith('/')) return null;
  if (!dimCache.has(clean)) dimCache.set(clean, await imageSizeOf(path.join('dist', clean)));
  return dimCache.get(clean);
}

async function processImages(html) {
  const tags = [...html.matchAll(/<img\b[^>]*>/gi)];
  let lcpDone = false;
  let result = '';
  let last = 0;
  for (const match of tags) {
    let tag = match[0];
    const declaredWidth = Number((tag.match(/\bwidth=["']?(\d+)/i) || [])[1] || 0);
    const sizeable = !TINY_IMG.test(tag) && (declaredWidth === 0 || declaredWidth >= 200);
    const want = sizeable && !lcpDone ? 'eager' : 'lazy';
    if (want === 'eager') {
      lcpDone = true;
      tag = tag.replace(/\sfetchpriority=(["']).*?\1/gi, '').replace(/<img\b/i, '<img fetchpriority="high"');
    }

    if (!/\bwidth=/i.test(tag) || !/\bheight=/i.test(tag)) {
      const src = (tag.match(/\bsrc=["']([^"']+)["']/i) || [])[1];
      const dims = src ? await dimsFor(src) : null;
      if (dims) tag = tag.replace(/<img\b/i, `<img width="${dims.width}" height="${dims.height}"`);
    }
    const decoding = /\bdecoding\s*=/.test(tag) ? '' : ' decoding="async"';
    tag = tag.replace(/\s+loading\s*=\s*["'][^"']*["']/i, '').replace(/<img\b/i, `<img${decoding} loading="${want}"`);

    result += html.slice(last, match.index) + tag;
    last = match.index + match[0].length;
  }
  return result + html.slice(last);
}

const HEAD_ADDITIONS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<script defer src="/runtime-config.js"></script>',
  '<script defer src="/api-client.js"></script>',
  '<script defer src="/forms.js"></script>',
].join('');

// Fold the many render-blocking <head> stylesheets into one cached bundle.
if (!runtimeOnly) {
const runtimeContent = (await Promise.all((await filesIn('site')).filter(f => f.endsWith('.js')).map(f => readFile(f, 'utf8')))).join('\n');
const images = await prepareImages('dist');
const rewrite = html => rewriteImages(html, images);

async function connectPages(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await connectPages(file);
    else if (entry.name.endsWith('.html')) {
      const html = await readFile(file, 'utf8');
      const prepared = rewrite(await processImages(removeUnusedPlugins(localizeLinks(html))));
      const styled = await bundlePageCss(prepared, 'dist', css => rewriteImages(css, images, true), runtimeContent);
      const out = await deferScripts(styled.replace('</head>', `${HEAD_ADDITIONS}</head>`), 'dist');
      await writeFile(file, out);
    }
  }
}
await connectPages('dist');
const backgrounds = await asset('dist', 'backgrounds', 'css', responsiveBackgroundCss(images));
for (const file of (await filesIn('dist')).filter(f => f.endsWith('.html'))) {
  const html = await readFile(file, 'utf8');
  await writeFile(file, html.replace('</head>', `<link rel="stylesheet" href="${backgrounds}"></head>`));
}
}
await applySeo('dist');
// Precompress at build time: first requests never pay the compression cost.
for (const file of await filesIn('dist')) {
  if (!/\.(html|css|js|mjs|json|svg|xml|txt)$/.test(file)) continue;
  if (runtimeOnly && !file.endsWith('.html') && !['runtime-config.js', 'api-client.js', 'forms.js', 'robots.txt', 'sitemap.xml'].includes(path.basename(file))) continue;
  const body = await readFile(file);
  if (body.length <= 512) continue;
  await writeFile(file + '.br', brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }));
  await writeFile(file + '.gz', gzipSync(body, { level: 6 }));
}
console.log(`Built ${report.pages.length} pages with versioned CSS, deferred scripts, responsive WebP and precompressed text. API origin: ${apiBaseUrl || 'same origin (/api)'}.`);
