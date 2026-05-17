const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const { getMatchingPeriodStart } = require('./matchPolicy');
const { getSurveyTargetPeriodStartForApplicationPeriod } = require('./surveyAvailabilityWindow');

function hasJsonSurvey(value) {
  return Boolean(
    value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value),
  );
}

function isoOrNull(d) {
  return d ? new Date(d).toISOString() : null;
}

/** @param {{ id: string; targetPeriodStart: Date; targetPeriodEnd: Date; submittedAt: Date } | null} row */
function weeklySummaryFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    targetPeriodStart: new Date(row.targetPeriodStart).toISOString(),
    targetPeriodEnd: new Date(row.targetPeriodEnd).toISOString(),
    submittedAt: new Date(row.submittedAt).toISOString(),
  };
}

/**
 * Trait JSON이 비어 있을 때 같은 레인의 가장 최근 주간 스냅샷으로 설문 본문을 보강합니다.
 * (`GET /api/survey/me*` 와 동일 규칙)
 */
function buildRomanceLane(traitRow, weeklyForTargetWeek, latestWeekly) {
  const fromTrait = hasJsonSurvey(traitRow?.surveyData);
  const data = fromTrait
    ? traitRow.surveyData
    : latestWeekly && hasJsonSurvey(latestWeekly.surveyData)
      ? latestWeekly.surveyData
      : null;
  const hasSurvey = hasJsonSurvey(data);
  const submittedAt = fromTrait ? traitRow?.surveySubmittedAt : latestWeekly?.submittedAt ?? null;
  return {
    hasSurvey,
    surveyData: hasSurvey ? data : null,
    gender: traitRow?.gender ?? null,
    surveySubmittedAt: isoOrNull(submittedAt),
    updatedAt: isoOrNull(submittedAt),
    weeklySubmittedForTargetWeek: Boolean(weeklyForTargetWeek),
    latestWeeklySubmission: weeklySummaryFromRow(latestWeekly),
  };
}

function buildFriendLane(traitRow, weeklyForTargetWeek, latestWeekly) {
  const fromTrait = hasJsonSurvey(traitRow?.friendSurveyData);
  const data = fromTrait
    ? traitRow.friendSurveyData
    : latestWeekly && hasJsonSurvey(latestWeekly.surveyData)
      ? latestWeekly.surveyData
      : null;
  const hasSurvey = hasJsonSurvey(data);
  const submittedAt = fromTrait
    ? traitRow?.friendSurveySubmittedAt
    : latestWeekly?.submittedAt ?? null;
  return {
    hasSurvey,
    surveyData: hasSurvey ? data : null,
    gender: traitRow?.gender ?? null,
    surveySubmittedAt: isoOrNull(submittedAt),
    updatedAt: isoOrNull(submittedAt),
    weeklySubmittedForTargetWeek: Boolean(weeklyForTargetWeek),
    latestWeeklySubmission: weeklySummaryFromRow(latestWeekly),
  };
}

/** @param {import('@prisma/client').PrismaClient} prismaClient */
function loadLatestRomanceWeekly(identityId, prismaClient = prisma) {
  return prismaClient.weeklySurveySubmission.findFirst({
    where: { identityId },
    orderBy: { submittedAt: 'desc' },
    select: {
      id: true,
      targetPeriodStart: true,
      targetPeriodEnd: true,
      submittedAt: true,
      surveyData: true,
    },
  });
}

/** @param {import('@prisma/client').PrismaClient} prismaClient */
function loadLatestFriendWeekly(identityId, prismaClient = prisma) {
  return prismaClient.friendWeeklySurveySubmission.findFirst({
    where: { identityId },
    orderBy: { submittedAt: 'desc' },
    select: {
      id: true,
      targetPeriodStart: true,
      targetPeriodEnd: true,
      submittedAt: true,
      surveyData: true,
    },
  });
}

/**
 * @param {string[]} identityIds
 * @param {import('@prisma/client').PrismaClient} prismaClient
 */
async function fetchLatestRomanceWeeklyRowsForIdentities(identityIds, prismaClient) {
  if (identityIds.length === 0) return [];
  return prismaClient.$queryRaw`
    SELECT DISTINCT ON (identity_id)
      identity_id AS "identityId",
      id,
      target_period_start AS "targetPeriodStart",
      target_period_end AS "targetPeriodEnd",
      submitted_at AS "submittedAt",
      survey_data AS "surveyData"
    FROM weekly_survey_submissions
    WHERE identity_id IN (${Prisma.join(identityIds)})
    ORDER BY identity_id, submitted_at DESC
  `;
}

/**
 * @param {string[]} identityIds
 * @param {import('@prisma/client').PrismaClient} prismaClient
 */
async function fetchLatestFriendWeeklyRowsForIdentities(identityIds, prismaClient) {
  if (identityIds.length === 0) return [];
  return prismaClient.$queryRaw`
    SELECT DISTINCT ON (identity_id)
      identity_id AS "identityId",
      id,
      target_period_start AS "targetPeriodStart",
      target_period_end AS "targetPeriodEnd",
      submitted_at AS "submittedAt",
      survey_data AS "surveyData"
    FROM friend_weekly_survey_submissions
    WHERE identity_id IN (${Prisma.join(identityIds)})
    ORDER BY identity_id, submitted_at DESC
  `;
}

/**
 * `GET /api/survey/me` 와 동일하게 Trait + 최신 주간 스냅샷을 병합한 레인을 여러 Identity에 대해 한 번에 계산합니다.
 *
 * @param {string[]} identityIds
 * @param {{
 *   prismaClient?: import('@prisma/client').PrismaClient,
 *   traitRows?: Array<{
 *     id: string,
 *     surveyData?: unknown,
 *     friendSurveyData?: unknown,
 *     gender?: string | null,
 *     surveySubmittedAt?: Date | null,
 *     friendSurveySubmittedAt?: Date | null,
 *     updatedAt?: Date,
 *   }>,
 * }} [options]
 * @returns {Promise<Map<string, { romance: ReturnType<typeof buildRomanceLane>, friend: ReturnType<typeof buildFriendLane> }>>}
 */
async function effectiveLanesByIdentityIds(identityIds, options = {}) {
  const prismaClient = options.prismaClient ?? prisma;
  const uniq = [...new Set(identityIds.filter(Boolean))];
  const out = new Map();
  if (uniq.length === 0) {
    return out;
  }

  const periodStart = getMatchingPeriodStart();
  const targetPeriodStart = getSurveyTargetPeriodStartForApplicationPeriod(periodStart);

  let traitRows = options.traitRows;
  if (!traitRows) {
    traitRows = await prismaClient.trait.findMany({
      where: { id: { in: uniq } },
      select: {
        id: true,
        surveyData: true,
        friendSurveyData: true,
        gender: true,
        surveySubmittedAt: true,
        friendSurveySubmittedAt: true,
        updatedAt: true,
      },
    });
  }

  const loadRomanceTargetRows = () =>
    prismaClient.weeklySurveySubmission.findMany({
      where: { identityId: { in: uniq }, targetPeriodStart },
      select: {
        id: true,
        identityId: true,
        targetPeriodStart: true,
        targetPeriodEnd: true,
        submittedAt: true,
        surveyData: true,
      },
    });
  const loadFriendTargetRows = () =>
    prismaClient.friendWeeklySurveySubmission.findMany({
      where: { identityId: { in: uniq }, targetPeriodStart },
      select: {
        id: true,
        identityId: true,
        targetPeriodStart: true,
        targetPeriodEnd: true,
        submittedAt: true,
        surveyData: true,
      },
    });
  const loadLatestRomanceRows = () => fetchLatestRomanceWeeklyRowsForIdentities(uniq, prismaClient);
  const loadLatestFriendRows = () => fetchLatestFriendWeeklyRowsForIdentities(uniq, prismaClient);

  let romanceTargetRows;
  let friendTargetRows;
  let latestRomanceRows;
  let latestFriendRows;
  try {
    [romanceTargetRows, friendTargetRows, latestRomanceRows, latestFriendRows] = await Promise.all([
      loadRomanceTargetRows(),
      loadFriendTargetRows(),
      loadLatestRomanceRows(),
      loadLatestFriendRows(),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = err instanceof Prisma.PrismaClientKnownRequestError ? err.code : null;
    const friendWeeklyUnavailable =
      code === 'P2021' ||
      (code === 'P2010' && /friend_weekly_survey_submissions/i.test(msg)) ||
      /friend_weekly_survey_submissions/i.test(msg) ||
      (/does not exist/i.test(msg) && /friend/i.test(msg));
    if (!friendWeeklyUnavailable) {
      throw err;
    }
    console.error(
      'effectiveLanesByIdentityIds: friend weekly submissions unavailable (migrate DB?); friend lane falls back to trait-only',
      err,
    );
    [romanceTargetRows, friendTargetRows, latestRomanceRows, latestFriendRows] = await Promise.all([
      loadRomanceTargetRows(),
      Promise.resolve([]),
      loadLatestRomanceRows(),
      Promise.resolve([]),
    ]);
  }

  const traitById = new Map(traitRows.map((t) => [t.id, t]));
  const romanceTargetById = new Map(romanceTargetRows.map((r) => [r.identityId, r]));
  const friendTargetById = new Map(friendTargetRows.map((r) => [r.identityId, r]));
  const latestRomanceById = new Map(latestRomanceRows.map((r) => [r.identityId, r]));
  const latestFriendById = new Map(latestFriendRows.map((r) => [r.identityId, r]));

  for (const id of uniq) {
    const traitRow = traitById.get(id) ?? null;
    out.set(id, {
      romance: buildRomanceLane(
        traitRow,
        romanceTargetById.get(id) ?? null,
        latestRomanceById.get(id) ?? null,
      ),
      friend: buildFriendLane(
        traitRow,
        friendTargetById.get(id) ?? null,
        latestFriendById.get(id) ?? null,
      ),
    });
  }
  return out;
}

module.exports = {
  hasJsonSurvey,
  buildRomanceLane,
  buildFriendLane,
  loadLatestRomanceWeekly,
  loadLatestFriendWeekly,
  effectiveLanesByIdentityIds,
};
