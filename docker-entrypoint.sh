#!/bin/sh
set -e
# Runs pending Prisma migrations, then hands off to the real CMD.
# Safe to run on every start: `migrate deploy` is idempotent and a no-op
# when the database is already at the latest migration.
if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not set; skipping prisma migrate deploy" >&2
else
  npx prisma migrate deploy
fi
exec "$@"
