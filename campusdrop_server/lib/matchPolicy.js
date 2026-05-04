/**
 * Python `final_score` 기준. 미만이면 실시간 매칭 응답·배치 DB 저장 모두 제외.
 */
const MIN_MATCH_SCORE = 50;

/** 매칭 주기 앵커(매주 동일 시각 기준 7일 구간). KST 2026-04-14 00:00(화요일). */
const MATCHING_PERIOD_ANCHOR_ISO = '2026-04-14T00:00:00.000+09:00';

const MS_PER_WEEK = 7 * 86400000;

function getMatchingPeriodAnchor() {
  return new Date(MATCHING_PERIOD_ANCHOR_ISO);
}

/**
 * `now`가 속한 매칭 주의 시작 시각(앵커부터 7일 단위). 앵커 이전이면 앵커 시각.
 * @param {Date} [now]
 */
function getMatchingPeriodStart(now = new Date()) {
  const anchor = getMatchingPeriodAnchor().getTime();
  const t = now.getTime();
  if (t < anchor) {
    return new Date(anchor);
  }
  const k = Math.floor((t - anchor) / MS_PER_WEEK);
  return new Date(anchor + k * MS_PER_WEEK);
}

/** @param {Date} periodStart */
function getMatchingPeriodEnd(periodStart) {
  return new Date(periodStart.getTime() + MS_PER_WEEK);
}

/**
 * 과거 `matchings`에 한 번이라도 함께 올라간 적 있는 상대 `Identity.id`(전 기간).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} selfId
 */
async function getHistoricalPartnerIds(prisma, selfId) {
  const rows = await prisma.matching.findMany({
    where: { OR: [{ userAId: selfId }, { userBId: selfId }] },
    select: { userAId: true, userBId: true },
  });
  const ids = new Set();
  for (const r of rows) {
    if (r.userAId === selfId) ids.add(r.userBId);
    else ids.add(r.userAId);
  }
  return ids;
}

/**
 * 배치용: 과거에 한 번이라도 매칭된 쌍 `[lo,hi]` (정렬된 UUID 문자열) 목록.
 * **이번 매칭 주**에만 존재하는 행은 제외(같은 주 덮어쓰기·점수 갱신 허용).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Date} periodStart
 * @returns {Promise<string[][]>}
 */
async function getForbiddenPairTuplesForBatch(prisma, periodStart) {
  const pe = getMatchingPeriodEnd(periodStart);
  const rows = await prisma.matching.findMany({
    where: {
      NOT: {
        OR: [
          { periodStart },
          {
            AND: [{ periodStart: null }, { matchedAt: { gte: periodStart, lt: pe } }],
          },
        ],
      },
    },
    select: { userAId: true, userBId: true },
  });
  const seen = new Set();
  /** @type {string[][]} */
  const out = [];
  for (const r of rows) {
    const [lo, hi] = [r.userAId, r.userBId].sort();
    const k = `${lo}|${hi}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([lo, hi]);
  }
  return out;
}

/**
 * 이번 매칭 주에 이미 짝이 된 쌍 중, `exceptUserId`를 포함하지 않는 행만 `[lo,hi]`로 반환.
 * 실시간 `/match/request`에서 전역 그리디를 돌릴 때 타인의 이번 주 짝은 유지하고 싶을 때 금지 쌍으로 합친다.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Date} periodStart
 * @param {string} exceptUserId
 * @returns {Promise<string[][]>}
 */
async function getSamePeriodLockedPairTuplesExceptUser(prisma, periodStart, exceptUserId) {
  const pe = getMatchingPeriodEnd(periodStart);
  const rows = await prisma.matching.findMany({
    where: {
      OR: [
        { periodStart },
        {
          AND: [{ periodStart: null }, { matchedAt: { gte: periodStart, lt: pe } }],
        },
      ],
    },
    select: { userAId: true, userBId: true },
  });
  const seen = new Set();
  /** @type {string[][]} */
  const out = [];
  for (const r of rows) {
    if (r.userAId === exceptUserId || r.userBId === exceptUserId) {
      continue;
    }
    const [lo, hi] = [r.userAId, r.userBId].sort();
    const k = `${lo}|${hi}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([lo, hi]);
  }
  return out;
}

/**
 * 이번 매칭 주(`periodStart`~`periodEnd`) `matchings`에 한 번이라도 올라간 `Identity.id`.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Date} periodStart
 */
async function getUserIdsMatchedInPeriod(prisma, periodStart) {
  const pe = getMatchingPeriodEnd(periodStart);
  const rows = await prisma.matching.findMany({
    where: {
      OR: [
        { periodStart },
        {
          AND: [{ periodStart: null }, { matchedAt: { gte: periodStart, lt: pe } }],
        },
      ],
    },
    select: { userAId: true, userBId: true },
  });
  const set = new Set();
  for (const r of rows) {
    set.add(r.userAId);
    set.add(r.userBId);
  }
  return set;
}

/**
 * 같은 매칭 주·주어진 유저 집합이 관련된 행만 삭제(배치/실시간 덮어쓰기 전).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Date} periodStart
 * @param {string[]} userIds
 */
async function deleteMatchingsForUsersInPeriod(prisma, periodStart, userIds) {
  if (userIds.length === 0) return;
  const pe = getMatchingPeriodEnd(periodStart);
  await prisma.matching.deleteMany({
    where: {
      AND: [
        {
          OR: [
            { periodStart },
            {
              AND: [{ periodStart: null }, { matchedAt: { gte: periodStart, lt: pe } }],
            },
          ],
        },
        {
          OR: [{ userAId: { in: userIds } }, { userBId: { in: userIds } }],
        },
      ],
    },
  });
}

/**
 * 현재 매칭 운영 주(`periodStart` ~)에 사용자가 포함된 `Matching` 1건(있을 때).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} userId `Identity.id`
 * @param {Date} periodStart `getMatchingPeriodStart()`와 동일 기준
 */
async function findUserMatchingInPeriod(prisma, userId, periodStart) {
  const pe = getMatchingPeriodEnd(periodStart);
  return prisma.matching.findFirst({
    where: {
      AND: [
        { OR: [{ userAId: userId }, { userBId: userId }] },
        {
          OR: [
            { periodStart },
            {
              AND: [{ periodStart: null }, { matchedAt: { gte: periodStart, lt: pe } }],
            },
          ],
        },
      ],
    },
    select: {
      id: true,
      userAId: true,
      userBId: true,
      score: true,
      matchedAt: true,
      meetingStartsAt: true,
      periodStart: true,
    },
  });
}

module.exports = {
  MIN_MATCH_SCORE,
  MATCHING_PERIOD_ANCHOR_ISO,
  getMatchingPeriodAnchor,
  getMatchingPeriodStart,
  getMatchingPeriodEnd,
  getHistoricalPartnerIds,
  getForbiddenPairTuplesForBatch,
  getSamePeriodLockedPairTuplesExceptUser,
  getUserIdsMatchedInPeriod,
  deleteMatchingsForUsersInPeriod,
  findUserMatchingInPeriod,
};
