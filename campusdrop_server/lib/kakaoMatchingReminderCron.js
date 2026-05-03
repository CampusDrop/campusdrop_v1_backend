const cron = require('node-cron');
const { prisma } = require('./prisma');
const { refreshKakaoAccessToken, sendKakaoTalkDefaultTextMemo } = require('./kakaoOAuth');
const { buildMeetingFeedbackKakaoReminder } = require('./meetingReminderText');

function parseReminderIdentityIds() {
  return String(process.env.KAKAO_CRON_NOTIFY_IDENTITY_UUIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function reminderMessageForRow(row) {
  const override = String(process.env.KAKAO_CRON_REMINDER_TEXT || '').trim();
  if (override) {
    return override;
  }
  return buildMeetingFeedbackKakaoReminder(row);
}

/**
 * 테스트·소규모 수신자용: ENV에 적은 `Identity.id`(UUID)마다 저장된 카카오 리프레시 토큰으로
 * 나에게 보내기 API를 호출합니다. 향후 “전 유저 확장”은 대상 조회 쿼리만 바꾸면 됩니다.
 */
async function runKakaoMatchingReminderJob() {
  const ids = parseReminderIdentityIds();

  if (!ids.length) {
    console.warn('[kakaoMatchingReminderCron] KAKAO_CRON_NOTIFY_IDENTITY_UUIDS 비어 있음 — 건너뜀');
    return;
  }

  for (const identityId of ids) {
    let row;
    try {
      row = await prisma.identity.findUnique({
        where: { id: identityId },
        select: {
          id: true,
          blockedAt: true,
          kakaoRefreshToken: true,
          meetingTime: true,
          meetingPlace: true,
        },
      });
    } catch (e) {
      console.error('[kakaoMatchingReminderCron] 조회 실패', identityId, e);
      continue;
    }

    if (!row) {
      console.warn('[kakaoMatchingReminderCron] 계정 없음:', identityId);
      continue;
    }
    if (row.blockedAt) {
      console.warn('[kakaoMatchingReminderCron] 차단 계정 건너뜀:', identityId);
      continue;
    }
    if (!row.kakaoRefreshToken || !String(row.kakaoRefreshToken).trim()) {
      console.warn(
        '[kakaoMatchingReminderCron] kakaoRefreshToken 없음(카카오 로그인에 talk_message 등 동의·리프레시 발급 필요):',
        identityId,
      );
      continue;
    }

    try {
      const text = reminderMessageForRow(row);
      const refreshed = await refreshKakaoAccessToken(row.kakaoRefreshToken);
      const newRt =
        typeof refreshed.refresh_token === 'string' && refreshed.refresh_token.trim()
          ? refreshed.refresh_token.trim()
          : null;
      if (newRt && newRt !== row.kakaoRefreshToken) {
        await prisma.identity.update({
          where: { id: row.id },
          data: { kakaoRefreshToken: newRt },
        });
      }
      await sendKakaoTalkDefaultTextMemo(refreshed.access_token, text);
      console.log('[kakaoMatchingReminderCron] 전송 완료:', identityId);
    } catch (e) {
      console.error(
        '[kakaoMatchingReminderCron] 전송 실패:',
        identityId,
        e && e.code,
        e && e.kakaoStatus,
        e && e.kakaoBody,
      );
    }
  }
}

/** 서버 기동 시 호출. 매일 18:00 KST에 1회 실행합니다. */
function scheduleKakaoMatchingReminderCron() {
  const off = String(process.env.KAKAO_MATCHING_REMINDER_CRON_DISABLED || '')
    .trim()
    .toLowerCase();
  if (off === '1' || off === 'true' || off === 'yes') {
    console.log('[kakaoMatchingReminderCron] KAKAO_MATCHING_REMINDER_CRON_DISABLED 로 등록 생략');
    return;
  }

  cron.schedule(
    '0 18 * * *',
    () => {
      runKakaoMatchingReminderJob().catch((err) =>
        console.error('[kakaoMatchingReminderCron] job error', err),
      );
    },
    { timezone: 'Asia/Seoul' },
  );

  console.log('[kakaoMatchingReminderCron] 등록됨: 매일 18:00 Asia/Seoul');
}

module.exports = {
  scheduleKakaoMatchingReminderCron,
  runKakaoMatchingReminderJob,
};
