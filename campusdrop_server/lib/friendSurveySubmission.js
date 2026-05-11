/**
 * Step 1: 1 PC방·게임, 2 운동·산책, 3 카페·맛집, 4 문화·여가.
 * Step 2: 분기별 1~4 (클라이언트에서 Step1과 일치시킴).
 * @param {unknown} raw
 * @returns {{ ok: true, data: { mainCategory: number, detailChoice: number } } | { ok: false, error: string }}
 */
function validateFriendHobbySurvey(raw) {
  if (raw === undefined || raw === null) {
    return { ok: false, error: 'friendHobbySurvey가 필요합니다.' };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'friendHobbySurvey는 객체여야 합니다.' };
  }
  const o = /** @type {Record<string, unknown>} */ (raw);
  const mainRaw = Object.prototype.hasOwnProperty.call(o, 'mainCategory')
    ? o.mainCategory
    : o.main_category;
  const detailRaw = Object.prototype.hasOwnProperty.call(o, 'detailChoice')
    ? o.detailChoice
    : o.detail_choice;

  const mainCategory =
    typeof mainRaw === 'number' && Number.isInteger(mainRaw)
      ? mainRaw
      : typeof mainRaw === 'string' && /^[1-4]$/.test(mainRaw.trim())
        ? Number(mainRaw.trim())
        : NaN;
  const detailChoice =
    typeof detailRaw === 'number' && Number.isInteger(detailRaw)
      ? detailRaw
      : typeof detailRaw === 'string' && /^[1-4]$/.test(detailRaw.trim())
        ? Number(detailRaw.trim())
        : NaN;

  if (!Number.isInteger(mainCategory) || mainCategory < 1 || mainCategory > 4) {
    return {
      ok: false,
      error: 'friendHobbySurvey.mainCategory는 1~4 정수여야 합니다. (1 PC방·게임 … 4 문화·여가)',
    };
  }
  if (!Number.isInteger(detailChoice) || detailChoice < 1 || detailChoice > 4) {
    return {
      ok: false,
      error: 'friendHobbySurvey.detailChoice는 1~4 정수여야 합니다.',
    };
  }

  return { ok: true, data: { mainCategory, detailChoice } };
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{
 *   identityId: string,
 *   submittedAt: Date,
 *   mainCategory: number,
 *   detailChoice: number,
 *   availabilityWindow: ReturnType<import('./surveyAvailabilityWindow').buildSurveyAvailabilityWindow>,
 * }} params
 */
async function upsertFriendSurveySubmission(tx, params) {
  const targetPeriodStart = new Date(params.availabilityWindow.target.periodStart);
  const targetPeriodEnd = new Date(params.availabilityWindow.target.periodEnd);
  const where = {
    identityId_targetPeriodStart: {
      identityId: params.identityId,
      targetPeriodStart,
    },
  };
  const existing = await tx.friendSurveySubmission.findUnique({ where });
  if (!existing) {
    return tx.friendSurveySubmission.create({
      data: {
        identityId: params.identityId,
        targetPeriodStart,
        targetPeriodEnd,
        mainCategory: params.mainCategory,
        detailChoice: params.detailChoice,
        submittedAt: params.submittedAt,
      },
    });
  }
  return tx.friendSurveySubmission.update({
    where,
    data: {
      targetPeriodEnd,
      mainCategory: params.mainCategory,
      detailChoice: params.detailChoice,
      submittedAt: params.submittedAt,
    },
  });
}

module.exports = {
  validateFriendHobbySurvey,
  upsertFriendSurveySubmission,
};
