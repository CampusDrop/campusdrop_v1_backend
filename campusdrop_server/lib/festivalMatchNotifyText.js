'use strict';

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

/** @param {string} phone */
function formatKoMobileDisplay(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('01')) {
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }
  return String(phone || '').trim() || '—';
}

/** @param {string | null | undefined} ig */
function instagramHandleDisplay(ig) {
  if (ig == null || String(ig).trim() === '') return '';
  const s = String(ig).trim();
  return s.startsWith('@') ? s : `@${s}`;
}

/**
 * 신청 시 `contactPreference`(최대 10자 자유 문자열)로 상대에게 무엇을 알려줄지 분기합니다.
 * 권장 값: `PHONE` | `IG` | `BOTH` 또는 `전화`·`인스타`·`둘다` 등 한글 키워드.
 * @returns {'phone'|'instagram'|'both'}
 */
function contactRevealMode(contactPreference, hasInstagram) {
  const s = String(contactPreference ?? '').trim();
  const u = s.toUpperCase();

  if (['PHONE', 'TEL', 'HP', 'CALL', 'SMS'].includes(u)) return 'phone';
  if (['INSTAGRAM', 'IG', 'INSTA'].includes(u)) return 'instagram';
  if (['BOTH', 'ALL'].includes(u)) return 'both';

  if (/인스타/.test(s)) return 'instagram';
  if (/전화|문자|폰/.test(s)) return 'phone';
  if (/둘|모두/.test(s)) return 'both';

  return hasInstagram ? 'both' : 'phone';
}

/**
 * 매칭 알림문에서 보여 줄 **상대방** 연락 한 줄 (상대의 `contactPreference`·인스타 유무 반영).
 * @param {{ phone: string, instagram: string | null, contactPreference: string }} partner
 */
function buildPartnerContactLine(partner) {
  const phoneDisp = formatKoMobileDisplay(partner.phone);
  const igDisp = instagramHandleDisplay(partner.instagram);
  const hasIg = Boolean(partner.instagram && String(partner.instagram).trim());

  switch (contactRevealMode(partner.contactPreference, hasIg)) {
    case 'phone':
      return phoneDisp;
    case 'instagram':
      return igDisp || phoneDisp;
    case 'both':
    default:
      return igDisp ? `${phoneDisp} 또는 ${igDisp}` : phoneDisp;
  }
}

/**
 * @param {{ receptionId: string, phone: string, vibe?: string }} self
 * @param {{ receptionId: string, phone: string, instagram: string | null, contactPreference: string, peopleCount: number, vibe: string }} partner
 * @param {'M' | 'F'} selfGender
 */
function buildFestivalMatchFriendTalkText(self, partner, selfGender) {
  const myVibe = String(self.vibe ?? '').trim();
  const partnerVibe = String(partner.vibe ?? '').trim();
  /** 같은 무드면 사용자 카피 스타일, 아니면 양쪽 모두 명시 */
  const moodLine =
    myVibe && partnerVibe && myVibe === partnerVibe
      ? `두 팀 모두 ${myVibe} 무드를 선택하셨네요. 🥂`
      : `내 팀은 ${myVibe || '—'}, 상대 팀은 ${partnerVibe || '—'} 무드예요. 🥂`;

  const partnerHasIg = Boolean(partner.instagram && String(partner.instagram).trim());
  const revealMode = contactRevealMode(partner.contactPreference, partnerHasIg);
  const partnerContactLine = buildPartnerContactLine(partner);

  const raw =
    String(process.env.FESTIVAL_MATCH_FRIENDTALK_TEXT || '').trim() ||
    `🎉 [매칭 성공] 축제 메이트가 도착했습니다!

치열한 대기열을 뚫고 드디어 매칭에 성공하셨습니다!
${moodLine}

지금 바로 연락해서 축제를 함께 즐길 약속을 잡아보세요!

■ 상대방 연락처: {partnerContactLine}
■ 인원 수: {partnerPeopleCount}명

💡 첫 인사는 이렇게 해보세요!
"안녕하세요! 캠퍼스 드랍 매칭돼서 연락드렸어요~ 지금 어디에 계시나요?"`;

  const vars = {
    myReceptionId: self.receptionId,
    partnerReceptionId: partner.receptionId,
    partnerPhone: partner.phone,
    partnerContactPreference: partner.contactPreference,
    partnerContactReveal: revealMode,
    partnerInstagram: partner.instagram ? instagramHandleDisplay(partner.instagram) : '(없음)',
    partnerVibe,
    partnerPeopleCount: String(partner.peopleCount),
    myGender: selfGender === 'M' ? '남' : '여',
    myVibe,
    moodLine,
    partnerContactLine,
  };
  return applyTemplate(raw, vars).slice(0, 1000);
}

module.exports = { buildFestivalMatchFriendTalkText, applyTemplate };
