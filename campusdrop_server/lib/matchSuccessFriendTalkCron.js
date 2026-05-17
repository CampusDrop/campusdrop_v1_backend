const cron = require('node-cron');
const { assertSolapiFriendTalkEnv } = require('./solapiFriendTalkSend');
const { publicApiBase } = require('./friendTalkRsvp');
const { getMatchingPeriodStart } = require('./matchPolicy');
const { sendMatchSuccessFriendTalkForAllInPeriod } = require('./adminMatchFriendTalk');
const {
  sendFriendGroupAttendanceInviteForAllInPeriod,
} = require('./friendGroupMatchSuccessFriendTalk');

/**
 * 이번 매칭 주기: 1:1 로맨스 성사 쌍(7번·RSVP) + 친구 소그룹 참석 확인 초대(월요일).
 */
async function runMatchSuccessFriendTalkCronJob() {
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    console.warn('[matchSuccessFriendTalkCron] Solapi 미설정:', missingEnv);
    return;
  }

  const periodStart = getMatchingPeriodStart();
  try {
    if (publicApiBase()) {
      const result = await sendMatchSuccessFriendTalkForAllInPeriod({ periodStart });
      console.log('[matchSuccessFriendTalkCron] 발송 요약(1:1):', {
        sent: result.sent,
        matchingCount: result.matchingCount,
        skipped: result.skipped.length,
        failed: result.failed.length,
        periodStart: result.periodStart,
      });
      if (result.failed.length) {
        console.warn('[matchSuccessFriendTalkCron] 일부 실패(1:1):', result.failed.slice(0, 5));
      }
    } else {
      console.warn(
        '[matchSuccessFriendTalkCron] PUBLIC_API_URL 미설정 — 1:1 매칭 성공(RSVP 버튼) 친구톡 생략',
      );
    }

    const fg = await sendFriendGroupAttendanceInviteForAllInPeriod({ periodStart });
    console.log('[matchSuccessFriendTalkCron] 친구 소그룹 참석 초대:', {
      groupCount: fg.groupCount,
      sentMembers: fg.sentMembers,
      skippedMembers: fg.skippedMembers,
      groupFailed: fg.groupFailed.length,
      memberFailed: fg.memberFailed.length,
    });
    if (fg.groupFailed.length) {
      console.warn(
        '[matchSuccessFriendTalkCron] 친구 소그룹 초대 건 실패:',
        fg.groupFailed.slice(0, 5),
      );
    }
    if (fg.memberFailed.length) {
      console.warn(
        '[matchSuccessFriendTalkCron] 친구 소그룹 멤버 발송 실패:',
        fg.memberFailed.slice(0, 5),
      );
    }
  } catch (err) {
    console.error('[matchSuccessFriendTalkCron] job error', err);
  }
}

/** 매주 월요일 09:00 KST */
function scheduleMatchSuccessFriendTalkCron() {
  const off = String(process.env.FRIEND_TALK_MATCH_SUCCESS_CRON_DISABLED || '')
    .trim()
    .toLowerCase();
  if (off === '1' || off === 'true' || off === 'yes') {
    console.log(
      '[matchSuccessFriendTalkCron] FRIEND_TALK_MATCH_SUCCESS_CRON_DISABLED 로 등록 생략',
    );
    return;
  }

  cron.schedule(
    '0 9 * * 1',
    () => {
      runMatchSuccessFriendTalkCronJob().catch((e) =>
        console.error('[matchSuccessFriendTalkCron] job error', e),
      );
    },
    { timezone: 'Asia/Seoul' },
  );
  console.log(
    '[matchSuccessFriendTalkCron] 등록됨: 매주 월요일 09:00 Asia/Seoul — 1:1 매칭 성공(7번) + 친구 소그룹 참석 확인',
  );
}

module.exports = {
  scheduleMatchSuccessFriendTalkCron,
  runMatchSuccessFriendTalkCronJob,
};
