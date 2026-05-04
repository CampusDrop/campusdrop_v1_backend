const express = require('express');
const {
  assertSolapiFriendTalkEnv,
  sendFriendTalkCta,
  getKakaoFriendTalkImageIdFromEnv,
  FRIEND_TALK_IMG_DAY_EVE,
  FRIEND_TALK_IMG_MATCH_FAIL,
  FRIEND_TALK_IMG_MATCH_SUCCESS,
} = require('../lib/solapiFriendTalkSend');
const { prisma } = require('../lib/prisma');
const {
  publicApiBase,
  rsvpSecret,
  normalizeMsisdn01,
  buildRsvpButtons,
  sendDayEveReminderForMatching,
} = require('../lib/friendTalkRsvp');

const router = express.Router();

const MATCHING_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @param {unknown} body */
function matchingIdFromBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const id =
    typeof b.matchingId === 'string'
      ? b.matchingId.trim()
      : typeof b.matching_id === 'string'
        ? b.matching_id.trim()
        : '';
  return MATCHING_UUID_RE.test(id) ? id : null;
}

/** @param {unknown} body */
function partnerPhoneFromBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const raw =
    typeof b.partnerPhone === 'string'
      ? b.partnerPhone
      : typeof b.partner_phone === 'string'
        ? b.partner_phone
        : '';
  return normalizeMsisdn01(raw);
}

const {
  PARTNER_DECLINED_TEXT,
  PARTNER_CONFIRMED_TEXT,
  MATCH_DAY_EVE_REMINDER_TEXT,
} = require('../lib/friendTalkTemplates');

const WAITLIST_REGISTERED_TEXT = `대기열 등록이 완료되었습니다 ✅

최종 매칭 결과(장소 및 시간)는 매주 월요일 오후 6시에 이 채팅방을 통해 전달해 드릴 예정입니다. 두근거리는 마음으로 조금만 기다려 주세요! 😊`;

const MATCH_COMPLETE_TEMPLATE = `[캠퍼스 드랍] 매칭 완료 및 일정 안내 🎉

안녕하세요! 캠퍼스 드랍입니다.
기다리시던 매칭이 드디어 완료되었습니다!

성공적인 첫 만남을 위해 아래 일정을 먼저 안내해 드립니다.

📍 일시: #{미팅일시}
📍 장소: #{미팅장소}

구체적인 만남 방식은 추후 다시 공지해 드릴 예정입니다.
원활한 행사 진행을 위해, 우선 해당 일정에 참석이 가능하신지 확인을 부탁드립니다.

📢 참석 가능 여부를 알려 주세요!`;

const NO_MATCH_THIS_WEEK_TEXT = `Campus Drop을 이용해 주셔서 감사합니다 💌

▶ 매칭 결과 안내
아쉽게도 이번 주에는 꼭 맞는 인연을 찾지 못했어요 😢

▶ 매칭 TIP
🕛만남이 가능한 시간대를 더 많이 선택해 주시면 매칭 성공률이 올라가요.

▶ 다음 주 매칭 안내
Campus Drop은 더 잘 맞는 인연을 연결해 드리기 위해 매주 새로운 매칭을 진행하고 있어요.
아쉬움은 미뤄두고, 다음 주 매칭에 참여해 보세요 🔥`;

const MEETING_FIELD_MAX_LEN = 500;

/** @param {unknown} body */
function recipientMsisdnFromBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const raw =
    typeof b.to === 'string'
      ? b.to
      : typeof b.phone === 'string'
        ? b.phone
        : '';
  const digits = raw.replace(/\D/g, '');
  if (!/^01\d{9}$/.test(digits)) {
    return null;
  }
  return digits;
}

/** @param {unknown} body */
function meetingTimePlaceFromBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const mt =
    typeof b.meetingTime === 'string'
      ? b.meetingTime
      : typeof b.meeting_time === 'string'
        ? b.meeting_time
        : '';
  const mp =
    typeof b.meetingPlace === 'string'
      ? b.meetingPlace
      : typeof b.meeting_place === 'string'
        ? b.meeting_place
        : '';
  const meetingTime = mt.trim().slice(0, MEETING_FIELD_MAX_LEN);
  const meetingPlace = mp.trim().slice(0, MEETING_FIELD_MAX_LEN);
  if (!meetingTime || !meetingPlace) {
    return {
      ok: false,
      error:
        'meetingTime·meetingPlace(또는 meeting_time·meeting_place)에 일시·장소 문자열을 넣어 주세요.',
    };
  }
  return { ok: true, meetingTime, meetingPlace };
}

/** @param {string} meetingTime @param {string} meetingPlace */
function buildMatchCompleteText(meetingTime, meetingPlace) {
  return MATCH_COMPLETE_TEMPLATE.replace('#{미팅일시}', meetingTime).replace('#{미팅장소}', meetingPlace);
}

function solapiRouteError(res, err) {
  if (err && err.code === 'SOLAPI_CONFIG') {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
  const name = err && err.name ? String(err.name) : 'Error';
  const messageText = err && err.message ? String(err.message) : String(err);
  return res.status(502).json({ ok: false, error: { name, message: messageText } });
}

/**
 * 대기열 등록 완료 안내 — Solapi 카카오 친구톡(CTA).
 * 헤더: x-user-uuid (로그인 세션)
 * JSON: { "to": "01012345678" } 또는 { "phone": "010-1234-5678" }
 */
router.post('/waitlist-registered', async (req, res) => {
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    return res.status(500).json({ ok: false, error: missingEnv });
  }

  const to = recipientMsisdnFromBody(req.body);
  if (!to) {
    return res.status(400).json({
      ok: false,
      error: 'to 또는 phone에 휴대폰 번호(010…) 11자리를 넣어 주세요.',
    });
  }

  try {
    const result = await sendFriendTalkCta({ to, text: WAITLIST_REGISTERED_TEXT });
    return res.json({ ok: true, result });
  } catch (err) {
    return solapiRouteError(res, err);
  }
});

/**
 * 이번 주 매칭 없음 안내 — Solapi 카카오 친구톡(CTA).
 * 헤더: x-user-uuid
 * JSON: { "to": "01012345678" } 또는 { "phone": "010-1234-5678" }
 */
router.post('/no-match-this-week', async (req, res) => {
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    return res.status(500).json({ ok: false, error: missingEnv });
  }

  const to = recipientMsisdnFromBody(req.body);
  if (!to) {
    return res.status(400).json({
      ok: false,
      error: 'to 또는 phone에 휴대폰 번호(010…) 11자리를 넣어 주세요.',
    });
  }

  try {
    const kakaoImageId = await getKakaoFriendTalkImageIdFromEnv(FRIEND_TALK_IMG_MATCH_FAIL);
    const result = await sendFriendTalkCta({
      to,
      text: NO_MATCH_THIS_WEEK_TEXT,
      kakaoImageId: kakaoImageId || undefined,
    });
    return res.json({ ok: true, result });
  } catch (err) {
    return solapiRouteError(res, err);
  }
});

/**
 * 상대가 만남 불가(반대) 통보 — Solapi 카카오 친구톡(CTA).
 * 헤더: x-user-uuid
 * JSON: { "to": "01012345678" } 또는 { "phone": "010-1234-5678" }
 */
router.post('/partner-declined', async (req, res) => {
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    return res.status(500).json({ ok: false, error: missingEnv });
  }

  const to = recipientMsisdnFromBody(req.body);
  if (!to) {
    return res.status(400).json({
      ok: false,
      error: 'to 또는 phone에 휴대폰 번호(010…) 11자리를 넣어 주세요.',
    });
  }

  try {
    const kakaoImageId = await getKakaoFriendTalkImageIdFromEnv(FRIEND_TALK_IMG_MATCH_FAIL);
    const result = await sendFriendTalkCta({
      to,
      text: PARTNER_DECLINED_TEXT,
      kakaoImageId: kakaoImageId || undefined,
    });
    return res.json({ ok: true, result });
  } catch (err) {
    return solapiRouteError(res, err);
  }
});

/**
 * 상대가 매칭(만남) 참여 가능 응답 — Solapi 카카오 친구톡(CTA).
 * 헤더: x-user-uuid
 * JSON: { "to": "01012345678" } 또는 { "phone": "010-1234-5678" }
 */
router.post('/partner-confirmed', async (req, res) => {
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    return res.status(500).json({ ok: false, error: missingEnv });
  }

  const to = recipientMsisdnFromBody(req.body);
  if (!to) {
    return res.status(400).json({
      ok: false,
      error: 'to 또는 phone에 휴대폰 번호(010…) 11자리를 넣어 주세요.',
    });
  }

  try {
    const kakaoImageId = await getKakaoFriendTalkImageIdFromEnv(FRIEND_TALK_IMG_MATCH_SUCCESS);
    const result = await sendFriendTalkCta({
      to,
      text: PARTNER_CONFIRMED_TEXT,
      kakaoImageId: kakaoImageId || undefined,
    });
    return res.json({ ok: true, result });
  } catch (err) {
    return solapiRouteError(res, err);
  }
});

/**
 * 매칭일 전날(노쇼 방지·참여 확인) 안내 — Solapi 카카오 친구톡(CTA).
 * 헤더: x-user-uuid
 *
 * • `matchingId` 있음: RSVP에 저장된 양쪽 번호로 6번+버튼 동시 발송(7번 양쪽 수락·스킵 아님만).
 * • 없음(레거시): `to` / `phone` 한 명만, 버튼 없음.
 */
router.post('/match-day-eve-reminder', async (req, res) => {
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    return res.status(500).json({ ok: false, error: missingEnv });
  }

  const mid = matchingIdFromBody(req.body);

  if (mid) {
    const m = await prisma.matching.findUnique({
      where: { id: mid },
      select: { id: true, userAId: true, userBId: true },
    });
    if (!m) {
      return res.status(404).json({ ok: false, error: '매칭을 찾을 수 없습니다.' });
    }
    if (m.userAId !== req.user.id && m.userBId !== req.user.id) {
      return res.status(403).json({ ok: false, error: '이 매칭의 참가자가 아닙니다.' });
    }

    const sent = await sendDayEveReminderForMatching(mid);
    if (!sent.ok) {
      const e = sent.error || '';
      if (e.includes('이미 전날')) {
        return res.status(409).json({ ok: false, error: e });
      }
      if (e.includes('조건') || e.includes('참여') || e.includes('RSVP')) {
        return res.status(400).json({ ok: false, error: e });
      }
      if (e.includes('찾을 수') || e.includes('기록이 없')) {
        return res.status(404).json({ ok: false, error: e });
      }
      if (
        e.includes('PUBLIC_API_URL') ||
        e.includes('FRIEND_TALK_RSVP_SECRET') ||
        e.includes('Missing env')
      ) {
        return res.status(500).json({ ok: false, error: e });
      }
      return res.status(502).json({ ok: false, error: e });
    }
    return res.json({ ok: true, result: sent.result });
  }

  const to = recipientMsisdnFromBody(req.body);
  if (!to) {
    return res.status(400).json({
      ok: false,
      error: 'to 또는 phone에 휴대폰 번호(010…) 11자리를 넣어 주세요. (또는 matchingId로 양쪽 발송)',
    });
  }

  try {
    const kakaoImageId = await getKakaoFriendTalkImageIdFromEnv(FRIEND_TALK_IMG_DAY_EVE);
    const result = await sendFriendTalkCta({
      to,
      text: MATCH_DAY_EVE_REMINDER_TEXT,
      kakaoImageId: kakaoImageId || undefined,
    });
    return res.json({ ok: true, result });
  } catch (err) {
    return solapiRouteError(res, err);
  }
});

/**
 * 매칭 완료 및 일정 안내 — Solapi 카카오 친구톡(CTA).
 * 헤더: x-user-uuid
 *
 * • `matchingId` + `partnerPhone` + 본인 `to`: 양쪽 번호에 같은 본문+7번 RSVP 버튼. DB에 RSVP 행 upsert.
 * • 없음(레거시): `to` 한 명만, 버튼 없음.
 */
router.post('/match-complete', async (req, res) => {
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    return res.status(500).json({ ok: false, error: missingEnv });
  }

  const mid = matchingIdFromBody(req.body);
  const base = publicApiBase();
  const secretOk = rsvpSecret().length >= 16;

  const placeRes = meetingTimePlaceFromBody(req.body);
  if (!placeRes.ok) {
    return res.status(400).json({ ok: false, error: placeRes.error });
  }
  const text = buildMatchCompleteText(placeRes.meetingTime, placeRes.meetingPlace);

  if (mid) {
    if (!base) {
      return res.status(500).json({
        ok: false,
        error: '버튼 링크용 PUBLIC_API_URL 설정이 필요합니다.',
      });
    }
    if (!secretOk) {
      return res.status(500).json({
        ok: false,
        error: 'FRIEND_TALK_RSVP_SECRET(16자 이상) 설정이 필요합니다.',
      });
    }

    const partner = partnerPhoneFromBody(req.body);
    if (!partner) {
      return res.status(400).json({
        ok: false,
        error: 'matchingId 사용 시 partnerPhone(또는 partner_phone)에 상대 휴대폰 11자리가 필요합니다.',
      });
    }
    const to = recipientMsisdnFromBody(req.body);
    if (!to) {
      return res.status(400).json({
        ok: false,
        error: 'to 또는 phone에 본인 휴대폰(010…) 11자리가 필요합니다.',
      });
    }

    const m = await prisma.matching.findUnique({
      where: { id: mid },
      select: { id: true, userAId: true, userBId: true },
    });
    if (!m) {
      return res.status(404).json({ ok: false, error: '매칭을 찾을 수 없습니다.' });
    }
    if (m.userAId !== req.user.id && m.userBId !== req.user.id) {
      return res.status(403).json({ ok: false, error: '이 매칭의 참가자가 아닙니다.' });
    }
    if (to === partner) {
      return res.status(400).json({ ok: false, error: '본인 번호와 상대 번호가 같을 수 없습니다.' });
    }

    const phoneUserA = m.userAId === req.user.id ? to : partner;
    const phoneUserB = m.userBId === req.user.id ? to : partner;

    await prisma.matchingFriendTalkRsvp.upsert({
      where: { matchingId: mid },
      create: {
        matchingId: mid,
        phoneUserA,
        phoneUserB,
        mondayRsvpUserA: null,
        mondayRsvpUserB: null,
        dayEveRsvpUserA: null,
        dayEveRsvpUserB: null,
        skipDayEveReminder: false,
        mondayOutcomeSent: false,
        dayEveOutcomeSent: false,
        dayEveReminderSentAt: null,
      },
      update: {
        phoneUserA,
        phoneUserB,
        mondayRsvpUserA: null,
        mondayRsvpUserB: null,
        dayEveRsvpUserA: null,
        dayEveRsvpUserB: null,
        skipDayEveReminder: false,
        mondayOutcomeSent: false,
        dayEveOutcomeSent: false,
        dayEveReminderSentAt: null,
      },
    });

    const btnA = buildRsvpButtons(mid, m.userAId, 'monday', base);
    const btnB = buildRsvpButtons(mid, m.userBId, 'monday', base);
    if (!btnA || !btnB) {
      return res.status(500).json({ ok: false, error: 'RSVP 토큰 생성에 실패했습니다.' });
    }

    try {
      const rA = await sendFriendTalkCta({ to: phoneUserA, text, buttons: btnA });
      const rB = await sendFriendTalkCta({ to: phoneUserB, text, buttons: btnB });
      return res.json({ ok: true, result: { userA: rA, userB: rB } });
    } catch (err) {
      return solapiRouteError(res, err);
    }
  }

  const to = recipientMsisdnFromBody(req.body);
  if (!to) {
    return res.status(400).json({
      ok: false,
      error: 'to 또는 phone에 휴대폰 번호(010…) 11자리를 넣어 주세요.',
    });
  }

  try {
    const result = await sendFriendTalkCta({ to, text });
    return res.json({ ok: true, result });
  } catch (err) {
    return solapiRouteError(res, err);
  }
});

module.exports = router;
