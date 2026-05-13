const { normalizeTraitGender } = require('./genderPolicy');
const { normalizeDepartment } = require('./departments');
const { normalizePhone01 } = require('./phoneCrypto');

const MAX_STUDENT_ID_LEN = 64;
const MAX_BIRTH_YEAR_LEN = 16;

/** 학교 메일 최초 연결(`verify-code`) 시 `profile.phone` 규격 안내 및 서버 검증 기준 요약용 */
const VERIFY_CODE_PROFILE_PHONE_DESCRIPTION =
  '문자열. 비숫자(하이픈·공백 등)는 제거 후 `01` + 9자리 숫자 = 총 11숫자, 지금은 `010`(휴대폰 11번대)만 허용. 예: "01012345678", "010-1234-5678".';

const VERIFY_CODE_PROFILE_PHONE_INVALID =
  'profile.phone 형식이 올바르지 않습니다. 010으로 시작하는 휴대폰 번호 11자리(숫자만 추출 기준)를 보내 주세요.';

const VERIFY_CODE_PROFILE_REQUIRED =
  '학교 이메일 최초 연결 시 JSON에 profile 객체와 profile.phone(필수)이 필요합니다. ' +
  VERIFY_CODE_PROFILE_PHONE_DESCRIPTION;

/**
 * 가입 직후(이메일/이미지) 프로필. 설문 없이 `Identity`·`Trait.gender`에 반영.
 * @param {unknown} raw — JSON 본문의 `profile` 객체 또는 multipart 문자열 파싱 결과
 * @param {{ phoneRequired?: boolean }} [options] — `phoneRequired: true`면 verify-code처럼 `profile.phone` 필수 및 객체 존재
 * @returns {{ ok: true, studentId?: string, birthYear?: string, department?: string, phone?: string, genderTrait: 'male' | 'female' | null } | { ok: false, error: string }}
 */
function parseSignupProfile(raw, options = {}) {
  const phoneRequired = options.phoneRequired === true;

  if (raw === undefined || raw === null || raw === '') {
    if (phoneRequired) {
      return { ok: false, error: VERIFY_CODE_PROFILE_REQUIRED };
    }
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
  const departmentRaw = o.department != null ? String(o.department).trim() : '';
  const department = departmentRaw ? normalizeDepartment(departmentRaw) : null;
  if (departmentRaw && !department) {
    return { ok: false, error: 'profile.department는 등록된 학과 목록 중 하나여야 합니다.' };
  }
  const genderTrait = normalizeTraitGender(o.gender);
  let normalizedSignupPhone = null;
  const phoneRaw = o.phone != null ? String(o.phone).trim() : '';
  if (phoneRaw) {
    normalizedSignupPhone = normalizePhone01(phoneRaw);
    if (!normalizedSignupPhone) {
      return { ok: false, error: VERIFY_CODE_PROFILE_PHONE_INVALID };
    }
  }

  if (phoneRequired && !normalizedSignupPhone) {
    return { ok: false, error: VERIFY_CODE_PROFILE_REQUIRED };
  }
  /** @type {{ ok: true, studentId?: string, birthYear?: string, department?: string, phone?: string, genderTrait: 'male' | 'female' | null }} */
  const out = { ok: true, genderTrait };
  if (sid) out.studentId = sid;
  if (by) out.birthYear = by;
  if (department) out.department = department;
  if (normalizedSignupPhone) out.phone = normalizedSignupPhone;
  return out;
}

module.exports = {
  parseSignupProfile,
  VERIFY_CODE_PROFILE_PHONE_DESCRIPTION,
  VERIFY_CODE_PROFILE_PHONE_INVALID,
  VERIFY_CODE_PROFILE_REQUIRED,
};
