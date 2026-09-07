import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { getDb, isConfigured, dbHealth, closeDb } from './db.mjs';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.gif': 'image/gif', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.xml', '.txt', '.ttf']);
const IMMUTABLE = /\.(css|js|mjs|woff2?|ttf|eot|otf|jpe?g|png|webp|avif|gif|svg|ico|mp4|webm)$/i;
const NEVER_CACHE = new Set(['/runtime-config.js', '/api-client.js', '/forms.js']);

// Cache compressed copies of text assets, keyed by path + mtime + encoding.
const encodedCache = new Map();
async function encodeBody(key, raw, encoding) {
  const hit = encodedCache.get(key);
  if (hit) return hit;
  const out = encoding === 'br'
    ? await brotli(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
    : await gzip(raw, { level: 6 });
  if (encodedCache.size > 400) encodedCache.clear();
  encodedCache.set(key, out);
  return out;
}

// Reference: form 4592 offers event types Wedding / Corporate Event / Socail
// Gathering / Other and meals Breakfast / Lunch / Hitea / Dinner / All Day Session.
// Values are stored as submitted rather than constrained, to stay resilient.
const trim = value => (typeof value === 'string' ? value.trim() : '');

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

// Same-origin requests are always allowed; a cross-origin caller must be listed.
function corsOrigin(req, allowed) {
  const origin = req.headers.origin;
  if (!origin) return null;
  const host = req.headers.host;
  if (host && (origin === `https://${host}` || origin === `http://${host}`)) return origin;
  return allowed.has(origin) ? origin : false;
}

async function readJson(req, limit = 32 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}

export function validateEnquiry(payload) {
  const data = {
    name: trim(payload.name).slice(0, 120),
    email: trim(payload.email).slice(0, 200),
    phone: trim(payload.phone).slice(0, 40),
    eventType: trim(payload.eventType).slice(0, 60),
    eventDate: trim(payload.eventDate).slice(0, 40),
    guests: trim(payload.guests).slice(0, 40),
    meals: trim(payload.meals).slice(0, 60),
    message: trim(payload.message).slice(0, 4000),
    page: trim(payload.page).slice(0, 200),
  };
  const errors = {};
  if (data.name.length < 2) errors.name = 'Please enter your name';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = 'Please enter a valid email address';
  if (data.phone.replace(/\D/g, '').length < 7) errors.phone = 'Please enter a valid phone number';
  if (!data.eventType) errors.eventType = 'Please select an event type';
  if (!data.eventDate) errors.eventDate = 'Please choose a date';
  if (!data.guests) errors.guests = 'Please enter the number of guests';
  if (!data.meals) errors.meals = 'Please select a meal option';
  return { data, errors };
}

async function handleApi(req, res, pathname, config) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.writeHead(204);
    return res.end();
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    return json(res, 200, { status: 'ok', service: 'centrepoint-api', db: await dbHealth() });
  }

  if (pathname === '/api/enquiries' && req.method === 'POST') {
    if (!isConfigured()) return json(res, 503, { error: 'Enquiry storage is not configured' });
    let payload;
    try { payload = await readJson(req); }
    catch (error) { return json(res, error.status || 400, { error: error.message }); }
    if (trim(payload.company)) return json(res, 200, { ok: true }); // honeypot
    const { data, errors } = validateEnquiry(payload);
    if (Object.keys(errors).length) return json(res, 422, { error: 'Please check the form', errors });
    try {
      const result = await getDb().then(db => db.collection('enquiries').insertOne({
        ...data,
        status: 'new',
        createdAt: new Date(),
        userAgent: trim(req.headers['user-agent']).slice(0, 400),
        ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '',
      }));
      return json(res, 201, { ok: true, id: result.insertedId });
    } catch (error) {
      console.error('enquiry insert failed:', error.message);
      return json(res, 502, { error: 'Could not save your enquiry, please try again' });
    }
  }

  if (pathname === '/api/enquiries' && req.method === 'GET') {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!config.adminToken || token !== config.adminToken) return json(res, 401, { error: 'Unauthorized' });
    if (!isConfigured()) return json(res, 503, { error: 'Enquiry storage is not configured' });
    const limit = Math.min(Number(new URL(req.url, 'http://localhost').searchParams.get('limit')) || 50, 200);
    try {
      const items = await getDb().then(db => db.collection('enquiries').find().sort({ createdAt: -1 }).limit(limit).toArray());
      return json(res, 200, { count: items.length, items });
    } catch (error) {
      console.error('enquiry list failed:', error.message);
      return json(res, 502, { error: 'Could not read enquiries' });
    }
  }

  return json(res, 404, { error: 'Endpoint not found' });
}

function pickEncoding(accept = '') {
  if (/\bbr\b/.test(accept)) return 'br';
  if (/\bgzip\b/.test(accept)) return 'gzip';
  return null;
}

async function serveStatic(req, res, root, pathname) {
  try {
    let file = path.resolve(root, '.' + decodeURIComponent(pathname));
    if (!file.startsWith(root + path.sep) && file !== root) throw new Error('outside root');
    let info = await stat(file);
    if (info.isDirectory()) { file = path.join(file, 'index.html'); info = await stat(file); }

    const ext = path.extname(file).toLowerCase();
    const isHtml = ext === '.html';
    const route = file.slice(root.length).split(path.sep).join('/');
    const etag = `"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;

    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', ETag: etag, Vary: 'Accept-Encoding' };
    if (isHtml) headers['Cache-Control'] = 'no-cache';
    else if (NEVER_CACHE.has(route)) headers['Cache-Control'] = 'no-cache';
    else if (IMMUTABLE.test(ext)) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    else headers['Cache-Control'] = 'public, max-age=3600';

    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }

    let body = await readFile(file);
    const encoding = COMPRESSIBLE.has(ext) && body.length > 512 ? pickEncoding(req.headers['accept-encoding']) : null;
    if (encoding) {
      body = await encodeBody(`${file}:${info.mtimeMs}:${encoding}`, body, encoding);
      headers['Content-Encoding'] = encoding;
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Page not found</h1><a href="/">Return home</a>');
  }
}

export function createSiteServer({ staticDir = 'site', origins = process.env.FRONTEND_ORIGINS || '', adminToken = process.env.ADMIN_TOKEN || '' } = {}) {
  const root = path.resolve(staticDir);
  const allowed = new Set(origins.split(',').map(value => value.trim()).filter(Boolean));
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;

    // Legacy WordPress AJAX endpoint the captured plugins still ping. There is no
    // WordPress here; reply the way admin-ajax.php does for an unknown action ("0")
    // so those requests resolve quietly instead of 404-ing.
    if (pathname === '/wp-admin/admin-ajax.php' || pathname === '/xmlrpc.php') {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('0');
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      res.setHeader('Vary', 'Origin');
      const origin = corsOrigin(req, allowed);
      if (origin === false) return json(res, 403, { error: 'Origin not allowed' });
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      try {
        return await handleApi(req, res, pathname, { adminToken });
      } catch (error) {
        console.error('api error:', error);
        if (!res.headersSent) return json(res, 500, { error: 'Internal error' });
        return res.end();
      }
    }
    return serveStatic(req, res, root, pathname);
  });
}

// Back-compat: an API-only server for `node backend/server.mjs` and tests.
export const createServer = options => createSiteServer({ staticDir: 'site', ...options });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const staticDir = process.env.STATIC_DIRECTORY || (process.argv.includes('--dist') ? 'dist' : 'site');
  const port = Number(process.env.PORT || 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = createSiteServer({ staticDir });
  server.listen(port, '0.0.0.0', () => console.log(`Serving ${path.basename(path.resolve(staticDir))}/ + /api on http://127.0.0.1:${port}`));
  const stop = () => {
    server.close(async () => { await closeDb().catch(() => {}); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
