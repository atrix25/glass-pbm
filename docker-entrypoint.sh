#!/bin/sh
set -e

# Historical application rollback: preserve the existing database schema and data.
# Schema changes must be applied explicitly, never by an older app on startup.

# Fly process group selects the command via CMD / processes in fly.toml.
# Default: web server.
if [ -n "$1" ]; then
  exec "$@"
fi

exec node /app/server.js
