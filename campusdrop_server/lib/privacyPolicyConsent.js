/**
 * JSON·multipart 본문에서 개인정보처리방침 동의 플래그 파싱.
 * @param {unknown} raw
 * @param {{ required?: boolean }} [opts]
 * @returns {{ ok: true, value: boolean | null } | { ok: false, error: string }}
 */
function parsePrivacyPolicyAgreed(raw, opts = {}) {
  const required = Boolean(opts.required);
  if (raw === undefined || raw === null || raw === '') {
    if (required) {
      return { ok: false, error: 'privacyPolicyAgreed가 필요합니다.' };
    }
    return { ok: true, value: null };
  }
  if (typeof raw === 'boolean') {
    return { ok: true, value: raw };
  }
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    if (s === 'true' || s === '1') return { ok: true, value: true };
    if (s === 'false' || s === '0') return { ok: true, value: false };
    return { ok: false, error: 'privacyPolicyAgreed는 true 또는 false여야 합니다.' };
  }
  return { ok: false, error: 'privacyPolicyAgreed는 불리언이어야 합니다.' };
}

module.exports = { parsePrivacyPolicyAgreed };
