const express = require('express');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../lib/prisma');
const {
  validateSurveyPayload,
  identityProfileColumnsFromSurveyData,
} = require('../lib/surveyValidation');
const {
  validateSurveyAvailabilityForCurrentWindow,
  getSurveyTargetPeriodStartForApplicationPeriod,
} = require('../lib/surveyAvailabilityWindow');
const { upsertWeeklySurveySubmission } = require('../lib/weeklySurveySubmission');
const { getMatchingPeriodStart } = require('../lib/matchPolicy');
const { writeAccessLog } = require('../lib/accessLog');
const { storePinForIdentity } = require('../lib/pinSession');
const { surveySchoolAccessOk, SURVEY_ACCESS_DENIED } = require('../lib/surveyAccess');
const { encryptPhoneForStorage, decryptPhoneFromStorage } = require('../lib/phoneCrypto');
const { assertSolapiFriendTalkEnv, sendFriendTalkCta } = require('../lib/solapiFriendTalkSend');
const templates = require('../lib/friendTalkTemplates');
const { publicApiBase, buildAcquisitionButtons } = require('../lib/friendTalkRsvp');
const { MATCH_TYPE_FRIEND, MATCH_TYPE_ROMANCE } = require('../lib/matchType');
const {
  buildRomanceLane,
  buildFriendLane,
  loadLatestRomanceWeekly,
  loadLatestFriendWeekly,
} = require('../lib/surveyEffectiveLanes');

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
 * /api/survey/me/romance:
 *   get:
 *     tags: [Survey]
 *     summary: 로맨스 설문 최신 상태(Trait + 가장 최근 주간 스냅샷 메타)
 *     security:
 *       - UserUuidAuth: []
 *     responses:
 *       200:
 *         description: 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SurveyLaneMeResponse'
 */
router.get('/me/romance', async (req, res) => {
  if (!surveySchoolAccessOk(req.user)) {
    return res.status(403).json(SURVEY_ACCESS_DENIED);
  }

  try {
    const periodStart = getMatchingPeriodStart();
    const targetPeriodStart = getSurveyTargetPeriodStartForApplicationPeriod(periodStart);

    const [traitRow, romanceWeekly, latestRomanceWeekly] = await Promise.all([
      prisma.trait.findUnique({
        where: { id: req.user.id },
        select: {
          surveyData: true,
          gender: true,
          surveySubmittedAt: true,
        },
      }),
      prisma.weeklySurveySubmission.findUnique({
        where: {
          identityId_targetPeriodStart: {
            identityId: req.user.id,
            targetPeriodStart,
          },
        },
        select: { id: true, submittedAt: true },
      }),
      loadLatestRomanceWeekly(req.user.id),
    ]);

    const lane = buildRomanceLane(traitRow, romanceWeekly, latestRomanceWeekly);
    const body = {
      userId: req.user.id,
      matchType: MATCH_TYPE_ROMANCE,
      meetingTargetPeriodStart: targetPeriodStart.toISOString(),
      ...lane,
    };

    await writeAccessLog({
      actorType: 'user_session',
      actorId: req.user.id,
      action: 'TRAIT_SURVEY_READ',
      resource: 'GET /api/survey/me/romance',
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { romanceHasSurvey: lane.hasSurvey },
    });

    return res.status(200).json(body);
  } catch (err) {
    console.error('survey GET /me/romance error:', err);
    return res.status(500).json({ error: '설문 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/survey/me/friend:
 *   get:
 *     tags: [Survey]
 *     summary: 친구 설문 최신 상태(Trait + 가장 최근 주간 스냅샷 메타)
 *     security:
 *       - UserUuidAuth: []
 *     responses:
 *       200:
 *         description: 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SurveyLaneMeResponse'
 */
router.get('/me/friend', async (req, res) => {
  if (!surveySchoolAccessOk(req.user)) {
    return res.status(403).json(SURVEY_ACCESS_DENIED);
  }

  try {
    const periodStart = getMatchingPeriodStart();
    const targetPeriodStart = getSurveyTargetPeriodStartForApplicationPeriod(periodStart);

    const [traitRow, friendWeekly, latestFriendWeekly] = await Promise.all([
      prisma.trait.findUnique({
        where: { id: req.user.id },
        select: {
          gender: true,
          friendSurveyData: true,
          friendSurveySubmittedAt: true,
        },
      }),
      prisma.friendWeeklySurveySubmission.findUnique({
        where: {
          identityId_targetPeriodStart: {
            identityId: req.user.id,
            targetPeriodStart,
          },
        },
        select: { id: true, submittedAt: true },
      }),
      loadLatestFriendWeekly(req.user.id),
    ]);

    const lane = buildFriendLane(traitRow, friendWeekly, latestFriendWeekly);
    const body = {
      userId: req.user.id,
      matchType: MATCH_TYPE_FRIEND,
      meetingTargetPeriodStart: targetPeriodStart.toISOString(),
      ...lane,
    };

    await writeAccessLog({
      actorType: 'user_session',
      actorId: req.user.id,
      action: 'TRAIT_SURVEY_READ',
      resource: 'GET /api/survey/me/friend',
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { friendHasSurvey: lane.hasSurvey },
    });

    return res.status(200).json(body);
  } catch (err) {
    console.error('survey GET /me/friend error:', err);
    return res.status(500).json({ error: '설문 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/survey/me:
 *   get:
 *     tags: [Survey]
 *     summary: 로맨스·친구 최신 설문 요약(합본)
 *     description: |
 *       각 레인의 본문은 Trait를 우선하고, Trait가 비어 있으면 해당 레인의 가장 최근 주간 스냅샷으로 보강합니다.
 *       `updatedAt`은 레인별 설문 제출 시각과 동일합니다.
 *       `activeWeeklyLane`은 이번 만남 대상 주에 대한 주간 스냅샷이 어느 레인인지(둘 다 있으면 더 늦게 제출한 쪽).
 *     security:
 *       - UserUuidAuth: []
 *     responses:
 *       200:
 *         description: 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SurveyCurrentResponse'
 */
router.get('/me', async (req, res) => {
  if (!surveySchoolAccessOk(req.user)) {
    return res.status(403).json(SURVEY_ACCESS_DENIED);
  }

  try {
    const periodStart = getMatchingPeriodStart();
    const targetPeriodStart = getSurveyTargetPeriodStartForApplicationPeriod(periodStart);

    const [traitRow, romanceWeekly, friendWeekly, latestRomanceWeekly, latestFriendWeekly] =
      await Promise.all([
        prisma.trait.findUnique({
          where: { id: req.user.id },
          select: {
            surveyData: true,
            friendSurveyData: true,
            gender: true,
            surveySubmittedAt: true,
            friendSurveySubmittedAt: true,
          },
        }),
        prisma.weeklySurveySubmission.findUnique({
          where: {
            identityId_targetPeriodStart: {
              identityId: req.user.id,
              targetPeriodStart,
            },
          },
          select: { id: true, submittedAt: true },
        }),
        prisma.friendWeeklySurveySubmission.findUnique({
          where: {
            identityId_targetPeriodStart: {
              identityId: req.user.id,
              targetPeriodStart,
            },
          },
          select: { id: true, submittedAt: true },
        }),
        loadLatestRomanceWeekly(req.user.id),
        loadLatestFriendWeekly(req.user.id),
      ]);

    /** @type {'ROMANCE' | 'FRIEND' | null} */
    let activeWeeklyLane = null;
    if (romanceWeekly && friendWeekly) {
      const ra = new Date(romanceWeekly.submittedAt).getTime();
      const fa = new Date(friendWeekly.submittedAt).getTime();
      activeWeeklyLane = ra >= fa ? MATCH_TYPE_ROMANCE : MATCH_TYPE_FRIEND;
    } else if (romanceWeekly) {
      activeWeeklyLane = MATCH_TYPE_ROMANCE;
    } else if (friendWeekly) {
      activeWeeklyLane = MATCH_TYPE_FRIEND;
    }

    const body = {
      userId: req.user.id,
      activeWeeklyLane,
      meetingTargetPeriodStart: targetPeriodStart.toISOString(),
      romance: buildRomanceLane(traitRow, romanceWeekly, latestRomanceWeekly),
      friend: buildFriendLane(traitRow, friendWeekly, latestFriendWeekly),
    };

    await writeAccessLog({
      actorType: 'user_session',
      actorId: req.user.id,
      action: 'TRAIT_SURVEY_READ',
      resource: 'GET /api/survey/me',
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: {
        romanceHasSurvey: body.romance.hasSurvey,
        friendHasSurvey: body.friend.hasSurvey,
      },
    });

    return res.status(200).json(body);
  } catch (err) {
    console.error('survey GET /me error:', err);
    return res.status(500).json({ error: '설문 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/survey/submit:
 *   post:
 *     tags: [Survey]
 *     summary: 로맨스(가치관) 설문 저장 — `POST /api/survey/friend/submit`은 친구 전용
 *     security:
 *       - UserUuidAuth: []
 */
router.post('/submit', async (req, res) => {
  if (!surveySchoolAccessOk(req.user)) {
    return res.status(403).json(SURVEY_ACCESS_DENIED);
  }

  const matchTypeIn = req.body?.matchType ?? req.body?.match_type;
  if (matchTypeIn != null) {
    return res.status(400).json({
      error:
        'matchType은 더 이상 이 엔드포인트에서 받지 않습니다. 로맨스 설문만 `POST /api/survey/submit`, 친구는 `POST /api/survey/friend/submit`을 사용하세요.',
    });
  }
  if (req.body?.friendHobbySurvey != null || req.body?.friend_hobby_survey != null) {
    return res.status(400).json({
      error:
        'friendHobbySurvey는 로맨스 설문 엔드포인트에서 받지 않습니다. 친구 설문은 `POST /api/survey/friend/submit`과 고정 스키마(`mainHobby` 등)를 사용하세요.',
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
  const windowValidation = validateSurveyAvailabilityForCurrentWindow(validation.data.availability);
  if (!windowValidation.ok) {
    return res.status(windowValidation.status).json({
      error: windowValidation.error,
      availabilityWindow: windowValidation.window,
    });
  }

  try {
    const surveySubmittedAt = new Date();
    const surveyGender = String(validation.data.gender);
    const txResult = await prisma.$transaction(async (tx) => {
      const savedTrait = await tx.trait.upsert({
        where: { id: req.user.id },
        create: {
          id: req.user.id,
          surveyData: validation.data,
          gender: surveyGender,
          surveySubmittedAt,
        },
        update: {
          surveyData: validation.data,
          gender: surveyGender,
          surveySubmittedAt,
        },
        select: { id: true },
      });
      const weekly = await upsertWeeklySurveySubmission(tx, {
        identityId: req.user.id,
        surveyData: validation.data,
        gender: surveyGender,
        submittedAt: surveySubmittedAt,
        availabilityWindow: windowValidation.window,
      });

      const profileCols = identityProfileColumnsFromSurveyData(validation.data);
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
      action: 'TRAIT_SURVEY_UPDATE',
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
        console.warn('survey first-week friendtalk skipped:', miss);
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
            console.error('survey submit first-week friendtalk error:', notifyErr);
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
      console.error('survey submit kakao pin error:', pinErr);
    }

    return res.status(200).json({
      message: '설문 결과가 저장되었습니다.',
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
    console.error('survey submit error:', err);
    return res.status(500).json({ error: '설문 저장 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
