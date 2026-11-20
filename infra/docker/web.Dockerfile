# VITPAY apps web (pay | business | admin) — Next.js standalone
ARG APP
FROM node:22-bookworm-slim AS build
ARG APP
ARG VITPAY_API_URL=http://api:4710
# « staging » : bandeau d'environnement de test sur toutes les pages (fixé au build).
ARG NEXT_PUBLIC_VITPAY_ENV=local
ENV NEXT_TELEMETRY_DISABLED=1 VITPAY_API_URL=$VITPAY_API_URL NEXT_PUBLIC_VITPAY_ENV=$NEXT_PUBLIC_VITPAY_ENV
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/ui/package.json packages/ui/
COPY apps/${APP}/package.json apps/${APP}/
RUN pnpm install --frozen-lockfile --filter @vitpay/${APP}...
COPY packages/ui packages/ui
COPY apps/${APP} apps/${APP}
RUN pnpm --filter @vitpay/${APP} build

FROM node:22-bookworm-slim
ARG APP
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
USER node
ENV APP_DIR=/app/apps/${APP}
CMD ["sh", "-c", "node $APP_DIR/server.js"]
