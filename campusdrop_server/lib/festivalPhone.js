/**
 * 신청서·운영 검색 공통 형식으로 휴대폰 번호를 정규화합니다 (`010xxxxxxxx` 또는 `070` 등 원칙적으로 010만 허용).
 * @param {unknown} raw
 */
function normalizeKoMobile(raw) {
  const digits = String(raw == null ? '' : raw).replace(/\D/g, '');
  let d = digits;
  if (!d.length) return '';
  if (d.startsWith('82')) {
    d = `0${d.slice(2)}`;
  }
  if (d.length === 11 && /^01\d{9}$/.test(d)) {
    return d;
  }
  if (d.length === 10 && /^10\d{8}$/.test(d)) {
    return `0${d}`;
  }
  return digits;
}

module.exports = { normalizeKoMobile };
