const axios = require('axios');
const { prisma } = require('./prisma');
const { normalizeDepartment } = require('./departments');
const { surveyDataToLifestyleUser } = require('./surveyToLifestyleUser');
const { surveyDataToAvailabilitySlots } = require('./surveyAvailabilitySlots');
const { getMatchingBatchMatchUrl } = require('./resolveMatchingServiceUrl');
const { sendWeeklyMatchAlimtalkMock } = require('./kakaoAlimtalk');
const { writeAccessLog } = require('./accessLog');
const {
  MIN_MATCH_SCORE,
  getMatchingPeriodStart,
  getForbiddenPairTuplesForBatch,
  getSamePeriodLockedPairTuplesExceptUser,
  deleteMatchingsForUsersInPeriod,
} = require('./matchPolicy');
const {
  buildSurveySubmissionWindowForApplicationPeriod,
  getSurveyTargetPeriodStartForApplicationPeriod,
} = require('./surveyAvailabilityWindow');
const { slimMatchReportForDb } = require('./slimMatchReport');
const { meetingStartsAtFromMatchReport } = require('./meetingStartsAtDerive');
const { isBinaryTraitGender, normalizeTraitGender } = require('./genderPolicy');
const { assignCafesToPairs } = require('./cafeAssignment');

const DEFAULT_BATCH_TIMEOUT_MS = 300_000;

function batchTimeoutMs() {
  const n = Number(process.env.MATCHING_BATCH_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BATCH_TIMEOUT_MS;
}

/**
 * 목표 매칭 주 직전 신청 기간에 설문을 제출한 유저만 배치 대상.
 * @param {{ prismaClient?: import('@prisma/client').PrismaClient, periodStart?: Date }} [options]
 */
async function loadEligibleTraits(options = {}) {
  const prismaClient = options.prismaClient || prisma;
  const periodStart = options.periodStart || getMatchingPeriodStart();
  const targetPeriodStart = getSurveyTargetPeriodStartForApplicationPeriod(periodStart);
  const submissions = await prismaClient.weeklySurveySubmission.findMany({
    where: { targetPeriodStart },
    include: {
      identity: {
        select: {
          id: true,
          nickname: true,
          email: true,
          kakaoId: true,
          kakaoLinkPin: true,
          birthYear: true,
          department: true,
          blockedAt: true,
          createdAt: true,
        },
      },
    },
  });
  return submissions
    .map((s) => ({
      id: s.identityId,
      gender: s.gender,
      surveyData: s.surveyData,
      surveySubmittedAt: s.submittedAt,
      updatedAt: s.updatedAt,
      targetPeriodStart: s.targetPeriodStart,
      targetPeriodEnd: s.targetPeriodEnd,
      identity: s.identity,
    }))
    .filter(
      (t) =>
        t.surveyData !== null &&
        t.surveyData !== undefined &&
        typeof t.surveyData === 'object' &&
        t.identity &&
        !t.identity.blockedAt,
    );
}

/**
 * 설문·비차단 유저를 로드한 뒤 남/여만 골라 Python `/batch-match`를 호출한다.
 * (점수 내림차순 그리디는 Python 쪽과 동일. 각 유저에 `availability` 슬롯 배열을 포함해 시간 겹침을 적용한다.)
 *
 * @param {import('@prisma/client').PrismaClient} prismaClient
 * @param {Date} periodStart
 * @param {{ lockSamePeriodPairsExceptUserId?: string | null, maxMatchesPerSlot?: number | null }} [options]
 *   - lockSamePeriodPairsExceptUserId: 실시간 매칭 시 이번 주 타인의 짝을 금지 쌍에 합침.
 *   - maxMatchesPerSlot: 슬롯당 최대 쌍 수(활성 카페 수). 생략 시 Python 기본값(2) 사용.
 * @returns {Promise<{ pairs: any[], skipped: boolean, skipReason?: string, batchTraitsCount: number, eligibleSurveyCount: number, url: string }>}
 */
async function fetchPythonBatchPairs(prismaClient, periodStart, options = {}) {
  const { lockSamePeriodPairsExceptUserId = null, maxMatchesPerSlot = null } = options;
  const url = getMatchingBatchMatchUrl();
  const submissionWindow = buildSurveySubmissionWindowForApplicationPeriod(periodStart);
  const traits = await loadEligibleTraits({ prismaClient, periodStart });
  if (traits.length < 2) {
    return {
      pairs: [],
      skipped: true,
      skipReason: 'not_enough_users',
      batchTraitsCount: 0,
      eligibleSurveyCount: traits.length,
      submissionWindow,
      url,
    };
  }

  const batchTraits = traits.filter((t) => isBinaryTraitGender(t.gender));
  if (batchTraits.length < 2) {
    return {
      pairs: [],
      skipped: true,
      skipReason: 'not_enough_binary_gender_users',
      batchTraitsCount: batchTraits.length,
      eligibleSurveyCount: traits.length,
      submissionWindow,
      url,
    };
  }

  let forbiddenPairs;
  try {
    forbiddenPairs = await getForbiddenPairTuplesForBatch(prismaClient, periodStart);
  } catch (err) {
    console.error('[fetchPythonBatchPairs] forbidden pairs load error:', err);
    throw err;
  }

  /** @type {string[][]} */
  let mergedForbidden = forbiddenPairs.slice();
  if (lockSamePeriodPairsExceptUserId) {
    let locked;
    try {
      locked = await getSamePeriodLockedPairTuplesExceptUser(
        prismaClient,
        periodStart,
        lockSamePeriodPairsExceptUserId,
      );
    } catch (err) {
      console.error('[fetchPythonBatchPairs] same-period locked pairs load error:', err);
      throw err;
    }
    const seen = new Set(mergedForbidden.map(([a, b]) => `${a}|${b}`));
    for (const [a, b] of locked) {
      const k = `${a}|${b}`;
      if (!seen.has(k)) {
        seen.add(k);
        mergedForbidden.push([a, b]);
      }
    }
  }

  const body = {
    users: batchTraits.map((t) => ({
      user_id: t.id,
      gender: normalizeTraitGender(t.gender),
      profile: surveyDataToLifestyleUser(/** @type {Record<string, unknown>} */ (t.surveyData)),
      department: normalizeDepartment(t.identity?.department),
      birth_year: parseBirthYearForMatch(t.identity?.birthYear),
      partner_age_preference: partnerAgePreferenceFromSurveyData(t.surveyData),
      availability: surveyDataToAvailabilitySlots(/** @type {Record<string, unknown>} */ (t.surveyData)),
    })),
    forbidden_pairs: mergedForbidden,
  };
  if (Number.isInteger(maxMatchesPerSlot) && maxMatchesPerSlot >= 1) {
    body.max_matches_per_slot = maxMatchesPerSlot;
  }

  try {
    const { data, status } = await axios.post(url, body, {
      timeout: batchTimeoutMs(),
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });
    if (status < 200 || status >= 300) {
      console.error('[fetchPythonBatchPairs] Python 오류', { status, url, data });
      if (status === 422 && data != null) {
        const s = typeof data === 'string' ? data : JSON.stringify(data);
        throw new Error(`BATCH_MATCH_HTTP_422:${s.slice(0, 1500)}`);
      }
      throw new Error(`BATCH_MATCH_HTTP_${status}`);
    }
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    return {
      pairs,
      skipped: false,
      batchTraitsCount: batchTraits.length,
      eligibleSurveyCount: traits.length,
      submissionWindow,
      url,
    };
  } catch (err) {
    console.error('[fetchPythonBatchPairs] 요청 실패:', err.message);
    throw err;
  }
}

/**
 * Python `/batch-match` 호출 → DB `matchings` 저장 → kakaoId 있는 유저에 알림톡(Mock).
 * @param {{ actorType?: string, actorId?: string | null, requestIp?: string | null, requestUserAgent?: string | null }} [options] 관리자 실행 시 `actorType: 'admin'`, `actorId`: Admin.id
 */
async function runWeeklyBatchMatch(options = {}) {
  const actorType = options.actorType || 'job';
  const actorId = options.actorId !== undefined ? options.actorId : null;
  const logAction = actorType === 'admin' ? 'ADMIN_BATCH_MATCH' : 'WEEKLY_BATCH_MATCH';
  const periodStartForBatch = getMatchingPeriodStart();
  const activeCafes = await prisma.cafe.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true },
  });
  if (activeCafes.length === 0) {
    console.warn(
      '[weeklyBatchMatch] 활성 카페가 없습니다. matchings에 cafe_id/meeting_venue_name이 비어 저장됩니다. 관리자 콘솔에서 카페를 등록해 주세요.',
    );
  }
  const maxMatchesPerSlot = activeCafes.length > 0 ? activeCafes.length : null;
  const fetched = await fetchPythonBatchPairs(prisma, periodStartForBatch, { maxMatchesPerSlot });

  if (fetched.skipped) {
    if (fetched.skipReason === 'not_enough_users') {
      console.warn('[weeklyBatchMatch] 설문이 있는 유저가 2명 미만이라 스킵합니다.', fetched.eligibleSurveyCount);
      return {
        skipped: true,
        reason: 'not_enough_users',
        count: fetched.eligibleSurveyCount,
        submissionWindow: fetched.submissionWindow,
      };
    }
    if (fetched.skipReason === 'not_enough_binary_gender_users') {
      console.warn(
        '[weeklyBatchMatch] 남/여 성별이 모두 있는 유저가 2명 미만이라 스킵합니다.',
        fetched.batchTraitsCount,
        '/',
        fetched.eligibleSurveyCount,
      );
      return {
        skipped: true,
        reason: 'not_enough_binary_gender_users',
        count: fetched.batchTraitsCount,
        eligibleSurveyCount: fetched.eligibleSurveyCount,
        submissionWindow: fetched.submissionWindow,
      };
    }
  }

  const pairs = fetched.pairs;
  const url = fetched.url;
  const submissionWindow = fetched.submissionWindow;
  const batchTraitsCount = fetched.batchTraitsCount;
  const traitsCount = fetched.eligibleSurveyCount;

  const matchedAt = new Date();
  const periodStart = periodStartForBatch;
  const insertRows = pairs
    .map((p) => {
      const score = typeof p.score === 'number' ? p.score : Number(p.score);
      if (!Number.isFinite(score) || !p.user_a_id || !p.user_b_id) return null;
      if (score < MIN_MATCH_SCORE) return null;
      const matchReport = slimMatchReportForDb(score, p.match_report);
      const meetingStartsAt = meetingStartsAtFromMatchReport(matchReport);
      const row = {
        userAId: p.user_a_id,
        userBId: p.user_b_id,
        score,
        matchedAt,
        periodStart,
        matchReport,
      };
      if (meetingStartsAt) {
        row.meetingStartsAt = meetingStartsAt;
      }
      return row;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  // 슬롯별 라운드로빈으로 카페 배정. matchedSlot이 없는 행은 카페·이름 미설정.
  assignCafesToPairs(insertRows, activeCafes);

  if (insertRows.length > 0) {
    const userIds = [...new Set(insertRows.flatMap((r) => [r.userAId, r.userBId]))];
    await prisma.$transaction(async (tx) => {
      await deleteMatchingsForUsersInPeriod(tx, periodStart, userIds);
      await tx.matching.createMany({ data: insertRows });
    });
  }

  const notifyIds = new Set();
  for (const row of insertRows) {
    notifyIds.add(row.userAId);
    notifyIds.add(row.userBId);
  }

  if (notifyIds.size > 0) {
    const identities = await prisma.identity.findMany({
      where: { id: { in: [...notifyIds] } },
      select: { id: true, kakaoId: true, kakaoLinkPin: true },
    });
    for (const row of identities) {
      await sendWeeklyMatchAlimtalkMock({
        identityId: row.id,
        kakaoId: row.kakaoId,
        context: { pairCount: insertRows.length, matchedAt: matchedAt.toISOString() },
      });
    }
  }

  const matchedIdentityRows =
    notifyIds.size > 0
      ? await prisma.identity.findMany({
          where: { id: { in: [...notifyIds] } },
          select: { id: true, kakaoId: true, kakaoLinkPin: true },
        })
      : [];
  const identityById = new Map(matchedIdentityRows.map((row) => [row.id, row]));
  const matches = insertRows.map((row) => {
    const userA = identityById.get(row.userAId);
    const userB = identityById.get(row.userBId);
    return {
      userAId: row.userAId,
      userBId: row.userBId,
      userAKakaoId: userA?.kakaoId ?? null,
      userBKakaoId: userB?.kakaoId ?? null,
      userAKakaoLinkPin: userA?.kakaoLinkPin ?? null,
      userBKakaoLinkPin: userB?.kakaoLinkPin ?? null,
      score: row.score,
      matchReport: row.matchReport ?? null,
    };
  });

  await writeAccessLog({
    actorType,
    actorId,
    action: logAction,
    resource: 'batch-match',
    ip: options.requestIp || null,
    userAgent: options.requestUserAgent || null,
    metadata: {
      pairCount: insertRows.length,
      userCount: batchTraitsCount,
      eligibleSurveyCount: traitsCount,
      pythonUrl: url,
      periodStart: insertRows.length > 0 ? insertRows[0].periodStart?.toISOString?.() ?? null : null,
      submissionWindow,
      activeCafeCount: activeCafes.length,
      cafesAssignedCount: insertRows.filter((r) => r.cafeId).length,
    },
  });

  console.log(
    `[weeklyBatchMatch] 완료: 배치대상(남/여) ${batchTraitsCount}명(설문보유 ${traitsCount}명), 쌍 ${insertRows.length}건, 카페 ${activeCafes.length}개, 알림 대상 처리`,
  );
  return {
    skipped: false,
    userCount: batchTraitsCount,
    eligibleSurveyCount: traitsCount,
    submissionWindow,
    pairCount: insertRows.length,
    activeCafeCount: activeCafes.length,
    matches,
  };
}

const PARTNER_AGE_PREF_ALLOWED = new Set(['OLDER', 'YOUNGER', 'SAME_AGE']);

/** @param {unknown} value Identity.birthYear 등 */
function parseBirthYearForMatch(value) {
  if (value === undefined || value === null || value === '') return null;
  const y = Number(String(value).trim());
  if (!Number.isInteger(y) || y < 1900 || y > new Date().getUTCFullYear()) return null;
  return y;
}

/**
 * phase6_partner_preferences.partner_age_preference 복수 선택.
 * @param {unknown} surveyData
 * @returns {string[] | null} 미존재·비어 있으면 null(Python에서 전 연령 허용)
 */
function partnerAgePreferenceFromSurveyData(surveyData) {
  if (surveyData === null || typeof surveyData !== 'object' || Array.isArray(surveyData)) return null;
  const phases = /** @type {Record<string, unknown>} */ (surveyData).surveyAnswers;
  if (!phases || typeof phases !== 'object' || Array.isArray(phases)) return null;
  const block = /** @type {Record<string, unknown>} */ (phases).phase6_partner_preferences;
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  const raw = block.partner_age_preference;
  if (!Array.isArray(raw)) return null;
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    const x = raw[i];
    if (typeof x === 'string' && PARTNER_AGE_PREF_ALLOWED.has(x)) out.push(x);
  }
  return out.length ? out : null;
}

module.exports = {
  runWeeklyBatchMatch,
  loadEligibleTraits,
  fetchPythonBatchPairs,
  parseBirthYearForMatch,
  partnerAgePreferenceFromSurveyData,
};
