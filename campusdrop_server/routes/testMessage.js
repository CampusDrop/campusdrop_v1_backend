const express = require('express');
const CoolsmsMessageService = require('coolsms-node-sdk').default;

const router = express.Router();

/**
 * Solapi(쿨에스엠에스) 카카오 친구톡(CTA) 단건 발송 테스트.
 *
 * 터미널에서 호출 예:
 *   curl.exe -X POST http://127.0.0.1:3000/api/test-message
 * (PowerShell에서 `curl`은 Invoke-WebRequest 별칭일 수 있으므로 curl.exe 사용 권장)
 */
router.post('/test-message', async (req, res) => {
  const apiKey = (process.env.SOLAPI_API_KEY || '').trim();
  const apiSecret = (process.env.SOLAPI_API_SECRET || '').trim();
  const from = (process.env.SENDER_NUMBER || '').trim();
  const pfId = (process.env.KAKAO_PF_ID || '').trim();

  if (!apiKey || !apiSecret || !from || !pfId) {
    return res.status(500).json({
      ok: false,
      error: 'Missing env: SOLAPI_API_KEY, SOLAPI_API_SECRET, SENDER_NUMBER, KAKAO_PF_ID',
    });
  }

  const text =
    '[캠퍼스드롭 매칭 완료! 💘]\n드디어 매칭이 성사되었습니다!\n- 시간: 오늘 오후 6시\n- 장소: 세종대 후문 커피니\n설레는 만남 되시길 바랍니다!';

  const message = {
    to: from,
    from,
    type: 'CTA',
    text,
    kakaoOptions: {
      pfId,
    },
  };

  try {
    const messageService = new CoolsmsMessageService(apiKey, apiSecret);
    const result = await messageService.sendOne(message);
    return res.json({ ok: true, result });
  } catch (err) {
    const name = err && err.name ? String(err.name) : 'Error';
    const messageText = err && err.message ? String(err.message) : String(err);
    return res.status(502).json({ ok: false, error: { name, message: messageText } });
  }
});

module.exports = router;
