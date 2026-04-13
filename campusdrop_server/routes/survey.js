const express = require('express');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../lib/prisma');
const { validateSurveyPayload } = require('../lib/surveyValidation');
const { writeAccessLog } = require('../lib/accessLog');
const { storePinForIdentity } = require('../lib/pinSession');

const router = express.Router();

/**
 * @openapi
 * /api/survey/submit:
 *   post:
 *     tags: [Survey]
 *     summary: 로그인 유저의 Trait 설문 저장 + 카카오 챗봇 연동용 4자리 PIN 발급 (`GET /api/auth/pin`과 동일)
 *     security:
 *       - UserUuidAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SurveySubmitRequest'
 *     responses:
 *       200:
 *         description: 저장 완료
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SurveySubmitResponse'
 *       400:
 *         description: payload 누락·검증 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       401:
 *         description: 세션 무효
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       404:
 *         description: Trait upsert 실패(P2025)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       500:
 *         description: 서버 오류
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.post('/submit', async (req, res) => {
  const { surveyData, survey } = req.body ?? {};
  const payload = surveyData ?? survey;

  if (payload === undefined || payload === null) {
    return res.status(400).json({ error: 'surveyData가 필요합니다.' });
  }

  const validation = validateSurveyPayload(payload);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const trait = await prisma.trait.upsert({
      where: { id: req.user.id },
      create: {
        surveyData: validation.data,
        gender: String(validation.data.gender),
        identity: { connect: { id: req.user.id } },
      },
      update: {
        surveyData: validation.data,
        gender: String(validation.data.gender),
      },
      select: { id: true },
    });

    await writeAccessLog({
      actorType: 'user_session',
      actorId: req.user.id,
      action: 'TRAIT_SURVEY_UPDATE',
      resource: `Trait:${trait.id}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: null,
    });

    let pin = null;
    let expiresInSec = null;
    try {
      const pinResult = await storePinForIdentity(req.user.id);
      pin = pinResult.pin;
      expiresInSec = pinResult.expiresInSec;
    } catch (pinErr) {
      console.error('survey submit kakao pin error:', pinErr);
    }

    return res.status(200).json({
      message: '설문 결과가 저장되었습니다.',
      userId: trait.id,
      pin,
      expiresInSec,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    console.error('survey submit error:', err);
    return res.status(500).json({ error: '설문 저장 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
