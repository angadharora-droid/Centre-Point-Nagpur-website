import http from 'node:http';
import { pathToFileURL } from 'node:url';

export function createServer({ origins = process.env.FRONTEND_ORIGINS || '' } = {}) {
  const allowed = new Set(origins.split(',').map(value => value.trim()).filter(Boolean));
  return http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    const send = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin)) return send(403, { error: 'Origin not allowed' });
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.writeHead(204); return res.end();
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      return send(405, { error: 'Method not allowed' });
    }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/health') return send(200, { status: 'ok', service: 'centrepoint-api' });
    return send(404, { error: 'Endpoint not found' });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = createServer();
  server.listen(port, '0.0.0.0', () => console.log(`Centre Point API listening on ${port}`));
  const stop = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
