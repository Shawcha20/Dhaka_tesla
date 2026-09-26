# syntax=docker/dockerfile:1
#
# Multi-stage build for the Dhaka Tesla Pool API.
#
# The same image runs under docker compose locally and on Render, so "works on my
# machine" and "works deployed" have one answer.
#
# Debian slim rather than Alpine: Prisma's query engine needs a musl-specific build
# and OpenSSL wiring that is a recurring source of runtime surprises. The extra tens
# of megabytes buy a boring, predictable image.

# ─── Stage 1: dependencies ───────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# openssl is a Prisma runtime requirement, not an optional extra.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Only the manifests, so this layer is cached until dependencies actually change.
COPY package.json package-lock.json ./
RUN npm ci

# ─── Stage 2: build ──────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY src ./src

# Generate before compiling: the build needs the generated client's types.
RUN npx prisma generate
RUN npm run build

# ─── Stage 3: production dependencies only ───────────────────────────────────
FROM deps AS prod-deps
WORKDIR /app
# Drops devDependencies (TypeScript, Vitest, ESLint) from the final image.
RUN npm ci --omit=dev
# Regenerated here because the prune above removes the client generated in deps.
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# ─── Stage 4: runtime ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV API_PORT=4000

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Migrations and schema ship with the image so `prisma migrate deploy` can run at
# startup against whatever database this container is pointed at.
COPY --from=build /app/prisma ./prisma
COPY prisma.config.ts package.json ./
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh

# node:22 already provides an unprivileged `node` user. Running as root inside a
# container is a habit worth not having.
RUN chown -R node:node /app
USER node

EXPOSE 4000

# Hits the readiness probe, which checks the database rather than only the process.
# Uses Node's built-in fetch, so the image needs no curl.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/ready').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/src/server.js"]
