const crypto = require('crypto');
const { getRedis } = require('./redis');
const { prisma } = require('./prisma');

const PIN_TTL_SEC = 180; // 3분
const PIN_KEY_PREFIX = 'PIN:';
const MAX_PIN_ATTEMPTS = 30;

function randomFourDigitPin() {
  return String(crypto.randomInt(0, 10_000)).padStart(4, '0');
}

/**
 * @param {string} pin
 * @param {string} identityId
 */
async function setRedisPinMap(pin, identityId) {
  const r = await getRedis();
  await r.set(`${PIN_KEY_PREFIX}${pin}`, identityId, { EX: PIN_TTL_SEC });
}

/**
 * DB에 `kakaoLinkPin`을 두고 전역 유일을 보장합니다.
 * 이미 해당 유저에게 PIN이 있으면 같은 값을 반환하고 Redis TTL만 갱신합니다.
 *
 * @param {string} identityId
 * @returns {Promise<{ pin: string, expiresInSec: number }>}
 */
async function storePinForIdentity(identityId) {
  const identity = await prisma.identity.findUnique({
    where: { id: identityId },
    select: { kakaoLinkPin: true },
  });
  if (!identity) {
    const e = new Error('IDENTITY_NOT_FOUND');
    /** @type {any} */ (e).code = 'IDENTITY_NOT_FOUND';
    throw e;
  }

  if (identity.kakaoLinkPin) {
    await setRedisPinMap(identity.kakaoLinkPin, identityId);
    return { pin: identity.kakaoLinkPin, expiresInSec: PIN_TTL_SEC };
  }

  for (let i = 0; i < MAX_PIN_ATTEMPTS; i += 1) {
    const pin = randomFourDigitPin();
    const holder = await prisma.identity.findUnique({
      where: { kakaoLinkPin: pin },
      select: { id: true },
    });
    if (holder) continue;

    try {
      await prisma.identity.update({
        where: { id: identityId },
        data: { kakaoLinkPin: pin },
      });
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        continue;
      }
      throw err;
    }

    await setRedisPinMap(pin, identityId);
    return { pin, expiresInSec: PIN_TTL_SEC };
  }

  const collision = new Error('PIN_COLLISION');
  /** @type {any} */ (collision).code = 'PIN_COLLISION';
  throw collision;
}

/**
 * @param {string} pin 4자리
 * @returns {Promise<string | null>} Identity UUID or null
 */
async function getIdentityIdByPin(pin) {
  const r = await getRedis();
  const key = `${PIN_KEY_PREFIX}${pin}`;
  const fromRedis = await r.get(key);
  if (fromRedis) return fromRedis;

  const row = await prisma.identity.findUnique({
    where: { kakaoLinkPin: pin },
    select: { id: true },
  });
  if (!row) return null;

  await r.set(key, row.id, { EX: PIN_TTL_SEC });
  return row.id;
}

/**
 * @param {string} pin
 */
async function deletePinKey(pin) {
  const r = await getRedis();
  await r.del(`${PIN_KEY_PREFIX}${pin}`);
}

module.exports = {
  storePinForIdentity,
  getIdentityIdByPin,
  deletePinKey,
  PIN_TTL_SEC,
  PIN_KEY_PREFIX,
};
