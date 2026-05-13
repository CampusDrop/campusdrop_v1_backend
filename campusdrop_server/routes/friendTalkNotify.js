const express = require('express');
const { assertSolapiFriendTalkEnv, sendFriendTalkCta, isWithinKakaoFriendTalkSendWindow } = require('../lib/solapiFriendTalkSend');
const { prisma } = require('../lib/prisma');
const {
  publicApiBase,
  normalizeMsisdn01,
  buildRsvpButtons,
  sendDayEveReminderForMatching,
} = require('../lib/friendTalkRsvp');
const { resolveMatchMeetingDisplay } = require('../lib/meetingDisplay');
const templates = require('../lib/friendTalkTemplates');

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
  return {
    meetingTime: mt.trim().slice(0, MEETING_FIELD_MAX_LEN),
    meetingPlace: mp.trim().slice(0, MEETING_FIELD_MAX_LEN),
  };
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
 * 매칭일 전날 안내 — `matchingId` 필수(양쪽 발송, 버튼 없음).
 */
router.post('/match-day-eve-reminder', async (req, res) => {
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    return res.status(500).json({ ok: false, error: missingEnv });
  }

  const mid = matchingIdFromBody(req.body);
  if (!mid) {
    return res.status(400).json({ ok: false, error: 'matchingId(또는 matching_id)가 필요합니다.' });
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
    if (e.includes('Missing env')) {
      return res.status(500).json({ ok: false, error: e });
    }
    return res.status(502).json({ ok: false, error: e });
  }
  if (sent.queued) {
    return res.json({
      ok: true,
      queued: true,
      message: '허용 시간대(KST 08:01~20:49) 밖이면 오전 8시 1분에 발송됩니다.',
    });
  }
  return res.json({ ok: true, result: sent.result });
});

/**
 * 매칭 완료 및 일정 안내(레거시·테스트). 운영은 관리자 API 사용 권장.
 */
router.post('/match-complete', async (req, res) => {
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    return res.status(500).json({ ok: false, error: missingEnv });
  }

  const mid = matchingIdFromBody(req.body);
  const base = publicApiBase();

  const bodyMeeting = meetingTimePlaceFromBody(req.body);

  if (mid) {
    if (!base) {
      return res.status(500).json({
        ok: false,
        error: '버튼 링크용 PUBLIC_API_URL 설정이 필요합니다.',
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

    const fromDb = await resolveMatchMeetingDisplay(mid);
    const meetingTime = bodyMeeting.meetingTime || fromDb.meetingTime || '';
    const meetingPlace = bodyMeeting.meetingPlace || fromDb.meetingPlace || '';
    if (!meetingTime || !meetingPlace) {
      return res.status(400).json({
        ok: false,
        error:
          '매칭 행에 meeting_starts_at / meeting_venue_name(또는 cafe)이 없고 본문에도 meetingTime·meetingPlace가 없습니다. 관리자 콘솔에서 매칭의 시간·카페를 먼저 설정해 주세요.',
      });
    }
    const text = templates.buildMatchCompleteText(meetingTime, meetingPlace);

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
        mondayOutcome: null,
        mondayOutcomeSentAt: null,
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
        mondayOutcome: null,
        mondayOutcomeSentAt: null,
        dayEveOutcomeSent: false,
        dayEveReminderSentAt: null,
      },
    });

    const btnA = await buildRsvpButtons(mid, m.userAId, 'monday', base);
    const btnB = await buildRsvpButtons(mid, m.userBId, 'monday', base);
    if (!btnA || !btnB) {
      return res.status(500).json({ ok: false, error: 'RSVP 토큰 생성에 실패했습니다.' });
    }

    try {
      if (isWithinKakaoFriendTalkSendWindow()) {
        const rA = await sendFriendTalkCta({ to: phoneUserA, text, buttons: btnA });
        const rB = await sendFriendTalkCta({ to: phoneUserB, text, buttons: btnB });
        return res.json({
          ok: true,
          result: { userA: rA, userB: rB },
          meetingTime,
          meetingPlace,
        });
      }
      void (async () => {
        try {
          await sendFriendTalkCta({ to: phoneUserA, text, buttons: btnA });
          await sendFriendTalkCta({ to: phoneUserB, text, buttons: btnB });
        } catch (err) {
          console.error('friend-talk match-complete deferred:', err);
        }
      })();
      return res.json({
        ok: true,
        queued: true,
        meetingTime,
        meetingPlace,
        message: '허용 시간대(KST 08:01~20:49) 밖이면 오전 8시 1분(KST) 이후에 순차 발송됩니다.',
      });
    } catch (err) {
      return solapiRouteError(res, err);
    }
  }

  if (!bodyMeeting.meetingTime || !bodyMeeting.meetingPlace) {
    return res.status(400).json({
      ok: false,
      error:
        'meetingTime·meetingPlace(또는 meeting_time·meeting_place)에 일시·장소 문자열을 넣어 주세요. (또는 matchingId로 DB 기반 자동 채움)',
    });
  }
  const text = templates.buildMatchCompleteText(bodyMeeting.meetingTime, bodyMeeting.meetingPlace);

  const to = recipientMsisdnFromBody(req.body);
  if (!to) {
    return res.status(400).json({
      ok: false,
      error: 'to 또는 phone에 휴대폰 번호(010…) 11자리를 넣어 주세요.',
    });
  }

  try {
    if (isWithinKakaoFriendTalkSendWindow()) {
      const result = await sendFriendTalkCta({ to, text });
      return res.json({ ok: true, result });
    }
    void sendFriendTalkCta({ to, text }).catch((err) =>
      console.error('friend-talk match-complete deferred:', err),
    );
    return res.json({
      ok: true,
      queued: true,
      message: '허용 시간대(KST 08:01~20:49) 밖이면 오전 8시 1분(KST) 이후에 발송됩니다.',
    });
  } catch (err) {
    return solapiRouteError(res, err);
  }
});

module.exports = router;
