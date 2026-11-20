# VITPAY API (et worker : même image, WORKERS_ENABLED=true)
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/money/package.json packages/money/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @vitpay/api...
COPY packages/money packages/money
COPY apps/api apps/api
RUN pnpm --filter @vitpay/money build && pnpm --filter @vitpay/api build
# Dépendances de production uniquement
RUN rm -rf node_modules apps/api/node_modules packages/money/node_modules \
 && pnpm install --frozen-lockfile --prod --filter @vitpay/api...

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/packages/money/package.json ./packages/money/package.json
COPY --from=build --chown=node:node /repo/packages/money/dist ./packages/money/dist
COPY --from=build --chown=node:node /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /repo/apps/api/migrations ./apps/api/migrations
USER node
WORKDIR /app/apps/api
EXPOSE 4710
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4710)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/main.js"]
