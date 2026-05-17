const cookie = require('cookie');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NAME_DEFAULT = 'campus_drop_festival_uuid';

/** @returns {string} 서버 세션 식별 쿠키 이름 (`FESTIVAL_SESSION_COOKIE_NAME`로 명세 이름 `uuid`와 충돌 시 변경). */
function festivalSessionCookieName() {
  const raw = String(process.env.FESTIVAL_SESSION_COOKIE_NAME || NAME_DEFAULT).trim();
  return raw || NAME_DEFAULT;
}

/** @returns {import('express').CookieOptions} */
function festivalSessionCookieBaseOptions() {
  const prod = process.env.NODE_ENV === 'production';
  const insecureOk = ['1', 'true', 'yes'].includes(
    String(process.env.FESTIVAL_COOKIE_INSECURE || '').trim().toLowerCase(),
  );
  /** @type {import('express').CookieOptions} */
  const opts = {
    httpOnly: true,
    secure: prod && !insecureOk,
    sameSite: /** @type {'lax'} */ ('lax'),
    path: '/',
  };
  const maxAgeDays = Number(process.env.FESTIVAL_COOKIE_MAX_AGE_DAYS || 60);
  const days = Number.isFinite(maxAgeDays) && maxAgeDays > 0 ? Math.min(maxAgeDays, 365) : 60;
  opts.maxAge = Math.floor(days * 24 * 60 * 60);
  return opts;
}

/**
 * @param {string | undefined} rawCookieHeader
 */
function readFestivalSessionUuid(rawCookieHeader) {
  try {
    const parsed = cookie.parse(typeof rawCookieHeader === 'string' ? rawCookieHeader : '');
    const v = parsed[festivalSessionCookieName()];
    return typeof v === 'string' ? v.trim() : '';
  } catch (_) {
    return '';
  }
}

/**
 * @param {import('express').Request} req
 */
function readFestivalSessionUuidFromReq(req) {
  return readFestivalSessionUuid(req.headers?.cookie || '');
}

/**
 * @param {import('express').Response} res
 * @param {string} uuid
 */
function attachFestivalSessionCookie(res, uuid) {
  res.cookie(festivalSessionCookieName(), uuid, festivalSessionCookieBaseOptions());
}

/**
 * 명세 상 `POST /api/auth/logout` 시 브라우저에 남아 있을 축제 쿠키를 만료 처리합니다.
 * @param {import('express').Response} res
 */
function clearFestivalSessionCookie(res) {
  res.clearCookie(festivalSessionCookieName(), {
    httpOnly: true,
    secure: festivalSessionCookieBaseOptions().secure,
    sameSite: 'lax',
    path: '/',
  });
}

module.exports = {
  festivalSessionCookieName,
  readFestivalSessionUuidFromReq,
  attachFestivalSessionCookie,
  clearFestivalSessionCookie,
  UUID_RE,
};
