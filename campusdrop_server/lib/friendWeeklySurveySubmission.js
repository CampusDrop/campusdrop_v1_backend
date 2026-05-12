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
 * 친구 매칭 주차 스냅샷 upsert. 같은 주차의 로맨스 주간 행은 호출 전에 상위에서 삭제하거나 여기서 함께 처리합니다.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} prismaClient
 * @param {{
 *   identityId: string,
 *   surveyData: Record<string, unknown>,
 *   gender: string | null,
 *   submittedAt: Date,
 *   availabilityWindow: ReturnType<import('./surveyAvailabilityWindow').buildSurveyAvailabilityWindow>,
 * }} params
 */
async function upsertFriendWeeklySurveySubmission(prismaClient, params) {
  const { targetPeriodStart, targetPeriodEnd } = targetPeriodFromAvailabilityWindow(
    params.availabilityWindow,
  );

  await prismaClient.weeklySurveySubmission.deleteMany({
    where: {
      identityId: params.identityId,
      targetPeriodStart,
    },
  });
  const existingAnyType = await prismaClient.friendWeeklySurveySubmission.findFirst({
    where: {
      identityId: params.identityId,
      targetPeriodStart,
    },
    select: { id: true },
  });
  const where = {
    identityId_targetPeriodStart: {
      identityId: params.identityId,
      targetPeriodStart,
    },
  };

  const existing = await prismaClient.friendWeeklySurveySubmission.findUnique({ where });
  if (!existing) {
    const created = await prismaClient.friendWeeklySurveySubmission.create({
      data: {
        identityId: params.identityId,
        targetPeriodStart,
        targetPeriodEnd,
        gender: params.gender,
        surveyData: params.surveyData,
        submittedAt: params.submittedAt,
      },
    });
    return { submission: created, isFirstSubmissionForWeek: !existingAnyType };
  }

  const updated = await prismaClient.friendWeeklySurveySubmission.update({
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
  upsertFriendWeeklySurveySubmission,
};
