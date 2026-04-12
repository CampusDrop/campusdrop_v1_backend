const { createClient } = require('redis');

/** @type {import('redis').RedisClientType | null} */
let client = null;

function redisUrl() {
  const url = (process.env.REDIS_URL || '').trim();
  if (!url) {
    throw new Error('REDIS_URL 환경 변수를 설정해 주세요.');
  }
  return url;
}

/**
 * 공유 Redis 클라이언트(연결 지연). 실패 시 예외.
 */
async function getRedis() {
  if (client && client.isOpen) {
    return client;
  }
  const c = createClient({ url: redisUrl() });
  c.on('error', (err) => console.error('Redis client error:', err));
  await c.connect();
  client = c;
  return client;
}

async function disconnectRedis() {
  if (client && client.isOpen) {
    await client.quit();
  }
  client = null;
}

module.exports = { getRedis, disconnectRedis, redisUrl };
