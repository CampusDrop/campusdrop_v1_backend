/**
 * 설문 시맨틱 v1 — 단일 진실 소스: `config/surveySemantics.v1.json`.
 * 제출 검증(허용 라벨) + `matchProfile` 생성(매칭 표준 표현).
 */

const fs = require('fs');
const path = require('path');

/** @type {any} */
let _cache = null;

function semanticsPath() {
  return path.join(__dirname, '..', '..', 'config', 'surveySemantics.v1.json');
}

function loadSemantics() {
  if (!_cache) {
    const raw = fs.readFileSync(semanticsPath(), 'utf8');
    _cache = JSON.parse(raw);
  }
  return _cache;
}

/**
 * @param {string} field
 * @param {string} label
 * @returns {boolean}
 */
function choiceLabelAllowed(field, label) {
  const spec = loadSemantics();
  const map = spec.choice_label_maps[field];
  if (!map || typeof map !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(map, label);
}

/**
 * @param {'pref_smoking'|'pref_tattoo'|'pref_religion'|'pref_cc'} field
 * @param {string} label
 * @returns {{ level: number, tier: string } | null}
 */
function resolvePreferenceLevel(field, label) {
  const spec = loadSemantics();
  const block = spec.preference_policies[field];
  if (!block || !Array.isArray(block.levels)) return null;
  const t = label.trim();
  for (const row of block.levels) {
    const labels = Array.isArray(row.labels) ? row.labels : [];
    if (labels.includes(t)) {
      return { level: row.id, tier: row.tier };
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} data `validateSurveyPayload` 성공 직전 동일 키
 * @returns {{ ok: true, patch: { surveySchemaVersion: number, matchProfile: object } } | { ok: false, error: string }}
 */
function validateCatalogAndBuildMatchProfile(data) {
  const spec = loadSemantics();

  const smokingLabel = String(data.smoking).trim();
  if (!choiceLabelAllowed('smoking', smokingLabel)) {
    return { ok: false, error: `smoking 값이 시맨틱 카탈로그에 없습니다: ${smokingLabel}` };
  }
  const tattooLabel = String(data.tattoo).trim();
  if (!choiceLabelAllowed('tattoo', tattooLabel)) {
    return { ok: false, error: `tattoo 값이 시맨틱 카탈로그에 없습니다: ${tattooLabel}` };
  }
  const religionLabel = String(data.religion_type).trim();
  if (!choiceLabelAllowed('religion_type', religionLabel)) {
    return { ok: false, error: `religion_type 값이 시맨틱 카탈로그에 없습니다: ${religionLabel}` };
  }

  const alcoholRaw = data.alcohol;
  if (typeof alcoholRaw === 'string') {
    const al = alcoholRaw.trim();
    if (!choiceLabelAllowed('alcohol', al)) {
      return { ok: false, error: `alcohol(문자열) 값이 시맨틱 카탈로그에 없습니다: ${al}` };
    }
  }

  const skinRaw = data.skinship_limit;
  if (typeof skinRaw === 'string') {
    const sk = skinRaw.trim();
    if (!choiceLabelAllowed('skinship_limit', sk)) {
      return { ok: false, error: `skinship_limit(문자열) 값이 시맨틱 카탈로그에 없습니다: ${sk}` };
    }
  }

  const dd = data.date_drinking;
  if (typeof dd === 'string') {
    const dds = dd.trim();
    if (!choiceLabelAllowed('date_drinking', dds)) {
      return { ok: false, error: `date_drinking(문자열) 값이 시맨틱 카탈로그에 없습니다: ${dds}` };
    }
  }

  const prefFields = /** @type {const} */ (['pref_smoking', 'pref_tattoo', 'pref_religion', 'pref_cc']);
  for (const key of prefFields) {
    const raw = data[key];
    const s = typeof raw === 'string' ? raw.trim() : '';
    const hit = resolvePreferenceLevel(key, s);
    if (!hit) {
      return { ok: false, error: `${key} 값이 시맨틱 선호 단계에 매핑되지 않습니다: ${s}` };
    }
  }

  const smokingCode = spec.choice_label_maps.smoking[smokingLabel];
  const tattooCode = spec.choice_label_maps.tattoo[tattooLabel];
  const religionCode = spec.choice_label_maps.religion_type[religionLabel];

  const matchProfile = {
    smoking: { code: smokingCode, label: smokingLabel },
    tattoo: { code: tattooCode, label: tattooLabel },
    religion: { code: religionCode, label: religionLabel },
    pref_smoking: {
      ...resolvePreferenceLevel('pref_smoking', String(data.pref_smoking).trim()),
      label: String(data.pref_smoking).trim(),
    },
    pref_tattoo: {
      ...resolvePreferenceLevel('pref_tattoo', String(data.pref_tattoo).trim()),
      label: String(data.pref_tattoo).trim(),
    },
    pref_religion: {
      ...resolvePreferenceLevel('pref_religion', String(data.pref_religion).trim()),
      label: String(data.pref_religion).trim(),
    },
    pref_cc: {
      ...resolvePreferenceLevel('pref_cc', String(data.pref_cc).trim()),
      label: String(data.pref_cc).trim(),
    },
  };

  return {
    ok: true,
    patch: {
      surveySchemaVersion: spec.version,
      matchProfile,
    },
  };
}

module.exports = {
  loadSemantics,
  semanticsPath,
  validateCatalogAndBuildMatchProfile,
  choiceLabelAllowed,
  resolvePreferenceLevel,
};
