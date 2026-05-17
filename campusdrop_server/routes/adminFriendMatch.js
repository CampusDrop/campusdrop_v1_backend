const express = require('express');
const { prisma } = require('../lib/prisma');
const { writeAccessLog } = require('../lib/accessLog');
const {
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
  listAdminAccessLogs,
  getMatchingPeriodStart,
  getMatchingPeriodEnd,
  getUserIdsMatchedInPeriod,
  MS_PER_WEEK,
} = require('../lib/adminFriendMatchDashboard');
const { runWeeklyBatchMatch } = require('../lib/weeklyBatchMatch');
const { MATCH_TYPE_FRIEND } = require('../lib/matchType');
const { buildSurveySubmissionWindowForApplicationPeriod } = require('../lib/surveyAvailabilityWindow');

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

function parsePeriodStartQuery(raw) {
  if (raw == null || raw === '') {
    return { ok: /** @type {const} */ (true), value: null };
  }
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) {
    return { ok: /** @type {const} */ (false), error: 'periodStart는 유효한 ISO 날짜여야 합니다.' };
  }
  return { ok: /** @type {const} */ (true), value: d };
}

/** 친구 매칭 운영 대시보드: KPI·퍼널·신청 창 메타 */
router.get('/friend-match/dashboard/summary', async (req, res) => {
  const parsed = parsePeriodStartQuery(req.query.periodStart ?? req.query.period_start);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }
  const applicationPeriodStart = resolveApplicationPeriodStart(parsed.value || undefined);
  const includePrev = ['1', 'true', 'yes'].includes(
    String(req.query.includePreviousWeek ?? req.query.include_previous_week ?? '').toLowerCase(),
  );

  try {
    const current = await computeFriendPeriodKpis(applicationPeriodStart);
    let previousWeek = null;
    if (includePrev) {
      const prevPs = new Date(applicationPeriodStart.getTime() - MS_PER_WEEK);
      previousWeek = await computeFriendPeriodKpis(prevPs);
    }

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_FRIEND_MATCH_DASHBOARD_SUMMARY',
      resource: 'friend-match/dashboard',
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { applicationPeriodStart: applicationPeriodStart.toISOString(), includePrev },
    });

    return res.status(200).json({
      matchType: MATCH_TYPE_FRIEND,
      ...current,
      ...(previousWeek ? { previousWeek } : {}),
    });
  } catch (err) {
    console.error('admin GET friend-match/dashboard/summary:', err);
    return res.status(500).json({ error: '대시보드 요약을 불러오지 못했습니다.' });
  }
});

/** 일·주 단위 추이(친구 주간 제출·친구 매칭 생성·배치 실행 상태) */
router.get('/friend-match/dashboard/trends', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days ?? 14) || 14, 1), 90);
  try {
    const data = await friendMatchTrends(days);
    return res.status(200).json({ matchType: MATCH_TYPE_FRIEND, ...data });
  } catch (err) {
    console.error('admin GET friend-match/dashboard/trends:', err);
    return res.status(500).json({ error: '추이 데이터를 불러오지 못했습니다.' });
  }
});

/** 이번 만남 대상 주 신청자 분포(학과·출생년·mainHobby) */
router.get('/friend-match/dashboard/distribution', async (req, res) => {
  const parsed = parsePeriodStartQuery(req.query.periodStart ?? req.query.period_start);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }
  const applicationPeriodStart = resolveApplicationPeriodStart(parsed.value || undefined);
  try {
    const data = await friendApplicantDistribution(applicationPeriodStart);
    return res.status(200).json({
      matchType: MATCH_TYPE_FRIEND,
      applicationPeriodStart: applicationPeriodStart.toISOString(),
      ...data,
    });
  } catch (err) {
    console.error('admin GET friend-match/dashboard/distribution:', err);
    return res.status(500).json({ error: '분포 통계를 불러오지 못했습니다.' });
  }
});

/** 단건: 참여·차단·이번 주 스냅샷·매칭 여부 한눈에 */
router.get('/friend-match/users/:identityId/overview', async (req, res) => {
  const { identityId } = req.params;
  if (!isUuid(identityId)) {
    return res.status(400).json({ error: 'identityId는 UUID여야 합니다.' });
  }
  try {
    const overview = await friendUserOverview(identityId);
    if (!overview) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_FRIEND_MATCH_USER_OVERVIEW',
      resource: `Identity:${identityId}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: null,
    });
    return res.status(200).json({ matchType: MATCH_TYPE_FRIEND, ...overview });
  } catch (err) {
    console.error('admin GET friend-match/users/overview:', err);
    return res.status(500).json({ error: '사용자 요약을 불러오지 못했습니다.' });
  }
});

/** 단건: 타임라인(증빙·주간 설문·매칭·관리자 감사 일부) */
router.get('/friend-match/users/:identityId/timeline', async (req, res) => {
  const { identityId } = req.params;
  if (!isUuid(identityId)) {
    return res.status(400).json({ error: 'identityId는 UUID여야 합니다.' });
  }
  try {
    const timeline = await friendUserTimeline(identityId);
    if (!timeline) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_FRIEND_MATCH_USER_TIMELINE',
      resource: `Identity:${identityId}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: null,
    });
    return res.status(200).json({ matchType: MATCH_TYPE_FRIEND, ...timeline });
  } catch (err) {
    console.error('admin GET friend-match/users/timeline:', err);
    return res.status(500).json({ error: '타임라인을 불러오지 못했습니다.' });
  }
});

/** 어뷰징·차단 힌트 */
router.get('/friend-match/users/:identityId/safety', async (req, res) => {
  const { identityId } = req.params;
  if (!isUuid(identityId)) {
    return res.status(400).json({ error: 'identityId는 UUID여야 합니다.' });
  }
  try {
    const row = await prisma.identity.findUnique({
      where: { id: identityId },
      select: { id: true },
    });
    if (!row) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    const safety = await friendUserSafetyFlags(identityId);
    return res.status(200).json({ matchType: MATCH_TYPE_FRIEND, identityId, safety });
  } catch (err) {
    console.error('admin GET friend-match/users/safety:', err);
    return res.status(500).json({ error: '안전 힌트를 불러오지 못했습니다.' });
  }
});

/** 이번 주기 미매칭 친구 배치 후보(설문·비차단) */
router.get('/friend-match/unmatched', async (req, res) => {
  const parsed = parsePeriodStartQuery(req.query.periodStart ?? req.query.period_start);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }
  const ps = parsed.value || getMatchingPeriodStart();
  const pe = getMatchingPeriodEnd(ps);
  const submissionWindow = buildSurveySubmissionWindowForApplicationPeriod(ps);

  try {
    const [eligible, matchedIds] = await Promise.all([
      loadEligibleTraits({ periodStart: ps, matchType: MATCH_TYPE_FRIEND }),
      getUserIdsMatchedInPeriod(prisma, ps, MATCH_TYPE_FRIEND),
    ]);
    const unmatched = eligible.filter((t) => !matchedIds.has(t.id));
    const users = unmatched.map((t) => ({
      id: t.id,
      identityId: t.id,
      nickname: t.identity?.nickname ?? null,
      email: t.identity?.email ?? null,
      kakaoId: t.identity?.kakaoId ?? null,
      department: t.identity?.department ?? null,
      birthYear: t.identity?.birthYear ?? null,
      createdAt: t.identity?.createdAt ?? null,
      gender: normalizeTraitGender(t.gender) ?? null,
      genderLabel: traitGenderLabelKo(t.gender) || null,
      surveySubmittedAt: t.surveySubmittedAt ?? null,
      surveyUpdatedAt: t.updatedAt ?? null,
      availabilityPreview: availabilityPreview(t.surveyData),
    }));

    return res.status(200).json({
      matchType: MATCH_TYPE_FRIEND,
      periodStart: ps.toISOString(),
      periodEnd: pe.toISOString(),
      submissionWindow,
      eligibleCount: eligible.length,
      matchedInPeriodCount: matchedIds.size,
      unmatchedCount: users.length,
      users,
    });
  } catch (err) {
    console.error('admin GET friend-match/unmatched:', err);
    return res.status(500).json({ error: '미매칭 목록을 불러오지 못했습니다.' });
  }
});

/** 친구 매칭 배치만 실행 (`runWeeklyBatchMatch` / matchType FRIEND) */
router.post('/friend-match/batch-run', async (req, res) => {
  try {
    const result = await runWeeklyBatchMatch({
      actorType: 'admin',
      actorId: req.admin.adminId,
      requestIp: req.ip || null,
      requestUserAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      matchType: MATCH_TYPE_FRIEND,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('admin POST friend-match/batch-run:', err);
    return res.status(502).json({
      error: '친구 매칭 배치 실행에 실패했습니다.',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

/** 최근 배치 실행 이력 */
router.get('/friend-match/batch-runs', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 30) || 30, 1), 200);
  try {
    const runs = await listBatchRuns(limit, MATCH_TYPE_FRIEND);
    return res.status(200).json({ matchType: MATCH_TYPE_FRIEND, runs });
  } catch (err) {
    console.error('admin GET friend-match/batch-runs:', err);
    return res.status(500).json({ error: '배치 이력을 불러오지 못했습니다.' });
  }
});

/** 배치 성공·스킵·에러·스킵 사유 집계 */
router.get('/friend-match/batch-runs/stats', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.sinceDays ?? 14) || 14, 1), 90);
  const since = new Date(Date.now() - days * 86400000);
  try {
    const stats = await batchRunFailureStats(since, MATCH_TYPE_FRIEND);
    return res.status(200).json({ matchType: MATCH_TYPE_FRIEND, sinceDays: days, ...stats });
  } catch (err) {
    console.error('admin GET friend-match/batch-runs/stats:', err);
    return res.status(500).json({ error: '배치 통계를 불러오지 못했습니다.' });
  }
});

/** 런타임 운영 설정(문구·스위치) 조회 */
router.get('/friend-match/settings/runtime', async (req, res) => {
  try {
    const data = await getFriendRuntimeSettings();
    return res.status(200).json({ matchType: MATCH_TYPE_FRIEND, ...data });
  } catch (err) {
    console.error('admin GET friend-match/settings/runtime:', err);
    return res.status(500).json({ error: '설정을 불러오지 못했습니다.' });
  }
});

/** 런타임 운영 설정 갱신(알려진 키만) */
router.patch('/friend-match/settings/runtime', async (req, res) => {
  try {
    const applied = await applyFriendRuntimeSettingsPatch(req.body ?? {}, req.admin.adminId);
    if (!applied.ok) {
      return res.status(400).json({ error: applied.error });
    }
    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_FRIEND_MATCH_RUNTIME_SETTINGS',
      resource: 'friend-match/settings/runtime',
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { updatedKeys: applied.updatedKeys },
    });
    const data = await getFriendRuntimeSettings();
    return res.status(200).json({
      message: '설정이 저장되었습니다.',
      updatedKeys: applied.updatedKeys,
      ...data,
    });
  } catch (err) {
    console.error('admin PATCH friend-match/settings/runtime:', err);
    return res.status(500).json({ error: '설정 저장 중 오류가 발생했습니다.' });
  }
});

/** 관리자 감사 로그(기본: actorType=admin) */
router.get('/friend-match/access-logs', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 500);
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
  const actionPrefix = typeof req.query.actionPrefix === 'string' ? req.query.actionPrefix.trim() : '';
  try {
    const { total, logs } = await listAdminAccessLogs({ limit, offset, actionPrefix });
    return res.status(200).json({ total, limit, offset, logs });
  } catch (err) {
    console.error('admin GET friend-match/access-logs:', err);
    return res.status(500).json({ error: '감사 로그를 불러오지 못했습니다.' });
  }
});

module.exports = router;
