/** @typedef {{ code: string, expiresAt: number }} VerificationEntry */

const TTL_MS = 3 * 60 * 1000;

/** @type {Map<string, VerificationEntry>} */
const store = new Map();

function setVerificationCode(email, code) {
  store.set(email, {
    code,
    expiresAt: Date.now() + TTL_MS,
  });
}

function clearVerificationCode(email) {
  store.delete(email);
}

/**
 * @param {string} email
 * @param {string} code
 * @returns {{ ok: true } | { ok: false, reason: 'not_found' | 'expired' | 'mismatch' }}
 */
function verifyAndConsume(email, code) {
  const entry = store.get(email);
  if (!entry) {
    return { ok: false, reason: 'not_found' };
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(email);
    return { ok: false, reason: 'expired' };
  }
  const input = String(code).trim();
  if (input !== entry.code) {
    return { ok: false, reason: 'mismatch' };
  }
  store.delete(email);
  return { ok: true };
}

module.exports = {
  setVerificationCode,
  clearVerificationCode,
  verifyAndConsume,
};
