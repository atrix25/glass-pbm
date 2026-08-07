#!/bin/sh
set -e

# Fetch the book onto the Fly volume when it is missing. Code deploys stay slim;
# the ~1.3 GB SQLite file is delivered separately via object storage.
if [ -n "$BOOK_S3_BUCKET" ] || [ -n "$BUCKET_NAME" ]; then
  node /app/scripts/download-book.mjs
fi

exec node /app/server.js
