const express = require('express');
const { assertSolapiFriendTalkEnv, sendFriendTalkCta } = require('../lib/solapiFriendTalkSend');

const router = express.Router();

/**
 * Solapi(쿨에스엠에스) 카카오 친구톡(CTA) 단건 발송 테스트.
 *
 * 터미널에서 호출 예:
 *   curl.exe -X POST http://127.0.0.1:3000/api/test-message
 * (PowerShell에서 `curl`은 Invoke-WebRequest 별칭일 수 있으므로 curl.exe 사용 권장)
 */
router.post('/test-message', async (req, res) => {
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    return res.status(500).json({ ok: false, error: missingEnv });
  }

  const from = (process.env.SENDER_NUMBER || '').trim();
  const text =
    '[캠퍼스드롭 매칭 완료! 💘]\n드디어 매칭이 성사되었습니다!\n- 시간: 오늘 오후 6시\n- 장소: 세종대 후문 커피니\n설레는 만남 되시길 바랍니다!';

  void (async () => {
    try {
      const result = await sendFriendTalkCta({ to: from, text });
      console.log('[test-message] friend talk sent:', result);
    } catch (err) {
      if (err && err.code === 'SOLAPI_CONFIG') {
        console.error('[test-message]', err.message || err);
        return;
      }
      console.error('[test-message] send error:', err);
    }
  })();
  return res.json({
    ok: true,
    accepted: true,
    message:
      '발송 요청을 접수했습니다. 허용 시간대(KST 08:01~20:49) 밖이면 오전 8시 1분(KST)에 발송되며, 결과는 서버 로그를 확인하세요.',
  });
});

module.exports = router;
