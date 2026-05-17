/**
 * 주간 신청 스냅샷 후보 로드. `weeklyBatchMatch` 및 친구 소그룹 배치 공용.
 */

const { prisma } = require('./prisma');
const { getSurveyTargetPeriodStartForApplicationPeriod } = require('./surveyAvailabilityWindow');
const { MATCH_TYPE_ROMANCE, MATCH_TYPE_FRIEND } = require('./matchType');
const { getMatchingPeriodStart } = require('./matchPolicy');

/**
 * 목표 매칭 주 직전 신청 기간에 설문을 제출한 유저만 배치 대상.
 * @param {{
 *   prismaClient?: import('@prisma/client').PrismaClient,
 *   periodStart?: Date,
 *   matchType?: typeof MATCH_TYPE_ROMANCE | typeof MATCH_TYPE_FRIEND,
 * }} [options]
 */
async function loadEligibleWeeklyTraits(options = {}) {
  const prismaClient = options.prismaClient || prisma;
  const periodStart = options.periodStart || getMatchingPeriodStart();
  const matchType = options.matchType || MATCH_TYPE_ROMANCE;
  const targetPeriodStart = getSurveyTargetPeriodStartForApplicationPeriod(periodStart);

  const submissionInclude = {
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
  };

  const submissions =
    matchType === MATCH_TYPE_ROMANCE
      ? await prismaClient.weeklySurveySubmission.findMany({
          where: { targetPeriodStart },
          include: submissionInclude,
        })
      : await prismaClient.friendWeeklySurveySubmission.findMany({
          where: { targetPeriodStart },
          include: submissionInclude,
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

module.exports = {
  loadEligibleWeeklyTraits,
};
