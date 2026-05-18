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
 * 이성 1:1 무작위 매칭. 해당 일자 `APPLIED`만 후보로 사용합니다.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ appliedLocalDate: Date }} p
 */
async function runFestivalPairing(tx, { appliedLocalDate }) {
  const baseWhere = /** @type {const} */ ({
    appliedLocalDate,
    deletedAt: null,
    status: 'APPLIED',
  });

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

module.exports = { runFestivalPairing, shuffleInPlace };
