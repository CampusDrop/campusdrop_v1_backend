const axios = require('axios');
const { prisma } = require('./prisma');
const { surveyDataToLifestyleUser } = require('./surveyToLifestyleUser');
const { getMatchingBatchMatchUrl } = require('./resolveMatchingServiceUrl');
const { sendWeeklyMatchAlimtalkMock } = require('./kakaoAlimtalk');
const { writeAccessLog } = require('./accessLog');

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
        select: { id: true, kakaoId: true },
      },
    },
  });
  return traits.filter(
    (t) =>
      t.surveyData !== null &&
      t.surveyData !== undefined &&
      typeof t.surveyData === 'object' &&
      t.identity,
  );
}

/**
 * Python `/batch-match` 호출 → DB `matchings` 저장 → kakaoId 있는 유저에 알림톡(Mock).
 */
async function runWeeklyBatchMatch() {
  const traits = await loadEligibleTraits();
  if (traits.length < 2) {
    console.warn('[weeklyBatchMatch] 설문이 있는 유저가 2명 미만이라 스킵합니다.', traits.length);
    return { skipped: true, reason: 'not_enough_users', count: traits.length };
  }

  const url = getMatchingBatchMatchUrl();
  const body = {
    users: traits.map((t) => ({
      user_id: t.id,
      profile: surveyDataToLifestyleUser(/** @type {Record<string, unknown>} */ (t.surveyData)),
    })),
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
      throw new Error(`BATCH_MATCH_HTTP_${status}`);
    }
    pairs = Array.isArray(data.pairs) ? data.pairs : [];
  } catch (err) {
    console.error('[weeklyBatchMatch] 요청 실패:', err.message);
    throw err;
  }

  const matchedAt = new Date();
  const insertRows = pairs
    .map((p) => {
      const score = typeof p.score === 'number' ? p.score : Number(p.score);
      if (!Number.isFinite(score) || !p.user_a_id || !p.user_b_id) return null;
      return {
        userAId: p.user_a_id,
        userBId: p.user_b_id,
        score,
        matchedAt,
      };
    })
    .filter(Boolean);
  if (insertRows.length > 0) {
    await prisma.matching.createMany({ data: insertRows });
  }

  const notifyIds = new Set();
  for (const p of pairs) {
    notifyIds.add(p.user_a_id);
    notifyIds.add(p.user_b_id);
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
        context: { pairCount: pairs.length, matchedAt: matchedAt.toISOString() },
      });
    }
  }

  await writeAccessLog({
    actorType: 'job',
    actorId: null,
    action: 'WEEKLY_BATCH_MATCH',
    resource: 'batch-match',
    ip: null,
    userAgent: null,
    metadata: { pairCount: insertRows.length, userCount: traits.length, pythonUrl: url },
  });

  console.log(
    `[weeklyBatchMatch] 완료: 유저 ${traits.length}명, 쌍 ${insertRows.length}건, 알림 대상(kakaoId 보유) 처리`,
  );
  return { skipped: false, userCount: traits.length, pairCount: insertRows.length };
}

module.exports = { runWeeklyBatchMatch, loadEligibleTraits };
