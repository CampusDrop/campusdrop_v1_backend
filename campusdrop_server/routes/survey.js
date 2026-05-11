const express = require('express');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../lib/prisma');
const {
  validateSurveyPayload,
  identityProfileColumnsFromSurveyData,
} = require('../lib/surveyValidation');
const { validateSurveyAvailabilityForCurrentWindow } = require('../lib/surveyAvailabilityWindow');
const { upsertWeeklySurveySubmission } = require('../lib/weeklySurveySubmission');
const { writeAccessLog } = require('../lib/accessLog');
const { storePinForIdentity } = require('../lib/pinSession');
const { surveySchoolAccessOk, SURVEY_ACCESS_DENIED } = require('../lib/surveyAccess');
const { encryptPhoneForStorage, decryptPhoneFromStorage } = require('../lib/phoneCrypto');
const { assertSolapiFriendTalkEnv, sendFriendTalkCta } = require('../lib/solapiFriendTalkSend');
const templates = require('../lib/friendTalkTemplates');
const { publicApiBase, buildAcquisitionButtons } = require('../lib/friendTalkRsvp');
const { normalizeMatchType, resolveMatchTypeOrDefault } = require('../lib/matchType');

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
 * `Trait` 한 행 → `GET /api/survey/me` JSON 본문.
 * @param {string} userId `Identity.id` (= `Trait.id`)
 * @param {{
 *   surveyData: unknown;
 *   gender: string | null;
 *   surveySubmittedAt: Date | string | null;
 *   updatedAt: Date | string;
 * } | null} row
 */
function surveyMePayloadFromTraitRow(userId, row) {
  const hasSurvey = Boolean(
    row &&
      row.surveyData !== null &&
      row.surveyData !== undefined &&
      typeof row.surveyData === 'object',
  );
  return {
    userId,
    hasSurvey,
    surveyData: hasSurvey ? row.surveyData : null,
    gender: row?.gender ?? null,
    surveySubmittedAt: row?.surveySubmittedAt
      ? new Date(row.surveySubmittedAt).toISOString()
      : null,
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

/**
 * @openapi
 * /api/survey/me:
 *   get:
 *     tags: [Survey]
 *     summary: 현재 세션에 저장된 설문 본문(`Trait.surveyData`) 조회
 *     description: |
 *       **인증:** `x-user-uuid` (미들웨어 `requireUserUuid`).
 *
 *       **응답 요약**
 *       - `hasSurvey` / `surveyData`: `Trait.surveyData`가 객체로 있으면 저장됨으로 간주. 없으면 `hasSurvey` false, `surveyData` null.
 *       - `gender`: `Trait.gender` (저장된 설문 기준).
 *       - `surveySubmittedAt`, `updatedAt`: ISO 8601 문자열 또는 null.
 *
 *       **403:** 학교 소속 미충족(`surveySchoolAccessOk` false)이거나, 이메일·증빙 없이 `imageUuidAccessUntil`만 쓰는 계정에서 그 기한 만료 시 `IMAGE_UUID_ACCESS_EXPIRED` 등.
 *
 *       설문 **제출 가능 기간·날짜 선택지**는 인증 없이 `GET /api/survey/availability-window` 참고.
 *     security:
 *       - UserUuidAuth: []
 *     responses:
 *       200:
 *         description: 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SurveyCurrentResponse'
 *       401:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       403:
 *         description: 이메일 없음 + 이미지 세션 무효·만료, 또는 `IMAGE_UUID_ACCESS_EXPIRED`
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       500:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.get('/me', async (req, res) => {
  if (!surveySchoolAccessOk(req.user)) {
    return res.status(403).json(SURVEY_ACCESS_DENIED);
  }

  try {
    const row = await prisma.trait.findUnique({
      where: { id: req.user.id },
      select: { surveyData: true, gender: true, surveySubmittedAt: true, updatedAt: true },
    });

    const body = surveyMePayloadFromTraitRow(req.user.id, row);

    await writeAccessLog({
      actorType: 'user_session',
      actorId: req.user.id,
      action: 'TRAIT_SURVEY_READ',
      resource: 'GET /api/survey/me',
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { hasSurvey: body.hasSurvey },
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
 *           학교 이메일·승인된 증빙·유효한 이미지 가입 세션 없음. 또는 설문·매칭 라우트에서 `IMAGE_UUID_ACCESS_EXPIRED`
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
  if (!surveySchoolAccessOk(req.user)) {
    return res.status(403).json(SURVEY_ACCESS_DENIED);
  }

  const { surveyData, survey } = req.body ?? {};
  const matchTypeIn = req.body?.matchType ?? req.body?.match_type;
  const payload = surveyData ?? survey;
  const matchType = resolveMatchTypeOrDefault(matchTypeIn);

  if (matchTypeIn != null && !normalizeMatchType(matchTypeIn)) {
    return res.status(400).json({ error: 'matchType은 ROMANCE 또는 FRIEND 여야 합니다.' });
  }

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
        matchType,
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
      try {
        const miss = assertSolapiFriendTalkEnv();
        if (miss) {
          console.warn('survey first-week friendtalk skipped:', miss);
        } else {
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
        }
      } catch (notifyErr) {
        console.error('survey submit first-week friendtalk error:', notifyErr);
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
