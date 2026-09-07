import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiListener } from '../backend/server.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.gif': 'image/gif', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };

// One server: static files from `root`, plus the JSON API under /api/* — same origin.
export function createSiteServer(root) {
  const base = path.resolve(root);
  const api = apiListener();
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api' || pathname.startsWith('/api/')) return api(req, res);
    try {
      let p = path.resolve(base, '.' + decodeURIComponent(pathname));
      if (!p.startsWith(base + path.sep) && p !== base) throw new Error('outside root');
      if ((await stat(p)).isDirectory()) p = path.join(p, 'index.html');
      const body = await readFile(p);
      res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>Page not found</h1><a href="/">Return home</a>');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // `npm run dev` serves the raw capture in site/ ; `npm start` (and Railway) pass
  // --dist to serve the built output. STATIC_DIRECTORY overrides both.
  const dir = process.env.STATIC_DIRECTORY || (process.argv.includes('--dist') ? 'dist' : 'site');
  const port = Number(process.env.PORT || 5173);
  createSiteServer(dir).listen(port, '0.0.0.0', () => console.log(`Serving ${path.basename(path.resolve(dir))}/ + /api on http://127.0.0.1:${port}`));
}
