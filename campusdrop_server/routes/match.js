const express = require('express');
const axios = require('axios');
const { prisma } = require('../lib/prisma');
const { getDummyMatchUsers } = require('../lib/matchDummyUsers');
const { surveyDataToLifestyleUser } = require('../lib/surveyToLifestyleUser');
const { surveyDataToAvailabilitySlots } = require('../lib/surveyAvailabilitySlots');
const { getMatchingCalculateMatchUrl, getMatchingBatchMatchUrl } = require('../lib/resolveMatchingServiceUrl');
const {
  MIN_MATCH_SCORE,
  getMatchingPeriodStart,
  getMatchingPeriodEnd,
  deleteMatchingsForUsersInPeriod,
  findUserMatchingInPeriod,
  findUserFriendGroupMembershipInPeriod,
} = require('../lib/matchPolicy');
const {
  buildSurveySubmissionWindowForApplicationPeriod,
  getSurveyTargetPeriodStartForApplicationPeriod,
} = require('../lib/surveyAvailabilityWindow');
const { fetchPythonBatchPairs } = require('../lib/weeklyBatchMatch');
const { slimMatchReportForDb } = require('../lib/slimMatchReport');
const { meetingStartsAtFromMatchReport } = require('../lib/meetingStartsAtDerive');
const { normalizeTraitGender, traitGenderLabelKo } = require('../lib/genderPolicy');
const {
  MATCH_TYPE_ROMANCE,
  MATCH_TYPE_FRIEND,
} = require('../lib/matchType');

const router = express.Router();

const DEFAULT_MATCH_TIMEOUT_MS = 5_000;

function matchRequestTimeoutMs() {
  const n = Number(process.env.MATCHING_SERVICE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MATCH_TIMEOUT_MS;
}

async function postCalculateMatch(body) {
  const url = getMatchingCalculateMatchUrl();
  const { data, status } = await axios.post(url, body, {
    timeout: matchRequestTimeoutMs(),
    headers: { 'Content-Type': 'application/json' },
    validateStatus: () => true,
  });
  if (status < 200 || status >= 300) {
    return { ok: false, status, data, url };
  }
  return { ok: true, data, url };
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {'ROMANCE' | 'FRIEND'} matchType
 */
async function handleWeekStatus(req, res, matchType) {
  const self = req.user;
  if (matchType === MATCH_TYPE_ROMANCE) {
    if (req.query?.matchType != null || req.query?.match_type != null) {
      return res.status(400).json({
        error:
          'matchType 쿼리는 지원하지 않습니다. 친구 매칭 상태는 GET /api/match/friend/week-status 를 사용하세요.',
      });
    }
  }

  const periodStart = getMatchingPeriodStart();
  const periodEnd = getMatchingPeriodEnd(periodStart);
  const targetPeriodStart = getSurveyTargetPeriodStartForApplicationPeriod(periodStart);
  const meetingTargetPeriodEnd = getMatchingPeriodEnd(targetPeriodStart);
  const submissionWindow = buildSurveySubmissionWindowForApplicationPeriod(periodStart);
  const millisecondsUntilPeriodEnd = Math.max(0, periodEnd.getTime() - Date.now());

  const selfSurvey =
    matchType === MATCH_TYPE_ROMANCE ? self.trait?.surveyData : self.trait?.friendSurveyData;
  const hasSurveyObject =
    selfSurvey !== null && selfSurvey !== undefined && typeof selfSurvey === 'object';
  const selfGender = normalizeTraitGender(self.trait?.gender);

  let weeklySurveySubmittedForTargetWeek = false;
  try {
    const sub =
      matchType === MATCH_TYPE_ROMANCE
        ? await prisma.weeklySurveySubmission.findUnique({
            where: {
              identityId_targetPeriodStart: {
                identityId: self.id,
                targetPeriodStart,
              },
            },
            select: { id: true },
          })
        : await prisma.friendWeeklySurveySubmission.findUnique({
            where: {
              identityId_targetPeriodStart: {
                identityId: self.id,
                targetPeriodStart,
              },
            },
            select: { id: true },
          });
    weeklySurveySubmittedForTargetWeek = Boolean(sub);
  } catch (err) {
    console.error('match week-status weekly survey load error:', err);
    return res.status(500).json({ error: '주차별 설문 제출 여부를 확인하지 못했습니다.' });
  }

  let fgMembership = null;
  try {
    if (matchType === MATCH_TYPE_FRIEND) {
      fgMembership = await findUserFriendGroupMembershipInPeriod(prisma, self.id, periodStart);
    }
  } catch (err) {
    console.error('match week-status friend group load error:', err);
    return res.status(500).json({ error: '매칭 이력을 불러오지 못했습니다.' });
  }

  let row = null;
  try {
    if (!fgMembership) {
      row = await findUserMatchingInPeriod(prisma, self.id, periodStart, matchType);
    }
  } catch (err) {
    console.error('match week-status matching load error:', err);
    return res.status(500).json({ error: '매칭 이력을 불러오지 못했습니다.' });
  }

    matchType === MATCH_TYPE_FRIEND &&
    fgMembership &&
    fgMembership.matching !== null &&
    fgMembership.matching !== undefined
  ) {
    const grp = fgMembership.matching;
    activeFriendGroupThisPeriod = {
      friendGroupMatchingId: grp.id,
      members: grp.members.map((m) => ({
        identityId: m.identity.id,
        nickname: m.identity.nickname,
      })),
      matchedAt: grp.matchedAt.toISOString(),
      meetingStartsAt: grp.meetingStartsAt ? grp.meetingStartsAt.toISOString() : null,
      meetingVenueName: grp.meetingVenueName ?? null,
      cafeId: grp.cafeId ?? null,
      cafe: grp.cafe ?? null,
      matchDecision: grp.matchDecision ?? null,
      periodStartStored: grp.periodStart ? grp.periodStart.toISOString() : null,
    };
  }

  let activeMatchingThisPeriod = null;
  if (!activeFriendGroupThisPeriod && row) {
    const isUserA = row.userAId === self.id;
    const partnerId = isUserA ? row.userBId : row.userAId;
    const partner = isUserA ? row.userB : row.userA;
    const me = isUserA ? row.userA : row.userB;
    activeMatchingThisPeriod = {
      matchingId: row.id,
      partnerId,
      partnerNickname: partner?.nickname ?? null,
      myNickname: me?.nickname ?? null,
      score: row.score,
      matchedAt: row.matchedAt.toISOString(),
      meetingStartsAt: row.meetingStartsAt ? row.meetingStartsAt.toISOString() : null,
      meetingVenueName: row.meetingVenueName ?? null,
      cafeId: row.cafeId ?? null,
      cafe: row.cafe ?? null,
      periodStartStored: row.periodStart ? row.periodStart.toISOString() : null,
    };
  }

  /** @type {string[]} */
  const matchRequestPrecheckMessages = [];
  if (!hasSurveyObject) {
    matchRequestPrecheckMessages.push(
      matchType === MATCH_TYPE_ROMANCE
        ? '설문을 먼저 제출해 주세요.'
        : '친구 설문을 먼저 제출해 주세요.',
    );
  }
  if (matchType === MATCH_TYPE_ROMANCE && !selfGender) {
    matchRequestPrecheckMessages.push(
      '이성 매칭을 위해 설문에 남성/여성 성별이 필요합니다. 설문을 다시 제출해 주세요.',
    );
  }
  if (!weeklySurveySubmittedForTargetWeek) {
    matchRequestPrecheckMessages.push(
      '이번 매칭 주기에 참여하려면 현재 신청 기간에 설문을 제출해 주세요.',
    );
  }

  return res.status(200).json({
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    matchType,
    millisecondsUntilPeriodEnd,
    meetingTargetPeriodStart: targetPeriodStart.toISOString(),
    meetingTargetPeriodEnd: meetingTargetPeriodEnd.toISOString(),
    submissionWindow,
    weeklySurveySubmittedForTargetWeek,
    activeMatchingThisPeriod,
    readyToCallMatchRequest: matchRequestPrecheckMessages.length === 0,
    matchRequestPrecheckMessages,
    activeFriendGroupThisPeriod,
  });
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {'ROMANCE' | 'FRIEND'} matchType
 */
async function handleMatchRequest(req, res, matchType) {
  const self = req.user;

  if (matchType === MATCH_TYPE_FRIEND) {
    return res.status(400).json({
      error: '친구 매칭은 주간 배치로만 진행됩니다. 실시간 매칭 요청은 지원하지 않습니다.',
    });
  }

  if (matchType === MATCH_TYPE_ROMANCE) {
    if (req.body?.matchType != null || req.body?.match_type != null) {
      return res.status(400).json({
        error:
          'matchType은 제거되었습니다. 친구 매칭은 POST /api/match/friend/request 를 사용하세요.',
      });
    }
  }

  const selfSurvey =
    matchType === MATCH_TYPE_ROMANCE ? self.trait?.surveyData : self.trait?.friendSurveyData;
  if (selfSurvey === null || selfSurvey === undefined || typeof selfSurvey !== 'object') {
    return res.status(400).json({
      error:
        matchType === MATCH_TYPE_ROMANCE
          ? '설문을 먼저 제출해 주세요.'
          : '친구 설문을 먼저 제출해 주세요.',
    });
  }

  const selfGender = normalizeTraitGender(self.trait?.gender);
  if (matchType === MATCH_TYPE_ROMANCE && !selfGender) {
    return res.status(400).json({
      error:
        '이성 매칭을 위해 설문에 남성/여성 성별이 필요합니다. 설문을 다시 제출해 주세요.',
    });
  }

  const periodStart = getMatchingPeriodStart();
  const periodEnd = getMatchingPeriodEnd(periodStart);
  const targetPeriodStart = getSurveyTargetPeriodStartForApplicationPeriod(periodStart);
  const submissionWindow = buildSurveySubmissionWindowForApplicationPeriod(periodStart);

  let selfWeeklySubmission;
  try {
    selfWeeklySubmission =
      matchType === MATCH_TYPE_ROMANCE
        ? await prisma.weeklySurveySubmission.findUnique({
            where: {
              identityId_targetPeriodStart: {
                identityId: self.id,
                targetPeriodStart,
              },
            },
            select: { id: true },
          })
        : await prisma.friendWeeklySurveySubmission.findUnique({
            where: {
              identityId_targetPeriodStart: {
                identityId: self.id,
                targetPeriodStart,
              },
            },
            select: { id: true },
          });
  } catch (err) {
    console.error('match request weekly survey load error:', err);
    return res.status(500).json({ error: '주차별 설문 제출 여부를 확인하지 못했습니다.' });
  }
  if (!selfWeeklySubmission) {
    return res.status(400).json({
      error: '이번 매칭 주기에 참여하려면 현재 신청 기간에 설문을 제출해 주세요.',
      submissionWindow,
    });
  }

  /** @type {Awaited<ReturnType<typeof fetchPythonBatchPairs>>} */
  let fetched;
  try {
    fetched = await fetchPythonBatchPairs(prisma, periodStart, {
      lockSamePeriodPairsExceptUserId: self.id,
      matchType,
    });
  } catch (err) {
    console.error('match request batch-match error:', err.message);

    if (axios.isAxiosError(err)) {
      const pyStatus = err.response?.status;
      const pyData = err.response?.data;
      const netCode = err.code || (err.cause && /** @type {NodeJS.ErrnoException} */ (err.cause).code);
      const isRefused = netCode === 'ECONNREFUSED' || /ECONNREFUSED/i.test(String(err.message));
      const hint = isRefused
        ? '호스트에서 Python을 모든 인터페이스에 바인딩하세요. 예: uvicorn app.main:app --host 0.0.0.0 --port 8000 (기본 127.0.0.1만이면 컨테이너·LAN IP 접속이 ECONNREFUSED 됩니다.)'
        : undefined;
      return res.status(502).json({
        error: 'Python 매칭 서비스에 연결할 수 없습니다.',
        pythonUrl: getMatchingBatchMatchUrl(),
        detail: err.message,
        pythonStatus: pyStatus ?? null,
        pythonBody: pyData ?? null,
        ...(hint ? { hint } : {}),
      });
    }

    return res.status(500).json({ error: '매칭 처리 중 서버 오류가 발생했습니다.' });
  }

  if (fetched.skipped) {
    if (fetched.skipReason === 'not_enough_binary_gender_users') {
      return res.status(404).json({
        error: '이성(남성·여성) 조건에 맞는 매칭 후보가 없습니다.',
      });
    }
    if (fetched.skipReason === 'not_enough_users_for_type') {
      return res.status(404).json({
        error: '친구 매칭 후보가 부족합니다.',
      });
    }
    return res.status(404).json({ error: '매칭할 다른 사용자가 없습니다.' });
  }

  const myPair = fetched.pairs.find(
    (p) => p.user_a_id === self.id || p.user_b_id === self.id,
  );

  if (!myPair) {
    return res.status(404).json({
      error:
        '전역 매칭에서 짝이 되지 않았습니다. (인원·하드 필터·과거 매칭 제약 등으로 이번 주기에 배정되지 않았을 수 있습니다.)',
    });
  }

  const score = typeof myPair.score === 'number' ? myPair.score : Number(myPair.score);
  if (!Number.isFinite(score) || score < MIN_MATCH_SCORE) {
    return res.status(404).json({
      error: `매칭 점수 ${MIN_MATCH_SCORE}점 이상인 상대가 없습니다.`,
    });
  }

  const partnerId = myPair.user_a_id === self.id ? myPair.user_b_id : myPair.user_a_id;

  let partner;
  try {
    partner = await prisma.identity.findUnique({
      where: { id: partnerId },
      include: { trait: true },
    });
  } catch (err) {
    console.error('match request partner load error:', err);
    return res.status(500).json({ error: '매칭 상대 정보를 불러오지 못했습니다.' });
  }

  const partnerSurveyOk =
    matchType === MATCH_TYPE_ROMANCE
      ? partner?.trait?.surveyData !== null &&
        partner?.trait?.surveyData !== undefined &&
        typeof partner.trait.surveyData === 'object'
      : partner?.trait?.friendSurveyData !== null &&
        partner?.trait?.friendSurveyData !== undefined &&
        typeof partner.trait.friendSurveyData === 'object';

  if (!partner || !partner.trait || !partnerSurveyOk) {
    return res.status(500).json({ error: '매칭 상대 설문 정보를 찾을 수 없습니다.' });
  }

  const partnerLabel =
    matchType === MATCH_TYPE_ROMANCE ? traitGenderLabelKo(partner.trait?.gender) || '상대' : '친구';
  const partnerNickname =
    typeof partner.nickname === 'string' && partner.nickname.trim() !== '' ? partner.nickname.trim() : null;
  const partnerEmail =
    typeof partner.email === 'string' && partner.email.trim() !== '' ? partner.email.trim() : null;
  const partnerKakaoId =
    typeof partner.kakaoId === 'string' && partner.kakaoId.trim() !== '' ? partner.kakaoId.trim() : null;
  const partnerKakaoLinkPin =
    typeof partner.kakaoLinkPin === 'string' && partner.kakaoLinkPin.trim() !== ''
      ? partner.kakaoLinkPin.trim()
      : null;

  const best = {
    partnerId,
    partnerNickname,
    partnerLabel,
    partnerEmail,
    partnerKakaoId,
    partnerKakaoLinkPin,
    score,
    report: myPair.match_report,
  };

  const [userLo, userHi] = [self.id, partnerId].sort();

  const reportSlim = slimMatchReportForDb(best.score, best.report);
  const meetingStartsAt = meetingStartsAtFromMatchReport(reportSlim);

  try {
    await prisma.$transaction(async (tx) => {
      await deleteMatchingsForUsersInPeriod(tx, periodStart, [self.id, partnerId], matchType);
      await tx.matching.create({
        data: {
          userAId: userLo,
          userBId: userHi,
          matchType,
          score: best.score,
          matchedAt: new Date(),
          periodStart,
          matchReport: reportSlim,
          ...(meetingStartsAt ? { meetingStartsAt } : {}),
        },
      });
    });
  } catch (err) {
    console.error('match request persist error:', err);
    return res.status(500).json({ error: '매칭 결과를 저장하지 못했습니다.' });
  }

  return res.status(200).json({
    partnerId: best.partnerId,
    partnerNickname: best.partnerNickname,
    partnerLabel: best.partnerLabel,
    partnerEmail: best.partnerEmail,
    partnerKakaoId: best.partnerKakaoId,
    partnerKakaoLinkPin: best.partnerKakaoLinkPin,
    score: best.score,
    report: reportSlim,
    matchType,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  });
}

/**
 * @openapi
 * /api/match/test:
 *   get:
 *     tags: [Match]
 *     summary: 더미 5명 순환 매칭 테스트 (Python calculate-match, availability_* 포함)
 *     security:
 *       - UserUuidAuth: []
 *     responses:
 *       200:
 *         description: 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 description: { type: string }
 *                 pythonUrl: { type: string }
 *                 inputUsers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       email: { type: string, nullable: true }
 *                       gender: { type: string, nullable: true }
 *                 comparisons:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       user_A:
 *                         type: object
 *                         properties:
 *                           id: { type: string }
 *                           email: { type: string, nullable: true }
 *                           gender: { type: string, nullable: true }
 *                       user_B:
 *                         type: object
 *                         properties:
 *                           id: { type: string }
 *                           email: { type: string, nullable: true }
 *                           gender: { type: string, nullable: true }
 *                       match:
 *                         type: object
 *                         description: Python CalculateMatchResponse
 *                         additionalProperties: true
 *       401:
 *         description: 세션 무효
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       502:
 *         description: Python 비정상 응답 또는 네트워크 오류
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/MatchTest502Python'
 *                 - $ref: '#/components/schemas/MatchTest502Network'
 *       500:
 *         description: 기타 서버 오류
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.get('/test', async (req, res) => {
  const users = getDummyMatchUsers();
  const url = getMatchingCalculateMatchUrl();

  const pairs = users.map((_, i) => {
    const a = users[i];
    const b = users[(i + 1) % users.length];
    return { user_A: a, user_B: b };
  });

  try {
    const comparisons = [];

    for (const { user_A: ua, user_B: ub } of pairs) {
      const ga = normalizeTraitGender(ua.gender);
      const gb = normalizeTraitGender(ub.gender);
      /** @type {Record<string, unknown>} */
      const body = {
        user_A: surveyDataToLifestyleUser(/** @type {Record<string, unknown>} */ (ua.surveyData)),
        user_B: surveyDataToLifestyleUser(/** @type {Record<string, unknown>} */ (ub.surveyData)),
        availability_a: surveyDataToAvailabilitySlots(/** @type {Record<string, unknown>} */ (ua.surveyData)),
        availability_b: surveyDataToAvailabilitySlots(/** @type {Record<string, unknown>} */ (ub.surveyData)),
        hard_filter_policy: 'fail',
        penalty_per_hard_violation: 30,
      };
      if (ga === 'female' || ga === 'male') body.gender_a = ga;
      if (gb === 'female' || gb === 'male') body.gender_b = gb;

      const py = await postCalculateMatch(body);

      if (!py.ok) {
        return res.status(502).json({
          error: '매칭 서비스가 오류 상태를 반환했습니다.',
          pythonStatus: py.status,
          pythonUrl: py.url,
          pythonBody: py.data,
          failedPair: { user_A_id: ua.id, user_B_id: ub.id },
        });
      }

      comparisons.push({
        user_A: { id: ua.id, email: ua.email ?? null, gender: ua.gender ?? null },
        user_B: { id: ub.id, email: ub.email ?? null, gender: ub.gender ?? null },
        match: py.data,
      });
    }

    return res.status(200).json({
      description: '더미 5명 순환 매칭(인접 쌍 5회). Python POST /calculate-match 응답을 pair별로 포함합니다.',
      pythonUrl: url,
      inputUsers: users.map((u) => ({
        id: u.id,
        email: u.email ?? null,
        gender: u.gender ?? null,
      })),
      comparisons,
    });
  } catch (err) {
    console.error('match /test proxy error:', err.message);

    if (axios.isAxiosError(err)) {
      const pyStatus = err.response?.status;
      const pyData = err.response?.data;
      const netCode = err.code || (err.cause && /** @type {NodeJS.ErrnoException} */ (err.cause).code);
      const isRefused = netCode === 'ECONNREFUSED' || /ECONNREFUSED/i.test(String(err.message));

      /** Docker에서 host.docker.internal → LAN IP로 붙을 때, Python이 127.0.0.1 전용이면 거부됨 */
      const hint = isRefused
        ? '호스트에서 Python을 모든 인터페이스에 바인딩하세요. 예: uvicorn app.main:app --host 0.0.0.0 --port 8000 (기본 127.0.0.1만이면 컨테이너·LAN IP 접속이 ECONNREFUSED 됩니다.)'
        : undefined;

      return res.status(502).json({
        error: 'Python 매칭 서비스에 연결할 수 없습니다.',
        pythonUrl: url,
        detail: err.message,
        pythonStatus: pyStatus ?? null,
        pythonBody: pyData ?? null,
        ...(hint ? { hint } : {}),
      });
    }

    return res.status(500).json({ error: '매칭 테스트 처리 중 서버 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/match/week-status:
 *   get:
 *     tags: [Match]
 *     summary: 로맨스 매칭 주간 상태
 *     description: 친구 매칭은 `GET /api/match/friend/week-status` — `matchType` 쿼리 미지원.
 *     security:
 *       - UserUuidAuth: []
 */
router.get('/week-status', (req, res) => handleWeekStatus(req, res, MATCH_TYPE_ROMANCE));

/**
 * @openapi
 * /api/match/friend/week-status:
 *   get:
 *     tags: [Match]
 *     summary: 친구 매칭 주간 상태
 *     security:
 *       - UserUuidAuth: []
 */
router.get('/friend/week-status', (req, res) => handleWeekStatus(req, res, MATCH_TYPE_FRIEND));

/**
 * @openapi
 * /api/match/request:
 *   post:
 *     tags: [Match]
 *     summary: 로맨스 실시간 매칭 1건
 *     security:
 *       - UserUuidAuth: []
 */
router.post('/request', (req, res) => handleMatchRequest(req, res, MATCH_TYPE_ROMANCE));

/**
 * @openapi
 * /api/match/friend/request:
 *   post:
 *     tags: [Match]
 *     summary: 친구 실시간 매칭 1건
 *     security:
 *       - UserUuidAuth: []
 */
router.post('/friend/request', (req, res) => handleMatchRequest(req, res, MATCH_TYPE_FRIEND));

module.exports = router;
