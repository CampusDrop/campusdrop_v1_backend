const express = require('express');
const { prisma } = require('../lib/prisma');
const { getIdentityIdByPin, deletePinKey } = require('../lib/pinSession');

const router = express.Router();

/** 카카오 i 오픈빌더 스킬 응답 v2.0 (simpleText) */
function kakaoSimpleResponse(text) {
  return {
    version: '2.0',
    template: {
      outputs: [{ simpleText: { text } }],
    },
  };
}

/** 발화에서 첫 번째 4자리 연속 숫자 추출 */
function extractFourDigitPin(utterance) {
  if (typeof utterance !== 'string') return null;
  const compact = utterance.replace(/\s/g, '');
  const m = compact.match(/\d{4}/);
  return m ? m[0] : null;
}

function resolveKakaoUserId(body) {
  const u = body?.userRequest?.user;
  if (u && typeof u.id === 'string' && u.id.trim() !== '') {
    return u.id.trim();
  }
  return null;
}

/**
 * @openapi
 * /api/kakao/webhook:
 *   post:
 *     tags: [Kakao]
 *     summary: 오픈빌더 스킬 웹훅 — PIN으로 Identity 연동 및 kakaoId 저장
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/KakaoWebhookRequest'
 *     responses:
 *       200:
 *         description: 항상 200 — 본문은 스킬 응답(JSON). 성공/실패 모두 simpleText
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/KakaoSkillResponse'
 */
router.post('/webhook', async (req, res) => {
  const body = req.body ?? {};
  const kakaoUserId = resolveKakaoUserId(body);

  if (!kakaoUserId) {
    return res.status(200).json(kakaoSimpleResponse('카카오 사용자 정보를 확인할 수 없습니다.'));
  }

  const utterance = body.userRequest?.utterance;
  const pin = extractFourDigitPin(typeof utterance === 'string' ? utterance : '');
  if (!pin) {
    return res.status(200).json(kakaoSimpleResponse('4자리 PIN 번호를 입력해 주세요.'));
  }

  let identityId;
  try {
    identityId = await getIdentityIdByPin(pin);
  } catch (err) {
    console.error('kakao webhook pin resolve:', err);
    return res.status(200).json(kakaoSimpleResponse('일시적인 오류입니다. 잠시 후 다시 시도해 주세요.'));
  }

  if (!identityId) {
    return res
      .status(200)
      .json(
        kakaoSimpleResponse(
          'PIN이 올바르지 않거나 만료되었습니다. 앱에서 PIN을 다시 발급한 뒤 입력해 주세요.',
        ),
      );
  }

  try {
    await prisma.identity.update({
      where: { id: identityId },
      data: { kakaoId: kakaoUserId, kakaoLinkPin: null },
    });
    await deletePinKey(pin);
  } catch (err) {
    console.error('kakao webhook identity update:', err);
    return res.status(200).json(kakaoSimpleResponse('연동 처리 중 오류가 발생했습니다.'));
  }

  return res.status(200).json(kakaoSimpleResponse('챗봇과 계정이 연동되었습니다.'));
});

module.exports = router;
