/**
 * Node 설문(JSON) → Python `LifestyleUser` (campusdrop_matching/app/schemas.py) 형태.
 * alcohol·skinship_limit는 서버 설문에서는 문자열, Python에서는 1~5 정수.
 */

/** @param {unknown} v @returns {number} */
function clampLikert(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.round(n)));
}

const ALCOHOL_TO_LIKERT = {
  '전혀 안 함': 1,
  '월 1회': 2,
  가끔: 3,
  자주: 5,
};

const SKINSHIP_LIMIT_TO_LIKERT = {
  '매우 천천히': 1,
  단계적으로: 3,
  '상의 후': 3,
  빠르게: 5,
};

/** @param {unknown} raw @returns {number} */
function likertAlcohol(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw)) return clampLikert(raw);
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (Object.prototype.hasOwnProperty.call(ALCOHOL_TO_LIKERT, t)) {
      return /** @type {number} */ (ALCOHOL_TO_LIKERT[t]);
    }
  }
  return 3;
}

/** @param {unknown} raw @returns {number} */
function likertSkinshipLimit(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw)) return clampLikert(raw);
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (Object.prototype.hasOwnProperty.call(SKINSHIP_LIMIT_TO_LIKERT, t)) {
      return /** @type {number} */ (SKINSHIP_LIMIT_TO_LIKERT[t]);
    }
  }
  return 3;
}

/**
 * @param {Record<string, unknown>} surveyData
 * @returns {Record<string, unknown>}
 */
function surveyDataToLifestyleUser(surveyData) {
  return {
    energy: clampLikert(surveyData.energy),
    weekend: clampLikert(surveyData.weekend),
    pattern: clampLikert(surveyData.pattern),
    trend: clampLikert(surveyData.trend),
    alcohol: likertAlcohol(surveyData.alcohol),
    contact: clampLikert(surveyData.contact),
    meeting: clampLikert(surveyData.meeting),
    planning: clampLikert(surveyData.planning),
    affection: clampLikert(surveyData.affection),
    date_expense: clampLikert(surveyData.date_expense),
    friends: clampLikert(surveyData.friends),
    jealousy: clampLikert(surveyData.jealousy),
    skinship_speed: clampLikert(surveyData.skinship_speed),
    skinship_limit: likertSkinshipLimit(surveyData.skinship_limit),
    politics: clampLikert(surveyData.politics),
    marriage_view: clampLikert(surveyData.marriage_view),
    meeting_seriousness: clampLikert(surveyData.meeting_seriousness),
    job_view: clampLikert(surveyData.job_view),
    spending: clampLikert(surveyData.spending),
    conflict: clampLikert(surveyData.conflict),
    empathy: clampLikert(surveyData.empathy),
    honesty: clampLikert(surveyData.honesty),
    trust: clampLikert(surveyData.trust),
    smoking: surveyData.smoking,
    tattoo: surveyData.tattoo,
    religion_type: surveyData.religion_type,
    pref_smoking: surveyData.pref_smoking,
    pref_tattoo: surveyData.pref_tattoo,
    pref_religion: surveyData.pref_religion,
    pref_cc: surveyData.pref_cc,
    cc: surveyData.cc ?? null,
  };
}

module.exports = { surveyDataToLifestyleUser };
