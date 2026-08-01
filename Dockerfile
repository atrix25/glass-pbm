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
# The build reads the seeded book for statically analysed pages; point it at
# the same file the runtime will use so the two never disagree.
ENV DATABASE_URL="file:/app/prisma/dev.db"
RUN npx prisma generate && npm run build

FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL="file:/app/prisma/dev.db"

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# The seeded book travels inside the image. A redeploy resets the demo to a
# known state, which is the behaviour we want for a demo.
COPY --from=build /app/prisma/dev.db ./prisma/dev.db

EXPOSE 3000
CMD ["node", "server.js"]
