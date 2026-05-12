const { normalizeTraitGender } = require('./genderPolicy');

/**
 * 친구 설문 JSON에서 주간/배치용 성별 후보 (participantMeta.profile.gender 등).
 * @param {Record<string, unknown>} surveyData
 * @returns {string | null} male | female | null
 */
function friendGenderFromSurveyData(surveyData) {
  const pm = surveyData.participantMeta;
  if (pm !== null && typeof pm === 'object' && !Array.isArray(pm)) {
    const pr = /** @type {Record<string, unknown>} */ (pm).profile;
    if (pr !== null && typeof pr === 'object' && !Array.isArray(pr)) {
      const g = /** @type {Record<string, unknown>} */ (pr).gender;
      if (g !== undefined && g !== null) {
        const ng = normalizeTraitGender(String(g));
        if (ng) return ng;
      }
    }
  }
  const rootG = surveyData.gender;
  if (rootG !== undefined && rootG !== null) {
    return normalizeTraitGender(String(rootG)) || null;
  }
  return null;
}

module.exports = { friendGenderFromSurveyData };
