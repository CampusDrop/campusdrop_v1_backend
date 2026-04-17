/**
 * Node 설문(JSON) → Python `LifestyleUser` (campusdrop_matching/app/schemas.py).
 * 신규 설문 키(에너지·음주 빈도 등)를 기존 매칭 연속형·하드필터 축으로 투영한다.
 * `config/surveySemantics.v1.json`의 `drinking_freq`·`conflict_style` 맵과 `matchProfile`(제출 시 부착)을 우선한다.
 */

const { loadSemantics, validateCatalogAndBuildMatchProfile } = require('./surveySemanticsCatalog');

/** @param {unknown} v @returns {number} */
function clampLikert(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.round(n)));
}

/** @param {unknown} a @param {unknown} b */
function avgLikert(a, b) {
  return clampLikert((clampLikert(a) + clampLikert(b)) / 2);
}

/** @param {unknown} raw @returns {number} */
function likertDrinkingFreq(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw)) return clampLikert(raw);
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (/^[1-5]$/.test(t)) return Number(t);
    const map = loadSemantics().choice_label_maps.drinking_freq;
    if (map && Object.prototype.hasOwnProperty.call(map, t)) {
      return clampLikert(/** @type {number} */ (map[t]));
    }
  }
  return 3;
}

/** @param {unknown} raw @returns {number} */
function likertConflictStyle(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw)) return clampLikert(raw);
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (/^[1-5]$/.test(t)) return Number(t);
    const map = loadSemantics().choice_label_maps.conflict_style;
    if (map && typeof map[t] === 'number') {
      return clampLikert(map[t]);
    }
  }
  return 3;
}

/** @param {Record<string, unknown>} surveyData @param {string} key */
function prefLabelFromMatchProfile(surveyData, key) {
  const mp = surveyData.matchProfile != null ? surveyData.matchProfile : surveyData.match_profile;
  if (mp && typeof mp === 'object' && !Array.isArray(mp)) {
    const block = /** @type {Record<string, unknown>} */ (mp)[key];
    if (block && typeof block === 'object' && typeof block.label === 'string' && block.label.trim()) {
      return block.label.trim();
    }
  }
  return null;
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

  const rt =
    typeof surveyData.religion_type === 'string' ? surveyData.religion_type.trim() : '';
  const religionNone = rt === '없음' || rt === '무교';
  const ri = religionNone ? 3 : clampLikert(surveyData.religion_intensity);

  const drink = likertDrinkingFreq(surveyData.drinking_freq);

  return {
    energy: clampLikert(surveyData.energy),
    weekend: clampLikert(surveyData.campus_date),
    pattern: clampLikert(surveyData.morning_night),
    trend: clampLikert(surveyData.spending_style),
    alcohol: drink,
    contact: avgLikert(surveyData.social_battery, surveyData.reply_speed),
    meeting: clampLikert(surveyData.meet_frequency),
    planning: clampLikert(surveyData.cleanliness),
    affection: clampLikert(surveyData.public_affection),
    date_expense: clampLikert(surveyData.date_cost_split),
    friends: clampLikert(surveyData.social_battery),
    jealousy: clampLikert(surveyData.alone_time_need),
    skinship_speed: clampLikert(surveyData.commitment),
    skinship_limit: clampLikert(surveyData.public_affection),
    date_drinking: drink,
    religion_intensity: religionNone ? 3 : ri,
    politics: clampLikert(surveyData.politics_importance),
    marriage_view: clampLikert(surveyData.family_plan_view),
    meeting_seriousness: clampLikert(surveyData.commitment),
    job_view: clampLikert(surveyData.study_together),
    spending: clampLikert(surveyData.spending_style),
    conflict: likertConflictStyle(surveyData.conflict_style),
    empathy: clampLikert(surveyData.humor_importance),
    honesty: clampLikert(surveyData.reply_speed),
    trust: clampLikert(surveyData.commitment),
    smoking: surveyData.smoking ?? null,
    tattoo: '없음',
    religion_type: surveyData.religion_type ?? null,
    pref_smoking: prefLabelFromMatchProfile(surveyData, 'pref_smoking') ?? '상관없음',
    pref_tattoo: prefLabelFromMatchProfile(surveyData, 'pref_tattoo') ?? '상관없음',
    pref_religion: prefLabelFromMatchProfile(surveyData, 'pref_religion') ?? '상관없음',
    pref_cc: prefLabelFromMatchProfile(surveyData, 'pref_cc') ?? '상관없음',
    cc:
      typeof surveyData.text_call_pref === 'string' && surveyData.text_call_pref.trim()
        ? surveyData.text_call_pref.trim()
        : null,
    match_profile: matchProfile ?? null,
  };
}

module.exports = { surveyDataToLifestyleUser };
