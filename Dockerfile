# Single Railway service: builds the static site and serves it together with /api.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

# Install the API's runtime dependency (mongodb driver) only.
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install --omit=dev --no-audit --no-fund

# The build and the static server use only Node built-ins beyond that.
COPY package.json mirror-report.json ./
COPY scripts ./scripts
COPY backend ./backend
COPY site ./site
RUN chown -R node:node /app

USER node
EXPOSE 3000
# prestart runs scripts/build.mjs (reads PUBLIC_SITE_URL at runtime), then start
# serves dist/ + /api on $PORT.
CMD ["npm", "start"]
