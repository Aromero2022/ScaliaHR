# Scalia HR worker — production image (pg-boss consumer).
# Build from the repo root:  docker build -f apps/worker/Dockerfile .
# No build arguments and no secrets: WORKER_DATABASE_URL is read at runtime.

ARG NODE_IMAGE=node:22-alpine
ARG TURBO_VERSION=2.11.10

FROM ${NODE_IMAGE} AS base
WORKDIR /repo

# ─── Prune the monorepo to @scaliahr/worker ──────────────────────────────────
FROM base AS pruner
ARG TURBO_VERSION
COPY . .
RUN npx --yes "turbo@${TURBO_VERSION}" prune @scaliahr/worker --docker

# ─── Build with dev dependencies ─────────────────────────────────────────────
FROM base AS builder
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/package-lock.json ./package-lock.json
RUN npm ci --no-audit --no-fund
COPY --from=pruner /repo/out/full/ ./
# turbo prune copies workspaces only; the shared compiler options live at the root.
COPY --from=pruner /repo/tsconfig.base.json ./tsconfig.base.json
RUN npm run build -w @scaliahr/worker

# ─── Production dependencies only ────────────────────────────────────────────
FROM base AS deps
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/package-lock.json ./package-lock.json
RUN npm ci --omit=dev --no-audit --no-fund

# ─── Runtime: compiled worker, non-root ──────────────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder /repo/apps/worker/dist ./apps/worker/dist
USER node
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
