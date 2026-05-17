const { prisma } = require('./prisma');
const {
  getMatchingPeriodStart,
  getMatchingPeriodEnd,
  getUserIdsMatchedInPeriod,
  findUserFriendGroupMembershipInPeriod,
  resolveApplicationPeriodStart,
} = require('./matchPolicy');
const {
  buildSurveySubmissionWindowForApplicationPeriod,
  buildSurveyAvailabilityWindow,
  getSurveyTargetPeriodStartForApplicationPeriod,
} = require('./surveyAvailabilityWindow');
const { loadEligibleTraits } = require('./weeklyBatchMatch');
const { MATCH_TYPE_FRIEND } = require('./matchType');
const { surveyDataToAvailabilitySlots } = require('./surveyAvailabilitySlots');
const { traitGenderLabelKo, normalizeTraitGender } = require('./genderPolicy');

const MS_PER_WEEK = 7 * 86400000;

/**
 * @param {Date} applicationPeriodStart
 * @param {'FRIEND'} [_matchType]
 */
async function friendWeeklyDistinctSubmitters(applicationPeriodStart) {
  const targetPeriodStart = getSurveyTargetPeriodStartForApplicationPeriod(applicationPeriodStart);
  const rows = await prisma.friendWeeklySurveySubmission.findMany({
    where: { targetPeriodStart },
    distinct: ['identityId'],
    select: { identityId: true },
  });
  return { targetPeriodStart, identityIds: rows.map((r) => r.identityId) };
}

/**
 * @param {Date} applicationPeriodStart
 */
async function computeFriendPeriodKpis(applicationPeriodStart) {
  const periodEnd = getMatchingPeriodEnd(applicationPeriodStart);
  const { targetPeriodStart, identityIds } = await friendWeeklyDistinctSubmitters(applicationPeriodStart);
  const submissionWindow = buildSurveySubmissionWindowForApplicationPeriod(applicationPeriodStart);

  const [eligible, matchedIds, matchedPairsCount, friendGroupCountThisPeriod, verifiedAmong, traitFriendCount] =
    await Promise.all([
    loadEligibleTraits({ periodStart: applicationPeriodStart, matchType: MATCH_TYPE_FRIEND }),
    getUserIdsMatchedInPeriod(prisma, applicationPeriodStart, MATCH_TYPE_FRIEND),
    prisma.matching.count({
      where: {
        matchType: MATCH_TYPE_FRIEND,
        OR: [
          { periodStart: applicationPeriodStart },
          {
            AND: [{ periodStart: null }, { matchedAt: { gte: applicationPeriodStart, lt: periodEnd } }],
          },
        ],
      },
    }),
    prisma.friendGroupMatching.count({
      where: { periodStart: applicationPeriodStart },
    }),
    identityIds.length === 0
      ? 0
      : prisma.identity.count({
          where: {
            id: { in: identityIds },
            schoolProofVerifiedAt: { not: null },
          },
        }),
    prisma.trait.count({
      where: { friendSurveySubmittedAt: { not: null } },
    }),
  ]);

  const eligibleIds = new Set(eligible.map((t) => t.id));
  const waitingUnmatched = eligible.filter((t) => !matchedIds.has(t.id)).length;

  return {
    applicationPeriodStart: applicationPeriodStart.toISOString(),
    meetingTargetPeriodStart: targetPeriodStart.toISOString(),
    submissionWindow,
    kpi: {
      weeklySubmissionsDistinct: identityIds.length,
      schoolVerifiedAmongWeeklySubmitters: verifiedAmong,
      eligibleForBatch: eligible.length,
      matchedUsersInPeriod: matchedIds.size,
      matchedPairs: matchedPairsCount,
      matchedFriendGroups: friendGroupCountThisPeriod,
      waitingUnmatched,
      traitWithFriendSurveyTotal: traitFriendCount,
    },
    funnel: {
      weeklyFriendApplication: identityIds.length,
      schoolVerifiedAmongApplicants: verifiedAmong,
      surveyEligibleForMatching: eligible.length,
      matchedSuccessfully: matchedIds.size,
      failedOrWaitingThisPeriod: waitingUnmatched,
    },
  };
}

/**
 * @param {number} days
 */
async function friendMatchTrends(days = 14) {
  const d = Math.min(Math.max(Number(days) || 14, 1), 90);
  const since = new Date(Date.now() - d * 86400000);

  const [submissions, pairings, groupings, batchRuns] = await Promise.all([
    prisma.$queryRaw`
      SELECT (DATE(s.submitted_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')) AS day, COUNT(*)::int AS count
      FROM friend_weekly_survey_submissions s
      WHERE s.submitted_at >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    prisma.$queryRaw`
      SELECT (DATE(m.matched_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')) AS day, COUNT(*)::int AS count
      FROM matchings m
      WHERE m.match_type = 'FRIEND' AND m.matched_at >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    prisma.$queryRaw`
      SELECT (DATE(g.matched_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')) AS day, COUNT(*)::int AS count
      FROM friend_group_matchings g
      WHERE g.matched_at >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    prisma.adminBatchMatchRun.groupBy({
      by: ['status'],
      where: { matchType: MATCH_TYPE_FRIEND, startedAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  const byDay = /** @type {Record<string, { pair: number, group: number }>} */ ({});
  const rowKey = (/** @type {{ day: unknown, count: unknown } | null} */ row) => {
    if (!row || row.day == null) return null;
    let s;
    const d = /** @type {{ toISOString?: () => string }} | string} */ (row.day);
    if (d && typeof d.toISOString === 'function') s = d.toISOString().slice(0, 10);
    else s = String(row.day).slice(0, 10);
    return s.length >= 10 ? s : null;
  };
  for (const r of pairings) {
    const k = rowKey(/** @type {any} */ (r));
    if (!k) continue;
    byDay[k] = byDay[k] || { pair: 0, group: 0 };
    byDay[k].pair += Number(/** @type {any} */ (r).count) || 0;
  }
  for (const r of groupings) {
    const k = rowKey(/** @type {any} */ (r));
    if (!k) continue;
    byDay[k] = byDay[k] || { pair: 0, group: 0 };
    byDay[k].group += Number(/** @type {any} */ (r).count) || 0;
  }
  const mergedDays = Object.entries(byDay).map(([day, v]) => ({
    day,
    count: v.pair + v.group,
    pairCount: v.pair,
    groupCount: v.group,
  }));

  return {
    days: d,
    since: since.toISOString(),
    friendWeeklySubmissionsByDay: submissions,
    friendMatchingsByDay: mergedDays,
    friendMatchingsLegacyPairsByDay: pairings,
    friendGroupMatchingsByDay: groupings,
    batchRunsByStatus: batchRuns.map((r) => ({ status: r.status, count: r._count._all })),
  };
}

/**
 * @param {Date} applicationPeriodStart
 */
async function friendApplicantDistribution(applicationPeriodStart) {
  const { identityIds, targetPeriodStart } = await friendWeeklyDistinctSubmitters(applicationPeriodStart);
  if (identityIds.length === 0) {
    return {
      meetingTargetPeriodStart: targetPeriodStart.toISOString(),
      byDepartment: [],
      byBirthYear: [],
      mainHobby: [],
    };
  }

  const identities = await prisma.identity.findMany({
    where: { id: { in: identityIds } },
    select: { department: true, birthYear: true },
  });

  /** @type {Map<string, number>} */
  const dept = new Map();
  /** @type {Map<string, number>} */
  const birth = new Map();
  for (const row of identities) {
    const dk = row.department && String(row.department).trim() ? String(row.department).trim() : '(미입력)';
    dept.set(dk, (dept.get(dk) || 0) + 1);
    const bk =
      row.birthYear && String(row.birthYear).trim() ? String(row.birthYear).trim() : '(미입력)';
    birth.set(bk, (birth.get(bk) || 0) + 1);
  }

  const subs = await prisma.friendWeeklySurveySubmission.findMany({
    where: { targetPeriodStart, identityId: { in: identityIds } },
    select: { surveyData: true },
  });
  /** @type {Map<string, number>} */
  const hobby = new Map();
  for (const s of subs) {
    const d = s.surveyData && typeof s.surveyData === 'object' && !Array.isArray(s.surveyData) ? s.surveyData : null;
    const mh = d && typeof (/** @type {Record<string, unknown>} */ (d)).mainHobby === 'string' ? String((/** @type {Record<string, unknown>} */ (d)).mainHobby) : '(알 수 없음)';
    hobby.set(mh, (hobby.get(mh) || 0) + 1);
  }

  const toSortedArr = (m) =>
    [...m.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);

  return {
    meetingTargetPeriodStart: targetPeriodStart.toISOString(),
    weeklySubmitterCount: identityIds.length,
    byDepartment: toSortedArr(dept),
    byBirthYear: toSortedArr(birth),
    mainHobby: toSortedArr(hobby),
  };
}

function availabilityPreview(surveyData) {
  try {
    return surveyDataToAvailabilitySlots(/** @type {Record<string, unknown>} */ (surveyData));
  } catch (_) {
    return [];
  }
}

/**
 * @param {string} identityId
 */
async function friendUserSafetyFlags(identityId) {
  const since = new Date(Date.now() - 28 * 86400000);
  const [friendN, romanceWeeklies, blocked] = await Promise.all([
    prisma.friendWeeklySurveySubmission.count({
      where: { identityId, submittedAt: { gte: since } },
    }),
    prisma.weeklySurveySubmission.count({
      where: { identityId, submittedAt: { gte: since } },
    }),
    prisma.identity.findUnique({
      where: { id: identityId },
      select: { blockedAt: true },
    }),
  ]);
  return {
    blockedAt: blocked?.blockedAt ?? null,
    friendWeeklySubmissionsLast28d: friendN,
    romanceWeeklySubmissionsLast28d: romanceWeeklies,
    frequentFriendResubmit: friendN >= 5,
    laneChurnSuspicion: friendN >= 3 && romanceWeeklies >= 3,
  };
}

/**
 * @param {string} identityId
 */
async function friendUserOverview(identityId) {
  const applicationPeriodStart = getMatchingPeriodStart();
  const targetPeriodStart = getSurveyTargetPeriodStartForApplicationPeriod(applicationPeriodStart);
  const periodEnd = getMatchingPeriodEnd(applicationPeriodStart);
  const submissionWindow = buildSurveySubmissionWindowForApplicationPeriod(applicationPeriodStart);
  const availabilityWindow = buildSurveyAvailabilityWindow();

  const [identity, trait, weeklyRow, activeMatch, matchedIds, safety, fgMem] = await Promise.all([
    prisma.identity.findUnique({
      where: { id: identityId },
      select: {
        id: true,
        nickname: true,
        email: true,
        blockedAt: true,
        schoolProofVerifiedAt: true,
        department: true,
        birthYear: true,
        createdAt: true,
      },
    }),
    prisma.trait.findUnique({
      where: { id: identityId },
      select: {
        gender: true,
        friendSurveyData: true,
        friendSurveySubmittedAt: true,
        surveySubmittedAt: true,
      },
    }),
    prisma.friendWeeklySurveySubmission.findUnique({
      where: {
        identityId_targetPeriodStart: { identityId, targetPeriodStart },
      },
      select: { id: true, submittedAt: true },
    }),
    prisma.matching.findFirst({
      where: {
        matchType: MATCH_TYPE_FRIEND,
        AND: [
          { OR: [{ userAId: identityId }, { userBId: identityId }] },
          {
            OR: [
              { periodStart: applicationPeriodStart },
              {
                AND: [{ periodStart: null }, { matchedAt: { gte: applicationPeriodStart, lt: periodEnd } }],
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
        periodStart: true,
        meetingStartsAt: true,
        meetingVenueName: true,
      },
    }),
    getUserIdsMatchedInPeriod(prisma, applicationPeriodStart, MATCH_TYPE_FRIEND),
    friendUserSafetyFlags(identityId),
    findUserFriendGroupMembershipInPeriod(prisma, identityId, applicationPeriodStart),
  ]);

  if (!identity) {
    return null;
  }

  /** @type {string[]} */
  const blockReasons = [];
  if (identity.blockedAt) {
    blockReasons.push('관리자 차단 계정입니다.');
  }
  if (!identity.schoolProofVerifiedAt) {
    blockReasons.push('학교 인증(증빙 승인)이 완료되지 않았습니다.');
  }

  const hasFriendTrait = Boolean(
    trait?.friendSurveyData &&
      typeof trait.friendSurveyData === 'object' &&
      !Array.isArray(trait.friendSurveyData) &&
      Object.keys(/** @type {Record<string, unknown>} */ (trait.friendSurveyData)).length > 0,
  );

  const canSubmitDuringWindow = availabilityWindow.isOpen && !identity.blockedAt;

  const fgMatching = fgMem?.matching ?? null;

  let matchedPartnerId = null;
  let matchingId = null;
  if (activeMatch && !fgMatching) {
    matchingId = activeMatch.id;
    matchedPartnerId = activeMatch.userAId === identityId ? activeMatch.userBId : activeMatch.userAId;
  }

  return {
    identity: {
      id: identity.id,
      nickname: identity.nickname,
      email: identity.email,
      department: identity.department,
      birthYear: identity.birthYear,
      schoolProofVerifiedAt: identity.schoolProofVerifiedAt,
      blockedAt: identity.blockedAt,
      createdAt: identity.createdAt,
    },
    trait: trait
      ? {
          gender: trait.gender,
          genderLabel: traitGenderLabelKo(trait.gender) || null,
          friendSurveySubmittedAt: trait.friendSurveySubmittedAt,
          romanceSurveySubmittedAt: trait.surveySubmittedAt,
          hasFriendSurvey: hasFriendTrait,
        }
      : null,
    thisWeek: {
      applicationPeriodStart: applicationPeriodStart.toISOString(),
      meetingTargetPeriodStart: targetPeriodStart.toISOString(),
      submissionWindow,
      availabilityWindow: {
        isOpen: availabilityWindow.isOpen,
        applicationClosesAt: availabilityWindow.application.closesAt,
        nextApplicationOpensAt: availabilityWindow.application.nextOpensAt,
      },
      hasFriendWeeklySnapshot: Boolean(weeklyRow),
      weeklySubmittedAt: weeklyRow?.submittedAt?.toISOString() ?? null,
      inMatchedSetThisPeriod: matchedIds.has(identityId),
      activeFriendGroup: fgMatching
        ? {
            friendGroupMatchingId: fgMatching.id,
            matchedAt: fgMatching.matchedAt.toISOString(),
            memberCount: fgMatching.members.length,
            meetingStartsAt: fgMatching.meetingStartsAt ? fgMatching.meetingStartsAt.toISOString() : null,
            meetingVenueName: fgMatching.meetingVenueName,
          }
        : null,
      activeMatching:
        fgMatching || !activeMatch
          ? null
          : {
            matchingId,
            partnerId: matchedPartnerId,
            score: activeMatch.score,
            matchedAt: activeMatch.matchedAt.toISOString(),
            meetingStartsAt: activeMatch.meetingStartsAt ? activeMatch.meetingStartsAt.toISOString() : null,
            meetingVenueName: activeMatch.meetingVenueName,
          },
    },
    participation: {
      canOpenSurveyDuringApplyWindow: canSubmitDuringWindow && Boolean(identity.schoolProofVerifiedAt),
      nextApplicationOpensAt: availabilityWindow.application.nextOpensAt,
      blockReasons,
      summaryLine: blockReasons.length
        ? blockReasons.join(' ')
        : matchedIds.has(identityId)
          ? '이번 친구 매칭 주기에 매칭된 상태입니다.'
          : weeklyRow
            ? '이번 주 친구 설문 제출 완료. 배치/실시간 매칭 대기·진행 중일 수 있습니다.'
            : availabilityWindow.isOpen
              ? '신청 기간 내 — 친구 설문 제출 가능.'
              : `신청 기간이 아닙니다. 다음 오픈: ${availabilityWindow.application.nextOpensAt}`,
    },
    safety,
  };
}

/**
 * @param {string} identityId
 */
async function friendUserTimeline(identityId) {
  const identity = await prisma.identity.findUnique({
    where: { id: identityId },
    select: { id: true, createdAt: true, blockedAt: true, schoolProofVerifiedAt: true },
  });
  if (!identity) {
    return null;
  }

  const [proofs, friendWeeklies, romanceWeeklies, matchings, friendGroupMatchings, adminLogs] = await Promise.all([
    prisma.schoolProofSubmission.findMany({
      where: { identityId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, createdAt: true, reviewedAt: true },
    }),
    prisma.friendWeeklySurveySubmission.findMany({
      where: { identityId },
      orderBy: { submittedAt: 'desc' },
      take: 40,
      select: {
        id: true,
        targetPeriodStart: true,
        targetPeriodEnd: true,
        submittedAt: true,
      },
    }),
    prisma.weeklySurveySubmission.findMany({
      where: { identityId },
      orderBy: { submittedAt: 'desc' },
      take: 20,
      select: { targetPeriodStart: true, submittedAt: true },
    }),
    prisma.matching.findMany({
      where: { matchType: MATCH_TYPE_FRIEND, OR: [{ userAId: identityId }, { userBId: identityId }] },
      orderBy: { matchedAt: 'desc' },
      take: 40,
      select: {
        id: true,
        userAId: true,
        userBId: true,
        score: true,
        matchedAt: true,
        periodStart: true,
        meetingStartsAt: true,
      },
    }),
    prisma.friendGroupMatching.findMany({
      where: { members: { some: { identityId } } },
      orderBy: { matchedAt: 'desc' },
      take: 40,
      select: {
        id: true,
        matchedAt: true,
        periodStart: true,
        meetingStartsAt: true,
        matchDecision: true,
        members: { select: { identityId: true } },
      },
    }),
    prisma.accessLog.findMany({
      where: {
        actorType: 'admin',
        OR: [
          { resource: { contains: identityId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        action: true,
        resource: true,
        metadata: true,
        actorId: true,
        createdAt: true,
      },
    }),
  ]);

  /** @type {{ at: string, type: string, title: string, detail?: unknown }[]} */
  const events = [];

  events.push({
    at: identity.createdAt.toISOString(),
    type: 'identity_created',
    title: '계정 생성',
  });
  if (identity.schoolProofVerifiedAt) {
    events.push({
      at: identity.schoolProofVerifiedAt.toISOString(),
      type: 'school_verified',
      title: '학교 증빙 승인(Identity)',
    });
  }
  if (identity.blockedAt) {
    events.push({
      at: identity.blockedAt.toISOString(),
      type: 'blocked',
      title: '계정 차단',
    });
  }

  for (const p of proofs) {
    events.push({
      at: p.createdAt.toISOString(),
      type: 'school_proof_submitted',
      title: `학교 증빙 제출 (${p.status})`,
      detail: { submissionId: p.id, status: p.status },
    });
    if (p.reviewedAt && p.status !== 'pending') {
      events.push({
        at: p.reviewedAt.toISOString(),
        type: 'school_proof_reviewed',
        title: `학교 증빙 심사: ${p.status}`,
        detail: { submissionId: p.id },
      });
    }
  }

  for (const rw of romanceWeeklies) {
    events.push({
      at: rw.submittedAt.toISOString(),
      type: 'romance_weekly_submitted',
      title: '로맨스 주간 설문 제출(동일 주에 친구 스냅샷과 배타)',
      detail: { targetPeriodStart: rw.targetPeriodStart.toISOString() },
    });
  }

  for (const fw of friendWeeklies) {
    events.push({
      at: fw.submittedAt.toISOString(),
      type: 'friend_weekly_submitted',
      title: '친구 매칭 주간 설문 제출',
      detail: {
        targetPeriodStart: fw.targetPeriodStart.toISOString(),
        targetPeriodEnd: fw.targetPeriodEnd.toISOString(),
      },
    });
  }

  for (const gm of friendGroupMatchings) {
    events.push({
      at: gm.matchedAt.toISOString(),
      type: 'friend_group_matched',
      title: '친구 소그룹 매칭(배치)',
      detail: {
        friendGroupMatchingId: gm.id,
        memberCount: gm.members.length,
        periodStart: gm.periodStart ? gm.periodStart.toISOString() : null,
        meetingStartsAt: gm.meetingStartsAt ? gm.meetingStartsAt.toISOString() : null,
      },
    });
  }

  for (const m of matchings) {
    const partnerId = m.userAId === identityId ? m.userBId : m.userAId;
    events.push({
      at: m.matchedAt.toISOString(),
      type: 'friend_matched',
      title: '친구 매칭 성사(기록)',
      detail: {
        matchingId: m.id,
        partnerId,
        score: m.score,
        periodStart: m.periodStart ? m.periodStart.toISOString() : null,
        meetingStartsAt: m.meetingStartsAt ? m.meetingStartsAt.toISOString() : null,
      },
    });
  }

  for (const log of adminLogs) {
    events.push({
      at: log.createdAt.toISOString(),
      type: 'admin_audit',
      title: log.action,
      detail: {
        accessLogId: log.id,
        resource: log.resource,
        actorId: log.actorId,
        metadata: log.metadata,
      },
    });
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return {
    identityId,
    events,
  };
}

/**
 * @param {number} limit
 * @param {string} [matchType]
 */
async function listBatchRuns(limit = 30, matchType = MATCH_TYPE_FRIEND) {
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 200);
  return prisma.adminBatchMatchRun.findMany({
    where: { matchType },
    orderBy: { startedAt: 'desc' },
    take: lim,
  });
}

/**
 * @param {Date} since
 * @param {string} [matchType]
 */
async function batchRunFailureStats(since, matchType = MATCH_TYPE_FRIEND) {
  const [byStatus, bySkip] = await Promise.all([
    prisma.adminBatchMatchRun.groupBy({
      by: ['status'],
      where: { matchType, startedAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.adminBatchMatchRun.groupBy({
      by: ['skipReason'],
      where: { matchType, startedAt: { gte: since }, status: 'skipped' },
      _count: { _all: true },
    }),
  ]);

  return {
    since: since.toISOString(),
    byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
    skippedByReason: bySkip
      .filter((r) => r.skipReason)
      .map((r) => ({ skipReason: r.skipReason, count: r._count._all })),
  };
}

/** 허용된 런타임 설정 키(친구 매칭 운영). */
const RUNTIME_SETTING_SCHEMA = /** @type {const} */ ({
  'friend_match.user_maintenance_message': { kind: 'string', maxLen: 4000 },
  'friend_match.user_apply_closed_message': { kind: 'string', maxLen: 4000 },
  'friend_match.rematch_weekly_cap': { kind: 'int', min: 0, max: 20 },
  'friend_match.show_maintenance_banner': { kind: 'bool' },
});

async function getFriendRuntimeSettings() {
  const keys = Object.keys(RUNTIME_SETTING_SCHEMA);
  const rows = await prisma.adminRuntimeSetting.findMany({
    where: { key: { in: keys } },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    allowedKeys: Object.keys(RUNTIME_SETTING_SCHEMA),
    settings: map,
  };
}

/**
 * @param {Record<string, unknown>} body
 */
function parseRuntimeSettingsPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: /** @type {const} */ (false), error: '본문은 JSON 객체여야 합니다.' };
  }
  const raw = /** @type {Record<string, unknown>} */ (body).settings ?? body;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: /** @type {const} */ (false), error: 'settings 객체가 필요합니다.' };
  }

  /** @type { { key: string, value: import('@prisma/client').Prisma.InputJsonValue }[] } */
  const upserts = [];
  for (const [key, def] of Object.entries(RUNTIME_SETTING_SCHEMA)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const v = /** @type {Record<string, unknown>} */ (raw)[key];
    if (def.kind === 'string') {
      if (typeof v !== 'string') {
        return { ok: /** @type {const} */ (false), error: `${key}는 문자열이어야 합니다.` };
      }
      if (v.length > def.maxLen) {
        return { ok: /** @type {const} */ (false), error: `${key}는 ${def.maxLen}자 이하여야 합니다.` };
      }
      upserts.push({ key, value: v });
    } else if (def.kind === 'int') {
      const n = Number(v);
      if (!Number.isInteger(n)) {
        return { ok: /** @type {const} */ (false), error: `${key}는 정수여야 합니다.` };
      }
      if (n < def.min || n > def.max) {
        return { ok: /** @type {const} */ (false), error: `${key}는 ${def.min}~${def.max} 범위여야 합니다.` };
      }
      upserts.push({ key, value: n });
    } else if (def.kind === 'bool') {
      if (typeof v !== 'boolean') {
        return { ok: /** @type {const} */ (false), error: `${key}는 boolean이어야 합니다.` };
      }
      upserts.push({ key, value: v });
    }
  }

  if (upserts.length === 0) {
    return { ok: /** @type {const} */ (false), error: '갱신할 알려진 키가 없습니다.' };
  }

  return { ok: /** @type {const} */ (true), upserts };
}

/**
 * @param {Record<string, unknown>} body
 * @param {string} adminId
 */
async function applyFriendRuntimeSettingsPatch(body, adminId) {
  const parsed = parseRuntimeSettingsPatch(body);
  if (!parsed.ok) {
    return { ok: /** @type {const} */ (false), error: parsed.error };
  }
  await prisma.$transaction(
    parsed.upserts.map((u) =>
      prisma.adminRuntimeSetting.upsert({
        where: { key: u.key },
        create: { key: u.key, value: u.value, updatedByAdminId: adminId },
        update: { value: u.value, updatedByAdminId: adminId },
      }),
    ),
  );
  return { ok: /** @type {const} */ (true), updatedKeys: parsed.upserts.map((x) => x.key) };
}

/**
 * @param {{ limit: number, offset: number, actionPrefix?: string }} q
 */
async function listAdminAccessLogs(q) {
  const where = /** @type {import('@prisma/client').Prisma.AccessLogWhereInput} */ ({
    actorType: 'admin',
  });
  if (q.actionPrefix && String(q.actionPrefix).trim()) {
    where.action = { startsWith: String(q.actionPrefix).trim() };
  }
  const [total, rows] = await prisma.$transaction([
    prisma.accessLog.count({ where }),
    prisma.accessLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: q.offset,
      take: q.limit,
      select: {
        id: true,
        actorType: true,
        actorId: true,
        action: true,
        resource: true,
        ip: true,
        metadata: true,
        createdAt: true,
      },
    }),
  ]);
  return { total, logs: rows };
}

module.exports = {
  MS_PER_WEEK,
  resolveApplicationPeriodStart,
  computeFriendPeriodKpis,
  friendMatchTrends,
  friendApplicantDistribution,
  friendUserOverview,
  friendUserTimeline,
  friendUserSafetyFlags,
  listBatchRuns,
  batchRunFailureStats,
  loadEligibleTraits,
  availabilityPreview,
  normalizeTraitGender,
  traitGenderLabelKo,
  getFriendRuntimeSettings,
  applyFriendRuntimeSettingsPatch,
  RUNTIME_SETTING_SCHEMA,
  listAdminAccessLogs,
  getMatchingPeriodStart,
  getMatchingPeriodEnd,
  getSurveyTargetPeriodStartForApplicationPeriod,
  getUserIdsMatchedInPeriod,
};
