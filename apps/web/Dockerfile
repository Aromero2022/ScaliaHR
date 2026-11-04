# Scalia HR web — production image (Next.js standalone).
# Build from the repo root:  docker build -f apps/web/Dockerfile .
# Only the two NEXT_PUBLIC_* values are build arguments: Next.js inlines them in
# the browser bundle, so they are public by design. Every secret is read at
# runtime from the container environment.

ARG NODE_IMAGE=node:22-alpine
ARG TURBO_VERSION=2.11.10

FROM ${NODE_IMAGE} AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /repo

# ─── Prune the monorepo to @scaliahr/web and its workspace dependencies ──────
FROM base AS pruner
ARG TURBO_VERSION
COPY . .
RUN npx --yes "turbo@${TURBO_VERSION}" prune @scaliahr/web --docker

# ─── Install and build ───────────────────────────────────────────────────────
FROM base AS builder
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/package-lock.json ./package-lock.json
RUN npm ci --no-audit --no-fund
COPY --from=pruner /repo/out/full/ ./
# turbo prune copies workspaces only; the shared compiler options live at the root.
COPY --from=pruner /repo/tsconfig.base.json ./tsconfig.base.json

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  || (echo "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY build args are required" && exit 1)
RUN cd apps/web && npx prisma generate --no-hints && npx next build

# ─── Runtime: standalone server only, non-root ───────────────────────────────
FROM ${NODE_IMAGE} AS runner
RUN apk add --no-cache openssl \
  && addgroup -S -g 1001 nodejs \
  && adduser -S -u 1001 -G nodejs nextjs
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
