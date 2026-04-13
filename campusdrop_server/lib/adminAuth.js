const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const BEARER_PREFIX = /^Bearer\s+/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * JWT 서명용 비밀. `ADMIN_JWT_SECRET`(16자 이상) 권장.
 * 없으면 `ADMIN_PASSWORD`로 결정적 파생(로컬·시드용 `.env`만 있을 때 편의).
 */
function getAdminJwtSecret() {
  const explicit = String(process.env.ADMIN_JWT_SECRET || '').trim();
  if (explicit.length >= 16) {
    return explicit;
  }
  const password = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!password) {
    return null;
  }
  return crypto.createHash('sha256').update(`campusdrop:admin-jwt|${password}`, 'utf8').digest('base64url');
}

function adminJwtExpiresSec() {
  const n = Number(process.env.ADMIN_JWT_EXPIRES_SEC || 28800);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 86400 * 7) : 28800;
}

/**
 * @param {string} adminId DB `Admin.id` (uuid)
 */
function signAdminToken(adminId) {
  if (!adminId || typeof adminId !== 'string' || !UUID_RE.test(adminId)) {
    throw new Error('ADMIN_ID_INVALID');
  }
  const secret = getAdminJwtSecret();
  if (!secret) {
    throw new Error('ADMIN_NOT_CONFIGURED');
  }
  return jwt.sign({ role: 'admin', adminId }, secret, {
    algorithm: 'HS256',
    expiresIn: adminJwtExpiresSec(),
    issuer: 'campusdrop-admin',
    subject: adminId,
  });
}

function verifyAdminToken(token) {
  const secret = getAdminJwtSecret();
  if (!secret) {
    return { ok: false, reason: 'not_configured' };
  }
  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: 'campusdrop-admin',
    });
    if (!payload || payload.role !== 'admin') {
      return { ok: false, reason: 'invalid' };
    }
    const adminId = payload.adminId;
    if (typeof adminId !== 'string' || !UUID_RE.test(adminId)) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, payload, adminId };
  } catch (_) {
    return { ok: false, reason: 'invalid' };
  }
}

function parseBearerToken(req) {
  const raw = req.headers.authorization;
  if (typeof raw !== 'string' || !raw.trim()) {
    return '';
  }
  const s = raw.trim();
  if (!BEARER_PREFIX.test(s)) {
    return '';
  }
  return s.replace(BEARER_PREFIX, '').trim();
}

/**
 * `Authorization: Bearer <JWT>` 검증. 성공 시 `req.admin = { role, adminId }`.
 */
function adminAuthMiddleware(req, res, next) {
  const token = parseBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: '관리자 인증이 필요합니다. Bearer 토큰을 보내 주세요.' });
  }
  const v = verifyAdminToken(token);
  if (!v.ok) {
    if (v.reason === 'not_configured') {
      return res.status(503).json({
        error:
          '관리자 JWT 서명 키가 없습니다. ADMIN_JWT_SECRET(16자 이상) 또는 ADMIN_PASSWORD(JWT 파생용)를 설정해 주세요.',
      });
    }
    return res.status(401).json({ error: '유효하지 않거나 만료된 관리자 토큰입니다.' });
  }
  req.admin = { role: 'admin', adminId: v.adminId };
  return next();
}

module.exports = {
  adminAuthMiddleware,
  signAdminToken,
  verifyAdminToken,
  getAdminJwtSecret,
  adminJwtExpiresSec,
};
