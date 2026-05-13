const express = require('express');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../lib/prisma');
const { identityProfileColumnsFromSurveyData } = require('../lib/surveyValidation');
const { writeAccessLog } = require('../lib/accessLog');
const { storePinForIdentity } = require('../lib/pinSession');
const { surveySchoolAccessOk, SURVEY_ACCESS_DENIED } = require('../lib/surveyAccess');
const { encryptPhoneForStorage, decryptPhoneFromStorage } = require('../lib/phoneCrypto');
const { assertSolapiFriendTalkEnv, sendFriendTalkCta } = require('../lib/solapiFriendTalkSend');
const templates = require('../lib/friendTalkTemplates');
const { publicApiBase, buildAcquisitionButtons } = require('../lib/friendTalkRsvp');
const {
  validateFriendSurveyPayload,
  validateFriendAvailabilityWindow,
} = require('../lib/friendSurveyValidation');
const {
  upsertFriendWeeklySurveySubmission,
  targetPeriodFromAvailabilityWindow,
} = require('../lib/friendWeeklySurveySubmission');
const { friendGenderFromSurveyData } = require('../lib/friendTraitGender');

const router = express.Router();

function phoneFromExistingIdentity(user) {
  if (!user || !user.phoneEncrypted) {
    return null;
  }
  try {
    return decryptPhoneFromStorage(user.phoneEncrypted);
  } catch (_) {
    return null;
  }
}

/**
 * @openapi
 * /api/survey/friend/submit:
 *   post:
 *     tags: [Survey]
 *     summary: 친구 매칭용 설문 제출 (`Trait.friendSurveyData` + 주간 스냅샷)
 *     security:
 *       - UserUuidAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FriendSurveySubmitRequest'
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SurveySubmitResponse'
 */
router.post('/friend/submit', async (req, res) => {
  if (!surveySchoolAccessOk(req.user)) {
    return res.status(403).json(SURVEY_ACCESS_DENIED);
  }

  const { surveyData, survey } = req.body ?? {};
  const payload = surveyData ?? survey;

  const v = validateFriendSurveyPayload(payload);
  if (!v.ok) {
    return res.status(400).json({ error: v.error });
  }
  const windowValidation = validateFriendAvailabilityWindow(v.availability);
  if (!windowValidation.ok) {
    return res.status(windowValidation.status).json({
      error: windowValidation.error,
      availabilityWindow: windowValidation.window,
    });
  }

  const surveyGender = friendGenderFromSurveyData(v.data);
  const weeklyGender = surveyGender ?? '';

  try {
    const surveySubmittedAt = new Date();
    const txResult = await prisma.$transaction(async (tx) => {
      const { targetPeriodStart } = targetPeriodFromAvailabilityWindow(windowValidation.window);

      await tx.weeklySurveySubmission.deleteMany({
        where: { identityId: req.user.id, targetPeriodStart },
      });

      const savedTrait = await tx.trait.upsert({
        where: { id: req.user.id },
        create: {
          id: req.user.id,
          friendSurveyData: v.data,
          friendSurveySubmittedAt: surveySubmittedAt,
        },
        update: {
          friendSurveyData: v.data,
          friendSurveySubmittedAt: surveySubmittedAt,
        },
        select: { id: true },
      });

      const weekly = await upsertFriendWeeklySurveySubmission(tx, {
        identityId: req.user.id,
        surveyData: v.data,
        gender: weeklyGender || null,
        submittedAt: surveySubmittedAt,
        availabilityWindow: windowValidation.window,
      });

      const profileCols = identityProfileColumnsFromSurveyData(v.data);
      let latestPhoneForNotification = profileCols.phone || phoneFromExistingIdentity(req.user);
      if (Object.keys(profileCols).length > 0) {
        const identityPatch = { ...profileCols };
        if (profileCols.phone) {
          identityPatch.phoneEncrypted = encryptPhoneForStorage(profileCols.phone);
          delete identityPatch.phone;
        }
        await tx.identity.update({
          where: { id: req.user.id },
          data: identityPatch,
        });
      }

      return {
        trait: savedTrait,
        shouldSendFirstWeeklySurveyConfirmed: weekly.isFirstSubmissionForWeek,
        phoneForFirstWeeklySurveyConfirmed: latestPhoneForNotification,
      };
    });

    await writeAccessLog({
      actorType: 'user_session',
      actorId: req.user.id,
      action: 'TRAIT_FRIEND_SURVEY_UPDATE',
      resource: `Trait:${txResult.trait.id}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: null,
    });

    if (
      txResult.shouldSendFirstWeeklySurveyConfirmed &&
      txResult.phoneForFirstWeeklySurveyConfirmed
    ) {
      const miss = assertSolapiFriendTalkEnv();
      if (miss) {
        console.warn('survey friend first-week friendtalk skipped:', miss);
      } else {
        void (async () => {
          try {
            const intro = `${templates.WAITLIST_AND_QUEUE_TEXT}\n\n${templates.FIRST_SURVEY_ACQUISITION_TAIL}`;
            const base = publicApiBase();
            const to = txResult.phoneForFirstWeeklySurveyConfirmed;
            if (!base) {
              await sendFriendTalkCta({ to, text: intro });
            } else {
              const buttons = await buildAcquisitionButtons(req.user.id, base);
              if (buttons && buttons.length > 0) {
                await sendFriendTalkCta({ to, text: intro, buttons });
              } else {
                await sendFriendTalkCta({ to, text: intro });
              }
            }
          } catch (notifyErr) {
            console.error('survey friend submit first-week friendtalk error:', notifyErr);
          }
        })();
      }
    }

    let pin = null;
    let expiresInSec = null;
    try {
      const pinResult = await storePinForIdentity(req.user.id);
      pin = pinResult.pin;
      expiresInSec = pinResult.expiresInSec;
    } catch (pinErr) {
      console.error('survey friend submit kakao pin error:', pinErr);
    }

    return res.status(200).json({
      message: '친구 매칭 설문이 저장되었습니다.',
      userId: txResult.trait.id,
      pin,
      expiresInSec,
    });
  } catch (err) {
    if (err && err.message === 'PHONE_ENCRYPTION_KEY_INVALID') {
      return res.status(500).json({
        error: '전화번호 저장 암호화 키가 설정되지 않았습니다. 서버 설정을 확인해 주세요.',
      });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    console.error('survey friend submit error:', err);
    return res.status(500).json({ error: '설문 저장 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
