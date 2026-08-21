#!/bin/sh
set -e

# Apply schema when DIRECT_URL / DATABASE_URL is reachable (idempotent).
if [ -n "$DATABASE_URL" ] || [ -n "$DATABASE_URL_DIRECT" ]; then
  export DATABASE_URL="${DATABASE_URL_DIRECT:-$DATABASE_URL}"
  npx prisma db push --skip-generate --accept-data-loss=false 2>/dev/null || true
fi

# Fly process group selects the command via CMD / processes in fly.toml.
# Default: web server.
if [ -n "$1" ]; then
  exec "$@"
fi

exec node /app/server.js
