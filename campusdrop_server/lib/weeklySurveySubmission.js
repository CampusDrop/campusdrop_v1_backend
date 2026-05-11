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
 *   matchType: 'ROMANCE' | 'FRIEND',
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
  const existingAnyType = await prismaClient.weeklySurveySubmission.findFirst({
    where: {
      identityId: params.identityId,
      targetPeriodStart,
    },
    select: { id: true },
  });
  const where = {
    identityId_matchType_targetPeriodStart: {
      identityId: params.identityId,
      matchType: params.matchType,
      targetPeriodStart,
    },
  };

  // 같은 주차에는 선택한 matchType 하나만 유지한다.
  await prismaClient.weeklySurveySubmission.deleteMany({
    where: {
      identityId: params.identityId,
      targetPeriodStart,
      NOT: { matchType: params.matchType },
    },
  });

  const existing = await prismaClient.weeklySurveySubmission.findUnique({ where });
  if (!existing) {
    const created = await prismaClient.weeklySurveySubmission.create({
      data: {
        identityId: params.identityId,
        matchType: params.matchType,
        targetPeriodStart,
        targetPeriodEnd,
        gender: params.gender,
        surveyData: params.surveyData,
        submittedAt: params.submittedAt,
      },
    });
    return { submission: created, isFirstSubmissionForWeek: !existingAnyType };
  }

  const updated = await prismaClient.weeklySurveySubmission.update({
    where,
    data: {
      targetPeriodEnd,
      gender: params.gender,
      surveyData: params.surveyData,
      submittedAt: params.submittedAt,
    },
  });
  return { submission: updated, isFirstSubmissionForWeek: false };
}

module.exports = {
  targetPeriodFromAvailabilityWindow,
  upsertWeeklySurveySubmission,
};
