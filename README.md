# Centre Point Nagpur

A private copy of the Centre Point Hotel Nagpur website — 36 captured public pages
with their original layout, images, fonts and colours. One Railway service builds
the static site and serves it together with a small JSON API from the same origin.

## What is and isn't included

- All 36 public pages, original presentation assets, Swiftbook booking links and
  the homepage booking widget.
- A working **event-enquiry form**: the captured WPForms form on the banquet /
  event pages submits to `POST /api/enquiries` and stores each enquiry in MongoDB.
- `GET /api/health` and an admin-only `GET /api/enquiries` reader.
- No payment or room-booking endpoints (rooms book through Swiftbook). WordPress
  admin and one large external video are not reproduced.

## Deploy to Railway

1. Create a Railway service from this repository (root directory `/`).
   `railway.json` selects the `Dockerfile` build and `npm start`.
2. Generate a public domain for the service.
3. Set service variables:
   - `PUBLIC_SITE_URL` — the public HTTPS origin you just generated, e.g.
     `https://centre-point-nagpur.up.railway.app` (or a custom domain). Origin
     only: no path, query or trailing slash. Required for SEO indexing, canonical
     links and the sitemap; without it every page builds `noindex`.
   - `MONGODB_URI` — your MongoDB connection string. Without it the site still
     runs and the enquiry form tells visitors submissions are unavailable.
   - `MONGODB_DB` — database name (defaults to `centrepoint`).
   - `ADMIN_TOKEN` — a long random string; required as `Authorization: Bearer …`
     to read `GET /api/enquiries`.
   - `PUBLIC_API_BASE_URL`, `FRONTEND_ORIGINS` — leave unset. The frontend calls
     `/api` on its own origin.
4. Deploy. The container runs `scripts/build.mjs` on start (so `PUBLIC_SITE_URL`
   takes effect), then serves `dist/` and `/api` on Railway's `$PORT`.
5. Check `https://YOUR-DOMAIN/api/health` →
   `{"status":"ok","service":"centrepoint-api","db":{"configured":true,"connected":true}}`.
   Railway's health check already polls this path.

On a Railway preview/PR environment (`RAILWAY_ENVIRONMENT_NAME` not `production`)
pages stay `noindex` even when `PUBLIC_SITE_URL` is set.

## API

| Method & path | Purpose |
| --- | --- |
| `GET /api/health` | Service status and MongoDB connectivity. |
| `POST /api/enquiries` | Submit an event enquiry (JSON). Validates name, email, phone, event type, date, guests and meals; a filled `company` field is treated as spam and silently dropped. |
| `GET /api/enquiries?limit=50` | List recent enquiries, newest first. Requires `Authorization: Bearer $ADMIN_TOKEN`. |

Enquiries are stored in the `enquiries` collection with `status: "new"`, a
timestamp, and the submitter's user agent and IP.

## Performance

- The server brotli/gzip-compresses HTML, CSS, JS and SVG on the fly (compressed
  copies are cached in memory) and sends `ETag` + `304` for revalidation.
- Static assets (`/wp-content/…`, fonts, CSS, JS, images) are served
  `Cache-Control: immutable` for a year; HTML is `no-cache` (revalidated).
- `scripts/build.mjs` marks offscreen images `loading="lazy"` and adds
  `preconnect` hints for Google Fonts.
- `scripts/optimize-images.mjs` is a one-time macOS (`sips`) tool that recompressed
  the captured images: JPEGs re-encoded at q80 / max 2000px, large photo PNGs
  converted to JPEG with every reference rewritten. It cut `site/` from ~169 MB to
  ~126 MB. Re-run it only if new large images are added to `site/`.

## SEO

`scripts/seo.mjs` (run from `scripts/build.mjs`) rewrites each page head while
leaving the body, inline styles, fonts and stylesheet links untouched. It sets a
unique title and description per page, a canonical link, Open Graph / Twitter
tags, and JSON-LD (`WebSite` + `WebPage` everywhere, `Hotel` on the home page,
`BreadcrumbList` elsewhere), and writes `dist/sitemap.xml` and `dist/robots.txt`.
The 34 content pages are indexable when `PUBLIC_SITE_URL` is set; two low-value
pages carried over from the original stay `noindex`.

## Local development

```sh
cd backend && npm install && cd ..     # once: installs the mongodb driver
cp .env.example .env                    # then fill in MONGODB_URI / ADMIN_TOKEN
```

```sh
npm run dev                             # serves site/ + /api on :5173
node --env-file=.env backend/server.mjs --dist   # serves the built dist/ like Railway
```

Validate:

```sh
npm test               # SEO transform preserves every page's presentation
npm run test:backend   # static serving, health, CORS, enquiry validation, admin auth
python3 scripts/verify.py
npm run build
```

## Layout

| Path | Purpose |
| --- | --- |
| `site/` | The original capture. Never rewritten by the build. |
| `scripts/build.mjs` | Copies `site/` → `dist/`, localises on-site links, injects the API client and `forms.js`, applies SEO. |
| `scripts/assets/forms.js` | Progressive enhancement that submits the WPForms enquiry form as JSON. |
| `backend/server.mjs` | The one server: compressed, cached static files from `dist/` (or `site/`) plus `/api/*`. |
| `scripts/optimize-images.mjs` | One-time image-shrinking maintenance tool (macOS `sips`). |
| `backend/db.mjs` | Lazy, reused MongoDB connection. |
| `Dockerfile`, `railway.json` | Railway build and run configuration. |
| `dist/` | Generated output. Not committed. |

The unused framework starter (`app/`, `components/`, Vite/Next config) remains in
the repository but is not part of this site.

Reference: [Railway config as code](https://docs.railway.com/config-as-code/reference),
[Railway health checks](https://docs.railway.com/deployments/healthchecks).
