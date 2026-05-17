'use strict';

const { prisma } = require('./prisma');
const { writeAccessLog } = require('./accessLog');
const { recordAdminBatchMatchRun } = require('./recordAdminBatchMatchRun');
const {
  getMatchingPeriodStart,
  deleteFriendGroupMatchingsForPeriod,
  getForbiddenPairTuplesForFriendGroupBatch,
} = require('./matchPolicy');
const { buildSurveySubmissionWindowForApplicationPeriod } = require('./surveyAvailabilityWindow');
const { surveyDataToAvailabilitySlots } = require('./surveyAvailabilitySlots');
const { loadEligibleWeeklyTraits } = require('./eligibleWeeklyTraits');
const { MATCH_TYPE_FRIEND } = require('./matchType');
const { runFriendGroupBatchPlan, uniqueSlotRefsOfUser, numericHour } = require('./friendGroupBatchEngine');
const { assignCafesToFriendGroupRows } = require('./cafeAssignment');
const { buildFriendMatchMatchedDecisionV1 } = require('./friendMatchDecision');
const { kstWallClockToUtc } = require('./kstMeetingInstant');

/**
 * 주간 친구 매칭: 소그룹(3·4명) 저장. Python `/batch-match` 미사용.
 * @param {{
 *   actorType?: string,
 *   actorId?: string | null,
 *   requestIp?: string | null,
 *   requestUserAgent?: string | null,
 *   prismaClient?: import('@prisma/client').PrismaClient,
 * }} options
 */
async function runFriendGroupWeeklyBatch(options = {}) {
  const startedAt = new Date();
  const actorType = options.actorType || 'job';
  const actorId = options.actorId !== undefined ? options.actorId : null;
  const logAction = actorType === 'admin' ? 'ADMIN_BATCH_MATCH' : 'WEEKLY_BATCH_MATCH';
  const periodStartForBatch = getMatchingPeriodStart();
  const prismaClient = options.prismaClient || prisma;

  /** @param {{ reason: string, batchTraitsCount?: number, eligibleSurveyCount?: number }} sk */
  const finishSkipped = async (sk) => {
    const finishedAt = new Date();
    await recordAdminBatchMatchRun({
      matchType: MATCH_TYPE_FRIEND,
      periodStart: periodStartForBatch,
      startedAt,
      finishedAt,
      status: 'skipped',
      pairCount: 0,
      eligibleCount: sk.eligibleSurveyCount ?? 0,
      batchTraitsCount: sk.batchTraitsCount ?? 0,
      skipReason: sk.reason,
      actorType,
      actorId,
      metadata: {
        submissionWindow: buildSurveySubmissionWindowForApplicationPeriod(periodStartForBatch),
      },
    });
    await writeAccessLog({
      actorType,
      actorId,
      action: logAction,
      resource: 'friend-group-batch',
      ip: options.requestIp || null,
      userAgent: options.requestUserAgent || null,
      metadata: {
        skipped: true,
        skipReason: sk.reason,
        matchType: MATCH_TYPE_FRIEND,
        periodStart: periodStartForBatch.toISOString(),
        batchTraitsCount: sk.batchTraitsCount,
        eligibleSurveyCount: sk.eligibleSurveyCount,
      },
    });
  };

  try {
    const traits = await loadEligibleWeeklyTraits({
      prismaClient,
      periodStart: periodStartForBatch,
      matchType: MATCH_TYPE_FRIEND,
    });
    const submissionWindow = buildSurveySubmissionWindowForApplicationPeriod(periodStartForBatch);

    if (traits.length < 3) {
      console.warn('[friendGroupWeeklyBatch] 신청자 3명 미만이라 스킵합니다.', traits.length);
      await finishSkipped({
        reason: 'not_enough_users',
        eligibleSurveyCount: traits.length,
        batchTraitsCount: traits.length,
      });
      return {
        skipped: true,
        matchType: MATCH_TYPE_FRIEND,
        reason: 'not_enough_users',
        count: traits.length,
        submissionWindow,
      };
    }

    /** @type {Parameters<typeof runFriendGroupBatchPlan>[0]['participants']} */
    const participants = [];
    for (const t of traits) {
      const data = /** @type {Record<string, unknown>} */ (t.surveyData);
      const mainHobby = typeof data.mainHobby === 'string' ? data.mainHobby.trim() : '';
      const mainHobbyDetail =
        typeof data.mainHobbyDetail === 'string' ? data.mainHobbyDetail.trim() : '';
      const favoriteFood =
        typeof data.favoriteFood === 'string' ? data.favoriteFood.trim() : '';
      const slots = surveyDataToAvailabilitySlots(data);
      participants.push({
        id: t.id,
        submittedAt:
          t.surveySubmittedAt instanceof Date
            ? t.surveySubmittedAt.toISOString()
            : String(t.surveySubmittedAt),
        slots,
        slotRefs: uniqueSlotRefsOfUser(slots),
        mainHobby,
        mainHobbyDetail,
        favoriteFood,
      });
    }

    const forbiddenTuples = await getForbiddenPairTuplesForFriendGroupBatch(
      prismaClient,
      periodStartForBatch,
    );

    const { groups, matchedIds } = runFriendGroupBatchPlan({
      participants,
      forbiddenPairTuples: forbiddenTuples,
      log: (...args) => console.log(...args),
    });

    const leftover = participants.filter((p) => !matchedIds.has(p.id));
    if (leftover.length > 0) {
      console.log(
        '[friendGroupWeeklyBatch] 미매칭 로그',
        JSON.stringify({
          periodStart: periodStartForBatch.toISOString(),
          unmatchedCount: leftover.length,
        }),
      );
    }

    const participantMeta = new Map(participants.map((p) => [p.id, p]));

    /** @type {Array<{ slotKey: string | null, slot: { date: string, time_slot: string }, score: number, meetingStartsAt?: Date|null, cafeId?: string|null, meetingVenueName?: string|null, matchDecision: unknown, memberIds: string[] }>} */
    const inserts = [];

    for (const g of groups) {
      const h = numericHour(g.slot);
      let slotKey = null;
      if (g.slot?.date != null && h !== null && !Number.isNaN(h)) {
        slotKey = `${g.slot.date}|${String(h).padStart(2, '0')}`;
      }

      /** @type {Date | undefined} */
      let meetingStartsAt;
      if (g.slot.date && h !== null && !Number.isNaN(h)) {
        const inst = kstWallClockToUtc(g.slot.date, h);
        if (inst) meetingStartsAt = inst;
      }

      const membersBySubmittedAtAsc = g.memberIds.map((id) => {
        const p = participantMeta.get(id);
        return {
          identityId: id,
          submittedAt: p ? p.submittedAt : new Date(0).toISOString(),
        };
      });

      const gs = /** @type {3 | 4} */ (g.memberIds.length === 4 ? 4 : 3);
      const matchDecision = buildFriendMatchMatchedDecisionV1({
        lane: g.lane,
        mainHobby: g.mainHobby,
        mainHobbyDetail: g.mainHobbyDetail,
        favoriteFood: g.favoriteFood,
        slot: g.slot,
        minAvailableCount: g.minAvailableCount,
        groupSizeChosen: gs,
        membersBySubmittedAtAsc,
      });

      inserts.push({
        slotKey,
        slot: g.slot,
        score: gs,
        meetingStartsAt: meetingStartsAt || null,
        matchDecision,
        memberIds: [...g.memberIds],
      });
    }

    const activeCafes = await prismaClient.cafe.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true },
    });

    assignCafesToFriendGroupRows(inserts, activeCafes);

    await prismaClient.$transaction(async (tx) => {
      await deleteFriendGroupMatchingsForPeriod(tx, periodStartForBatch);
      for (const row of inserts) {
        await tx.friendGroupMatching.create({
          data: {
            periodStart: periodStartForBatch,
            matchedAt: new Date(),
            meetingStartsAt: row.meetingStartsAt,
            cafeId: row.cafeId ?? null,
            meetingVenueName: row.meetingVenueName ?? null,
            matchDecision:
              typeof row.matchDecision === 'object' && row.matchDecision !== null
                ? /** @type {import('@prisma/client').Prisma.InputJsonValue} */ (
                    /** @type {object} */ (row.matchDecision)
                  )
                : {},
            members: {
              create: row.memberIds.map((identityId, sortOrder) => ({ identityId, sortOrder })),
            },
          },
        });
      }
    });

    const notifyIds = new Set();
    for (const row of inserts) {
      for (const id of row.memberIds) notifyIds.add(id);
    }
    const matchedIdentityRows =
      notifyIds.size > 0
        ? await prismaClient.identity.findMany({
            where: { id: { in: [...notifyIds] } },
            select: { id: true, kakaoId: true, kakaoLinkPin: true },
          })
        : [];
    const identityById = new Map(matchedIdentityRows.map((row) => [row.id, row]));

    const matches = inserts.map((row) => ({
      friendGroupMembers: row.memberIds,
      memberKakaoIds: row.memberIds.map((id) => identityById.get(id)?.kakaoId ?? null),
      matchDecision: row.matchDecision ?? null,
    }));

    const finishedAt = new Date();
    await recordAdminBatchMatchRun({
      matchType: MATCH_TYPE_FRIEND,
      periodStart: periodStartForBatch,
      startedAt,
      finishedAt,
      status: 'success',
      pairCount: inserts.length,
      eligibleCount: traits.length,
      batchTraitsCount: traits.length,
      actorType,
      actorId,
      metadata: {
        submissionWindow,
        activeCafeCount: activeCafes.length,
        friendGroupCreated: inserts.length,
        unmatchedCount: leftover.length,
      },
    });

    await writeAccessLog({
      actorType,
      actorId,
      action: logAction,
      resource: 'friend-group-batch',
      ip: options.requestIp || null,
      userAgent: options.requestUserAgent || null,
      metadata: {
        friendGroupCount: inserts.length,
        userCount: traits.length,
        matchType: MATCH_TYPE_FRIEND,
        periodStart: periodStartForBatch.toISOString(),
      },
    });

    console.log(
      `[friendGroupWeeklyBatch] 완료: 그룹 ${inserts.length}건, 신청 ${traits.length}명, 카페 ${activeCafes.length}개, 미매칭 ${leftover.length}명(로그)`,
    );

    return {
      skipped: false,
      matchType: MATCH_TYPE_FRIEND,
      userCount: traits.length,
      eligibleSurveyCount: traits.length,
      submissionWindow,
      pairCount: inserts.length,
      friendGroupCount: inserts.length,
      activeCafeCount: activeCafes.length,
      matches,
    };
  } catch (err) {
    const finishedAt = new Date();
    await recordAdminBatchMatchRun({
      matchType: MATCH_TYPE_FRIEND,
      periodStart: periodStartForBatch,
      startedAt,
      finishedAt,
      status: 'error',
      actorType,
      actorId,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

module.exports = { runFriendGroupWeeklyBatch };
