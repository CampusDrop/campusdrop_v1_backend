/**
 * `Trait.surveyData` → Python 배치/`calculate-match`용 `{ date, time_slot }[]`.
 * - 우선 정규화 저장분 `availability`.
 * - 비어 있고 `matchAvailability`만 있으면 `surveyValidation.matchAvailabilityToLegacySlots` 재사용.
 * - 변환 불가면 [] (배치에서 양쪽 []이면 시간축 레거시 호환).
 */

const { matchAvailabilityToLegacySlots } = require('./surveyValidation');

/** @param {unknown} row @returns {{ date: string, time_slot: string } | null} */
function normalizeSurveySlot(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = /** @type {Record<string, unknown>} */ (row);
  const date = typeof r.date === 'string' ? r.date.trim() : '';
  const time_slot = typeof r.time_slot === 'string' ? r.time_slot.trim() : '';
  if (!date || !time_slot) return null;
  return { date, time_slot };
}

/**
 * @param {Record<string, unknown>} surveyData
 * @returns {Array<{ date: string, time_slot: string }>}
 */
function surveyDataToAvailabilitySlots(surveyData) {
  if (!surveyData || typeof surveyData !== 'object' || Array.isArray(surveyData)) {
    return [];
  }

  const raw = surveyData.availability;
  if (Array.isArray(raw) && raw.length > 0) {
    const seen = new Set();
    /** @type {Array<{ date: string, time_slot: string }>} */
    const out = [];
    for (const row of raw) {
      const n = normalizeSurveySlot(row);
      if (!n) continue;
      const k = `${n.date}\t${n.time_slot}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(n);
    }
    if (out.length > 0) return out;
  }

  const ma = surveyData.matchAvailability;
  if (ma !== null && ma !== undefined && typeof ma === 'object' && !Array.isArray(ma)) {
    const conv = matchAvailabilityToLegacySlots(ma);
    if (conv.ok && Array.isArray(conv.slots) && conv.slots.length > 0) {
      return conv.slots;
    }
  }

  return [];
}

module.exports = { surveyDataToAvailabilitySlots };
