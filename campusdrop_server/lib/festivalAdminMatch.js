const crypto = require('crypto');

/**
 * @template T
 * @param {T[]} arr
 */
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/**
 * `peopleCount` 기준 버킷 안에서만 이성 1행↔1행 무작위 매칭(DB 업데이트 포함).
 * - `peopleCount === 1` → 1:1 코호트만 서로 짝
 * - `peopleCount >= 2` → 다대다 코호트만 서로 짝 (행 단위 1:1이지만 상대 후보가 같은 버킷으로 한정됨)
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Date} appliedLocalDate
 * @param {number | import('@prisma/client').Prisma.IntFilter} peopleCountFilter
 */
async function pairAppliedByPeopleCountBucket(tx, appliedLocalDate, peopleCountFilter) {
  /** @type {import('@prisma/client').Prisma.FestivalApplicationWhereInput} */
  const baseWhere = {
    appliedLocalDate,
    deletedAt: null,
    status: 'APPLIED',
    peopleCount: peopleCountFilter,
  };

  const males = await tx.festivalApplication.findMany({
    where: { ...baseWhere, gender: 'M' },
    orderBy: { id: 'asc' },
  });
  const females = await tx.festivalApplication.findMany({
    where: { ...baseWhere, gender: 'F' },
    orderBy: { id: 'asc' },
  });

  shuffleInPlace(males);
  shuffleInPlace(females);

  const n = Math.min(males.length, females.length);
  /** @type {{ male: import('@prisma/client').FestivalApplication, female: import('@prisma/client').FestivalApplication }[]} */
  const pairs = [];
  const now = new Date();
  for (let i = 0; i < n; i += 1) {
    const m = /** @type {import('@prisma/client').FestivalApplication} */ (males[i]);
    const f = /** @type {import('@prisma/client').FestivalApplication} */ (females[i]);

    await tx.festivalApplication.update({
      where: { id: m.id },
      data: {
        status: 'MATCHED',
        partnerPhone: f.phone,
        partnerReceptionId: f.receptionId,
        matchedAt: now,
      },
    });
    await tx.festivalApplication.update({
      where: { id: f.id },
      data: {
        status: 'MATCHED',
        partnerPhone: m.phone,
        partnerReceptionId: m.receptionId,
        matchedAt: now,
      },
    });
    pairs.push({ male: m, female: f });
  }

  return {
    pairedCount: n,
    unmatchedMale: males.length - n,
    unmatchedFemale: females.length - n,
    pairs,
  };
}

/**
 * 이성 무작위 매칭 — `peopleCount`가 1인 신청과 2 이상인 신청은 서로 짝 지어지지 않습니다.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ appliedLocalDate: Date }} p
 */
async function runFestivalPairing(tx, { appliedLocalDate }) {
  const oneToOne = await pairAppliedByPeopleCountBucket(tx, appliedLocalDate, 1);
  const multi = await pairAppliedByPeopleCountBucket(tx, appliedLocalDate, { gte: 2 });

  return {
    pairedCount: oneToOne.pairedCount + multi.pairedCount,
    unmatchedMale: oneToOne.unmatchedMale + multi.unmatchedMale,
    unmatchedFemale: oneToOne.unmatchedFemale + multi.unmatchedFemale,
    pairs: [...oneToOne.pairs, ...multi.pairs],
  };
}

module.exports = { runFestivalPairing, shuffleInPlace };
