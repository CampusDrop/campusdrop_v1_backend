const cron = require('node-cron');
const { prisma } = require('./prisma');
const { assertSolapiFriendTalkEnv, sendFriendTalkCta } = require('./solapiFriendTalkSend');
const templates = require('./friendTalkTemplates');
const { resolveMatchMeetingDisplay } = require('./meetingDisplay');
const {
  publicApiBase,
  buildFeedbackButtons,
} = require('./friendTalkRsvp');
const { decryptPhoneForIdentity } = require('./adminMatchFriendTalk');

function meetingDateKeyKst(meetingStartsAt) {
  return new Date(meetingStartsAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

/**
 * 만남 당일(KST) 18시 — 양쪽 월요 수락 완료 매칭에 후기 친구톡(3버튼).
 */
async function runMeetingFeedbackFriendTalkJob() {
  const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    console.warn('[meetingFeedbackFriendTalkCron] Solapi 미설정:', missingEnv);
    return;
  }
  const base = publicApiBase();
  if (!base) {
    console.warn('[meetingFeedbackFriendTalkCron] PUBLIC_API_URL 미설정 — 건너뜀');
    return;
  }

  const rows = await prisma.matching.findMany({
    where: {
      meetingStartsAt: { not: null },
      feedbackFriendTalkSentAt: null,
      friendTalkRsvp: {
        is: {
          mondayRsvpUserA: 'YES',
          mondayRsvpUserB: 'YES',
          skipDayEveReminder: false,
        },
      },
    },
    include: { friendTalkRsvp: true },
  });

  for (const m of rows) {
    if (!m.meetingStartsAt || !m.friendTalkRsvp) {
      continue;
    }
    if (meetingDateKeyKst(m.meetingStartsAt) !== todayKey) {
      continue;
    }

    const [userA, userB] = await Promise.all([
      prisma.identity.findUnique({ where: { id: m.userAId }, select: { blockedAt: true } }),
      prisma.identity.findUnique({ where: { id: m.userBId }, select: { blockedAt: true } }),
    ]);
    if (userA?.blockedAt || userB?.blockedAt) {
      console.warn('[meetingFeedbackFriendTalkCron] 차단 계정 포함 건너뜀:', m.id);
      continue;
    }

    const meeting = await resolveMatchMeetingDisplay(m.id);
    const text = templates.buildMeetingDayFeedbackText(meeting.meetingPlace || '');
    const btnA = await buildFeedbackButtons(m.id, m.userAId, base);
    const btnB = await buildFeedbackButtons(m.id, m.userBId, base);
    if (!btnA || !btnB) {
      console.warn('[meetingFeedbackFriendTalkCron] 피드백 버튼 생성 실패:', m.id);
      continue;
    }

    const phoneA = await decryptPhoneForIdentity(m.userAId);
    const phoneB = await decryptPhoneForIdentity(m.userBId);
    if (!phoneA || !phoneB) {
      console.warn('[meetingFeedbackFriendTalkCron] 전화번호 없음:', m.id);
      continue;
    }

    try {
      await sendFriendTalkCta({ to: phoneA, text, buttons: btnA });
      await sendFriendTalkCta({ to: phoneB, text, buttons: btnB });
      await prisma.matching.update({
        where: { id: m.id },
        data: { feedbackFriendTalkSentAt: new Date() },
      });
      console.log('[meetingFeedbackFriendTalkCron] 후기 친구톡 발송:', m.id);
    } catch (e) {
      console.error('[meetingFeedbackFriendTalkCron] 발송 실패', m.id, e && e.message);
    }
  }
}

function scheduleMeetingFeedbackFriendTalkCron() {
  const off = String(process.env.KAKAO_MATCHING_REMINDER_CRON_DISABLED || '')
    .trim()
    .toLowerCase();
  if (off === '1' || off === 'true' || off === 'yes') {
    console.log(
      '[meetingFeedbackFriendTalkCron] KAKAO_MATCHING_REMINDER_CRON_DISABLED 로 등록 생략',
    );
    return;
  }

  cron.schedule(
    '0 18 * * *',
    () => {
      runMeetingFeedbackFriendTalkJob().catch((err) =>
        console.error('[meetingFeedbackFriendTalkCron] job error', err),
      );
    },
    { timezone: 'Asia/Seoul' },
  );
  console.log(
    '[meetingFeedbackFriendTalkCron] 등록됨: 매일 18:00 Asia/Seoul — 만남 당일 후기 친구톡',
  );
}

module.exports = {
  scheduleMeetingFeedbackFriendTalkCron,
  runMeetingFeedbackFriendTalkJob,
};
