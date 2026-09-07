// One-time maintenance tool (macOS `sips`). Shrinks the heavy captured images in
// site/ in place: large JPEGs are re-encoded, large photo PNGs become JPEGs and
// every reference (src, srcset, preload, og:image, CSS url()) is rewritten.
// Run from the repo root:  node scripts/optimize-images.mjs
import { execFile } from 'node:child_process';
import { readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SITE = path.resolve('site');
const MAX_DIM = 2000;
const JPEG_Q = 80;
const JPEG_MIN = 150 * 1024; // recompress JPEGs larger than this
const PNG_MIN = 250 * 1024;  // convert PNGs larger than this
// Keep these PNGs as-is (logos / flat graphics that may rely on transparency).
const KEEP_PNG = /(logo|icon|cpngp|Untitled-|favicon|sprite)/i;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const sips = args => run('sips', args, { maxBuffer: 1 << 24 });
const size = async f => (await stat(f)).size;
const webPath = f => '/' + path.relative(SITE, f).split(path.sep).join('/');

const renames = new Map(); // '/wp-content/.../foo.png' -> '/wp-content/.../foo.jpg'
let jpegSaved = 0;
let pngSaved = 0;

for await (const file of walk(SITE)) {
  const ext = path.extname(file).toLowerCase();
  const before = await size(file).catch(() => 0);

  if ((ext === '.jpg' || ext === '.jpeg') && before > JPEG_MIN) {
    const tmp = file + '.opt';
    await sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', String(JPEG_Q), '-Z', String(MAX_DIM), file, '--out', tmp]);
    const after = await size(tmp);
    if (after < before * 0.9) { await rename(tmp, file); jpegSaved += before - after; }
    else await rm(tmp, { force: true });
  } else if (ext === '.png' && before > PNG_MIN && !KEEP_PNG.test(file)) {
    const jpg = file.slice(0, -4) + '.jpg';
    await sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', String(JPEG_Q), '-Z', String(MAX_DIM), file, '--out', jpg]);
    pngSaved += before - (await size(jpg));
    await rm(file, { force: true });
    renames.set(webPath(file), webPath(jpg));
  }
}

let touched = 0;
if (renames.size) {
  for await (const file of walk(SITE)) {
    if (!/\.(html|css|js)$/.test(file)) continue;
    const original = await readFile(file, 'utf8');
    let text = original;
    for (const [from, to] of renames) text = text.split(from).join(to);
    if (text !== original) { await writeFile(file, text); touched++; }
  }
}

console.log(`JPEG recompressed: saved ${(jpegSaved / 1048576).toFixed(1)} MB`);
console.log(`PNG → JPEG: ${renames.size} images, saved ${(pngSaved / 1048576).toFixed(1)} MB`);
console.log(`${touched} text files updated`);
for (const [from, to] of renames) console.log(`  ${from} -> ${path.basename(to)}`);
