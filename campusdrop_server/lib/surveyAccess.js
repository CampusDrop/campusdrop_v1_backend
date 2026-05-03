const { normalizeEmail, isSjuAcKrEmail } = require('./sjuEmail');

const SURVEY_ACCESS_DENIED = {
  error:
    '설문·매칭은 학교 이메일(@sju.ac.kr) 인증, 관리자가 승인한 학교 증빙, 또는 (증빙 제출 후) 이미지 가입 세션 유효 기간 내에만 이용할 수 있습니다.',
};

/**
 * 학교 소속 확인 완료로 간주되는지(설문·매칭 `/me`·`/submit` 등).
 * @param {{ email?: string | null; schoolProofVerifiedAt?: Date | string | null; imageUuidAccessUntil?: Date | string | null }} user
 */
function userHasSchoolVerification(user) {
  if (!user) return false;
  const email = user.email != null ? String(user.email).trim() : '';
  if (email && isSjuAcKrEmail(normalizeEmail(email))) return true;
  if (user.schoolProofVerifiedAt) return true;
  const imageUntil = user?.imageUuidAccessUntil;
  return Boolean(
    imageUntil &&
      !Number.isNaN(new Date(imageUntil).getTime()) &&
      Date.now() < new Date(imageUntil).getTime(),
  );
}

module.exports = {
  userHasSchoolVerification,
  surveySchoolAccessOk: userHasSchoolVerification,
  SURVEY_ACCESS_DENIED,
};
