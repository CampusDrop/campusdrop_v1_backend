#!/bin/sh
set -e
cd /app
npx prisma migrate deploy
exec node index.js
