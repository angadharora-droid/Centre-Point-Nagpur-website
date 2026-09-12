import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const hash = data => createHash('sha256').update(data).digest('hex').slice(0, 16);
export async function asset(root, name, extension, body) {
  const url = `/assets/${name}.${hash(body)}.${extension}`;
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, url), body);
  return url;
}
export async function filesIn(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(file));
    else files.push(file);
  }
  return files;
}

// Explicit format URLs avoid depending on Accept-aware CDN cache keys.
export async function prepareImages(root) {
  const images = new Map();
  for (const file of await filesIn(root)) {
    if (!/\.(jpe?g|png)$/i.test(file)) continue;
    const source = await readFile(file);
    const meta = await sharp(source).metadata();
    if (!meta.width || !meta.height || meta.pages > 1) continue;
    const widths = [...new Set([480, 768, 1280, 1920, Math.min(meta.width, 1920)].filter(w => w <= meta.width))].sort((a, b) => a - b);
    const variants = [];
    for (const width of widths) {
      const body = await sharp(source).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
      variants.push({ width, url: await asset(root, `image-${width}`, 'webp', body) });
    }
    images.set('/' + path.relative(root, file).split(path.sep).join('/'), variants);
  }
  return images;
}
export function rewriteImages(html, images, isCss = false) {
  // Also handles CSS backgrounds and images embedded in script/config strings.
  html = html.replace(/\/wp-content\/[^\s"'<>()[\]\\]+?\.(?:jpe?g|png)(?![\w.])/gi, url => images.get(url)?.at(-1)?.url || url);
  const byUrl = new Map([...images.values()].map(v => [v.at(-1).url, v]));
  if (isCss) html = html.replace(/url\((["']?)(\/assets\/image-[^)'"]+\.webp)\1\)/g, (whole, quote, url) => {
    const variants = byUrl.get(url);
    if (!variants || variants.length < 2) return whole;
    images.backgrounds ||= new Map();
    const name = '--cp-image-' + hash(url);
    images.backgrounds.set(name, variants);
    return `var(${name},url("${url}"))`;
  });
  if (!isCss) html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_, attrs, css) => `<style${attrs}>${rewriteImages(css, images, true)}</style>`);
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const srcMatch = tag.match(/\ssrc=(["'])(.*?)\1/i);
    const src = srcMatch?.[2];
    const variants = images.get(src) || byUrl.get(src);
    if (!variants) return tag;
    if (images.has(src)) tag = tag.replace(srcMatch[0], ` src=${srcMatch[1]}${variants.at(-1).url}${srcMatch[1]}`);
    // Replace captured srcsets, whose descriptors may refer to the old sizes.
    tag = tag.replace(/\s(?:srcset|sizes)=(["']).*?\1/gi, '');
    const set = variants.map(v => `${v.url} ${v.width}w`).join(', ');
    const width = Number(tag.match(/\swidth=["'](\d+)/i)?.[1]);
    const sizes = width && width < 768 ? `(max-width: ${width}px) 100vw, ${width}px` : '100vw';
    return tag.replace(/<img\b/i, `<img srcset="${set}" sizes="${sizes}"`);
  });
}

// Classic deferred scripts execute in document order, before DOMContentLoaded.
// Externalize inline code too, so it cannot run before deferred dependencies.
export async function deferScripts(html, root) {
  let out = '', last = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const [whole, attrs, body] = match;
    const type = attrs.match(/\btype=(["'])(.*?)\1/i)?.[2];
    let tag = whole;
    if (!type || /^(?:text|application)\/javascript$/i.test(type)) {
      if (/\bdocument\.write\s*\(/.test(body)) throw new Error('Parser-dependent inline script needs manual review');
      const src = attrs.match(/\bsrc=(["'])(.*?)\1/i)?.[2];
      if (src || body.trim()) {
        const clean = attrs.replace(/\s(?:async|defer)(?:=(?:["'][^"']*["']|[^\s>]+))?/gi, '');
        tag = `<script${clean} defer${src ? '' : ` src="${await asset(root, 'inline', 'js', body)}"`}></script>`;
      }
    }
    out += html.slice(last, match.index) + tag;
    last = match.index + whole.length;
  }
  return out + html.slice(last);
}

export function removeUnusedPlugins(html) {
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const unused = [];
  // These captures use Swiftbook for booking and have no shop/cart UI.
  if (!/class=["'][^"']*\b(?:add_to_cart_button|single_add_to_cart_button|woocommerce-cart-form|woocommerce-checkout|widget_shopping_cart)\b/i.test(markup)) unused.push('woocommerce');
  if (!/class=["'][^"']*\b(?:ls-container|ls-wp-container|ls-slide)\b/i.test(markup)) unused.push('LayerSlider');
  if (!/class=["'][^"']*\b(?:sdm_download|sdm_download_link)\b/i.test(markup)) unused.push('simple-download-monitor');
  if (!/class=["'][^"']*\btml(?:-|\s|["'])/i.test(markup)) unused.push('theme-my-login');
  const unwanted = url => unused.some(plugin => url.includes(`/plugins/${plugin}/`));
  return html.replace(/<script\b[^>]*\bsrc=(["'])([^"']+)\1[^>]*>[\s\S]*?<\/script>/gi, (tag, q, src) => unwanted(src) ? '' : tag)
    .replace(/<link\b[^>]*>/gi, tag => unwanted(tag.match(/\bhref=(["'])(.*?)\1/i)?.[2] || '') ? '' : tag);
}

export function responsiveBackgroundCss(images) {
  return [1280, 768].map(width => {
    const rules = [...(images.backgrounds || [])].map(([name, variants]) => {
      const choice = variants.find(v => v.width >= width) || variants.at(-1);
      return `${name}:url("${choice.url}")`;
    }).join(';');
    return `@media(max-width:${width - 1}px){:root{${rules}}}`;
  }).join('');
}
