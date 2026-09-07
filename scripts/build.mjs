import { applySeo } from './seo.mjs';
import { bundleCss, relinkCss } from './bundle-css.mjs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('site', 'dist', { recursive: true });
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

// Only the first sizeable image on a page (the LCP candidate) loads eagerly;
// every other image — including slider slides the theme marked eager — is lazied.
const TINY_IMG = /\b(?:mobile-icon|icon|logo|Untitled-298|favicon|spinner|loader)\b/i;
function lazyLoadImages(html) {
  let lcpDone = false;
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const width = Number((tag.match(/\bwidth=["']?(\d+)/i) || [])[1] || 0);
    const sizeable = !TINY_IMG.test(tag) && (width === 0 || width >= 200);
    const decoding = /\bdecoding\s*=/.test(tag) ? '' : ' decoding="async"';
    let want;
    if (sizeable && !lcpDone) { want = 'eager'; lcpDone = true; }
    else want = 'lazy';
    const withoutLoading = tag.replace(/\s+loading\s*=\s*["'][^"']*["']/i, '');
    return withoutLoading.replace(/<img\b/i, `<img${decoding} loading="${want}"`);
  });
}

const HEAD_ADDITIONS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<script defer src="/runtime-config.js"></script>',
  '<script defer src="/api-client.js"></script>',
  '<script defer src="/forms.js"></script>',
].join('');

// Fold the many render-blocking <head> stylesheets into one cached bundle.
const bundledCss = await bundleCss('dist');

async function connectPages(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await connectPages(file);
    else if (entry.name.endsWith('.html')) {
      const html = await readFile(file, 'utf8');
      const out = relinkCss(lazyLoadImages(localizeLinks(html)), bundledCss).replace('</head>', `${HEAD_ADDITIONS}</head>`);
      await writeFile(file, out);
    }
  }
}
await connectPages('dist');
await applySeo('dist');
const bundleKb = bundledCss.size ? Math.round((await readFile('dist/assets/site.css')).length / 1024) : 0;
console.log(`Built ${report.pages.length} pages. CSS bundle: ${bundledCss.size} files, ${bundleKb} KB. API origin: ${apiBaseUrl || 'same origin (/api)'}.`);
