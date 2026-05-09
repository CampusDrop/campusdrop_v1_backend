const cron = require('node-cron');
const { prisma } = require('./prisma');
const { decryptPhoneFromStorage } = require('./phoneCrypto');
const { sendFriendTalkCta, assertSolapiFriendTalkEnv } = require('./solapiFriendTalkSend');
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
 * 테스트·소규모 수신자용: ENV에 적은 `Identity.id`(UUID)마다 Solapi 친구톡을 전송합니다.
 * 향후 “전 유저 확장”은 대상 조회 쿼리만 바꾸면 됩니다.
 */
async function runKakaoMatchingReminderJob() {
  const ids = parseReminderIdentityIds();
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    console.warn('[kakaoMatchingReminderCron] Solapi 설정 누락으로 건너뜀:', missingEnv);
    return;
  }

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
          phoneEncrypted: true,
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
    if (!row.phoneEncrypted) {
      console.warn('[kakaoMatchingReminderCron] phoneEncrypted 없음:', identityId);
      continue;
    }

    let to;
    try {
      to = decryptPhoneFromStorage(row.phoneEncrypted);
    } catch (e) {
      console.warn('[kakaoMatchingReminderCron] 전화번호 복호화 실패:', identityId, e && e.message);
      continue;
    }

    try {
      const text = reminderMessageForRow(row);
      await sendFriendTalkCta({ to, text });
      console.log('[kakaoMatchingReminderCron] 전송 완료:', identityId);
    } catch (e) {
      console.error(
        '[kakaoMatchingReminderCron] 전송 실패:',
        identityId,
        e && e.code ? e.code : '',
        e && e.message ? e.message : e,
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
