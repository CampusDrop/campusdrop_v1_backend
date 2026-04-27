/**
 * Node 설문(JSON) → Python `LifestyleUser` (campusdrop_matching/app/schemas.py).
 * v4: `surveyAnswers` phase 중첩 또는 레거시 평탄 키를 지원한다.
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
 * @param {string} key
 * @returns {unknown}
 */
function getSurveyAnswer(surveyData, key) {
  const nested = surveyData.surveyAnswers;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const phases = loadSemantics().survey_phases;
    if (Array.isArray(phases)) {
      for (const ph of phases) {
        const block = /** @type {Record<string, unknown>} */ (nested)[ph];
        if (block && typeof block === 'object' && !Array.isArray(block) && key in block) {
          return block[key];
        }
      }
    }
  }
  return surveyData[key];
}

function usesV3NestedSurvey(surveyData) {
  const n = surveyData.surveyAnswers;
  return Boolean(n && typeof n === 'object' && !Array.isArray(n) && n.phase1_lifestyle);
}

/** @param {unknown} raw @returns {number} */
function likertDrinkingOnDate(raw) {
  if (raw === 'DRINK') return 5;
  if (raw === 'NO_DRINK') return 1;
  if (raw === 'ANY') return 3;
  return 3;
}

/** @param {unknown} raw @returns {number} */
function likertLegacyDrinkingFreq(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw)) return clampLikert(raw);
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (/^[1-5]$/.test(t)) return Number(t);
    const maps = loadSemantics().choice_label_maps;
    const map = maps && maps.drinking_freq;
    if (map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, t)) {
      return clampLikert(/** @type {number} */ (map[t]));
    }
  }
  return 3;
}

/** @param {unknown} raw @returns {number} */
function likertLegacyConflictStyle(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw)) return clampLikert(raw);
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (/^[1-5]$/.test(t)) return Number(t);
    const maps = loadSemantics().choice_label_maps;
    const map = maps && maps.conflict_style;
    if (map && typeof map[t] === 'number') {
      return clampLikert(map[t]);
    }
  }
  return 3;
}

/** @param {unknown} rel */
function religionEnumToMatchingString(rel) {
  if (typeof rel !== 'string') return null;
  const spec = loadSemantics();
  const m = spec.choice_label_maps && spec.choice_label_maps.religion_type;
  if (m && Object.prototype.hasOwnProperty.call(m, rel.trim())) {
    return String(m[rel.trim()]);
  }
  return rel.trim().toLowerCase();
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
  if (matchProfile == null && usesV3NestedSurvey(surveyData)) {
    /** @type {Record<string, unknown>} */
    const flat = {};
    const phases = loadSemantics().survey_phases;
    if (Array.isArray(phases) && surveyData.surveyAnswers) {
      for (const ph of phases) {
        const b = /** @type {Record<string, unknown>} */ (surveyData.surveyAnswers)[ph];
        if (b && typeof b === 'object') {
          for (const k of Object.keys(b)) {
            flat[k] = b[k];
          }
        }
      }
    }
    const sem = validateCatalogAndBuildMatchProfile(flat);
    if (sem.ok) matchProfile = sem.patch.matchProfile;
  }

  if (usesV3NestedSurvey(surveyData)) {
    const rel = getSurveyAnswer(surveyData, 'religion');
    const relStr = typeof rel === 'string' ? rel.trim() : '';
    const religionNorm = religionEnumToMatchingString(rel) ?? 'none';
    const religionNone = relStr === 'NONE';
    const ri = religionNone ? 3 : clampLikert(getSurveyAnswer(surveyData, 'faith_depth'));

    const drinkPref = getSurveyAnswer(surveyData, 'drinking_preference');
    const drinkOnDate = getSurveyAnswer(surveyData, 'drinking_on_date');

    return {
      energy: clampLikert(getSurveyAnswer(surveyData, 'meeting_tension')),
      weekend: avgLikert(getSurveyAnswer(surveyData, 'weekend_activity'), getSurveyAnswer(surveyData, 'campus_couple_openness')),
      pattern: avgLikert(getSurveyAnswer(surveyData, 'lifestyle_pattern'), getSurveyAnswer(surveyData, 'hobby_type')),
      trend: avgLikert(getSurveyAnswer(surveyData, 'fashion_interest'), getSurveyAnswer(surveyData, 'hobby_type')),
      alcohol: clampLikert(drinkPref),
      contact: clampLikert(getSurveyAnswer(surveyData, 'contact_frequency')),
      meeting: clampLikert(getSurveyAnswer(surveyData, 'meeting_frequency')),
      planning: clampLikert(getSurveyAnswer(surveyData, 'date_planning')),
      affection: clampLikert(getSurveyAnswer(surveyData, 'verbal_affection')),
      date_expense: clampLikert(getSurveyAnswer(surveyData, 'dating_cost')),
      friends: clampLikert(getSurveyAnswer(surveyData, 'opposite_sex_friends')),
      jealousy: clampLikert(getSurveyAnswer(surveyData, 'jealousy_level')),
      skinship_speed: clampLikert(getSurveyAnswer(surveyData, 'intimacy_speed')),
      skinship_limit: clampLikert(getSurveyAnswer(surveyData, 'intimacy_openness')),
      date_drinking: likertDrinkingOnDate(drinkOnDate),
      religion_intensity: ri,
      politics: clampLikert(getSurveyAnswer(surveyData, 'political_view')),
      marriage_view: clampLikert(getSurveyAnswer(surveyData, 'marriage_view')),
      meeting_seriousness: clampLikert(getSurveyAnswer(surveyData, 'relationship_seriousness')),
      job_view: clampLikert(getSurveyAnswer(surveyData, 'work_value')),
      spending: clampLikert(getSurveyAnswer(surveyData, 'spending_habit')),
      conflict: clampLikert(getSurveyAnswer(surveyData, 'conflict_resolution')),
      empathy: clampLikert(getSurveyAnswer(surveyData, 'empathy_level')),
      honesty: avgLikert(getSurveyAnswer(surveyData, 'expressing_discomfort'), getSurveyAnswer(surveyData, 'self_management')),
      trust: avgLikert(getSurveyAnswer(surveyData, 'reliance_level'), getSurveyAnswer(surveyData, 'self_management')),
      smoking: getSurveyAnswer(surveyData, 'smoking_status') ?? null,
      tattoo: getSurveyAnswer(surveyData, 'tattoo_status') ?? null,
      religion_type: religionNorm,
      pref_smoking: prefLabelFromMatchProfile(surveyData, 'pref_smoking') ?? '3',
      pref_tattoo: prefLabelFromMatchProfile(surveyData, 'pref_tattoo') ?? '3',
      pref_religion: prefLabelFromMatchProfile(surveyData, 'pref_religion') ?? '3',
      pref_cc: prefLabelFromMatchProfile(surveyData, 'pref_cc') ?? 'any',
      cc: null,
      match_profile: matchProfile ?? null,
    };
  }

  const rt =
    typeof surveyData.religion_type === 'string' ? surveyData.religion_type.trim() : '';
  const religionNone = rt === '없음' || rt === '무교';
  const ri = religionNone ? 3 : clampLikert(surveyData.religion_intensity);

  const drink = likertLegacyDrinkingFreq(surveyData.drinking_freq);

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
    conflict: likertLegacyConflictStyle(surveyData.conflict_style),
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
