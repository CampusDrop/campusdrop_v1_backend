const { getRedis } = require('./redis');
const { rateWindowSec } = require('./analyticsConstants');

function timeBucket(windowSec = rateWindowSec) {
  return Math.floor(Date.now() / (windowSec * 1000));
}

function dayBucketUtc() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 고정 창 카운터. 초과 시 false.
 * Redis 장애 시 true(수집 우선) + 콘솔 경고.
 *
 * @param {string} scope
 * @param {string} id
 * @param {number} max
 * @param {number} windowSec
 */
async function allowInWindow(scope, id, max, windowSec = rateWindowSec) {
  if (max <= 0) return true;
  const safeId = String(id || 'unknown').slice(0, 200);
  const key = `ratelimit:analytics:${scope}:${safeId}:${timeBucket(windowSec)}`;
  const ttl = Math.max(windowSec * 2, 120);
  try {
    const redis = await getRedis();
    const n = await redis.incr(key);
    if (n === 1) {
      await redis.expire(key, ttl);
    }
    return n <= max;
  } catch (err) {
    console.warn('analytics rate limit skipped (redis):', err && err.message ? err.message : err);
    return true;
  }
}

/**
 * 세션·UTC일 기준 상호작용 상한. INCRBY 후 초과면 즉시 롤백.
 * @returns {Promise<boolean>}
 */
async function reserveDailyInteractionQuota(sessionId, addCount, maxPerDay) {
  if (maxPerDay <= 0 || addCount <= 0) return true;
  const safeSession = String(sessionId || '').slice(0, 64);
  const key = `ratelimit:analytics:interaction:daily:${safeSession}:${dayBucketUtc()}`;
  const ttl = 60 * 60 * 50;
  try {
    const redis = await getRedis();
    const n = await redis.incrBy(key, addCount);
    if (n === addCount) {
      await redis.expire(key, ttl);
    }
    if (n > maxPerDay) {
      await redis.incrBy(key, -addCount);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('analytics daily quota skipped (redis):', err && err.message ? err.message : err);
    return true;
  }
}

async function releaseDailyInteractionQuota(sessionId, addCount) {
  if (addCount <= 0) return;
  const safeSession = String(sessionId || '').slice(0, 64);
  const key = `ratelimit:analytics:interaction:daily:${safeSession}:${dayBucketUtc()}`;
  try {
    const redis = await getRedis();
    await redis.incrBy(key, -addCount);
  } catch (err) {
    console.warn('analytics daily quota release failed:', err && err.message ? err.message : err);
  }
}

/**
 * IP·세션 둘 다 한도 이내일 때만 true.
 */
async function allowIpAndSession(scope, ip, sessionId, maxIp, maxSession, windowSec = rateWindowSec) {
  const ipOk = await allowInWindow(`${scope}:ip`, ip, maxIp, windowSec);
  if (!ipOk) return false;
  const sessOk = await allowInWindow(`${scope}:session`, sessionId, maxSession, windowSec);
  return sessOk;
}

module.exports = {
  allowInWindow,
  reserveDailyInteractionQuota,
  releaseDailyInteractionQuota,
  allowIpAndSession,
  timeBucket,
  dayBucketUtc,
};
