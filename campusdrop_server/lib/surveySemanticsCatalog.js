/**
 * 설문 시맨틱 v1 파일(`surveySemantics.v1.json`) — 단일 진실 소스.
 * 제출 검증(허용 라벨) + `matchProfile` 생성(매칭 표준 표현).
 * 신규 설문 UI에는 tattoo·파트너 선호(pref_*) 문항이 없을 수 있어, 기본값으로 시맨틱 neutral을 채운 뒤 검증한다.
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
  if (/^\d+$/.test(t)) {
    let idNum = Number(t);
    if (field === 'pref_cc') {
      if (!Number.isInteger(idNum) || idNum < 1 || idNum > 5) {
        idNum = NaN;
      } else if (idNum <= 2) {
        idNum = 1;
      } else if (idNum === 3) {
        idNum = 3;
      } else {
        idNum = 2;
      }
    }
    if (Number.isInteger(idNum)) {
      const rowById = block.levels.find((r) => r.id === idNum);
      if (rowById) {
        return { level: rowById.id, tier: rowById.tier };
      }
    }
  }
  for (const row of block.levels) {
    const labels = Array.isArray(row.labels) ? row.labels : [];
    if (labels.includes(t)) {
      return { level: row.id, tier: row.tier };
    }
  }
  return null;
}

/** @param {Record<string, unknown>} data */
function withCatalogDefaults(data) {
  return {
    tattoo: '없음',
    pref_smoking: '상관없음',
    pref_tattoo: '상관없음',
    pref_religion: '상관없음',
    pref_cc: '상관없음',
    ...data,
  };
}

/**
 * @param {Record<string, unknown>} data `validateSurveyPayload` 성공 직전 동일 키
 * @returns {{ ok: true, patch: { surveySchemaVersion: number, matchProfile: object } } | { ok: false, error: string }}
 */
function validateCatalogAndBuildMatchProfile(data) {
  const spec = loadSemantics();
  const merged = withCatalogDefaults(data);

  const smokingLabel = String(merged.smoking).trim();
  if (!choiceLabelAllowed('smoking', smokingLabel)) {
    return { ok: false, error: `smoking 값이 시맨틱 카탈로그에 없습니다: ${smokingLabel}` };
  }
  const tattooLabel = String(merged.tattoo).trim();
  if (!choiceLabelAllowed('tattoo', tattooLabel)) {
    return { ok: false, error: `tattoo 값이 시맨틱 카탈로그에 없습니다: ${tattooLabel}` };
  }
  const religionLabel = String(merged.religion_type).trim();
  if (!choiceLabelAllowed('religion_type', religionLabel)) {
    return { ok: false, error: `religion_type 값이 시맨틱 카탈로그에 없습니다: ${religionLabel}` };
  }

  const df = merged.drinking_freq;
  if (typeof df === 'string') {
    const dfs = df.trim();
    if (!choiceLabelAllowed('drinking_freq', dfs)) {
      return { ok: false, error: `drinking_freq(문자열) 값이 시맨틱 카탈로그에 없습니다: ${dfs}` };
    }
  }

  const cs = merged.conflict_style;
  if (typeof cs === 'string') {
    const css = cs.trim();
    if (!choiceLabelAllowed('conflict_style', css)) {
      return { ok: false, error: `conflict_style 값이 시맨틱 카탈로그에 없습니다: ${css}` };
    }
  }

  const tcp = merged.text_call_pref;
  if (typeof tcp === 'string') {
    const tcps = tcp.trim();
    if (!choiceLabelAllowed('text_call_pref', tcps)) {
      return { ok: false, error: `text_call_pref 값이 시맨틱 카탈로그에 없습니다: ${tcps}` };
    }
  }

  const fo = merged.feedback_opt_in;
  if (typeof fo === 'string') {
    const fos = fo.trim();
    if (!choiceLabelAllowed('feedback_opt_in', fos)) {
      return { ok: false, error: `feedback_opt_in 값이 시맨틱 카탈로그에 없습니다: ${fos}` };
    }
  }

  const prefFields = /** @type {const} */ (['pref_smoking', 'pref_tattoo', 'pref_religion', 'pref_cc']);
  for (const key of prefFields) {
    const raw = merged[key];
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
      ...resolvePreferenceLevel('pref_smoking', String(merged.pref_smoking).trim()),
      label: String(merged.pref_smoking).trim(),
    },
    pref_tattoo: {
      ...resolvePreferenceLevel('pref_tattoo', String(merged.pref_tattoo).trim()),
      label: String(merged.pref_tattoo).trim(),
    },
    pref_religion: {
      ...resolvePreferenceLevel('pref_religion', String(merged.pref_religion).trim()),
      label: String(merged.pref_religion).trim(),
    },
    pref_cc: {
      ...resolvePreferenceLevel('pref_cc', String(merged.pref_cc).trim()),
      label: String(merged.pref_cc).trim(),
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
