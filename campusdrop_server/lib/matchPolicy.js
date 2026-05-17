/**
 * Python `final_score` 기준. 미만이면 실시간 매칭 응답·배치 DB 저장 모두 제외.
 */
const MIN_MATCH_SCORE = 50;
const { MATCH_TYPE_ROMANCE, MATCH_TYPE_FRIEND } = require('./matchType');
const { resolveMeetingStartsAt } = require('./meetingStartsAtDerive');
const { CHAT_OPEN_AFTER_MS, isWithinUserChatWindow } = require('./meetChatRoom');

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
async function getHistoricalPartnerIds(prisma, selfId, matchType = MATCH_TYPE_ROMANCE) {
  const rows = await prisma.matching.findMany({
    where: { matchType, OR: [{ userAId: selfId }, { userBId: selfId }] },
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
async function getForbiddenPairTuplesForBatch(prisma, periodStart, matchType = MATCH_TYPE_ROMANCE) {
  const pe = getMatchingPeriodEnd(periodStart);
  const rows = await prisma.matching.findMany({
    where: {
      matchType,
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
async function getSamePeriodLockedPairTuplesExceptUser(
  prisma,
  periodStart,
  exceptUserId,
  matchType = MATCH_TYPE_ROMANCE,
) {
  const pe = getMatchingPeriodEnd(periodStart);
  const rows = await prisma.matching.findMany({
    where: {
      matchType,
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
async function getUserIdsMatchedInPeriod(prisma, periodStart, matchType = MATCH_TYPE_ROMANCE) {
  const pe = getMatchingPeriodEnd(periodStart);
  const rows = await prisma.matching.findMany({
    where: {
      matchType,
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

  if (matchType === MATCH_TYPE_FRIEND) {
    const gRows = await prisma.friendGroupMember.findMany({
      where: {
        matching: {
          periodStart,
        },
      },
      select: { identityId: true },
    });
    for (const rr of gRows) {
      set.add(rr.identityId);
    }
  }

  return set;
}

/**
 * 같은 매칭 주·주어진 유저 집합이 관련된 행만 삭제(배치/실시간 덮어쓰기 전).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Date} periodStart
 * @param {string[]} userIds
 */
async function deleteMatchingsForUsersInPeriod(
  prisma,
  periodStart,
  userIds,
  matchType = MATCH_TYPE_ROMANCE,
) {
  if (userIds.length === 0) return;
  const pe = getMatchingPeriodEnd(periodStart);
  await prisma.matching.deleteMany({
    where: {
      AND: [
        {
          matchType,
        },
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

/** 이번 `period_start` 해당 주 친구 소그룹 행 삭제 후 재배치할 때 사용. */
async function deleteFriendGroupMatchingsForPeriod(prisma, periodStart) {
  await prisma.friendGroupMatching.deleteMany({ where: { periodStart } });
}

/**
 * 해당 매칭 주에 `userIds` 중 한 명이라도 포함된 친구 소그룹 매칭 행을 삭제합니다(멤버는 cascade).
 * 강제 재배치·관리 삭제 시 이중 소속을 막기 위해 사용합니다.
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} prisma
 * @param {Date} periodStart
 * @param {string[]} userIds
 * @returns {Promise<{ deletedGroupIds: string[] }>}
 */
async function deleteFriendGroupMatchingsTouchingUsers(prisma, periodStart, userIds) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return { deletedGroupIds: [] };

  const members = await prisma.friendGroupMember.findMany({
    where: {
      identityId: { in: ids },
      matching: { periodStart },
    },
    select: { friendGroupMatchingId: true },
  });
  const groupIds = [...new Set(members.map((m) => m.friendGroupMatchingId))];
  if (groupIds.length === 0) return { deletedGroupIds: [] };

  await prisma.friendGroupMatching.deleteMany({ where: { id: { in: groupIds } } });
  return { deletedGroupIds: groupIds };
}

/**
 * FRIEND 레거시 1:1 `matchings` + 과거 모든 `friend_group_matchings`(이번 주 제외) 속 쌍.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Date} periodStart
 * @returns {Promise<string[][]>}
 */
async function getForbiddenPairTuplesForFriendGroupBatch(prisma, periodStart) {
  const base = await getForbiddenPairTuplesForBatch(prisma, periodStart, MATCH_TYPE_FRIEND);
  const seen = new Set(base.map(([a, b]) => `${a}|${b}`));
  /** @type {string[][]} */
  const out = [...base];
  const groups = await prisma.friendGroupMatching.findMany({
    where: { NOT: { periodStart } },
    select: { members: { select: { identityId: true } } },
  });
  for (const g of groups) {
    const ids = g.members.map((m) => m.identityId);
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const [lo, hi] = [ids[i], ids[j]].sort();
        const key = `${lo}|${hi}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([lo, hi]);
      }
    }
  }
  return out;
}

/**
 * 주간 소그룹 매칭: 본인이 속한 행 멤버십(+그룹·동료 회원 포함).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} userId
 * @param {Date} periodStart
 */
async function findUserFriendGroupMembershipInPeriod(prisma, userId, periodStart) {
  return prisma.friendGroupMember.findFirst({
    where: {
      identityId: userId,
      matching: { periodStart },
    },
    include: {
      matching: {
        include: {
          cafe: { select: { id: true, name: true, naverPlaceUrl: true, isActive: true } },
          members: {
            orderBy: { sortOrder: 'asc' },
            include: { identity: { select: { id: true, nickname: true } } },
          },
        },
      },
    },
  });
}

/** @type {import('@prisma/client').Prisma.MatchingSelect} */
const USER_MATCHING_MEET_CHAT_SELECT = {
  id: true,
  userAId: true,
  userBId: true,
  score: true,
  matchedAt: true,
  meetingStartsAt: true,
  meetingVenueName: true,
  cafeId: true,
  periodStart: true,
  matchReport: true,
  userA: { select: { id: true, nickname: true } },
  userB: { select: { id: true, nickname: true } },
  cafe: { select: { id: true, name: true, naverPlaceUrl: true, isActive: true } },
};

/**
 * 현재 매칭 운영 주(`periodStart` ~)에 사용자가 포함된 `Matching` 1건(있을 때).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} userId `Identity.id`
 * @param {Date} periodStart `getMatchingPeriodStart()`와 동일 기준
 */
async function findUserMatchingInPeriod(
  prisma,
  userId,
  periodStart,
  matchType = MATCH_TYPE_ROMANCE,
) {
  const pe = getMatchingPeriodEnd(periodStart);
  return prisma.matching.findFirst({
    where: {
      AND: [
        { OR: [{ userAId: userId }, { userBId: userId }] },
        { matchType },
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
    select: USER_MATCHING_MEET_CHAT_SELECT,
  });
}

/** `my-qr-token` 등: 최근 매칭만 스캔(과거 이력 폭주 방지). */
const MEET_CHAT_CANDIDATE_LIMIT = 40;

/**
 * `/api/meet-chat/my-qr-token` 등: `matchingId` 없이 본인 짝을 찾을 때 사용.
 * 운영 주(`periodStart`)와 무관하게 **소개팅 시각** 기준으로 고릅니다.
 * - 채팅 종료 시각(`정각 + CHAT_OPEN_AFTER`)이 지난 약속은 제외
 * - 여러 후보 중 지금 채팅 창이 열린 행 우선, 없으면 가장 빠른 약속 1건
 * 강제 매칭·지난주 배정·이번주 미팅 등 주 경계에 덜 취약합니다.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} userId
 * @param {string} [matchType]
 * @param {Date} [now]
 */
async function findUserMatchingForMeetChat(prisma, userId, matchType = MATCH_TYPE_ROMANCE, now = new Date()) {
  const candidates = await prisma.matching.findMany({
    where: { matchType, OR: [{ userAId: userId }, { userBId: userId }] },
    select: USER_MATCHING_MEET_CHAT_SELECT,
    orderBy: { matchedAt: 'desc' },
    take: MEET_CHAT_CANDIDATE_LIMIT,
  });

  const tNow = now.getTime();
  /** @type {Array<{ row: (typeof candidates)[number], meetingAt: Date }>} */
  const stillRelevant = [];
  for (const row of candidates) {
    const meetingAt = resolveMeetingStartsAt(row);
    if (!meetingAt || Number.isNaN(meetingAt.getTime())) continue;
    if (meetingAt.getTime() + CHAT_OPEN_AFTER_MS < tNow) continue;
    stillRelevant.push({ row, meetingAt });
  }
  if (stillRelevant.length === 0) return null;

  for (const x of stillRelevant) {
    if (isWithinUserChatWindow(now, x.meetingAt)) return x.row;
  }
  stillRelevant.sort((a, b) => a.meetingAt.getTime() - b.meetingAt.getTime());
  return stillRelevant[0].row;
}

module.exports = {
  MIN_MATCH_SCORE,
  MATCHING_PERIOD_ANCHOR_ISO,
  getMatchingPeriodAnchor,
  getMatchingPeriodStart,
  getMatchingPeriodEnd,
  getHistoricalPartnerIds,
  getForbiddenPairTuplesForBatch,
  getForbiddenPairTuplesForFriendGroupBatch,
  getSamePeriodLockedPairTuplesExceptUser,
  getUserIdsMatchedInPeriod,
  deleteMatchingsForUsersInPeriod,
  findUserFriendGroupMembershipInPeriod,
  deleteFriendGroupMatchingsForPeriod,
  deleteFriendGroupMatchingsTouchingUsers,
  findUserMatchingInPeriod,
  findUserMatchingForMeetChat,
};
