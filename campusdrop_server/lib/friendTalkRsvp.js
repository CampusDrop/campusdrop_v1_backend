const crypto = require('crypto');
const { prisma } = require('./prisma');
const { sendFriendTalkCta, assertSolapiFriendTalkEnv, getKakaoFriendTalkImageIdFromEnv, FRIEND_TALK_IMG_DAY_EVE, FRIEND_TALK_IMG_MATCH_FAIL, FRIEND_TALK_IMG_MATCH_SUCCESS } = require('./solapiFriendTalkSend');
const templates = require('./friendTalkTemplates');

const RSVP_YES = 'YES';
const RSVP_NO = 'NO';

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
  const sig = crypto.createHmac('sha256', secret).update(payloadString).digest('base64url');
  return sig;
}

/**
 * @param {{ matchingId: string, identityId: string, phase: string, choice: string }} p
 */
function makeRsvpToken({ matchingId, identityId, phase, choice }) {
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const choiceNorm = choice === 'yes' || choice === 'YES' ? 'yes' : 'no';
  const payloadObj = { matchingId, identityId, phase, choice: choiceNorm, exp };
  const payload = JSON.stringify(payloadObj);
  const sig = signPayload(payload);
  if (!sig) {
    return null;
  }
  return Buffer.from(JSON.stringify({ payload, sig }), 'utf8').toString('base64url');
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
  if (!matchingId || !identityId || !phase || !choice || !exp) {
    return { ok: false, error: '유효하지 않은 링크입니다.' };
  }
  if (Math.floor(Date.now() / 1000) > Number(exp)) {
    return { ok: false, error: '링크가 만료되었습니다.' };
  }
  if (phase !== 'monday' && phase !== 'eve') {
    return { ok: false, error: '유효하지 않은 링크입니다.' };
  }
  if (choice !== 'yes' && choice !== 'no') {
    return { ok: false, error: '유효하지 않은 링크입니다.' };
  }
  return { ok: true, data: { matchingId, identityId, phase, choice } };
}

/**
 * @param {string} matchingId
 * @param {string} identityId
 * @param {'monday'|'eve'} phase
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

async function sendMondayOutcomeToBoth(rsvp) {
  const bothYes = rsvp.mondayRsvpUserA === RSVP_YES && rsvp.mondayRsvpUserB === RSVP_YES;
  const text = bothYes
    ? templates.MATCH_MONDAY_CONFIRMED_TEXT
    : templates.MATCH_MONDAY_CANCELLED_TEXT;
  const imgKey = bothYes ? FRIEND_TALK_IMG_MATCH_SUCCESS : FRIEND_TALK_IMG_MATCH_FAIL;
  const kakaoImageId = await getKakaoFriendTalkImageIdFromEnv(imgKey);
  await sendFriendTalkCta({ to: rsvp.phoneUserA, text, kakaoImageId: kakaoImageId || undefined });
  await sendFriendTalkCta({ to: rsvp.phoneUserB, text, kakaoImageId: kakaoImageId || undefined });
}

async function sendEveOutcomeToBoth(rsvp) {
  const bothYes = rsvp.dayEveRsvpUserA === RSVP_YES && rsvp.dayEveRsvpUserB === RSVP_YES;
  const text = bothYes ? templates.PARTNER_CONFIRMED_TEXT : templates.PARTNER_DECLINED_TEXT;
  const imgKey = bothYes ? FRIEND_TALK_IMG_MATCH_SUCCESS : FRIEND_TALK_IMG_MATCH_FAIL;
  const kakaoImageId = await getKakaoFriendTalkImageIdFromEnv(imgKey);
  await sendFriendTalkCta({ to: rsvp.phoneUserA, text, kakaoImageId: kakaoImageId || undefined });
  await sendFriendTalkCta({ to: rsvp.phoneUserB, text, kakaoImageId: kakaoImageId || undefined });
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
  await sendMondayOutcomeToBoth(fresh);
  await prisma.matchingFriendTalkRsvp.update({
    where: { matchingId },
    data: { mondayOutcomeSent: true },
  });
}

async function resolveAfterEveUpdate(matchingId) {
  const rsvp = await prisma.matchingFriendTalkRsvp.findUnique({ where: { matchingId } });
  if (!rsvp || rsvp.dayEveOutcomeSent) {
    return;
  }
  const { dayEveRsvpUserA: a, dayEveRsvpUserB: b } = rsvp;
  if (a == null || b == null) {
    return;
  }
  await sendEveOutcomeToBoth(rsvp);
  await prisma.matchingFriendTalkRsvp.update({
    where: { matchingId },
    data: { dayEveOutcomeSent: true },
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

/**
 * @param {{ matchingId: string, identityId: string, phase: 'monday'|'eve', choice: 'yes'|'no' }} p
 */
async function handleRsvpClick({ matchingId, identityId, phase, choice }) {
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

  if (rsvp.skipDayEveReminder) {
    return { ok: false, error: '전날 안내 응답을 받을 수 없는 매칭입니다.' };
  }
  if (rsvp.mondayRsvpUserA !== RSVP_YES || rsvp.mondayRsvpUserB !== RSVP_YES) {
    return { ok: false, error: '먼저 일정 안내(월요일)에서 양쪽 모두 참여 가능 응답이 필요합니다.' };
  }

  const data = isA ? { dayEveRsvpUserA: value } : { dayEveRsvpUserB: value };
  await prisma.matchingFriendTalkRsvp.update({
    where: { matchingId },
    data,
  });
  await resolveAfterEveUpdate(matchingId);
  return { ok: true };
}

/**
 * 6번(전날) 친구톡 + RSVP 버튼 양쪽 발송. 수동 API·크론 공통.
 * @param {string} matchingId
 * @returns {Promise<{ ok: true, result: { userA: unknown, userB: unknown } } | { ok: false, error: string }>}
 */
async function sendDayEveReminderForMatching(matchingId) {
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    return { ok: false, error: missingEnv };
  }
  const base = publicApiBase();
  if (!base) {
    return { ok: false, error: '버튼 링크용 PUBLIC_API_URL 설정이 필요합니다.' };
  }
  if (rsvpSecret().length < 16) {
    return { ok: false, error: 'FRIEND_TALK_RSVP_SECRET(16자 이상) 설정이 필요합니다.' };
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

  const btnA = buildRsvpButtons(matchingId, m.userAId, 'eve', base);
  const btnB = buildRsvpButtons(matchingId, m.userBId, 'eve', base);
  if (!btnA || !btnB) {
    return { ok: false, error: 'RSVP 토큰 생성에 실패했습니다.' };
  }

  const text = templates.MATCH_DAY_EVE_REMINDER_TEXT;

  await prisma.matchingFriendTalkRsvp.update({
    where: { matchingId },
    data: {
      dayEveRsvpUserA: null,
      dayEveRsvpUserB: null,
      dayEveOutcomeSent: false,
    },
  });

  try {
    const kakaoImageId = await getKakaoFriendTalkImageIdFromEnv(FRIEND_TALK_IMG_DAY_EVE);
    const rA = await sendFriendTalkCta({
      to: rsvp.phoneUserA,
      text,
      buttons: btnA,
      kakaoImageId: kakaoImageId || undefined,
    });
    const rB = await sendFriendTalkCta({
      to: rsvp.phoneUserB,
      text,
      buttons: btnB,
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
  rsvpSecret,
  publicApiBase,
  normalizeMsisdn01,
  makeRsvpToken,
  parseRsvpToken,
  buildRsvpButtons,
  handleRsvpClick,
  canSendDayEveReminder,
  sendDayEveReminderForMatching,
};
