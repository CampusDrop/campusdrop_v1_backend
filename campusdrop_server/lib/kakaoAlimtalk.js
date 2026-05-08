const { prisma } = require('./prisma');
const { decryptPhoneFromStorage } = require('./phoneCrypto');
const { assertSolapiFriendTalkEnv, sendFriendTalkCta } = require('./solapiFriendTalkSend');

const WEEKLY_MATCH_RESULT_TEXT = `Campus Drop 매칭 결과가 준비되었습니다 💌

앱에서 이번 주 매칭 결과와 안내 내용을 확인해 주세요.`;

/**
 * 주간 매칭 결과 알림을 Solapi 친구톡으로 발송.
 * @param {{ identityId: string, kakaoId?: string | null, templateCode?: string, context?: Record<string, unknown> }} params
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string }>}
 */
async function sendWeeklyMatchAlimtalkMock(params) {
  const { identityId } = params;
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    return { ok: false, skipped: true, reason: missingEnv };
  }

  const row = await prisma.identity.findUnique({
    where: { id: identityId },
    select: { phoneEncrypted: true, blockedAt: true },
  });
  if (!row || row.blockedAt) {
    return { ok: false, skipped: true, reason: 'identity_not_found_or_blocked' };
  }
  if (!row.phoneEncrypted) {
    return { ok: false, skipped: true, reason: 'phone_not_found' };
  }
  let to;
  try {
    to = decryptPhoneFromStorage(row.phoneEncrypted);
  } catch (_) {
    return { ok: false, skipped: true, reason: 'phone_decrypt_failed' };
  }
  await sendFriendTalkCta({ to, text: WEEKLY_MATCH_RESULT_TEXT });
  return { ok: true };
}

module.exports = { sendWeeklyMatchAlimtalkMock };
