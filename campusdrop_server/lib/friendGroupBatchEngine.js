'use strict';

const {
  FRIEND_MAIN_HOBBIES,
  FRIEND_DETAIL_ORDER_BY_MAIN,
  FRIEND_FAVORITE_FOOD_ORDER,
} = require('./friendSurveyValidation');

const { hourStartFromTimeSlotString } = require('./kstMeetingInstant');

/** @typedef {{ date: string, time_slot: string }} AvailabilitySlotNorm */

/** @typedef {{ canonical: string, slot: AvailabilitySlotNorm }} SlotRef */

/**
 * 버킷·슬롯 스펙(취미 고정 순 → 음식 폴백).
 * 이용 가능 인원 n(slot)≥3 인 슬록 중 최소 n, 동률 시 빠른 시각(KST 일자·정각 시작).
 */

/** @returns {number | null} */
function numericHour(slot) {
  return hourStartFromTimeSlotString(slot.time_slot || '');
}

/**
 * @param {AvailabilitySlotNorm} a
 * @param {AvailabilitySlotNorm} b
 */
function compareSlotAsc(a, b) {
  const dd = String(a.date).localeCompare(String(b.date));
  if (dd !== 0) return dd;
  const ha = numericHour(a) ?? 999;
  const hb = numericHour(b) ?? 999;
  if (ha !== hb) return ha - hb;
  return String(a.time_slot || '').localeCompare(String(b.time_slot || ''));
}

/**
 * @param {AvailabilitySlotNorm} slot
 */
function slotCanonical(slot) {
  const h = numericHour(slot);
  if (!slot.date || h === null || Number.isNaN(h)) return null;
  return `${slot.date}|${String(h).padStart(2, '0')}`;
}

/**
 * @param {AvailabilitySlotNorm[]} slots
 * @returns {SlotRef[]}
 */
function uniqueSlotRefsOfUser(slots) {
  /** @type {Map<string, AvailabilitySlotNorm>} */
  const m = new Map();
  for (const raw of slots) {
    const s =
      raw &&
      typeof raw === 'object' &&
      typeof /** @type {AvailabilitySlotNorm} */ (raw).date === 'string' &&
      typeof /** @type {AvailabilitySlotNorm} */ (raw).time_slot === 'string'
        ? /** @type {AvailabilitySlotNorm} */ (raw)
        : null;
    if (!s) continue;
    const c = slotCanonical(s);
    if (!c) continue;
    if (!m.has(c)) {
      m.set(c, {
        date: s.date.trim(),
        time_slot: String(s.time_slot).trim(),
      });
    }
  }
  return [...m.entries()].map(([canonical, slot]) => ({ canonical, slot }));
}

function pairForbiddenKey(lo, hi) {
  const a = lo < hi ? lo : hi;
  const b = lo < hi ? hi : lo;
  return `${a}|${b}`;
}

/**
 * @param {string[]} ids
 * @param {ReadonlySet<string>} forbiddenPairs
 */
function hasForbiddenPairs(ids, forbiddenPairs) {
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      if (forbiddenPairs.has(pairForbiddenKey(ids[i], ids[j]))) return true;
    }
  }
  return false;
}

/**
 * @typedef {{
 *   id: string,
 *   submittedAt: string,
 *   slots: AvailabilitySlotNorm[],
 *   slotRefs: SlotRef[],
 *   mainHobby: string,
 *   mainHobbyDetail: string,
 *   favoriteFood: string,
 * }} FGParticipantEngine
 */

/**
 * @param {FGParticipantEngine} a
 * @param {FGParticipantEngine} b
 */
function sortParticipantsAsc(a, b) {
  const ta = new Date(a.submittedAt).getTime();
  const tb = new Date(b.submittedAt).getTime();
  if (ta !== tb) return ta - tb;
  return a.id.localeCompare(b.id);
}

/**
 * @param {FGParticipantEngine[]} eligibleSorted
 * @param {ReadonlySet<string>} forbiddenPairs
 * @returns {string[] | null}
 */
function pickOneGroupSequential(eligibleSorted, forbiddenPairs) {
  const ids = eligibleSorted.map((p) => p.id);
  const n = ids.length;
  if (n < 3) return null;
  const sizes = n >= 4 ? [4, 3] : [3];
  for (const size of sizes) {
    for (let i = 0; i + size <= n; i += 1) {
      const slice = ids.slice(i, i + size);
      if (!hasForbiddenPairs(slice, forbiddenPairs)) return slice;
    }
  }
  return null;
}

/** @typedef {'HOBBY'|'FOOD_FALLBACK'} FriendBatchLaneStr */

/** @typedef {{ lane: FriendBatchLaneStr, mainHobby?: string, mainHobbyDetail?: string, favoriteFood?: string }} BucketSpec */

/** @typedef {{ slot: AvailabilitySlotNorm, canonical: string, minAvailableCount: number, lane: FriendBatchLaneStr, mainHobby?: string, mainHobbyDetail?: string, favoriteFood?: string, memberIds: string[] }} PlannedFriendGroupDraft */

/** @typedef {{ groups: PlannedFriendGroupDraft[], globalMatched: Set<string> }} BatchCollector */

/**
 * @param {FGParticipantEngine[]} bucketUsers
 * @param {ReadonlySet<string>} forbiddenPairs
 * @param {BatchCollector} collector
 * @param {BucketSpec} spec
 * @param {((...args: unknown[]) => void) | undefined} log
 */
function drainBucket(bucketUsers, forbiddenPairs, collector, spec, log) {
  const logFn = typeof log === 'function' ? log : () => {};

  for (;;) {
    /** @type {FGParticipantEngine[]} */
    const U = [];
    for (const p of bucketUsers) {
      if (!collector.globalMatched.has(p.id)) U.push(p);
    }
    if (U.length < 3) return;

    /** @type {Map<string, number>} */
    const slotAvailCount = new Map();
    for (const p of U) {
      for (const { canonical } of p.slotRefs) {
        slotAvailCount.set(canonical, (slotAvailCount.get(canonical) || 0) + 1);
      }
    }

    /** @type {SlotRef[]} */
    const candidateSlots = [];
    for (const [canonical, c] of slotAvailCount.entries()) {
      if (c < 3) continue;
      const sample = U.find((p) => [...p.slotRefs].some((r) => r.canonical === canonical));
      const slotNorm = sample?.slotRefs.find((r) => r.canonical === canonical)?.slot;
      if (!slotNorm) continue;
      candidateSlots.push({ canonical, slot: slotNorm });
    }

    candidateSlots.sort((a, b) => {
      const ca = slotAvailCount.get(a.canonical) || 0;
      const cb = slotAvailCount.get(b.canonical) || 0;
      if (ca !== cb) return ca - cb;
      return compareSlotAsc(a.slot, b.slot);
    });

    /** @type {Set<string>} */
    const blocked = new Set();
    let progressedRound = false;

    for (;;) {
      const pickList = candidateSlots.filter((s) => !blocked.has(s.canonical));
      if (pickList.length === 0) break;

      const selected = pickList[0];
      const minCount = slotAvailCount.get(selected.canonical) ?? 0;
      /** @type {FGParticipantEngine[]} */
      const atSlot = U.filter((p) => [...p.slotRefs].some((r) => r.canonical === selected.canonical));
      atSlot.sort(sortParticipantsAsc);

      const memberIdsRaw = pickOneGroupSequential(atSlot, forbiddenPairs);
      if (!memberIdsRaw || memberIdsRaw.length < 3) {
        blocked.add(selected.canonical);
        logFn('[friendGroupBatchEngine]', 'blocked-slot-no-valid-window', {
          canonical: selected.canonical,
          lane: spec.lane,
          hobby: `${spec.mainHobby || ''}|${spec.mainHobbyDetail || ''}`,
          food: spec.favoriteFood ?? null,
        });
        if (blocked.size >= candidateSlots.length) break;
        continue;
      }

      for (const uid of memberIdsRaw) collector.globalMatched.add(uid);
      collector.groups.push({
        slot: { date: selected.slot.date, time_slot: selected.slot.time_slot },
        canonical: selected.canonical,
        minAvailableCount: minCount,
        lane: spec.lane,
        mainHobby: spec.mainHobby,
        mainHobbyDetail: spec.mainHobbyDetail,
        favoriteFood: spec.favoriteFood,
        memberIds: [...memberIdsRaw],
      });
      progressedRound = true;
      break;
    }

    if (!progressedRound) return;
  }
}

/** @typedef {{ participants: FGParticipantEngine[], forbiddenPairTuples?: ReadonlyArray<Readonly<[string, string]>>, log?: (...a: unknown[]) => void }} PlanInput */

/**
 * @param {PlanInput} input
 * @returns {{ groups: PlannedFriendGroupDraft[], matchedIds: ReadonlySet<string> }}
 */
function runFriendGroupBatchPlan(input) {
  const tuples = input.forbiddenPairTuples || [];
  const forbiddenPairs = new Set(
    tuples.map(([a, b]) => pairForbiddenKey(String(a), String(b))),
  );

  /** @type {BatchCollector} */
  const collector = {
    groups: [],
    globalMatched: new Set(),
  };

  const logFn = input.log || (() => {});

  for (let mi = 0; mi < FRIEND_MAIN_HOBBIES.length; mi += 1) {
    const main = FRIEND_MAIN_HOBBIES[mi];
    const details = FRIEND_DETAIL_ORDER_BY_MAIN[main];
    for (let di = 0; di < details.length; di += 1) {
      const detail = details[di];
      const bucketUsers = input.participants.filter(
        (p) => p.mainHobby === main && p.mainHobbyDetail === detail,
      );
      drainBucket(bucketUsers, forbiddenPairs, collector, { lane: 'HOBBY', mainHobby: main, mainHobbyDetail: detail }, logFn);
    }
  }

  for (let fi = 0; fi < FRIEND_FAVORITE_FOOD_ORDER.length; fi += 1) {
    const ff = FRIEND_FAVORITE_FOOD_ORDER[fi];
    const bucketUsers = input.participants.filter((p) => p.favoriteFood === ff);
    drainBucket(bucketUsers, forbiddenPairs, collector, { lane: 'FOOD_FALLBACK', favoriteFood: ff }, logFn);
  }

  return {
    groups: collector.groups,
    matchedIds: collector.globalMatched,
  };
}

module.exports = {
  runFriendGroupBatchPlan,
  slotCanonical,
  numericHour,
  compareSlotAsc,
  uniqueSlotRefsOfUser,
  pairForbiddenKey,
};
