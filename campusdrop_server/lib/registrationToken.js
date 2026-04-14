const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ISS = 'campusdrop-registration';
const TYP = 'campusdrop_reg_email';

function getRegistrationJwtSecret() {
  const explicit = String(process.env.AUTH_REGISTRATION_JWT_SECRET || '').trim();
  if (explicit.length >= 16) {
    return explicit;
  }
  const adminJwt = String(process.env.ADMIN_JWT_SECRET || '').trim();
  if (adminJwt.length >= 16) {
    return adminJwt;
  }
  const password = String(process.env.ADMIN_PASSWORD || '').trim();
  if (password) {
    return crypto
      .createHash('sha256')
      .update(`campusdrop:registration-jwt|${password}`, 'utf8')
      .digest('base64url');
  }
  return null;
}

function registrationJwtExpiresSec() {
  const n = Number(process.env.AUTH_REGISTRATION_JWT_EXPIRES_SEC || 3600);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 86400 * 2) : 3600;
}

/**
 * @param {string} normalizedEmail `normalizeEmail` 적용된 @sju.ac.kr
 */
function signRegistrationToken(normalizedEmail) {
  const secret = getRegistrationJwtSecret();
  if (!secret) {
    const e = new Error('REGISTRATION_JWT_SECRET_MISSING');
    e.code = 'REGISTRATION_JWT_SECRET_MISSING';
    throw e;
  }
  return jwt.sign(
    { typ: TYP, email: normalizedEmail },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: registrationJwtExpiresSec(),
      issuer: ISS,
      subject: normalizedEmail,
    },
  );
}

/**
 * @param {string} token
 * @returns {{ ok: true, email: string } | { ok: false, reason: string }}
 */
function verifyRegistrationToken(token) {
  const secret = getRegistrationJwtSecret();
  if (!secret) {
    return { ok: false, reason: 'not_configured' };
  }
  const raw = String(token || '').trim();
  if (!raw) {
    return { ok: false, reason: 'missing' };
  }
  try {
    const payload = jwt.verify(raw, secret, {
      algorithms: ['HS256'],
      issuer: ISS,
    });
    if (!payload || payload.typ !== TYP) {
      return { ok: false, reason: 'invalid' };
    }
    const email = typeof payload.email === 'string' ? payload.email.trim() : '';
    if (!email) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, email };
  } catch (_) {
    return { ok: false, reason: 'invalid' };
  }
}

module.exports = {
  signRegistrationToken,
  verifyRegistrationToken,
  registrationJwtExpiresSec,
};
