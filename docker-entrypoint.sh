#!/bin/sh
# Container startup for the EVE Healthcare Backend.
#
# 1) Apply the committed Prisma migration history to the (Docker) database using
#    the SAFE, non-destructive command. `migrate deploy` never resets or drops
#    data — it only applies pending migrations.
# 2) Start the HTTP server.
#
# `set -e` ensures a migration failure aborts startup instead of being hidden.
set -e

echo "[entrypoint] Applying database migrations (prisma migrate deploy)..."
npx prisma migrate deploy

echo "[entrypoint] Starting EVE Healthcare Backend..."
exec node src/server.js
