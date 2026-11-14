import { createHash } from 'node:crypto';

// The site was captured from WordPress, so its files sat under /wp-content/ and
// /wp-includes/: folder names that plugin-detector extensions read plugin and theme
// names from. The build moves them to neutral paths and rewrites every reference;
// the server redirects the old paths (cached stylesheets, image search, link
// previews) to the new ones. Both sides derive paths from this one function.
const code = value => createHash('sha256').update(value).digest('hex').slice(0, 8);

// '/wp-content/plugins/elementor/a.js' -> '/static/<code>/a.js'; anything else unchanged.
export function neutralPath(pathname) {
  if (pathname === '/wp-admin/admin-ajax.php') return '/ajax';
  return pathname
    .replace(/^\/wp-content\/(plugins|themes)\/([^/]+)/, (_, kind, slug) => `/static/${code(`${kind}/${slug}`)}`)
    .replace(/^\/wp-content\/uploads(?=\/|$)/, '/media')
    .replace(/^\/wp-content\/([^/]+)/, (_, dir) => `/static/${code(dir)}`)
    .replace(/^\/wp-includes(?=\/|$)/, `/static/${code('wp-includes')}`);
}

// Rewrite references in page, stylesheet and script text, in plain, JSON-escaped
// ("\/wp-content\/") and URL-encoded ("%2Fwp-content%2F") form. Plain goes last:
// its pattern would otherwise half-match inside the escaped form.
export function rewriteLegacyPaths(text) {
  for (const sep of ['\\/', '%2F', '/']) {
    const s = sep.replace(/[\\/]/g, '\\$&');
    const pattern = new RegExp(`${s}wp-(?:content${s}(?:(?:plugins|themes)${s}[\\w.-]+|[\\w.-]+)|includes|admin${s}admin-ajax\\.php)(?![\\w.-])`, 'gi');
    text = text.replace(pattern, match => neutralPath(match.split(new RegExp(s, 'i')).join('/')).split('/').join(sep));
  }
  return text;
}
