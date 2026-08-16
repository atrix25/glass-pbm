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
# at runtime from the Fly volume (downloaded from object storage on first boot).
ENV DATABASE_URL="file:/app/prisma/build.db"
RUN npx prisma generate \
  && npx prisma db push --skip-generate \
  && npm run build

FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL="file:/data/dev.db" \
    BOOK_PATH="/data/dev.db"

# Boot script pulls the book from S3-compatible storage when the volume is empty.
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts @aws-sdk/client-s3 @aws-sdk/lib-storage \
  && npm cache clean --force
COPY scripts/download-book.mjs scripts/book-storage.mjs ./scripts/
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Schema client is already traced into the standalone bundle. The book itself
# is not copied: it is supplied by the glass_book volume at /data.

# Correctness proof reads this Vitest artifact at runtime (see
# getHarnessResults). The suite needs the full book, so we ship the last
# committed run rather than regenerating inside the image.
COPY tests/results.json ./tests/results.json

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
