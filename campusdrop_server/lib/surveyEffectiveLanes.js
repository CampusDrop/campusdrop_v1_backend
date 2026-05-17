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

/** RDS 등에서 `$queryRaw` IN 바인딩이 `text`로 들어가 `uuid = text`(42883)가 나지 않도록 캐스팅한다. */
function uuidListForRawIn(identityIds) {
  return Prisma.join(identityIds.map((id) => Prisma.sql`CAST(${id} AS uuid)`));
}

/** 주간 설문 테이블이 아직 마이그레이션되지 않은 등으로 조회 불가할 때만 true (그 외는 상위로 전파). */
function isWeeklySnapshotLayerUnavailable(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const code = err instanceof Prisma.PrismaClientKnownRequestError ? err.code : null;

  const mentionsWeeklyTable =
    /weekly_survey_submissions/i.test(msg) || /friend_weekly_survey_submissions/i.test(msg);

  /* 테이블 자체 없음(P2021) — 다른 모델의 P2021을 삼키지 않도록 이름을 확인합니다. */
  if (code === 'P2021') {
    return (
      mentionsWeeklyTable ||
      (/does not exist/i.test(msg) && /survey_submission/i.test(msg) && /weekly/i.test(msg))
    );
  }
  if (code === 'P2010' && mentionsWeeklyTable) {
    return true;
  }
  if (mentionsWeeklyTable && /does not exist/i.test(msg)) {
    return true;
  }

  /* 기존 friend 전용 폴백과 동일한 휴리스틱(메시지에 테이블명이 안 잡히는 클라이언트 대비). */
  if (/friend_weekly_survey_submissions/i.test(msg)) {
    return true;
  }
  if (/does not exist/i.test(msg) && /friend/i.test(msg)) {
    return true;
  }

  return false;
}

/**
 * @template T
 * @param {string} label
 * @param {() => Promise<T>} loadFn
 * @returns {Promise<T>}
 */
async function weeklyRowsOrEmpty(label, loadFn) {
  try {
    return await loadFn();
  } catch (err) {
    if (!isWeeklySnapshotLayerUnavailable(err)) {
      throw err;
    }
    console.error(
      `effectiveLanesByIdentityIds: ${label} unavailable (migrate DB?); lane falls back to trait-only`,
      err,
    );
    return /** @type {T} */ ([]);
  }
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
    WHERE identity_id IN (${uuidListForRawIn(identityIds)})
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
    WHERE identity_id IN (${uuidListForRawIn(identityIds)})
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

  const [romanceTargetRows, friendTargetRows, latestRomanceRows, latestFriendRows] =
    await Promise.all([
      weeklyRowsOrEmpty('romance target submissions', loadRomanceTargetRows),
      weeklyRowsOrEmpty('friend target submissions', loadFriendTargetRows),
      weeklyRowsOrEmpty('latest romance weekly', loadLatestRomanceRows),
      weeklyRowsOrEmpty('latest friend weekly', loadLatestFriendRows),
    ]);

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
