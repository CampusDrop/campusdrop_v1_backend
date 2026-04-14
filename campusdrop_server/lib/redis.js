const { createClient } = require('redis');

/** @type {import('redis').RedisClientType | null} */
let client = null;

/** 동일 Redis 오류 로그 과다 출력 방지(초) */
const REDIS_ERROR_LOG_INTERVAL_MS = 15_000;
let lastRedisErrorLogAt = 0;

function redisUrl() {
  const url = (process.env.REDIS_URL || '').trim();
  if (!url) {
    throw new Error('REDIS_URL 환경 변수를 설정해 주세요.');
  }
  return url;
}

function logRedisErrorThrottled(err) {
  const now = Date.now();
  if (now - lastRedisErrorLogAt < REDIS_ERROR_LOG_INTERVAL_MS) {
    return;
  }
  lastRedisErrorLogAt = now;
  const hint =
    '로컬 개발: Redis를 6379에서 실행하거나 .env에 REDIS_URL=redis://127.0.0.1:6379 설정. Docker Desktop을 쓰면 `docker run -d -p 6379:6379 redis:7-alpine`';
  console.error('Redis:', err && err.message ? err.message : err, `— ${hint}`);
}

/**
 * 공유 Redis 클라이언트(연결 지연). 실패 시 예외.
 */
async function getRedis() {
  if (client && client.isOpen) {
    return client;
  }
  const c = createClient({
    url: redisUrl(),
    socket: {
      reconnectStrategy(retries) {
        if (retries > 12) {
          return new Error('Redis 재연결 횟수 초과');
        }
        return Math.min(retries * 250, 3000);
      },
    },
  });
  c.on('error', (err) => logRedisErrorThrottled(err));
  try {
    await c.connect();
  } catch (err) {
    try {
      c.removeAllListeners('error');
      await c.quit();
    } catch (_) {
      /* ignore */
    }
    throw err;
  }
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
