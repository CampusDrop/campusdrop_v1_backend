/**
 * @param {string} raw
 * @param {Record<string, string>} vars
 */
function applyTemplate(raw, vars) {
  let out = raw;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v);
  }
  return out;
}

/**
 * @param {{ receptionId: string, phone: string }} self
 * @param {{ receptionId: string, phone: string, instagram: string | null, contactPreference: string, peopleCount: number, vibe: string }} partner
 * @param {'M' | 'F'} selfGender
 */
function buildFestivalMatchFriendTalkText(self, partner, selfGender) {
  const raw =
    String(process.env.FESTIVAL_MATCH_FRIENDTALK_TEXT || '').trim() ||
    `[캠퍼스드롭 축제 매칭] 매칭이 완료되었습니다.

내 접수번호: {myReceptionId}
상대 접수번호: {partnerReceptionId}
상대 연락처: {partnerPhone}
선호 연락: {partnerContactPreference}
인스타: {partnerInstagram}
무드: {partnerVibe}
인원: {partnerPeopleCount}

서로 인사 나누시고 만남 일정을 조율해 주세요. 행사 안내를 확인해 주세요.`;

  const vars = {
    myReceptionId: self.receptionId,
    partnerReceptionId: partner.receptionId,
    partnerPhone: partner.phone,
    partnerContactPreference: partner.contactPreference,
    partnerInstagram: partner.instagram || '(없음)',
    partnerVibe: partner.vibe,
    partnerPeopleCount: String(partner.peopleCount),
    myGender: selfGender === 'M' ? '남' : '여',
  };
  return applyTemplate(raw, vars).slice(0, 1000);
}

module.exports = { buildFestivalMatchFriendTalkText, applyTemplate };
