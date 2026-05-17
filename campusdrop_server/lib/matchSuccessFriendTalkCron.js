const cron = require('node-cron');
const { assertSolapiFriendTalkEnv } = require('./solapiFriendTalkSend');
const { publicApiBase } = require('./friendTalkRsvp');
const { getMatchingPeriodStart } = require('./matchPolicy');
const { sendMatchSuccessFriendTalkForAllInPeriod } = require('./adminMatchFriendTalk');

/**
 * 이번 매칭 주기의 성사 쌍에 7번(참석 확인) 친구톡 일괄 발송 — 관리자 API와 동일 로직.
 */
async function runMatchSuccessFriendTalkCronJob() {
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    console.warn('[matchSuccessFriendTalkCron] Solapi 미설정:', missingEnv);
    return;
  }
  if (!publicApiBase()) {
    console.warn('[matchSuccessFriendTalkCron] PUBLIC_API_URL 미설정 — 건너뜀');
    return;
  }

  const periodStart = getMatchingPeriodStart();
  try {
    const result = await sendMatchSuccessFriendTalkForAllInPeriod({ periodStart });
    console.log('[matchSuccessFriendTalkCron] 발송 요약:', {
      sent: result.sent,
      matchingCount: result.matchingCount,
      skipped: result.skipped.length,
      failed: result.failed.length,
      periodStart: result.periodStart,
    });
    if (result.failed.length) {
      console.warn('[matchSuccessFriendTalkCron] 일부 실패:', result.failed.slice(0, 5));
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
    '[matchSuccessFriendTalkCron] 등록됨: 매주 월요일 09:00 Asia/Seoul — 매칭 성공(7번) 친구톡',
  );
}

module.exports = {
  scheduleMatchSuccessFriendTalkCron,
  runMatchSuccessFriendTalkCronJob,
};
