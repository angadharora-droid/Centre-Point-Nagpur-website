import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { transform } from 'lightningcss';
import { PurgeCSS } from 'purgecss';
import { asset } from './performance.mjs';

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=(["'])(.*?)\\1`, 'i'))?.[2] || '';
export function absolutiseUrls(css, cssPath) {
  const fix = ref => {
    const value = ref.trim().replace(/^['"]|['"]$/g, '');
    return !value || /^(data:|https?:|\/|#)/.test(value) ? value : path.posix.normalize(path.posix.join(path.posix.dirname(cssPath), value));
  };
  return css.replace(/url\(\s*([^)]+?)\s*\)/gi, (_, ref) => `url("${fix(ref)}")`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (_, q, ref) => `@import ${q}${fix(ref)}${q}`);
}

// Bundle only adjacent local links. Inline styles, scripts and remote sheets
// remain cascade boundaries, including styles enqueued in the body.
export async function bundlePageCss(html, root, rewrite = x => x, runtimeContent = '') {
  const content = [{ raw: html + runtimeContent, extension: 'html' }];
  const matches = [...html.matchAll(/<link\b[^>]*>/gi)];
  let output = '', cursor = 0, group = [], groupEnd = 0;
  async function flush() {
    if (!group.length) return;
    const parts = [];
    for (const match of group) {
      const href = attr(match[0], 'href').split(/[?#]/)[0];
      const source = await readFile(path.join(root, href), 'utf8');
      let css = rewrite(absolutiseUrls(source, href));
      const media = attr(match[0], 'media');
      if (media && media !== 'all') css = `@media ${media}{${css}}`;
      // Keep @imports in their own sheets to avoid making them invalid mid-bundle.
      parts.push(css);
    }
    const source = parts.join('\n');
    // Restrict pruning to the two large widget libraries. Keep the theme, forms,
    // animations, icon fonts and all other vendor CSS intact. Runtime JS is also
    // scanned, and dynamically assembled state/prefix selectors are preserved.
    let pruned = source;
    if (group.every(m => /\/elementskit(?:-lite)?\/widgets\/init\/assets\/css\//.test(attr(m[0], 'href')))) {
      [ { css: pruned } ] = await new PurgeCSS().purge({
        content, css: [{raw: source}],
        safelist: { standard: [/^(active|show|open|current|selected|disabled|focus|hover|animated|fade|is-|has-|swiper|slick|owl|ekit-menu|elementskit-menu)/],
          greedy: [/:hover/, /:focus/, /:active/, /\[.*(?:aria-|data-)/] },
        keyframes: false, fontFace: false, variables: false,
      });
    }
    const css = transform({ filename: 'page.css', code: Buffer.from(pruned), minify: true, errorRecovery: true }).code;
    const href = await asset(root, 'style', 'css', css);
    output += html.slice(cursor, group[0].index) + `<link rel="stylesheet" href="${href}">`;
    cursor = groupEnd;
    group = [];
  }
  for (const match of matches) {
    const href = attr(match[0], 'href');
    const eligible = attr(match[0], 'rel') === 'stylesheet' && href.startsWith('/wp-');
    if (!eligible || (group.length && html.slice(groupEnd, match.index).trim())) await flush();
    if (!eligible) continue;
    // Each file may contain an @import; do not move it behind other rules.
    const source = await readFile(path.join(root, href.split(/[?#]/)[0]), 'utf8');
    if (/@import\b/.test(source) || /\/elementskit(?:-lite)?\/widgets\/init\/assets\/css\//.test(href)) await flush();
    group.push(match); groupEnd = match.index + match[0].length;
    if (/@import\b/.test(source) || /\/elementskit(?:-lite)?\/widgets\/init\/assets\/css\//.test(href)) await flush();
  }
  await flush();
  return output + html.slice(cursor);
}
