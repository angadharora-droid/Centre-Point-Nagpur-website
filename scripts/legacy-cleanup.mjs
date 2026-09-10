import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {asset} from './performance.mjs';

export function cleanLegacyRuntime(html) {
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const unused = ['elementor-pro']; // No Pro widgets exist in these static captures.
  if (!/class=["'][^"']*\bmphb-(?:sc-|booking-|search-|checkout-|room-type-)/i.test(markup)) unused.push('motopress-hotel-booking', 'mphb-reviews');
  if (!/class=["'][^"']*\bpt-cv-/i.test(markup)) unused.push('content-views-query-and-display-post-page', 'pt-content-views-pro');
  const ids = /^(?:elementor-pro-|pro-preloaded-)/;
  const optionalIds = { 'motopress-hotel-booking': /^mphb-/, 'mphb-reviews': /^mphb-reviews-/, 'content-views-query-and-display-post-page': /^pt-cv-/ };
  const removedIds = [...html.matchAll(/<script\b[^>]*\bid=(["'])([^"']+)\1[^>]*>/gi)].map(m => m[2]);
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attrs, code) => {
    const src = attrs.match(/\bsrc=(["'])(.*?)\1/i)?.[2] || '';
    const id = attrs.match(/\bid=(["'])(.*?)\1/i)?.[2] || '';
    if (unused.some(p => src.includes(`/plugins/${p}/`))) return '';
    if (!src && (ids.test(id) || unused.some(p => optionalIds[p]?.test(id)) || (/^(?:wc-|woocommerce-|layerslider-|sdm-|theme-my-login-)/.test(id) && !removedIds.includes(id.replace(/-(?:extra|before|after)$/, ''))) || code.includes('window._wpemojiSettings'))) return '';
    return tag;
  });
  const localFonts = new Set([...html.matchAll(/\/google-fonts\/css\/([a-z]+)\.css/g)].map(m => m[1]));
  html = html.replace(/<link\b[^>]*>/gi, tag => {
    const href = tag.match(/\bhref=(["'])(.*?)\1/i)?.[2];
    if (!href || !href.startsWith('https://fonts.googleapis.com/')) return tag;
    const url = new URL(href.replaceAll('&amp;', '&'));
    const families = url.searchParams.getAll('family').flatMap(value => value.split('|')).map(value => value.split(':')[0].toLowerCase().replace(/[^a-z]/g, ''));
    return families.length && families.every(f => localFonts.has(f)) ? '' : tag;
  });
  return html
    .replace(/<meta\b[^>]*\bname=["']generator["'][^>]*>/gi, '')
    .replace(/<link\b[^>]*\brel=["'](?:https:\/\/api\.w\.org\/|EditURI|wlwmanifest|shortlink|pingback)["'][^>]*>/gi, '')
    .replace(/<script\b[^>]*\btype=["']text\/template["'][^>]*\bid=["']tmpl-(?:variation|unavailable-variation)-template["'][^>]*>[\s\S]*?<\/script>/gi, '');
}

// Merge compatible classic scripts in their original deferred execution order.
// Keep URL-sensitive runtimes, third parties and mutable config as boundaries.
export async function bundleScripts(html, root) {
  const matches = [...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/gi)];
  const replacements = new Map();
  let group = [];
  async function flush() {
    if (group.length > 1) {
      const source = group.map(({code}) => `;\n${code}\n`).join('');
      new vm.Script(source); // Fail the build rather than ship a syntax collision.
      const url = await asset(root, 'page', 'js', source);
      group.forEach(({match}, i) => replacements.set(match.index, i ? '' : `<script defer src="${url}"></script>`));
    }
    group = [];
  }
  for (const match of matches) {
    const attrs = match[1];
    const src = attrs.match(/\bsrc=(["'])(.*?)\1/i)?.[2];
    if (!src) continue; // JSON/templates neither execute nor change script order.
    if (!src.startsWith('/') || src.startsWith('//') || /^\/(runtime-config|api-client|forms)\.js/.test(src) || /\btype=["']module/.test(attrs)) { await flush(); continue; }
    const code = await readFile(path.join(root, src.split(/[?#]/)[0]), 'utf8');
    const withoutComments = code.replace(/^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*/, '');
    if (/currentScript|document\.write|sourceMappingURL|import\.meta/.test(code) || /^\s*["']use strict["']/.test(withoutComments)) { await flush(); continue; }
    group.push({match, code});
  }
  await flush();
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag, offset) => replacements.has(offset) ? replacements.get(offset) : tag);
}

// Drop repeat <link> requests for a resource already pulled earlier on the page.
// Editor-embedded widgets re-declare the same Font Awesome / Google Font sheets and
// the build appends its own preconnects; each duplicate is another blocking fetch.
export function dedupeHeadLinks(html) {
  const seen = new Set();
  return html.replace(/<link\b[^>]*>/gi, tag => {
    const rel = (tag.match(/\brel=(["'])(.*?)\1/i)?.[2] || '').trim().toLowerCase();
    if (!['stylesheet', 'preconnect', 'dns-prefetch'].includes(rel)) return tag;
    const href = (tag.match(/\bhref=(["'])(.*?)\1/i)?.[2] || '').replaceAll('&amp;', '&').trim();
    if (!href) return tag;
    // A connection's CORS mode is part of its identity; a stylesheet's is not.
    const crossorigin = rel !== 'stylesheet' && /\bcrossorigin\b/i.test(tag) ? 'x' : '';
    const key = `${rel}|${href}|${crossorigin}`;
    if (seen.has(key)) return '';
    seen.add(key);
    return tag;
  });
}

export function lazyBooking(html) {
  let attributes;
  html = html.replace(/<script\b([^>]*\bsrc=["']https:\/\/www\.swiftbook\.io\/plugin\/js\/booking-service\.min\.js["'][^>]*)>[\s\S]*?<\/script>/gi, (_, attrs) => {
    attributes = Object.fromEntries([...attrs.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(m => [m[1], m[3]]));
    return '';
  });
  if (!attributes) return html;
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, tag => tag.includes('const checkWidgetLoad = setInterval') ? '' : tag);
  html = html.replace('<div id="quickbook-widget"></div>', '<div id="quickbook-widget" class="widget-loaded"><button type="button" class="cp-booking-load" style="background:#a70062;color:white;border:0;padding:16px 24px;font:inherit;cursor:pointer">Check availability</button><span class="cp-booking-status" role="status"></span></div>');
  const code = `(() => {
    const container = document.getElementById('quickbook-widget');
    const button = container && container.querySelector('.cp-booking-load');
    if (!button) return;
    button.addEventListener('click', () => {
      button.disabled = true;
      button.textContent = 'Loading availability…';
      const script = document.createElement('script');
      const attributes = ${JSON.stringify(attributes)};
      for (const [key, value] of Object.entries(attributes)) script.setAttribute(key, value);
      script.async = true;
      const status = container.querySelector('.cp-booking-status');
      const timer = setTimeout(() => { if (status && status.isConnected) status.textContent = ' Booking is taking longer than usual. You can also use the Book Now link.'; }, 15000);
      const observer = new MutationObserver(() => {
        if ([...container.children].some(el => el !== button && el !== status)) {
          clearTimeout(timer); observer.disconnect(); button.remove(); if(status) status.remove();
          container.classList.add('widget-loaded');
        }
      });
      observer.observe(container, {childList: true});
      script.onerror = () => { clearTimeout(timer); observer.disconnect(); script.remove(); button.disabled = false; button.textContent = 'Retry availability'; status.textContent = ' Booking could not load. Please retry or use Book Now.'; };
      document.body.appendChild(script);
    });
  })();`;
  return html.replace('</body>', `<script>${code}</script></body>`);
}
