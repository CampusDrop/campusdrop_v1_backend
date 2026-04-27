/**
 * @param {ReturnType<import('./surveyAvailabilityWindow').buildSurveyAvailabilityWindow>} availabilityWindow
 */
function targetPeriodFromAvailabilityWindow(availabilityWindow) {
  return {
    targetPeriodStart: new Date(availabilityWindow.target.periodStart),
    targetPeriodEnd: new Date(availabilityWindow.target.periodEnd),
  };
}

/**
 * 같은 매칭 주차에 다시 제출하면 해당 주차 스냅샷을 최신 설문으로 덮어쓴다.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} prismaClient
 * @param {{
 *   identityId: string,
 *   surveyData: Record<string, unknown>,
 *   gender: string,
 *   submittedAt: Date,
 *   availabilityWindow: ReturnType<import('./surveyAvailabilityWindow').buildSurveyAvailabilityWindow>,
 * }} params
 */
async function upsertWeeklySurveySubmission(prismaClient, params) {
  const { targetPeriodStart, targetPeriodEnd } = targetPeriodFromAvailabilityWindow(
    params.availabilityWindow,
  );

  return prismaClient.weeklySurveySubmission.upsert({
    where: {
      identityId_targetPeriodStart: {
        identityId: params.identityId,
        targetPeriodStart,
      },
    },
    create: {
      identityId: params.identityId,
      targetPeriodStart,
      targetPeriodEnd,
      gender: params.gender,
      surveyData: params.surveyData,
      submittedAt: params.submittedAt,
    },
    update: {
      targetPeriodEnd,
      gender: params.gender,
      surveyData: params.surveyData,
      submittedAt: params.submittedAt,
    },
  });
}

module.exports = {
  targetPeriodFromAvailabilityWindow,
  upsertWeeklySurveySubmission,
};
