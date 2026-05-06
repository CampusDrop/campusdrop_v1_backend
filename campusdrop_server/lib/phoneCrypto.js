const crypto = require('crypto');

const PHONE_DIGITS_RE = /^01\d{9}$/;
const PHONE_KEY_BYTES = 32;
const IV_BYTES = 12;
const KEY_ENV = 'PHONE_ENCRYPTION_KEY';

function normalizePhone01(raw) {
  const digits = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!PHONE_DIGITS_RE.test(digits)) {
    return null;
  }
  return digits;
}

function loadPhoneKey() {
  const keyRaw = String(process.env[KEY_ENV] || '').trim();
  if (!keyRaw) {
    return null;
  }
  try {
    const buf = Buffer.from(keyRaw, 'base64');
    if (buf.length === PHONE_KEY_BYTES) {
      return buf;
    }
  } catch (_) {
    // ignore; fallback to hex parsing
  }
  try {
    const buf = Buffer.from(keyRaw, 'hex');
    if (buf.length === PHONE_KEY_BYTES) {
      return buf;
    }
  } catch (_) {
    // ignore
  }
  return null;
}

function encryptPhoneForStorage(phoneDigits) {
  const normalized = normalizePhone01(phoneDigits);
  if (!normalized) {
    throw new Error('PHONE_INVALID');
  }
  const key = loadPhoneKey();
  if (!key) {
    throw new Error('PHONE_ENCRYPTION_KEY_INVALID');
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${enc.toString('base64url')}:${tag.toString('base64url')}`;
}

function decryptPhoneFromStorage(token) {
  const raw = String(token || '').trim();
  const [ver, ivB64, encB64, tagB64] = raw.split(':');
  if (ver !== 'v1' || !ivB64 || !encB64 || !tagB64) {
    throw new Error('PHONE_CIPHERTEXT_INVALID');
  }
  const key = loadPhoneKey();
  if (!key) {
    throw new Error('PHONE_ENCRYPTION_KEY_INVALID');
  }
  const iv = Buffer.from(ivB64, 'base64url');
  const enc = Buffer.from(encB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return `${decipher.update(enc)}${decipher.final()}`;
}

module.exports = {
  KEY_ENV,
  normalizePhone01,
  encryptPhoneForStorage,
  decryptPhoneFromStorage,
};
