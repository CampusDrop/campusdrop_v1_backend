/**
 * Node 설문(JSON) → Python `LifestyleUser` (campusdrop_matching/app/schemas.py) 형태.
 * alcohol·skinship_limit·date_drinking는 서버 설문에서는 문자열일 수 있음, Python에서는 1~5 정수.
 * `config/surveySemantics.v1.json` 카탈로그와 `matchProfile`(제출 시 부착)을 우선한다.
 * `availability` 등 LifestyleUser에 없는 키는 DB `Trait.surveyData`에만 남고 여기서는 제외된다.
 * 만남 가능 시간은 `surveyAvailabilitySlots.surveyDataToAvailabilitySlots`로 별도 전달한다.
 * 하드필터·선호 필드는 JSON 직렬화 시 `undefined`가 빠지면 Python Pydantic이 422를 내므로 null 등으로 항상 키를 채운다.
 */

const { loadSemantics, validateCatalogAndBuildMatchProfile } = require('./surveySemanticsCatalog');

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
    if (/^[1-5]$/.test(t)) return Number(t);
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
    if (/^[1-5]$/.test(t)) return Number(t);
    if (Object.prototype.hasOwnProperty.call(SKINSHIP_LIMIT_TO_LIKERT, t)) {
      return /** @type {number} */ (SKINSHIP_LIMIT_TO_LIKERT[t]);
    }
  }
  return 3;
}

/** @param {unknown} raw @returns {number} */
function likertDateDrinking(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw)) return clampLikert(raw);
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (/^[1-5]$/.test(t)) return Number(t);
    const map = loadSemantics().choice_label_maps.date_drinking;
    if (map && Object.prototype.hasOwnProperty.call(map, t)) {
      return /** @type {number} */ (map[t]);
    }
  }
  return likertAlcohol(raw);
}

/**
 * @param {Record<string, unknown>} surveyData
 * @returns {Record<string, unknown>}
 */
function surveyDataToLifestyleUser(surveyData) {
  let matchProfile =
    surveyData.matchProfile != null
      ? surveyData.matchProfile
      : surveyData.match_profile != null
        ? surveyData.match_profile
        : null;
  if (matchProfile == null) {
    const sem = validateCatalogAndBuildMatchProfile(surveyData);
    if (sem.ok) matchProfile = sem.patch.matchProfile;
  }

  const religionNone =
    typeof surveyData.religion_type === 'string' && surveyData.religion_type.trim() === '없음';
  const ri = religionNone ? 3 : clampLikert(surveyData.religion_intensity);

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
    date_drinking: likertDateDrinking(surveyData.date_drinking),
    religion_intensity: religionNone ? 3 : ri,
    politics: clampLikert(surveyData.politics),
    marriage_view: clampLikert(surveyData.marriage_view),
    meeting_seriousness: clampLikert(surveyData.meeting_seriousness),
    job_view: clampLikert(surveyData.job_view),
    spending: clampLikert(surveyData.spending),
    conflict: clampLikert(surveyData.conflict),
    empathy: clampLikert(surveyData.empathy),
    honesty: clampLikert(surveyData.honesty),
    trust: clampLikert(surveyData.trust),
    smoking: surveyData.smoking ?? null,
    tattoo: surveyData.tattoo ?? null,
    religion_type: surveyData.religion_type ?? null,
    pref_smoking: surveyData.pref_smoking ?? null,
    pref_tattoo: surveyData.pref_tattoo ?? null,
    pref_religion: surveyData.pref_religion ?? null,
    pref_cc: surveyData.pref_cc ?? null,
    cc: surveyData.cc ?? null,
    match_profile: matchProfile ?? null,
  };
}

module.exports = { surveyDataToLifestyleUser };
