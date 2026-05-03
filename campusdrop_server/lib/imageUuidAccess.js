const { getMatchingPeriodStart, getMatchingPeriodEnd } = require('./matchPolicy');

/**
 * 익명(이미지) 온보딩 시각 기준 — `matchPolicy`의 매칭 주(앵커 월요일 KST 기준 7일) 중 **현재 주의 끝**.
 * DB에는 UTC로 저장됩니다.
 * @param {Date} [at]
 * @returns {Date}
 */
function computeImageUuidAccessUntil(at = new Date()) {
  const periodStart = getMatchingPeriodStart(at);
  return getMatchingPeriodEnd(periodStart);
}

const IMAGE_ACCESS_EXPIRED = {
  error:
    '이미지 가입 세션 유효 기간이 지났습니다. 학교 이메일(@sju.ac.kr) 인증 또는 관리자 승인된 학교 증빙이 있어야 설문·매칭 기능을 이용할 수 있습니다.',
  code: 'IMAGE_UUID_ACCESS_EXPIRED',
};

/**
 * `Identity.imageUuidAccessUntil`이 지난 경우 설문·매칭 라우트만 403. (필드가 null이면 통과)
 */
function requireImageUuidAccessForSurveyApis(req, res, next) {
  const u = req.user;
  if (!u || u.imageUuidAccessUntil == null) {
    next();
    return;
  }
  const raw = u.imageUuidAccessUntil;
  const until = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(until.getTime())) {
    next();
    return;
  }
  if (Date.now() < until.getTime()) {
    next();
    return;
  }
  return res.status(403).json({
    ...IMAGE_ACCESS_EXPIRED,
    accessExpiredAt: until.toISOString(),
  });
}

module.exports = {
  computeImageUuidAccessUntil,
  requireImageUuidAccessForSurveyApis,
};
