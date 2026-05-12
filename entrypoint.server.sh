#!/bin/sh
set -e
cd /app
echo "[entrypoint] prisma migrate deploy (DATABASE_URL 대상 DB에 적용) …"
npx prisma migrate deploy
echo "[entrypoint] starting node …"
exec node index.js
