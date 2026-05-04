const cron = require('node-cron');
const { prisma } = require('./prisma');
const { sendDayEveReminderForMatching, canSendDayEveReminder } = require('./friendTalkRsvp');

/** matchingStartsAt 의 한국 날짜 YYYY-MM-DD */
function meetingDateKeyKst(meetingStartsAt) {
  return new Date(meetingStartsAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

/** 오늘(KST) 기준 내일 날짜 YYYY-MM-DD */
function seoulTomorrowYmdFromNow() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const [y, m, d] = today.split('-').map(Number);
  const noonUtc = Date.UTC(y, m - 1, d, 12, 0, 0);
  return new Date(noonUtc + 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

/**
 * meetingStartsAt 가 **내일**(KST)인 매칭에 대해 6번(전날) 친구톡+버튼을 자동 발송합니다.
 * 7번 양쪽 수락·skip 아님·미발송·비차단만 대상.
 */
async function runFriendTalkDayEveCronJob() {
  const targetKey = seoulTomorrowYmdFromNow();
  const base = String(process.env.PUBLIC_API_URL || '').trim();
  const secretOk = String(process.env.FRIEND_TALK_RSVP_SECRET || '').trim().length >= 16;
  if (!base || !secretOk) {
    console.warn(
      '[friendTalkDayEveCron] PUBLIC_API_URL 또는 FRIEND_TALK_RSVP_SECRET 미설정 — 건너뜀',
    );
    return;
  }

  const rows = await prisma.matching.findMany({
    where: {
      meetingStartsAt: { not: null },
      friendTalkRsvp: { isNot: null },
    },
    include: { friendTalkRsvp: true },
  });

  for (const m of rows) {
    const r = m.friendTalkRsvp;
    if (!r || !m.meetingStartsAt) continue;
    if (meetingDateKeyKst(m.meetingStartsAt) !== targetKey) continue;
    if (!canSendDayEveReminder(r)) continue;
    if (r.dayEveReminderSentAt != null) continue;

    const [userA, userB] = await Promise.all([
      prisma.identity.findUnique({ where: { id: m.userAId }, select: { blockedAt: true } }),
      prisma.identity.findUnique({ where: { id: m.userBId }, select: { blockedAt: true } }),
    ]);
    if (userA?.blockedAt || userB?.blockedAt) {
      console.warn('[friendTalkDayEveCron] 차단 계정 포함 건너뜀:', m.id);
      continue;
    }

    const sent = await sendDayEveReminderForMatching(m.id);
    if (sent.ok) {
      console.log('[friendTalkDayEveCron] 6번 발송:', m.id);
    } else {
      console.warn('[friendTalkDayEveCron] 발송 실패', m.id, sent.error);
    }
  }
}

/** 매일 18:00 KST */
function scheduleFriendTalkDayEveCron() {
  const off = String(process.env.FRIEND_TALK_DAY_EVE_CRON_DISABLED || '')
    .trim()
    .toLowerCase();
  if (off === '1' || off === 'true' || off === 'yes') {
    console.log('[friendTalkDayEveCron] FRIEND_TALK_DAY_EVE_CRON_DISABLED 로 등록 생략');
    return;
  }

  cron.schedule(
    '0 18 * * *',
    () => {
      runFriendTalkDayEveCronJob().catch((e) =>
        console.error('[friendTalkDayEveCron] job error', e),
      );
    },
    { timezone: 'Asia/Seoul' },
  );
  console.log(
    '[friendTalkDayEveCron] 등록됨: 매일 18:00 Asia/Seoul — meetingStartsAt가 내일(KST)인 매칭에 6번',
  );
}

module.exports = {
  scheduleFriendTalkDayEveCron,
  runFriendTalkDayEveCronJob,
};
