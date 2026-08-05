FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build only needs the schema, not the 1.3 GB book. The real book is mounted
# at runtime from the Fly volume.
ENV DATABASE_URL="file:/app/prisma/build.db"
RUN npx prisma generate \
  && npx prisma db push --skip-generate \
  && npm run build

FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL="file:/data/dev.db"

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Schema client is already traced into the standalone bundle. The book itself
# is not copied: it is supplied by the glass_book volume at /data.

EXPOSE 3000
CMD ["node", "server.js"]
