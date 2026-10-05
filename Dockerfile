# Backend image. Build from the repository root:  docker build -t rent-manager-api .
FROM node:22-bookworm-slim AS build
# Prisma picks its engine files by the OpenSSL version it finds; the slim image has none, so install it before anything else.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/shared/package.json packages/shared/package.json
# The backend's postinstall (node scripts/prisma.js generate) needs this script and the schema, so copy them before npm ci.
COPY apps/backend/scripts apps/backend/scripts
COPY prisma prisma
RUN npm ci --workspace @rental/backend --workspace @rental/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN npx prisma generate --schema prisma/schema.prisma && npm run -w @rental/backend build && npm prune --omit=dev --workspace @rental/backend --workspace @rental/shared --include-workspace-root

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Owned by the non-root user so Prisma can write its engine files if it ever needs to.
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build /app/prisma prisma
COPY --from=build /app/apps/backend/dist apps/backend/dist
COPY --from=build /app/apps/backend/assets apps/backend/assets
COPY --from=build /app/apps/backend/package.json apps/backend/package.json
USER node
WORKDIR /app/apps/backend
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Applies pending migrations, then starts the API.
CMD ["sh", "-c", "npx prisma migrate deploy --schema ../../prisma/schema.prisma && node dist/main.js"]