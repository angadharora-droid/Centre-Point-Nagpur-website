# Single Railway service: builds the static site and serves it together with /api.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

# No dependency install: the build and server use only Node built-ins.
COPY --chown=node:node package.json mirror-report.json ./
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node backend/server.mjs ./backend/server.mjs
COPY --chown=node:node site ./site
RUN chown node:node /app

USER node
EXPOSE 3000
# prestart runs scripts/build.mjs (reads PUBLIC_SITE_URL / PUBLIC_API_BASE_URL at
# runtime), then start serves dist/ + /api on $PORT.
CMD ["npm", "start"]
