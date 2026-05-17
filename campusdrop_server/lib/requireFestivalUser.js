const { prisma } = require('./prisma');
const { readFestivalSessionUuidFromReq, UUID_RE } = require('./festivalCookie');

/** @typedef {{ id: bigint, uuid: string, kakaoId: string, createdAt: Date }} FestivalUser */

/**
 * 헤더 `x-user-uuid` 우선, 없으면 축제 전용 세션 쿠키 값을 검사합니다.
 * @returns {Promise<FestivalUser | null>}
 */
async function resolveFestivalUserFromReq(req) {
  const hdr = req.headers?.['x-user-uuid'];
  const fromHeader = typeof hdr === 'string' ? hdr.trim() : '';
  const fromCookie = readFestivalSessionUuidFromReq(req);
  const token = fromHeader || fromCookie || '';
  if (!token || !UUID_RE.test(token)) {
    return null;
  }
  return prisma.festivalUser.findUnique({ where: { uuid: token } });
}

async function requireFestivalUserUuid(req, res, next) {
  try {
    const u = await resolveFestivalUserFromReq(req);
    if (!u) {
      return res.status(401).json({
        error: '축제 로그인이 필요합니다.',
        code: 'FESTIVAL_AUTH_REQUIRED',
      });
    }
    /** @type {import('express').Request & { festivalUser?: FestivalUser }} */
    const r = req;
    r.festivalUser = u;
    return next();
  } catch (err) {
    console.error('requireFestivalUserUuid error:', err);
    return res.status(500).json({ error: '인증 처리 중 오류가 발생했습니다.' });
  }
}

module.exports = { requireFestivalUserUuid, resolveFestivalUserFromReq };
