const crypto = require('crypto');
const { getRedis } = require('./redis');

const PIN_TTL_SEC = 180; // 3분
const PIN_KEY_PREFIX = 'PIN:';
const MAX_PIN_ATTEMPTS = 30;

function randomFourDigitPin() {
  return String(crypto.randomInt(0, 10_000)).padStart(4, '0');
}

/**
 * Redis에 `PIN:{4자리}` → Identity UUID 저장 (TTL 3분, NX).
 * @param {string} identityId
 * @returns {Promise<{ pin: string, expiresInSec: number }>}
 */
async function storePinForIdentity(identityId) {
  const r = await getRedis();
  for (let i = 0; i < MAX_PIN_ATTEMPTS; i += 1) {
    const pin = randomFourDigitPin();
    const key = `${PIN_KEY_PREFIX}${pin}`;
    const ok = await r.set(key, identityId, { EX: PIN_TTL_SEC, NX: true });
    if (ok) {
      return { pin, expiresInSec: PIN_TTL_SEC };
    }
  }
  const e = new Error('PIN_COLLISION');
  /** @type {any} */ (e).code = 'PIN_COLLISION';
  throw e;
}

/**
 * @param {string} pin 4자리
 * @returns {Promise<string | null>} Identity UUID or null
 */
async function getIdentityIdByPin(pin) {
  const r = await getRedis();
  const key = `${PIN_KEY_PREFIX}${pin}`;
  const v = await r.get(key);
  return v;
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
