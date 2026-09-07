# Centre Point Nagpur

37 captured public hotel pages with their original presentation assets.

## Deployment split

| Service | Project root | Configuration | Purpose |
| --- | --- | --- | --- |
| Vercel | Repository root | `vercel.json` | Static frontend; builds to `dist` |
| Railway | `backend` | `backend/railway.json` | Node API starter |

The Railway backend currently implements **only `GET /api/health`**. It has no database, enquiries, admin, payment or booking endpoints yet. The copied WordPress forms are not wired to it. Original booking services and one large video remain external. The previous Sites deployment is not changed by these configuration files.

## 1. Deploy Railway

1. Import this repository into a Railway service.
2. Set the service Root Directory to `/backend` and, if Railway asks for a config-file path, set it to `/backend/railway.json`.
3. Set `FRONTEND_ORIGINS` to the exact Vercel frontend origin, for example `https://your-hotel.vercel.app`. Use commas for additional approved origins; no trailing slashes or wildcard.
4. Deploy and generate a public domain. Railway supplies `PORT`; the API listens on `0.0.0.0`.
5. Open `https://YOUR-RAILWAY-DOMAIN/api/health`. Expect `{"status":"ok","service":"centrepoint-api"}`.

The Docker image installs no packages because the API uses only Node built-ins. No volume or database is needed for the health endpoint.

## 2. Deploy Vercel

1. Import the same repository into Vercel with the repository root as Root Directory.
2. The checked-in configuration selects no framework, uses `npm run build`, and publishes `dist`. The frontend build uses Node built-ins, so its install command only checks the Node version.
3. Set `PUBLIC_API_BASE_URL` to the Railway HTTPS origin, for example `https://YOUR-RAILWAY-DOMAIN`. Do not append `/api`.
4. Set `PUBLIC_SITE_URL` to the final public HTTPS origin, for example `https://centrepointnagpur.com` (an origin only — no path, query or trailing segment). See SEO below.
5. Deploy. Copy the actual Vercel origin into Railway's `FRONTEND_ORIGINS` and redeploy Railway if needed.
6. In the frontend browser console, `await window.centrePointApi.health()` checks the connection.

Only the public API origin is embedded in the frontend. Never put secrets in `PUBLIC_API_BASE_URL`. Changing it requires a frontend rebuild. Preview deployment origins must be explicitly allowed in Railway before they can access the API.

## SEO

The build (`scripts/seo.mjs`, run from `scripts/build.mjs`) rewrites each page head while leaving the body, inline styles, fonts and stylesheet links untouched. It sets a unique `<title>` and meta description per page, a canonical link, Open Graph and Twitter tags, and JSON-LD (`WebSite` + `WebPage` on every page, `Hotel` on the home page, `BreadcrumbList` elsewhere). It also writes `dist/sitemap.xml` and `dist/robots.txt`.

- With no `PUBLIC_SITE_URL`, pages build with `noindex,follow` and no canonical — safe for preview.
- With `PUBLIC_SITE_URL` set and `VERCEL_ENV` unset or `production`, the 35 content pages become indexable; the two policy-style pages stay `noindex`. Vercel preview deployments (`VERCEL_ENV=preview`) stay `noindex` even when the variable is set.
- `PUBLIC_SITE_URL` must be a bare HTTPS origin; a path, query, credentials or non-HTTPS scheme fails the build. If unset, `VERCEL_PROJECT_PRODUCTION_URL` is used as a fallback.

Run `npm test` to check the SEO transform preserves every page's presentation.

## Local development

Static pages only:

```sh
npm run dev
```

API:

```sh
cd backend
node --env-file=.env.example server.mjs
```

Built frontend with local API connection, in another terminal:

```sh
PUBLIC_API_BASE_URL=http://localhost:3001 npm run build
STATIC_DIRECTORY=dist npm run dev
```

Open `http://127.0.0.1:5173`. To validate:

```sh
npm test
npm run test:backend
python3 scripts/verify.py
npm run build
```

The original capture is in `site/`; deployment-ready files are generated in `dist/`. The existing framework starter remains in the repository but does not serve the copied frontend.

Configuration references: [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json), [Railway config as code](https://docs.railway.com/config-as-code/reference), [Railway health checks](https://docs.railway.com/deployments/healthchecks).
