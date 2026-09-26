# syntax=docker/dockerfile:1
#
# Multi-stage build for the Dhaka Tesla Pool frontend.
#
# Relies on Next's `output: 'standalone'`, which traces the modules the server
# actually reaches and copies just those — so the runtime stage needs no npm install
# and carries none of the build tooling.

# ─── Stage 1: dependencies ───────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ─── Stage 2: build ──────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

COPY tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs ./
COPY src ./src

# Next inlines NEXT_PUBLIC_* at build time, so anything the browser needs has to be
# present now rather than at startup. Left unset on purpose: the API client defaults
# to the relative /api/v1, which the rewrite proxies — so the image is not tied to
# any particular API hostname.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Stage 3: runtime ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The standalone bundle, plus the static assets it serves.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# node:22 already provides an unprivileged `node` user.
RUN chown -R node:node /app
USER node

EXPOSE 3000

# Checks that the app responds, using Node's built-in fetch so the image needs no curl.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
