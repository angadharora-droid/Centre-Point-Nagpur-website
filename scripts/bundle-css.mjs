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

// Classes that plugin/theme runtimes add to the DOM after load and that the HTML
// snapshot therefore never contains. Purging their rules would break menus,
// sliders, lightboxes, scroll animations and form validation. Everything else is
// matched against the rendered markup: dormant plugins (WooCommerce, MotoPress,
// dashicons, LayerSlider) and other pages' Elementor CSS fall away.
const SAFELIST = {
  standard: [
    'html', 'body', 'active', 'current', 'hover', 'visible', 'hidden', 'selected', 'inactive',
    'open', 'opened', 'show', 'shown', 'collapsing', 'disabled', 'checked', 'loading', 'loaded',
    'sticky', 'stuck', 'scrolled', 'fixed', 'nofixed', 'hasbg', 'toggled', 'animated', 'clicked',
    'smooved', 'no-smooved', 'noanimation', 'overflow_hidden', 'modalview', 'js_nav', 'blur',
    'scroll_up', 'scroll_down', 'mainnav_in', 'mainnav_out', 'subnav_in', 'subnav_out',
    'share_open', 'sharing', 'has-content', 'current-menu-item', 'current-menu-ancestor',
    'current_page_item', 'menu-item-has-children', 'elementor-active', 'elementor-open',
    'elementor-invisible', 'elementor-sticky', 'elementor-sticky__spacer', 'elementor-in-view',
    'elementor-fullscreen', 'elementor-popup-modal', 'elementor-lightbox',
    /^(elementor-sticky--|elementor-motion-effects|elementor-tab-|elementor-slideshow|elementor-swiper|elementor-animation-)/,
    /^(swiper-slide|swiper-pagination|swiper-button|swiper-scrollbar|swiper-notification|swiper-wrapper|swiper-container|swiper-lazy|swiper-zoom)/,
    /^(ekit-|elementskit-)/,
    /^(is-|has-)/,
    /^(fadeIn|fadeInUp|fadeInDown|fadeInLeft|fadeInRight|fadeInUpBig|zoomIn|slideInUp|slideInDown|slideInLeft|slideInRight|bounceIn|bounce|pulse|shake|flash|grow|shrink|rubberBand|headShake)/,
    /^(wpforms|mailcheck|choices__|flatpickr-|iti__|iti-)/,
    /^(mobx-|mfp-|pswp|lg-outer|lg-backdrop|lightbox-)/,
    /^(loftloader|loftloading|pageloader)/,
    /^(sub-menu|menu-open|nav-open|mobile-menu|off-canvas|offcanvas|hamburger|burger|tg_menu|tg-menu|slicknav)/,
  ],
  greedy: [
    /:hover$/, /:focus(-visible|-within)?$/, /:active$/,
    /::(before|after|marker|placeholder|selection|backdrop)$/,
    /\[(aria-[a-z]+|data-[a-z-]+)/,
    /--(active|open|opened|visible|effects|current|selected|expanded|hover|focus)$/,
    /-(active|open|visible|current|selected)$/,
  ],
};

// Google-fonts CSS ships an @font-face per weight × script (Cyrillic, Greek,
// Vietnamese …). This is an English/Latin site; keep only the Latin and
// Latin-Extended cuts. Runs on the raw CSS, before lightningcss rewrites
// "U+0000-00FF" to its compact "U+0-FF" form.
function trimFontSubsets(css) {
  return css.replace(/@font-face\s*\{[^{}]*\}/gi, block => {
    const range = block.match(/unicode-range\s*:\s*([^;]+)/i)?.[1];
    if (!range) return block; // a single-file webfont, not a subset split
    const latin = /U\+0+-/i.test(range) || /U\+0*100-0*2/i.test(range);
    return latin ? block : '';
  });
}

// Bundle only adjacent local links. Inline styles, scripts and remote sheets
// remain cascade boundaries, including styles enqueued in the body.
export async function bundlePageCss(html, root, rewrite = x => x, runtimeContent = '') {
  // Only the rendered HTML feeds selector detection. Minified vendor scripts are
  // deliberately excluded: their token soup matches almost every class name and
  // would defeat pruning. Runtime-added classes are covered by SAFELIST instead.
  void runtimeContent;
  const content = [{ raw: html, extension: 'html' }];
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
    // Trim webfont subsets on the raw text, then normalise: lightningcss
    // error-recovers the stray control characters and vendor hacks that PurgeCSS's
    // strict parser would otherwise throw on, leaving the whole group unpruned.
    let source = trimFontSubsets(parts.join('\n').replace(/[\u200b-\u200f\u2060\ufeff]/g, ''));
    try { source = transform({ filename: 'page.css', code: Buffer.from(source), minify: false, errorRecovery: true }).code.toString(); } catch { /* keep raw */ }
    // Drop selector rules this page never references — the bulk of the bundle is
    // WooCommerce, MotoPress, dashicons and other dormant plugin CSS. Runtime-added
    // state classes, icon fonts and animations are safelisted. @font-face and CSS
    // variables are kept wholesale (Customizer globals resolve through them).
    let pruned = source;
    try {
      [ { css: pruned } ] = await new PurgeCSS().purge({
        content, css: [{ raw: source }],
        safelist: SAFELIST, keyframes: false, fontFace: false, variables: false,
      });
    } catch (e) { pruned = source; console.warn(`CSS prune skipped for one bundle: ${e.message}`); }
    if (process.env.CSS_DEBUG) console.error('group', group.map(m => attr(m[0], 'href').split('/').pop()).join(','), source.length, '->', pruned.length);
    const css = transform({ filename: 'page.css', code: Buffer.from(pruned), minify: true, errorRecovery: true }).code;
    // A group can prune down to nothing (e.g. a lone dormant-plugin sheet); emit no
    // link rather than a request for an empty file.
    if (css.toString().trim()) {
      const href = await asset(root, 'style', 'css', css);
      output += html.slice(cursor, group[0].index) + `<link rel="stylesheet" href="${href}">`;
    } else {
      output += html.slice(cursor, group[0].index);
    }
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
