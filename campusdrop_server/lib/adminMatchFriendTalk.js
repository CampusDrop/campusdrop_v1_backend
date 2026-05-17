const { prisma } = require('./prisma');
const { decryptPhoneFromStorage } = require('./phoneCrypto');
const { assertSolapiFriendTalkEnv, sendFriendTalkCta, getKakaoFriendTalkImageIdFromEnv, FRIEND_TALK_IMG_MATCH_FAIL } = require('./solapiFriendTalkSend');
const templates = require('./friendTalkTemplates');
const {
  publicApiBase,
  buildRsvpButtons,
} = require('./friendTalkRsvp');
const { resolveMatchMeetingDisplay } = require('./meetingDisplay');
const {
  meetingDateKeyKst,
  utcBoundsForKstDateKeys,
} = require('./kstMeetingDateKeys');
const { MATCH_TYPE_ROMANCE } = require('./matchType');
const {
  getMatchingPeriodStart,
  getMatchingPeriodEnd,
  getUserIdsMatchedInPeriod,
} = require('./matchPolicy');
const { loadEligibleTraits } = require('./weeklyBatchMatch');
const { attendanceDeadlineUtcForInviteDay } = require('./friendGroupAttendanceSchedule');

/**
 * @param {string} identityId
 * @returns {Promise<string | null>}
 */
async function decryptPhoneForIdentity(identityId) {
  const row = await prisma.identity.findUnique({
    where: { id: identityId },
    select: { phoneEncrypted: true, blockedAt: true },
  });
  if (!row || row.blockedAt || !row.phoneEncrypted) {
    return null;
  }
  try {
    return decryptPhoneFromStorage(row.phoneEncrypted);
  } catch (_) {
    return null;
  }
}

/**
 * @param {Date} periodStart
 * @returns {Promise<import('@prisma/client').Matching[]>}
 */
async function matchingsForPeriod(periodStart) {
  const pe = getMatchingPeriodEnd(periodStart);
  return prisma.matching.findMany({
    where: {
      OR: [
        { periodStart },
        {
          AND: [{ periodStart: null }, { matchedAt: { gte: periodStart, lt: pe } }],
        },
      ],
    },
    select: {
      id: true,
      userAId: true,
      userBId: true,
    },
  });
}

/**
 * 한 매칭에 대해 7번 친구톡 양쪽 발송 + RSVP 행 준비.
 * @param {string} matchingId
 * @returns {Promise<
 *   | { ok: true }
 *   | { ok: false, error: string, skipped?: true }
 * >}
 */
async function sendMatchSuccessFriendTalkForMatching(matchingId) {
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    return { ok: false, error: missingEnv };
  }
  const base = publicApiBase();
  if (!base) {
    return { ok: false, error: '버튼 링크용 PUBLIC_API_URL 설정이 필요합니다.' };
  }

  const m = await prisma.matching.findUnique({
    where: { id: matchingId },
    select: {
      id: true,
      userAId: true,
      userBId: true,
      friendTalkRsvp: { select: { matchingId: true } },
    },
  });
  if (!m) {
    return { ok: false, error: '매칭을 찾을 수 없습니다.' };
  }
  if (m.friendTalkRsvp) {
    return { ok: false, error: '이미 발송 이력이 있어 재발송을 건너뜁니다.', skipped: true };
  }

  const display = await resolveMatchMeetingDisplay(matchingId);
  const meetingTime = display.meetingTime || '';
  const meetingPlace = display.meetingPlace || '';
  if (!meetingTime || !meetingPlace) {
    return {
      ok: false,
      error: '매칭에 일시·장소(meeting_starts_at·카페/venue)가 없어 친구톡을 보낼 수 없습니다.',
    };
  }

  const phoneUserA = await decryptPhoneForIdentity(m.userAId);
  const phoneUserB = await decryptPhoneForIdentity(m.userBId);
  if (!phoneUserA || !phoneUserB) {
    return { ok: false, error: '한쪽 또는 양쪽 전화번호가 없거나 복호화에 실패했습니다.' };
  }

  const text = templates.buildMatchCompleteText(meetingTime, meetingPlace);
  const btnA = await buildRsvpButtons(matchingId, m.userAId, 'monday', base);
  const btnB = await buildRsvpButtons(matchingId, m.userBId, 'monday', base);
  if (!btnA || !btnB) {
    return { ok: false, error: 'RSVP 토큰 생성에 실패했습니다.' };
  }

  await prisma.matchingFriendTalkRsvp.upsert({
    where: { matchingId },
    create: {
      matchingId,
      phoneUserA,
      phoneUserB,
      mondayRsvpUserA: null,
      mondayRsvpUserB: null,
      mondayRsvpDueAt: attendanceDeadlineUtcForInviteDay(new Date()),
      mondayOutcomeScheduledSendAt: null,
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
      mondayRsvpDueAt: attendanceDeadlineUtcForInviteDay(new Date()),
      mondayOutcomeScheduledSendAt: null,
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

  try {
    await sendFriendTalkCta({ to: phoneUserA, text, buttons: btnA });
    await sendFriendTalkCta({ to: phoneUserB, text, buttons: btnB });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? String(err.message) : 'Solapi 발송 실패',
    };
  }
}

/**
 * @param {{ periodStart?: Date }} [opts]
 * @returns {Promise<{
 *   sent: number,
 *   skipped: { matchingId: string, reason: string }[],
 *   failed: { matchingId: string, error: string }[]
 * }>}
 */
async function sendMatchSuccessFriendTalkForAllInPeriod(opts = {}) {
  const periodStart = opts.periodStart || getMatchingPeriodStart();
  const rows = await matchingsForPeriod(periodStart);
  /** @type {{ matchingId: string, reason: string }[]} */
  const skipped = [];
  /** @type {{ matchingId: string, error: string }[]} */
  const failed = [];
  let sent = 0;
  for (const row of rows) {
    const r = await sendMatchSuccessFriendTalkForMatching(row.id);
    if (r.ok) {
      sent += 1;
    } else if (r.skipped) {
      skipped.push({ matchingId: row.id, reason: r.error });
    } else {
      failed.push({ matchingId: row.id, error: r.error });
    }
  }
  return { sent, skipped, failed, periodStart: periodStart.toISOString(), matchingCount: rows.length };
}

/**
 * `meetingStartsAt`의 KST 날짜가 `dateKeys`(화~일 6일 등) 안에 들어가는 로맨스 1:1 매칭만 대상.
 * 월요 크론은 `period_start` 대신 만남 일정 기준으로 발송한다.
 *
 * @param {{ dateKeys: Set<string> | string[] }} opts
 */
async function sendMatchSuccessFriendTalkForMeetingsOnKstDateKeys(opts) {
  const rawKeys = opts && opts.dateKeys;
  const dateKeys =
    rawKeys instanceof Set ? rawKeys : new Set(Array.isArray(rawKeys) ? rawKeys : []);
  /** @type {string[]} */
  const meetingDateKeysSorted = [...dateKeys].sort();
  if (dateKeys.size === 0) {
    return {
      sent: 0,
      skipped: [],
      failed: [],
      matchingCount: 0,
      meetingDateKeys: meetingDateKeysSorted,
    };
  }

  const { rangeStart, rangeEnd } = utcBoundsForKstDateKeys(dateKeys);
  if (!rangeStart || !rangeEnd) {
    return {
      sent: 0,
      skipped: [],
      failed: [],
      matchingCount: 0,
      meetingDateKeys: meetingDateKeysSorted,
    };
  }

  const rows = await prisma.matching.findMany({
    where: {
      matchType: MATCH_TYPE_ROMANCE,
      meetingStartsAt: {
        not: null,
        gte: rangeStart,
        lte: rangeEnd,
      },
    },
    select: { id: true, meetingStartsAt: true },
  });

  const filtered = rows.filter(
    (r) => r.meetingStartsAt && dateKeys.has(meetingDateKeyKst(r.meetingStartsAt)),
  );

  /** @type {{ matchingId: string, reason: string }[]} */
  const skipped = [];
  /** @type {{ matchingId: string, error: string }[]} */
  const failed = [];
  let sent = 0;
  for (const row of filtered) {
    const r = await sendMatchSuccessFriendTalkForMatching(row.id);
    if (r.ok) {
      sent += 1;
    } else if (r.skipped) {
      skipped.push({ matchingId: row.id, reason: r.error });
    } else {
      failed.push({ matchingId: row.id, error: r.error });
    }
  }
  return {
    sent,
    skipped,
    failed,
    matchingCount: filtered.length,
    meetingDateKeys: meetingDateKeysSorted,
  };
}

/**
 * 이번 주 설문 제출자 중 매칭에 안 올라간 사람에게 미매칭 안내.
 * @param {{ periodStart?: Date }} [opts]
 */
async function sendMatchFailureFriendTalkForUnmatchedInPeriod(opts = {}) {
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    return { ok: false, error: missingEnv, sent: 0, skipped: 0, failed: [] };
  }

  const periodStart = opts.periodStart || getMatchingPeriodStart();
  const eligible = await loadEligibleTraits({ periodStart });
  const matchedIds = await getUserIdsMatchedInPeriod(prisma, periodStart);

  const text = templates.NO_MATCH_THIS_WEEK_TEXT;
  const kakaoImageId = await getKakaoFriendTalkImageIdFromEnv(FRIEND_TALK_IMG_MATCH_FAIL);

  let sent = 0;
  let skipped = 0;
  /** @type {{ identityId: string, error: string }[]} */
  const failed = [];

  for (const row of eligible) {
    const id = row.id;
    if (matchedIds.has(id)) {
      continue;
    }
    const to = await decryptPhoneForIdentity(id);
    if (!to) {
      skipped += 1;
      continue;
    }
    try {
      await sendFriendTalkCta({
        to,
        text,
        kakaoImageId: kakaoImageId || undefined,
      });
      sent += 1;
    } catch (err) {
      failed.push({
        identityId: id,
        error: err && err.message ? String(err.message) : 'Solapi error',
      });
    }
  }

  return {
    ok: true,
    sent,
    skipped,
    failed,
    eligibleCount: eligible.length,
    matchedCount: matchedIds.size,
    periodStart: periodStart.toISOString(),
  };
}

module.exports = {
  sendMatchSuccessFriendTalkForMatching,
  sendMatchSuccessFriendTalkForAllInPeriod,
  sendMatchSuccessFriendTalkForMeetingsOnKstDateKeys,
  sendMatchFailureFriendTalkForUnmatchedInPeriod,
  decryptPhoneForIdentity,
};
