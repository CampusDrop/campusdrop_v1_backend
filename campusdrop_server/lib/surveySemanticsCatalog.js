/**
 * 설문 시맨틱(`surveySemantics.v1.json`) — 단일 진실 소스.
 * v4: 중첩 surveyAnswers를 평탄화한 뒤 matchProfile(surveySchemaVersion)을 부착한다.
 */

const fs = require('fs');
const path = require('path');

/** @type {any} */
let _cache = null;

const SEMANTICS_FILE = 'surveySemantics.v1.json';

/**
 * - Docker(`Dockerfile.server`): `config/`가 `/app/config`에 복사됨 → `lib/../config`.
 * - 모노레포에서 `campusdrop_server` 기준 실행: 레포 루트 `config/` → `lib/../../config`.
 */
function semanticsPath() {
  const candidates = [
    path.join(__dirname, '..', 'config', SEMANTICS_FILE),
    path.join(__dirname, '..', '..', 'config', SEMANTICS_FILE),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  throw new Error(`survey semantics JSON not found. Tried:\n  ${candidates.join('\n  ')}`);
}

function loadSemantics() {
  if (!_cache) {
    const raw = fs.readFileSync(semanticsPath(), 'utf8');
    _cache = JSON.parse(raw);
  }
  return _cache;
}

/**
 * @param {'smoking'|'tattoo'|'religion_type'} field
 * @param {string} label
 */
function choiceLabelAllowed(field, label) {
  const spec = loadSemantics();
  const map = spec.choice_label_maps[field];
  if (!map || typeof map !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(map, label);
}

/**
 * @param {'pref_smoking'|'pref_tattoo'|'pref_religion'|'pref_cc'} field
 * @param {number} likert 1~5 (pref_religion은 1~6 허용)
 * @returns {{ level: number, tier: string } | null}
 */
function resolvePreferenceLevelFromLikert(field, likert) {
  const spec = loadSemantics();
  const block = spec.preference_policies[field];
  if (!block || !Array.isArray(block.levels)) return null;
  const idNum = Math.round(Number(likert));
  if (!Number.isInteger(idNum)) return null;
  const row = block.levels.find((r) => r.id === idNum);
  if (!row) return null;
  return { level: row.id, tier: row.tier };
}

/**
 * 레거시: 문자열 라벨로 선호 단계 해석(구 설문).
 * @param {'pref_smoking'|'pref_tattoo'|'pref_religion'|'pref_cc'} field
 * @param {string} label
 * @returns {{ level: number, tier: string } | null}
 */
function resolvePreferenceLevel(field, label) {
  const spec = loadSemantics();
  const block = spec.preference_policies[field];
  if (!block || !Array.isArray(block.levels)) return null;
  const t = String(label).trim();
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

/**
 * v3 평탄 설문 필드(모든 phase 키)로 matchProfile 생성.
 * @param {Record<string, unknown>} flatSurveyAnswers
 * @returns {{ ok: true, patch: { surveySchemaVersion: number, matchProfile: object } } | { ok: false, error: string }}
 */
function validateCatalogAndBuildMatchProfile(flatSurveyAnswers) {
  const spec = loadSemantics();
  const merged = { ...flatSurveyAnswers };

  const smokingLabel = String(merged.smoking_status).trim();
  if (!choiceLabelAllowed('smoking', smokingLabel)) {
    return { ok: false, error: `smoking_status 값이 시맨틱에 없습니다: ${smokingLabel}` };
  }
  const tattooLabel = String(merged.tattoo_status).trim();
  if (!choiceLabelAllowed('tattoo', tattooLabel)) {
    return { ok: false, error: `tattoo_status 값이 시맨틱에 없습니다: ${tattooLabel}` };
  }
  const religionEnum = String(merged.religion).trim();
  if (!choiceLabelAllowed('religion_type', religionEnum)) {
    return { ok: false, error: `religion 값이 시맨틱에 없습니다: ${religionEnum}` };
  }

  const prefFields = /** @type {const} */ (['pref_smoking', 'pref_tattoo', 'pref_religion', 'pref_cc']);
  const likertKeys = {
    pref_smoking: 'partner_smoking_tolerance',
    pref_tattoo: 'partner_tattoo_tolerance',
    pref_religion: 'partner_religion_tolerance',
    pref_cc: null,
  };

  /** @type {Record<string, { level: number, tier: string, label: string }>} */
  const prefBlocks = {};

  for (const key of prefFields) {
    const sourceKey = likertKeys[key];
    if (!sourceKey) {
      prefBlocks[key] = { level: 3, tier: 'neutral', label: 'any' };
      continue;
    }
    const raw = merged[sourceKey];
    const n = typeof raw === 'number' ? raw : Number(raw);
    const hit = resolvePreferenceLevelFromLikert(key, n);
    if (!hit) {
      return { ok: false, error: `${sourceKey}가 선호 정책 단계에 매핑되지 않습니다: ${raw}` };
    }
    prefBlocks[key] = { ...hit, label: String(Math.round(n)) };
  }

  const smokingCode = spec.choice_label_maps.smoking[smokingLabel];
  const tattooCode = spec.choice_label_maps.tattoo[tattooLabel];
  const religionCode = spec.choice_label_maps.religion_type[religionEnum];

  const matchProfile = {
    smoking: { code: smokingCode, label: smokingLabel },
    tattoo: { code: tattooCode, label: tattooLabel },
    religion: { code: religionCode, label: religionEnum },
    pref_smoking: prefBlocks.pref_smoking,
    pref_tattoo: prefBlocks.pref_tattoo,
    pref_religion: prefBlocks.pref_religion,
    pref_cc: prefBlocks.pref_cc,
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
  resolvePreferenceLevelFromLikert,
};
