/**
 * 만남 가능 시간 겹침 (Python `campusdrop_matching/app/availability.py` 와 동일 규칙).
 *
 * 정책 B 1단계: 저장된 `date`(YYYY-MM-DD) + `time_slot`(1시간 구간 문자열)을 키로 교집합을 본다.
 * - 양쪽 슬롯 0개: 레거시 호환으로 시간축에서 막지 않음.
 * - 한쪽만 슬롯: 상대 일정 불명 → 비호환.
 * - 양쪽 1개 이상: 동일 `date`+`time_slot` 키가 1개 이상일 때만 호환.
 */

/** @param {unknown} slots @returns {Set<string>} */
function normalizedSlotKeys(slots) {
  const keys = new Set();
  if (!Array.isArray(slots)) return keys;
  for (const row of slots) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const d = typeof row.date === 'string' ? row.date.trim() : '';
    const t = typeof row.time_slot === 'string' ? row.time_slot.trim() : '';
    if (d && t) keys.add(`${d}\t${t}`);
  }
  return keys;
}

/**
 * @param {unknown} slotsA
 * @param {unknown} slotsB
 * @returns {number}
 */
function availabilityOverlapCount(slotsA, slotsB) {
  const ka = normalizedSlotKeys(slotsA);
  const kb = normalizedSlotKeys(slotsB);
  let n = 0;
  for (const k of ka) {
    if (kb.has(k)) n += 1;
  }
  return n;
}

/**
 * @param {unknown} slotsA
 * @param {unknown} slotsB
 * @returns {boolean}
 */
function availabilityPairCompatibleForMatching(slotsA, slotsB) {
  const ka = normalizedSlotKeys(slotsA);
  const kb = normalizedSlotKeys(slotsB);
  if (ka.size === 0 && kb.size === 0) return true;
  if (ka.size === 0 || kb.size === 0) return false;
  for (const k of ka) {
    if (kb.has(k)) return true;
  }
  return false;
}

module.exports = {
  normalizedSlotKeys,
  availabilityOverlapCount,
  availabilityPairCompatibleForMatching,
};
