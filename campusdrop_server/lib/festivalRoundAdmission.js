'use strict';

/**
 * 축제 신청 회차는 시계(14·17시)가 아니라 관리자 `match-run` 완료 시점으로 넘어갑니다.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Date} appliedLocalDate `@db.Date` 당일 행만
 */
async function isMatchingRoundComplete(tx, appliedLocalDate, slotNum) {
  const c = await tx.festivalMatchRoundCompletion.findUnique({
    where: {
      appliedLocalDate_matchingSlot: {
        appliedLocalDate,
        matchingSlot: slotNum,
      },
    },
  });
  if (c) return true;

  const appliedLeft = await tx.festivalApplication.count({
    where: {
      appliedLocalDate,
      matchingSlot: slotNum,
      status: 'APPLIED',
      deletedAt: null,
    },
  });
  if (appliedLeft > 0) return false;

  const matchedCount = await tx.festivalApplication.count({
    where: {
      appliedLocalDate,
      matchingSlot: slotNum,
      status: 'MATCHED',
      deletedAt: null,
    },
  });
  /** 구 데이터(관리 회차 기록 없이 매칭만 된 경우): 풀이 비었고 MATCHED 행만 있음 */
  return matchedCount > 0;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Date} appliedLocalDate
 * @returns {Promise<{ slot: 1 } | { slot: 2 } | { slot: null; errorMessage: string }>}
 */
async function computeOpenSubmissionSlot(tx, appliedLocalDate) {
  if (!(await isMatchingRoundComplete(tx, appliedLocalDate, 1))) {
    return { slot: /** @type {const} */ (1) };
  }
  if (!(await isMatchingRoundComplete(tx, appliedLocalDate, 2))) {
    return { slot: /** @type {const} */ (2) };
  }
  return { slot: null, errorMessage: '금일 축제 신청 접수가 마감되었습니다.' };
}

module.exports = {
  isMatchingRoundComplete,
  computeOpenSubmissionSlot,
};
