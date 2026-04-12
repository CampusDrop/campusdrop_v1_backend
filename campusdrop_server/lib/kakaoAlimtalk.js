/**
 * 카카오 알림톡 발송 (Mock). 실제 연동 시 비즈메시지/알림톡 REST API로 교체.
 * @param {{ identityId: string, kakaoId: string, templateCode?: string, context?: Record<string, unknown> }} params
 * @returns {Promise<{ ok: true, mock: true }>}
 */
async function sendWeeklyMatchAlimtalkMock(params) {
  const { identityId, kakaoId, templateCode = 'WEEKLY_MATCH_RESULT', context } = params;
  console.log(
    '[kakao alimtalk MOCK]',
    JSON.stringify({ identityId, kakaoId, templateCode, context: context ?? {} }),
  );
  return { ok: true, mock: true };
}

module.exports = { sendWeeklyMatchAlimtalkMock };
