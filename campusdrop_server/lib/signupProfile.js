const { normalizeTraitGender } = require('./genderPolicy');

const MAX_STUDENT_ID_LEN = 64;
const MAX_BIRTH_YEAR_LEN = 16;

/**
 * 가입 직후(이메일/이미지) 프로필. 설문 없이 `Identity`·`Trait.gender`에 반영.
 * @param {unknown} raw — JSON 본문의 `profile` 객체 또는 multipart 문자열 파싱 결과
 * @returns {{ ok: true, studentId?: string, birthYear?: string, genderTrait: 'male' | 'female' | null } | { ok: false, error: string }}
 */
function parseSignupProfile(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, genderTrait: null };
  }
  let o = raw;
  if (typeof raw === 'string') {
    try {
      o = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'profile JSON을 파싱할 수 없습니다.' };
    }
  }
  if (o === null || typeof o !== 'object' || Array.isArray(o)) {
    return { ok: false, error: 'profile은 객체여야 합니다.' };
  }
  const sid = o.studentId != null ? String(o.studentId).trim().slice(0, MAX_STUDENT_ID_LEN) : '';
  const by = o.birthYear != null ? String(o.birthYear).trim().slice(0, MAX_BIRTH_YEAR_LEN) : '';
  const genderTrait = normalizeTraitGender(o.gender);
  /** @type {{ ok: true, studentId?: string, birthYear?: string, genderTrait: 'male' | 'female' | null }} */
  const out = { ok: true, genderTrait };
  if (sid) out.studentId = sid;
  if (by) out.birthYear = by;
  return out;
}

module.exports = { parseSignupProfile };
