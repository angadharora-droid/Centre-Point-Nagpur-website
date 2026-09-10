import { readFile } from 'node:fs/promises';

// Minimal intrinsic-size reader for the formats this site uses. Returns
// { width, height } or null. No dependencies — parses the file headers directly.
export function imageSize(buf) {
  if (buf.length < 24) return null;

  // SVG: explicit width/height, else the viewBox extent.
  if (buf.toString('latin1', 0, 200).includes('<svg')) {
    const head = buf.toString('latin1', 0, 2000);
    const num = v => Math.round(parseFloat(v));
    const w = head.match(/\bwidth\s*=\s*["']([\d.]+)/i);
    const h = head.match(/\bheight\s*=\s*["']([\d.]+)/i);
    if (w && h) return { width: num(w[1]), height: num(h[1]) };
    const vb = head.match(/viewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/i);
    if (vb) return { width: num(vb[1]), height: num(vb[2]) };
    return null;
  }

  // PNG: 8-byte signature, then IHDR (width/height as big-endian uint32).
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // GIF: logical screen descriptor, little-endian uint16.
  if (buf.toString('latin1', 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // WebP (RIFF....WEBP): VP8 / VP8L / VP8X.
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const fmt = buf.toString('latin1', 12, 16);
    if (fmt === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (fmt === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (fmt === 'VP8X') return { width: (buf.readUIntLE(24, 3) & 0xffffff) + 1, height: (buf.readUIntLE(27, 3) & 0xffffff) + 1 };
    return null;
  }

  // JPEG: walk the marker segments to the first Start-Of-Frame.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) { offset += 1; continue; }
      const marker = buf[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = buf.readUInt16BE(offset + 2);
      const sof = (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (sof) return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      offset += 2 + length;
    }
  }
  return null;
}

export async function imageSizeOf(file) {
  try { return imageSize(await readFile(file)); }
  catch { return null; }
}
