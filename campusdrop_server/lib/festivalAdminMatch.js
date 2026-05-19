'use strict';

const crypto = require('crypto');
const { sameFestivalVibe } = require('./festivalVibe');

/** @typedef {import('@prisma/client').FestivalApplication} FestApp */
/** @typedef {{ male: FestApp, female: FestApp }} FestPair */

/**
 * @template T
 * @param {T[]} arr
 */
function shuffleCopy(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/** @param {FestApp} row */
function rowKey(row) {
  return String(row.id);
}

/** @param {FestApp[]} rows */
function partitionSoloMulti(rows) {
  /** @type {FestApp[]} */
  const solo = [];
  /** @type {FestApp[]} */
  const multi = [];
  for (const r of rows) {
    if (r.peopleCount === 1) solo.push(r);
    else multi.push(r);
  }
  return { solo, multi };
}

/**
 * 남·여 전체 팀 수만 검사합니다. 1명팀/다인팀 코호트 수는 달라도 됩니다.
 * @param {FestApp[]} males
 * @param {FestApp[]} females
 */
function validateFestivalMatchPool(males, females) {
  if (males.length !== females.length) {
    return {
      ok: /** @type {const} */ (false),
      code: 'FESTIVAL_GENDER_TEAM_IMBALANCE',
      error: '남·여 팀 수가 같아야 매칭할 수 있습니다.',
      counts: {
        appliedMaleTeams: males.length,
        appliedFemaleTeams: females.length,
      },
    };
  }

  const mPart = partitionSoloMulti(males);
  const fPart = partitionSoloMulti(females);

  return {
    ok: /** @type {const} */ (true),
    counts: {
      appliedMaleTeams: males.length,
      appliedFemaleTeams: females.length,
      soloMaleTeams: mPart.solo.length,
      soloFemaleTeams: fPart.solo.length,
      multiMaleTeams: mPart.multi.length,
      multiFemaleTeams: fPart.multi.length,
    },
  };
}

/**
 * @param {FestApp[]} males
 * @param {FestApp[]} females
 * @param {(m: FestApp, f: FestApp) => boolean} canPair
 * @returns {FestPair[]}
 */
function maxBipartitePairs(males, females, canPair) {
  if (males.length === 0 || females.length === 0) return [];

  /** @type {Map<string, FestApp>} femaleId -> male */
  const matchFemaleToMale = new Map();

  /**
   * @param {FestApp} m
   * @param {Set<string>} seenFemaleIds
   */
  function dfs(m, seenFemaleIds) {
    for (const f of females) {
      if (!canPair(m, f)) continue;
      const fk = rowKey(f);
      if (seenFemaleIds.has(fk)) continue;
      seenFemaleIds.add(fk);

      const prevMale = matchFemaleToMale.get(fk);
      if (!prevMale || dfs(prevMale, seenFemaleIds)) {
        matchFemaleToMale.set(fk, m);
        return true;
      }
    }
    return false;
  }

  for (const m of shuffleCopy(males)) {
    dfs(m, new Set());
  }

  /** @type {Map<string, FestApp>} maleId -> female */
  const matchMaleToFemale = new Map();
  for (const [fk, m] of matchFemaleToMale) {
    const f = females.find((row) => rowKey(row) === fk);
    if (f) matchMaleToFemale.set(rowKey(m), f);
  }

  /** @type {FestPair[]} */
  const pairs = [];
  for (const m of males) {
    const f = matchMaleToFemale.get(rowKey(m));
    if (f) pairs.push({ male: m, female: f });
  }
  return pairs;
}

/** @param {Set<string>} matchedKeys @param {FestApp[]} rows */
function filterUnmatched(rows, matchedKeys) {
  return rows.filter((r) => !matchedKeys.has(rowKey(r)));
}

/** 여 1명팀 ↔ 남 1명팀, 같은 무드 */
function phaseFemaleSoloMaleSoloSameVibe(m, f) {
  return f.peopleCount === 1 && m.peopleCount === 1 && sameFestivalVibe(m.vibe, f.vibe);
}

/** 여 1명팀 ↔ 남 1명팀, 무드 무관 */
function phaseFemaleSoloMaleSoloAnyVibe(m, f) {
  return f.peopleCount === 1 && m.peopleCount === 1;
}

/** 여 2명+팀 ↔ 남 1명+팀, 같은 무드 (1:다 포함) */
function phaseFemaleMultiMaleAnySameVibe(m, f) {
  return f.peopleCount >= 2 && m.peopleCount >= 1 && sameFestivalVibe(m.vibe, f.vibe);
}

/** 여 2명+팀 ↔ 남 2명+팀, 무드 무관 */
function phaseFemaleMultiMaleMultiAnyVibe(m, f) {
  return f.peopleCount >= 2 && m.peopleCount >= 2;
}

/**
 * 여팀 기준 5단계 → 최대 이성 매칭. 팀 1:1만 허용.
 * @param {FestApp[]} males
 * @param {FestApp[]} females
 */
function computeFestivalPairs(males, females) {
  const validation = validateFestivalMatchPool(males, females);
  if (!validation.ok) {
    return { ok: /** @type {const} */ (false), validation };
  }

  /** @type {FestPair[]} */
  const pairs = [];
  const matchedKeys = new Set();

  /**
   * @param {FestPair[]} newPairs
   */
  function absorbPairs(newPairs) {
    for (const p of newPairs) {
      pairs.push(p);
      matchedKeys.add(rowKey(p.male));
      matchedKeys.add(rowKey(p.female));
    }
  }

  /** @param {(m: FestApp, f: FestApp) => boolean} canPair */
  function runPhase(canPair) {
    const mRem = filterUnmatched(males, matchedKeys);
    const fRem = filterUnmatched(females, matchedKeys);
    absorbPairs(maxBipartitePairs(mRem, fRem, canPair));
  }

  runPhase(phaseFemaleSoloMaleSoloSameVibe);
  runPhase(phaseFemaleSoloMaleSoloAnyVibe);
  runPhase(phaseFemaleMultiMaleAnySameVibe);
  runPhase(phaseFemaleMultiMaleMultiAnyVibe);
  runPhase(() => true);

  const unmatchedMale = filterUnmatched(males, matchedKeys).length;
  const unmatchedFemale = filterUnmatched(females, matchedKeys).length;

  return {
    ok: /** @type {const} */ (true),
    pairs,
    pairedCount: pairs.length,
    unmatchedMale,
    unmatchedFemale,
    poolCounts: validation.counts,
  };
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ appliedLocalDate: Date }} p
 */
async function runFestivalPairing(tx, { appliedLocalDate }) {
  /** @type {import('@prisma/client').Prisma.FestivalApplicationWhereInput} */
  const baseWhere = {
    appliedLocalDate,
    deletedAt: null,
    status: 'APPLIED',
  };

  const [males, females] = await Promise.all([
    tx.festivalApplication.findMany({
      where: { ...baseWhere, gender: 'M' },
      orderBy: { id: 'asc' },
    }),
    tx.festivalApplication.findMany({
      where: { ...baseWhere, gender: 'F' },
      orderBy: { id: 'asc' },
    }),
  ]);

  const computed = computeFestivalPairs(males, females);
  if (!computed.ok) {
    return {
      tag: /** @type {const} */ ('imbalance'),
      validation: computed.validation,
    };
  }

  const now = new Date();
  for (const { male: m, female: f } of computed.pairs) {
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
  }

  return {
    tag: /** @type {const} */ ('ok'),
    pairedCount: computed.pairedCount,
    unmatchedMale: computed.unmatchedMale,
    unmatchedFemale: computed.unmatchedFemale,
    pairs: computed.pairs,
    poolCounts: computed.poolCounts,
  };
}

module.exports = {
  validateFestivalMatchPool,
  computeFestivalPairs,
  maxBipartitePairs,
  phaseFemaleSoloMaleSoloSameVibe,
  phaseFemaleSoloMaleSoloAnyVibe,
  phaseFemaleMultiMaleAnySameVibe,
  phaseFemaleMultiMaleMultiAnyVibe,
  runFestivalPairing,
};
