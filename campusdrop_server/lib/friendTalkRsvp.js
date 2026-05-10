const crypto = require('crypto');
const { prisma } = require('./prisma');
const {
  sendFriendTalkCta,
  assertSolapiFriendTalkEnv,
  getKakaoFriendTalkImageIdFromEnv,
  FRIEND_TALK_IMG_DAY_EVE,
  FRIEND_TALK_IMG_MATCH_FAIL,
  FRIEND_TALK_IMG_MATCH_SUCCESS,
} = require('./solapiFriendTalkSend');
const templates = require('./friendTalkTemplates');
const { resolveMatchMeetingDisplay } = require('./meetingDisplay');

const RSVP_YES = 'YES';
const RSVP_NO = 'NO';

const ACQUISITION_SLUGS = ['everytime', 'instagram', 'friend', 'poster'];
const FEEDBACK_SLUGS = ['similar', 'different', 'neutral'];

function rsvpSecret() {
  return String(process.env.FRIEND_TALK_RSVP_SECRET || '').trim();
}

function publicApiBase() {
  return String(process.env.PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
}

function normalizeMsisdn01(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!/^01\d{9}$/.test(digits)) {
    return null;
  }
  return digits;
}

function signPayload(payloadString) {
  const secret = rsvpSecret();
  if (!secret || secret.length < 16) {
    return null;
  }
  return crypto.createHmac('sha256', secret).update(payloadString).digest('base64url');
}

/**
 * @param {{ matchingId?: string | null, identityId: string, phase: string, choice: string }} p
 */
function makeFriendTalkToken({ matchingId = null, identityId, phase, choice }) {
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const payloadObj = {
    matchingId: matchingId || null,
    identityId,
    phase,
    choice: String(choice),
    exp,
  };
  const payload = JSON.stringify(payloadObj);
  const sig = signPayload(payload);
  if (!sig) {
    return null;
  }
  return Buffer.from(JSON.stringify({ payload, sig }), 'utf8').toString('base64url');
}

/**
 * @param {{ matchingId: string, identityId: string, phase: string, choice: string }} p
 */
function makeRsvpToken({ matchingId, identityId, phase, choice }) {
  const c =
    choice === 'yes' || choice === 'YES'
      ? 'yes'
      : choice === 'no' || choice === 'NO'
        ? 'no'
        : String(choice);
  return makeFriendTalkToken({ matchingId, identityId, phase, choice: c });
}

function parseRsvpToken(token) {
  const secret = rsvpSecret();
  if (!secret || secret.length < 16) {
    return { ok: false, error: 'FRIEND_TALK_RSVP_SECRET(16자 이상)이 설정되지 않았습니다.' };
  }
  let json;
  try {
    json = JSON.parse(Buffer.from(String(token || ''), 'base64url').toString('utf8'));
  } catch (_) {
    return { ok: false, error: '유효하지 않은 링크입니다.' };
  }
  const { payload, sig } = json;
  if (typeof payload !== 'string' || typeof sig !== 'string') {
    return { ok: false, error: '유효하지 않은 링크입니다.' };
  }
  const expect = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expect);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, error: '유효하지 않은 링크입니다.' };
  }
  let data;
  try {
    data = JSON.parse(payload);
  } catch (_) {
    return { ok: false, error: '유효하지 않은 링크입니다.' };
  }
  const { matchingId, identityId, phase, choice, exp } = data;
  if (!identityId || !phase || choice === undefined || choice === null || choice === '' || !exp) {
    return { ok: false, error: '유효하지 않은 링크입니다.' };
  }
  if (Math.floor(Date.now() / 1000) > Number(exp)) {
    return { ok: false, error: '링크가 만료되었습니다.' };
  }
  if (phase !== 'monday' && phase !== 'acquisition' && phase !== 'feedback') {
    return { ok: false, error: '유효하지 않은 링크입니다.' };
  }
  const choiceStr = String(choice);
  if (phase === 'monday') {
    if (choiceStr !== 'yes' && choiceStr !== 'no') {
      return { ok: false, error: '유효하지 않은 링크입니다.' };
    }
    if (!matchingId) {
      return { ok: false, error: '유효하지 않은 링크입니다.' };
    }
  } else if (phase === 'acquisition') {
    if (!ACQUISITION_SLUGS.includes(choiceStr)) {
      return { ok: false, error: '유효하지 않은 링크입니다.' };
    }
  } else if (phase === 'feedback') {
    if (!FEEDBACK_SLUGS.includes(choiceStr)) {
      return { ok: false, error: '유효하지 않은 링크입니다.' };
    }
    if (!matchingId) {
      return { ok: false, error: '유효하지 않은 링크입니다.' };
    }
  }
  return { ok: true, data: { matchingId: matchingId || null, identityId, phase, choice: choiceStr } };
}

/**
 * @param {string} matchingId
 * @param {string} identityId
 * @param {'monday'} phase
 * @param {string} baseUrl
 */
function buildRsvpButtons(matchingId, identityId, phase, baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const yes = makeRsvpToken({ matchingId, identityId, phase, choice: 'yes' });
  const no = makeRsvpToken({ matchingId, identityId, phase, choice: 'no' });
  if (!yes || !no) {
    return null;
  }
  return [
    {
      buttonName: '참여 가능해요 !',
      buttonType: 'WL',
      linkMo: `${base}/api/friend-talk/rsvp?t=${encodeURIComponent(yes)}`,
      linkPc: `${base}/api/friend-talk/rsvp?t=${encodeURIComponent(yes)}`,
    },
    {
      buttonName: '시간이 안돼요 ㅠㅠ',
      buttonType: 'WL',
      linkMo: `${base}/api/friend-talk/rsvp?t=${encodeURIComponent(no)}`,
      linkPc: `${base}/api/friend-talk/rsvp?t=${encodeURIComponent(no)}`,
    },
  ];
}

const ACQUISITION_BUTTONS = [
  { slug: 'everytime', label: '에브리타임에서 봤어요 🏫' },
  { slug: 'instagram', label: '인스타그램/SNS에서 봤어요 📱' },
  { slug: 'friend', label: '친구나 지인이 추천해 줬어요 🗣️' },
  { slug: 'poster', label: '포스터나 전단지를 봤어요 🪧' },
];

/**
 * @param {string} identityId
 * @param {string} baseUrl
 */
function buildAcquisitionButtons(identityId, baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const out = [];
  for (const { slug, label } of ACQUISITION_BUTTONS) {
    const t = makeFriendTalkToken({ identityId, phase: 'acquisition', choice: slug });
    if (!t) {
      return null;
    }
    out.push({
      buttonName: label,
      buttonType: 'WL',
      linkMo: `${base}/api/friend-talk/rsvp?t=${encodeURIComponent(t)}`,
      linkPc: `${base}/api/friend-talk/rsvp?t=${encodeURIComponent(t)}`,
    });
  }
  return out;
}

const FEEDBACK_BUTTONS = [
  { slug: 'similar', label: '다음에도 비슷한 분과! 👍' },
  { slug: 'different', label: '다른 성향의 분과! 🔄' },
  { slug: 'neutral', label: '무난한 만남이었어요 🙂' },
];

/**
 * @param {string} matchingId
 * @param {string} identityId
 * @param {string} baseUrl
 */
function buildFeedbackButtons(matchingId, identityId, baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const out = [];
  for (const { slug, label } of FEEDBACK_BUTTONS) {
    const t = makeFriendTalkToken({ matchingId, identityId, phase: 'feedback', choice: slug });
    if (!t) {
      return null;
    }
    out.push({
      buttonName: label,
      buttonType: 'WL',
      linkMo: `${base}/api/friend-talk/rsvp?t=${encodeURIComponent(t)}`,
      linkPc: `${base}/api/friend-talk/rsvp?t=${encodeURIComponent(t)}`,
    });
  }
  return out;
}

async function sendMondayOutcomeMessages(rsvp) {
  const a = rsvp.mondayRsvpUserA;
  const b = rsvp.mondayRsvpUserB;
  const imgSuccess = await getKakaoFriendTalkImageIdFromEnv(FRIEND_TALK_IMG_MATCH_SUCCESS);
  const imgFail = await getKakaoFriendTalkImageIdFromEnv(FRIEND_TALK_IMG_MATCH_FAIL);
  const imgOk = imgSuccess || undefined;
  const imgBad = imgFail || undefined;

  if (a === RSVP_YES && b === RSVP_YES) {
    const text = templates.MATCH_MONDAY_BOTH_CONFIRMED_TEXT;
    await sendFriendTalkCta({ to: rsvp.phoneUserA, text, kakaoImageId: imgOk });
    await sendFriendTalkCta({ to: rsvp.phoneUserB, text, kakaoImageId: imgOk });
    return;
  }

  const longCancel = templates.MATCH_MONDAY_ACCEPTOR_PARTNER_DECLINED_TEXT;
  const declineAck = templates.MATCH_MONDAY_SELF_DECLINE_ACK_TEXT;

  if (a === RSVP_YES && b === RSVP_NO) {
    await sendFriendTalkCta({ to: rsvp.phoneUserA, text: longCancel, kakaoImageId: imgBad });
    await sendFriendTalkCta({ to: rsvp.phoneUserB, text: declineAck, kakaoImageId: imgBad });
    return;
  }
  if (a === RSVP_NO && b === RSVP_YES) {
    await sendFriendTalkCta({ to: rsvp.phoneUserA, text: declineAck, kakaoImageId: imgBad });
    await sendFriendTalkCta({ to: rsvp.phoneUserB, text: longCancel, kakaoImageId: imgBad });
    return;
  }
  await sendFriendTalkCta({ to: rsvp.phoneUserA, text: declineAck, kakaoImageId: imgBad });
  await sendFriendTalkCta({ to: rsvp.phoneUserB, text: declineAck, kakaoImageId: imgBad });
}

async function resolveAfterMondayUpdate(matchingId) {
  const rsvp = await prisma.matchingFriendTalkRsvp.findUnique({ where: { matchingId } });
  if (!rsvp || rsvp.mondayOutcomeSent) {
    return;
  }
  const { mondayRsvpUserA: a, mondayRsvpUserB: b } = rsvp;
  if (a == null || b == null) {
    return;
  }
  const anyNo = a === RSVP_NO || b === RSVP_NO;
  await prisma.matchingFriendTalkRsvp.update({
    where: { matchingId },
    data: { skipDayEveReminder: anyNo },
  });
  const fresh = await prisma.matchingFriendTalkRsvp.findUnique({ where: { matchingId } });
  if (!fresh) {
    return;
  }
  await sendMondayOutcomeMessages(fresh);
  await prisma.matchingFriendTalkRsvp.update({
    where: { matchingId },
    data: { mondayOutcomeSent: true },
  });
}

function canSendDayEveReminder(rsvp) {
  if (!rsvp) {
    return false;
  }
  return (
    rsvp.mondayRsvpUserA === RSVP_YES &&
    rsvp.mondayRsvpUserB === RSVP_YES &&
    !rsvp.skipDayEveReminder
  );
}

async function handleAcquisitionClick(identityId, choiceSlug) {
  if (!ACQUISITION_SLUGS.includes(choiceSlug)) {
    return { ok: false, error: '유효하지 않은 응답입니다.' };
  }
  const row = await prisma.identity.findUnique({
    where: { id: identityId },
    select: { id: true, acquisitionSource: true },
  });
  if (!row) {
    return { ok: false, error: '계정을 찾을 수 없습니다.' };
  }
  if (row.acquisitionSource) {
    return { ok: true };
  }
  await prisma.identity.update({
    where: { id: identityId },
    data: { acquisitionSource: choiceSlug },
  });
  return { ok: true };
}

async function handleFeedbackClick(matchingId, identityId, choiceSlug) {
  if (!FEEDBACK_SLUGS.includes(choiceSlug)) {
    return { ok: false, error: '유효하지 않은 응답입니다.' };
  }
  const match = await prisma.matching.findUnique({
    where: { id: matchingId },
    select: { id: true, userAId: true, userBId: true },
  });
  if (!match) {
    return { ok: false, error: '매칭을 찾을 수 없습니다.' };
  }
  if (match.userAId !== identityId && match.userBId !== identityId) {
    return { ok: false, error: '참가자 정보가 올바르지 않습니다.' };
  }
  await prisma.matchingMeetingFeedback.upsert({
    where: {
      matchingId_identityId: { matchingId, identityId },
    },
    create: { matchingId, identityId, choice: choiceSlug },
    update: { choice: choiceSlug },
  });
  return { ok: true };
}

/**
 * @param {{ matchingId: string | null, identityId: string, phase: string, choice: string }} p
 */
async function handleRsvpClick({ matchingId, identityId, phase, choice }) {
  if (phase === 'acquisition') {
    return handleAcquisitionClick(identityId, choice);
  }
  if (phase === 'feedback') {
    if (!matchingId) {
      return { ok: false, error: '유효하지 않은 링크입니다.' };
    }
    return handleFeedbackClick(matchingId, identityId, choice);
  }

  if (!matchingId) {
    return { ok: false, error: '유효하지 않은 링크입니다.' };
  }

  const match = await prisma.matching.findUnique({
    where: { id: matchingId },
    select: { id: true, userAId: true, userBId: true },
  });
  if (!match) {
    return { ok: false, error: '매칭을 찾을 수 없습니다.' };
  }
  if (match.userAId !== identityId && match.userBId !== identityId) {
    return { ok: false, error: '참가자 정보가 올바르지 않습니다.' };
  }

  const rsvp = await prisma.matchingFriendTalkRsvp.findUnique({ where: { matchingId } });
  if (!rsvp) {
    return { ok: false, error: '응답 기록이 없습니다.' };
  }

  const value = choice === 'yes' ? RSVP_YES : RSVP_NO;
  const isA = identityId === match.userAId;

  if (phase === 'monday') {
    const data = isA ? { mondayRsvpUserA: value } : { mondayRsvpUserB: value };
    await prisma.matchingFriendTalkRsvp.update({
      where: { matchingId },
      data,
    });
    await resolveAfterMondayUpdate(matchingId);
    return { ok: true };
  }

  return { ok: false, error: '유효하지 않은 링크입니다.' };
}

/**
 * 6번(전날) 친구톡 — 버튼 없음. 수동 API·크론 공통.
 * @param {string} matchingId
 * @returns {Promise<{ ok: true, result: { userA: unknown, userB: unknown } } | { ok: false, error: string }>}
 */
async function sendDayEveReminderForMatching(matchingId) {
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    return { ok: false, error: missingEnv };
  }

  const m = await prisma.matching.findUnique({
    where: { id: matchingId },
    select: { id: true, userAId: true, userBId: true },
  });
  if (!m) {
    return { ok: false, error: '매칭을 찾을 수 없습니다.' };
  }

  const rsvp = await prisma.matchingFriendTalkRsvp.findUnique({ where: { matchingId } });
  if (!rsvp) {
    return { ok: false, error: '친구톡 RSVP 기록이 없습니다.' };
  }
  if (!canSendDayEveReminder(rsvp)) {
    return {
      ok: false,
      error:
        '6번 발송 조건이 아닙니다. (7번에서 양쪽 모두 참여 가능이고, 취소 처리되지 않은 경우만 가능)',
    };
  }
  if (rsvp.dayEveReminderSentAt != null) {
    return { ok: false, error: '이미 전날 안내가 발송된 매칭입니다.' };
  }

  const meeting = await resolveMatchMeetingDisplay(matchingId);
  const text = templates.buildMatchDayEveReminderText({
    meetingTime: meeting.meetingTime,
    meetingPlace: meeting.meetingPlace,
  });

  try {
    const kakaoImageId = await getKakaoFriendTalkImageIdFromEnv(FRIEND_TALK_IMG_DAY_EVE);
    const rA = await sendFriendTalkCta({
      to: rsvp.phoneUserA,
      text,
      kakaoImageId: kakaoImageId || undefined,
    });
    const rB = await sendFriendTalkCta({
      to: rsvp.phoneUserB,
      text,
      kakaoImageId: kakaoImageId || undefined,
    });
    await prisma.matchingFriendTalkRsvp.update({
      where: { matchingId },
      data: { dayEveReminderSentAt: new Date() },
    });
    return { ok: true, result: { userA: rA, userB: rB } };
  } catch (err) {
    return {
      ok: false,
      error:
        err && err.message
          ? String(err.message)
          : 'Solapi 발송 중 오류가 발생했습니다.',
    };
  }
}

module.exports = {
  RSVP_YES,
  RSVP_NO,
  ACQUISITION_SLUGS,
  FEEDBACK_SLUGS,
  rsvpSecret,
  publicApiBase,
  normalizeMsisdn01,
  makeFriendTalkToken,
  makeRsvpToken,
  parseRsvpToken,
  buildRsvpButtons,
  buildAcquisitionButtons,
  buildFeedbackButtons,
  handleRsvpClick,
  canSendDayEveReminder,
  sendDayEveReminderForMatching,
};
