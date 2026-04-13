const axios = require('axios');
const { prisma } = require('./prisma');
const { surveyDataToLifestyleUser } = require('./surveyToLifestyleUser');
const { getMatchingBatchMatchUrl } = require('./resolveMatchingServiceUrl');
const { sendWeeklyMatchAlimtalkMock } = require('./kakaoAlimtalk');
const { writeAccessLog } = require('./accessLog');
const {
  MIN_MATCH_SCORE,
  getMatchingPeriodStart,
  getForbiddenPairTuplesForBatch,
  deleteMatchingsForUsersInPeriod,
} = require('./matchPolicy');
const { slimMatchReportForDb } = require('./slimMatchReport');
const { isBinaryTraitGender, normalizeTraitGender } = require('./genderPolicy');

const DEFAULT_BATCH_TIMEOUT_MS = 120_000;

function batchTimeoutMs() {
  const n = Number(process.env.MATCHING_BATCH_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BATCH_TIMEOUT_MS;
}

/**
 * Trait에 설문이 있는 유저만 배치 대상.
 */
async function loadEligibleTraits() {
  const traits = await prisma.trait.findMany({
    include: {
      identity: {
        select: { id: true, email: true, kakaoId: true, blockedAt: true, createdAt: true },
      },
    },
  });
  return traits.filter(
    (t) =>
      t.surveyData !== null &&
      t.surveyData !== undefined &&
      typeof t.surveyData === 'object' &&
      t.identity &&
      !t.identity.blockedAt,
  );
}

/**
 * Python `/batch-match` 호출 → DB `matchings` 저장 → kakaoId 있는 유저에 알림톡(Mock).
 * @param {{ actorType?: string, actorId?: string | null, requestIp?: string | null, requestUserAgent?: string | null }} [options] 관리자 실행 시 `actorType: 'admin'`, `actorId`: Admin.id
 */
async function runWeeklyBatchMatch(options = {}) {
  const actorType = options.actorType || 'job';
  const actorId = options.actorId !== undefined ? options.actorId : null;
  const logAction = actorType === 'admin' ? 'ADMIN_BATCH_MATCH' : 'WEEKLY_BATCH_MATCH';
  const traits = await loadEligibleTraits();
  if (traits.length < 2) {
    console.warn('[weeklyBatchMatch] 설문이 있는 유저가 2명 미만이라 스킵합니다.', traits.length);
    return { skipped: true, reason: 'not_enough_users', count: traits.length };
  }

  const batchTraits = traits.filter((t) => isBinaryTraitGender(t.gender));
  if (batchTraits.length < 2) {
    console.warn(
      '[weeklyBatchMatch] 남/여 성별이 모두 있는 유저가 2명 미만이라 스킵합니다.',
      batchTraits.length,
      '/',
      traits.length,
    );
    return {
      skipped: true,
      reason: 'not_enough_binary_gender_users',
      count: batchTraits.length,
      eligibleSurveyCount: traits.length,
    };
  }

  const url = getMatchingBatchMatchUrl();
  const periodStartForBatch = getMatchingPeriodStart();
  let forbiddenPairs;
  try {
    forbiddenPairs = await getForbiddenPairTuplesForBatch(prisma, periodStartForBatch);
  } catch (err) {
    console.error('[weeklyBatchMatch] forbidden pairs load error:', err);
    throw err;
  }

  const body = {
    users: batchTraits.map((t) => ({
      user_id: t.id,
      gender: normalizeTraitGender(t.gender),
      profile: surveyDataToLifestyleUser(/** @type {Record<string, unknown>} */ (t.surveyData)),
    })),
    forbidden_pairs: forbiddenPairs,
  };

  let pairs;
  try {
    const { data, status } = await axios.post(url, body, {
      timeout: batchTimeoutMs(),
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });
    if (status < 200 || status >= 300) {
      console.error('[weeklyBatchMatch] Python 오류', { status, url, data });
      if (status === 422 && data != null) {
        const s = typeof data === 'string' ? data : JSON.stringify(data);
        throw new Error(`BATCH_MATCH_HTTP_422:${s.slice(0, 1500)}`);
      }
      throw new Error(`BATCH_MATCH_HTTP_${status}`);
    }
    pairs = Array.isArray(data.pairs) ? data.pairs : [];
  } catch (err) {
    console.error('[weeklyBatchMatch] 요청 실패:', err.message);
    throw err;
  }

  const matchedAt = new Date();
  const periodStart = periodStartForBatch;
  const insertRows = pairs
    .map((p) => {
      const score = typeof p.score === 'number' ? p.score : Number(p.score);
      if (!Number.isFinite(score) || !p.user_a_id || !p.user_b_id) return null;
      if (score < MIN_MATCH_SCORE) return null;
      const matchReport = slimMatchReportForDb(score, p.match_report);
      return {
        userAId: p.user_a_id,
        userBId: p.user_b_id,
        score,
        matchedAt,
        periodStart,
        matchReport,
      };
    })
    .filter(Boolean);
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
      select: { id: true, kakaoId: true },
    });
    for (const row of identities) {
      if (!row.kakaoId) continue;
      await sendWeeklyMatchAlimtalkMock({
        identityId: row.id,
        kakaoId: row.kakaoId,
        context: { pairCount: insertRows.length, matchedAt: matchedAt.toISOString() },
      });
    }
  }

  await writeAccessLog({
    actorType,
    actorId,
    action: logAction,
    resource: 'batch-match',
    ip: options.requestIp || null,
    userAgent: options.requestUserAgent || null,
    metadata: {
      pairCount: insertRows.length,
      userCount: batchTraits.length,
      eligibleSurveyCount: traits.length,
      pythonUrl: url,
      periodStart: insertRows.length > 0 ? insertRows[0].periodStart?.toISOString?.() ?? null : null,
    },
  });

  console.log(
    `[weeklyBatchMatch] 완료: 배치대상(남/여) ${batchTraits.length}명(설문보유 ${traits.length}명), 쌍 ${insertRows.length}건, 알림 대상(kakaoId 보유) 처리`,
  );
  return {
    skipped: false,
    userCount: batchTraits.length,
    eligibleSurveyCount: traits.length,
    pairCount: insertRows.length,
  };
}

module.exports = { runWeeklyBatchMatch, loadEligibleTraits };
