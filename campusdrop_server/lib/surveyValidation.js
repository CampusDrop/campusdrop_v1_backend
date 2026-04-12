/**
 * 설문 32문항 키 및 타입 정의.
 * 척도(scale): 정수 1~5. 문자열 옵션(string): 공백만 있는 문자열 불가.
 */

const ALL_KEYS = [
  'energy',
  'weekend',
  'pattern',
  'trend',
  'alcohol',
  'smoking',
  'tattoo',
  'contact',
  'meeting',
  'planning',
  'affection',
  'date_expense',
  'friends',
  'jealousy',
  'skinship_speed',
  'skinship_limit',
  'date_drinking',
  'politics',
  'religion_type',
  'religion_intensity',
  'marriage_view',
  'meeting_seriousness',
  'job_view',
  'spending',
  'conflict',
  'empathy',
  'honesty',
  'trust',
  'pref_cc',
  'pref_smoking',
  'pref_tattoo',
  'pref_religion',
];

const ALL_KEYS_SET = new Set(ALL_KEYS);

/** 문자열 선택지 */
const STRING_KEYS = new Set([
  'alcohol',
  'smoking',
  'tattoo',
  'religion_type',
  'skinship_limit',
  'pref_cc',
  'pref_smoking',
  'pref_tattoo',
  'pref_religion',
]);

/** 척도(1~5 정수) — religion_intensity 포함, 종교 없음일 때는 값 생략 가능 */
const SCALE_KEYS = new Set(
  ALL_KEYS.filter((k) => !STRING_KEYS.has(k)),
);

const SCALE_MIN = 1;
const SCALE_MAX = 5;

function isReligionNone(value) {
  return typeof value === 'string' && value.trim() === '없음';
}

function isScaleValue(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= SCALE_MIN &&
    value <= SCALE_MAX
  );
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @param {unknown} surveyData
 * @returns {{ ok: true, data: Record<string, unknown> } | { ok: false, error: string }}
 */
function validateSurveyPayload(surveyData) {
  if (surveyData === null || typeof surveyData !== 'object' || Array.isArray(surveyData)) {
    return { ok: false, error: 'surveyData는 JSON 객체여야 합니다.' };
  }

  const raw = /** @type {Record<string, unknown>} */ (surveyData);

  for (const key of Object.keys(raw)) {
    if (!ALL_KEYS_SET.has(key)) {
      return { ok: false, error: `허용되지 않은 필드가 있습니다: ${key}` };
    }
  }

  for (const key of ALL_KEYS) {
    if (key === 'religion_intensity') continue;
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      return { ok: false, error: `필수 항목이 누락되었습니다: ${key}` };
    }
    const v = raw[key];
    if (v === undefined || v === null) {
      return { ok: false, error: `필수 항목이 누락되었습니다: ${key}` };
    }
  }

  const religionType = raw.religion_type;
  if (!isNonEmptyString(religionType)) {
    return { ok: false, error: 'religion_type은 비어 있지 않은 문자열이어야 합니다.' };
  }

  const religionNone = isReligionNone(religionType);

  const hasIntensityKey = Object.prototype.hasOwnProperty.call(
    raw,
    'religion_intensity',
  );
  const intensityRaw = hasIntensityKey ? raw.religion_intensity : undefined;

  if (!religionNone) {
    if (!hasIntensityKey || intensityRaw === undefined || intensityRaw === null) {
      return {
        ok: false,
        error:
          "religion_type이 '없음'이 아닐 때는 religion_intensity(1~5 정수)가 필수입니다.",
      };
    }
    if (!isScaleValue(intensityRaw)) {
      return {
        ok: false,
        error: 'religion_intensity는 1~5 사이의 정수여야 합니다.',
      };
    }
  } else if (hasIntensityKey && intensityRaw !== undefined && intensityRaw !== null) {
    if (!isScaleValue(intensityRaw)) {
      return {
        ok: false,
        error:
          "religion_type이 '없음'일 때 religion_intensity를 보낸 경우 1~5 정수여야 합니다.",
      };
    }
  }

  /** @type {Record<string, unknown>} */
  const data = {};

  for (const key of ALL_KEYS) {
    if (key === 'religion_intensity') {
      if (religionNone) {
        data[key] =
          hasIntensityKey && intensityRaw !== undefined && intensityRaw !== null
            ? intensityRaw
            : null;
      } else {
        data[key] = intensityRaw;
      }
      continue;
    }

    const value = raw[key];
    if (STRING_KEYS.has(key)) {
      if (!isNonEmptyString(value)) {
        return {
          ok: false,
          error: `${key}는 비어 있지 않은 문자열이어야 합니다.`,
        };
      }
      data[key] = typeof value === 'string' ? value.trim() : value;
      continue;
    }

    if (!isScaleValue(value)) {
      return {
        ok: false,
        error: `${key}는 ${SCALE_MIN}~${SCALE_MAX} 사이의 정수여야 합니다.`,
      };
    }
    data[key] = value;
  }

  return { ok: true, data };
}

module.exports = {
  validateSurveyPayload,
  ALL_KEYS,
  SCALE_KEYS,
  STRING_KEYS,
  SCALE_MIN,
  SCALE_MAX,
};
