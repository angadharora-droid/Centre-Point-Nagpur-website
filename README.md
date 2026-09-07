# Centre Point Nagpur

A private copy of the Centre Point Hotel Nagpur website — 37 captured public pages
with their original layout, images, fonts and colours. One Railway service builds
the static site and serves it together with a small JSON API from the same origin.

## What is and isn't included

- All 37 public pages, original presentation assets, Swiftbook booking links and
  the homepage booking widget.
- `GET /api/health` only. No database, enquiry, admin, payment or booking
  endpoints yet; the copied WordPress forms are not wired to it.
- WordPress admin and one large external video are not reproduced.

## Deploy to Railway

1. Create a Railway service from this repository (root directory `/`).
   `railway.json` selects the `Dockerfile` build and `npm start`.
2. Generate a public domain for the service.
3. Set service variables:
   - `PUBLIC_SITE_URL` — the public HTTPS origin you just generated, e.g.
     `https://centre-point-nagpur.up.railway.app` (or a custom domain). Origin
     only: no path, query or trailing slash. Required for SEO indexing, canonical
     links and the sitemap; without it every page builds `noindex`.
   - `PUBLIC_API_BASE_URL` — leave unset. The frontend calls `/api` on its own
     origin.
   - `FRONTEND_ORIGINS` — leave unset unless another origin must call the API.
4. Deploy. The container runs `scripts/build.mjs` on start (so the variables above
   take effect), then serves `dist/` and `/api` on Railway's `$PORT`.
5. Check `https://YOUR-DOMAIN/api/health` → `{"status":"ok","service":"centrepoint-api"}`.
   Railway's health check already polls this path.

On a Railway preview/PR environment (`RAILWAY_ENVIRONMENT_NAME` not `production`)
pages stay `noindex` even when `PUBLIC_SITE_URL` is set.

## SEO

`scripts/seo.mjs` (run from `scripts/build.mjs`) rewrites each page head while
leaving the body, inline styles, fonts and stylesheet links untouched. It sets a
unique title and description per page, a canonical link, Open Graph / Twitter
tags, and JSON-LD (`WebSite` + `WebPage` everywhere, `Hotel` on the home page,
`BreadcrumbList` elsewhere), and writes `dist/sitemap.xml` and `dist/robots.txt`.
The 35 content pages are indexable when `PUBLIC_SITE_URL` is set; two low-value
pages carried over from the original stay `noindex`.

## Local development

Serve the raw capture in `site/` plus the API:

```sh
npm run dev            # http://127.0.0.1:5173
```

Serve the production build exactly as Railway does:

```sh
PUBLIC_SITE_URL=https://example.up.railway.app npm start
```

Validate:

```sh
npm test               # SEO transform preserves every page's presentation
npm run test:backend   # API health, CORS allow-list, method handling
python3 scripts/verify.py
npm run build
```

## Layout

| Path | Purpose |
| --- | --- |
| `site/` | The original capture. Never rewritten by the build. |
| `scripts/build.mjs` | Copies `site/` → `dist/`, localises on-site links, injects the API client, applies SEO. |
| `scripts/serve.mjs` | One server: static files + `/api/*` (`--dist` serves the build). |
| `backend/server.mjs` | The API request listener, mounted by `serve.mjs` and runnable standalone. |
| `Dockerfile`, `railway.json` | Railway build and run configuration. |
| `dist/` | Generated output. Not committed. |

The unused framework starter (`app/`, `components/`, Vite/Next config) remains in
the repository but is not part of this site.

Reference: [Railway config as code](https://docs.railway.com/config-as-code/reference),
[Railway health checks](https://docs.railway.com/deployments/healthchecks).
