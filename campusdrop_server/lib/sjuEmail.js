/**
 * 세종대학교 이메일(@sju.ac.kr) 여부만 검사합니다.
 * @param {string} email
 */
function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function isSjuAcKrEmail(email) {
  const normalized = normalizeEmail(email);
  const parts = normalized.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return Boolean(local) && domain === 'sju.ac.kr';
}

module.exports = { normalizeEmail, isSjuAcKrEmail };
