import { applySeo } from './seo.mjs';
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
function localizeLinks(html) {
  return html
    .replaceAll(`href="${sourceOrigin}/`, 'href="/')
    .replaceAll(`href="${sourceOrigin}"`, 'href="/"')
    .replaceAll(`action="${sourceOrigin}/`, 'action="/')
    .replaceAll(`action="${sourceOrigin}"`, 'action="/"');
}
async function connectPages(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await connectPages(file);
    else if (entry.name.endsWith('.html')) {
      const html = await readFile(file, 'utf8');
      await writeFile(file, localizeLinks(html).replace('</head>', '<script defer src="/runtime-config.js"></script><script defer src="/api-client.js"></script><script defer src="/forms.js"></script></head>'));
    }
  }
}
await connectPages('dist');
await applySeo('dist');
console.log(`Built ${report.pages.length} pages. API origin: ${apiBaseUrl || 'same origin (/api)'}.`);
