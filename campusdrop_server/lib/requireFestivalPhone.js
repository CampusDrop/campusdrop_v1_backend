const { normalizeKoMobile } = require('./festivalPhone');

/**
 * 쿼리 `phone` 또는 헤더 `x-festival-phone` — `normalizeKoMobile` 11자리.
 * 본인인증 없음; 클라이언트가 넘긴 값이 곧 식별자입니다.
 */
function parseFestivalPhoneFromReq(req) {
  const q = req.query?.phone;
  const h = req.headers?.['x-festival-phone'];
  const raw =
    (typeof q === 'string' ? q.trim() : '') || (typeof h === 'string' ? h.trim() : '');
  if (!raw) return null;
  const normalized = normalizeKoMobile(raw);
  if (!(normalized.length === 11 && normalized.startsWith('01'))) return null;
  return normalized;
}

function requireFestivalPhone(req, res, next) {
  const p = parseFestivalPhoneFromReq(req);
  if (!p) {
    return res.status(400).json({
      error:
        '휴대폰 번호가 필요합니다. 쿼리 ?phone=010… 또는 헤더 x-festival-phone(010 포함 11자리)를 보내 주세요.',
      code: 'FESTIVAL_PHONE_REQUIRED',
    });
  }
  /** @type {import('express').Request & { festivalPhoneNormalized?: string }} */
  const r = req;
  r.festivalPhoneNormalized = p;
  return next();
}

module.exports = { parseFestivalPhoneFromReq, requireFestivalPhone };
