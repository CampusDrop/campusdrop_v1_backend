const express = require('express');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../lib/prisma');
const {
  validateSurveyPayload,
  identityProfileColumnsFromSurveyData,
} = require('../lib/surveyValidation');
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
 *       403:
 *         description: |
 *           이메일 없고 이미지 가입 세션(`imageUuidAccessUntil`)도 만료·없음. 또는 설문·매칭 라우트에서 세션 만료(`IMAGE_UUID_ACCESS_EXPIRED`)
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
  const email = req.user && req.user.email != null ? String(req.user.email).trim() : '';
  const imageUntil = req.user?.imageUuidAccessUntil;
  const imageSessionOk =
    imageUntil &&
    !Number.isNaN(new Date(imageUntil).getTime()) &&
    Date.now() < new Date(imageUntil).getTime();
  if (!email && !imageSessionOk) {
    return res.status(403).json({
      error:
        '설문은 학교 이메일(@sju.ac.kr) 인증을 완료한 뒤 제출하거나, 이미지 가입 세션 유효 기간(`imageUuidAccessUntil`) 내에 제출해 주세요.',
    });
  }

  const { surveyData, survey } = req.body ?? {};
  const payload = surveyData ?? survey;

  if (payload === undefined || payload === null) {
    return res.status(400).json({
      error: 'surveyData 또는 survey 본문이 필요합니다. (프론트 설문 패키지: surveyAnswers·matchAvailability·participantMeta 등 포함 가능)',
    });
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

    const profileCols = identityProfileColumnsFromSurveyData(validation.data);
    if (Object.keys(profileCols).length > 0) {
      await prisma.identity.update({
        where: { id: req.user.id },
        data: profileCols,
      });
    }

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
