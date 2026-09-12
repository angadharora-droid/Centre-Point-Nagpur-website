# Centre Point Nagpur

A private copy of the Centre Point Hotel Nagpur website — 36 captured public pages
with their original layout, images, fonts and colours. One Railway service builds
the static site and serves it together with a small JSON API from the same origin.

## What is and isn't included

- All 36 public pages, original presentation assets, Swiftbook booking links and
  the homepage booking widget.
- A working **event-enquiry form**: the captured WPForms form on the banquet /
  event pages submits to `POST /api/enquiries` and stores each enquiry in MongoDB.
- A staff **enquiries dashboard** at `/admin/` — search, filter, change status
  and delete enquiries. Gated by the same admin token, entered once and kept
  in the browser's local storage.
- `GET /api/health` and an admin-only `GET/PATCH/DELETE /api/enquiries` reader.
- No payment or room-booking endpoints (rooms book through Swiftbook). WordPress
  admin and one large external video are not reproduced.

## Deploy to Railway

1. Create a Railway service from this repository (root directory `/`).
   `railway.json` selects the `Dockerfile` build and `npm start`.
2. Generate a public domain for the service.
3. Set service variables:
   - `MONGODB_URI` — your MongoDB connection string. Without it the site still
     runs and the enquiry form tells visitors submissions are unavailable.
     (Allow-list `0.0.0.0/0` in MongoDB Atlas → Network Access — Railway egress
     IPs are not static.)
   - `MONGODB_DB` — database name (defaults to `centrepoint`).
   - `ADMIN_TOKEN` — a long random string. Required as `Authorization: Bearer …`
     for `GET/PATCH/DELETE /api/enquiries`, and it's the key staff enter once at
     `https://YOUR-DOMAIN/admin/` (kept in that browser's local storage after).
   - `PUBLIC_SITE_URL` — optional. SEO defaults to `https://centrepointnagpur.com`;
     set this only to point canonical links / the sitemap at a different host.
   - `PUBLIC_API_BASE_URL`, `FRONTEND_ORIGINS` — leave unset. The frontend calls
     `/api` on its own origin.
4. Deploy. Docker builds assets; startup refreshes configuration and SEO, then serves `dist/`
   and `/api` on Railway's `$PORT`.
5. Check `https://YOUR-DOMAIN/api/health` →
   `{"status":"ok","service":"centrepoint-api","db":{"configured":true,"connected":true}}`.
   Railway's health check already polls this path.

On a Railway preview/PR environment (`RAILWAY_ENVIRONMENT_NAME` not `production`)
pages build `noindex` automatically.

## API

| Method & path | Purpose |
| --- | --- |
| `GET /api/health` | Service status and MongoDB connectivity. |
| `POST /api/enquiries` | Submit an event enquiry (JSON). Validates name, email, phone, event type, date, guests and meals; a filled `company` field is treated as spam and silently dropped. |
| `GET /api/enquiries?limit=50` | List recent enquiries, newest first (max 500). Requires the admin token. |
| `PATCH /api/enquiries/:id` | Set `{"status"}` to one of `new`, `contacted`, `confirmed`, `closed`. Requires the admin token. |
| `DELETE /api/enquiries/:id` | Remove one enquiry. Requires the admin token. |

Enquiries are stored in the `enquiries` collection with `status: "new"`, a
timestamp, and the submitter's user agent and IP. `/admin/` is a plain,
dependency-free HTML page (no build step) that calls these endpoints directly;
it's excluded from the sitemap and served `noindex`, but — like the API — its
only real protection is the admin token, so treat that token like a password.

## Performance

- HTML permits one hour of shared caching, while browsers revalidate. A scoped
  Cloudflare Cache Rule must also enable HTML caching; see
  [production rollout](deploy/PERFORMANCE.md).
- Generated CSS, inline scripts and WebP images use content hashes and one-year
  immutable caching. Unversioned assets revalidate instead of staying stale.
- Each page bundles only its own CSS, preserving inline-style cascade boundaries.
  CSS is minified; unused shop/slider assets are omitted where no matching UI is
  present. The two largest ElementsKit widget stylesheets are conservatively
  pruned using page markup and captured runtime JavaScript.
- Classic scripts and their inline setup execute in deferred document order.
- Images use explicit WebP URLs, responsive width variants and intrinsic sizes;
  the first sizeable image gets high fetch priority. CSS backgrounds use smaller
  variants at mobile/tablet breakpoints.
- HTML/CSS/JS compression happens during the Docker build. Compressed responses
  are reused in memory, avoiding repeated file reads for warm text requests.
- Startup updates runtime configuration and SEO without regenerating images.

## SEO

`scripts/seo.mjs` (run from `scripts/build.mjs`) rewrites each page head while
leaving the body, inline styles, fonts and stylesheet links untouched. It sets a
unique title and description per page, a canonical link, Open Graph / Twitter
tags, and JSON-LD (`WebSite` + `WebPage` everywhere, `Hotel` on the home page,
`BreadcrumbList` elsewhere), and writes `dist/sitemap.xml` and `dist/robots.txt`.
The 34 content pages are indexable (canonical host `https://centrepointnagpur.com`,
override with `PUBLIC_SITE_URL`); two low-value pages carried over from the
original stay `noindex`. `robots.txt` links the sitemap. On a non-production
Railway/Vercel environment every page builds `noindex`.

## Local development

```sh
npm ci --prefix backend                 # once: installs the mongodb driver
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm ci --prefix scripts  # build tools
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

## Why scanners report WordPress

This service runs Node and MongoDB, not PHP or a WordPress installation. The
original pages were exported from WordPress, so their layout still uses captured
Hoteller/Elementor frontend CSS, classes and some JavaScript. Those signatures can
make a scanner infer WordPress even though there is no WordPress admin or plugin
installation to update here.

The build removes obsolete generator metadata, unused Elementor Pro runtime
(the capture has Pro 3.14 with core 3.30, but no Pro widgets), unused MotoPress and
Content Views scripts where their UI is absent, and orphaned plugin setup code.
Compatible local scripts are bundled in deferred execution order; URL-sensitive
webpack runtimes and mutable runtime configuration stay separate. Duplicate
Google Fonts requests are omitted when the same family is already self-hosted.
The Swiftbook widget loads when a visitor selects **Check availability**, with
loading/retry feedback and existing **Book Now** links still available.

Retained layout classes and vendor licenses are intentional. Removing all traces
of the original frontend requires replacing the remaining theme widgets, not
installing a WordPress optimization plugin or just renaming asset directories.
