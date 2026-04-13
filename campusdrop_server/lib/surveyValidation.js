/**
 * 설문 키 및 타입 정의.
 * 척도(scale): 정수 1~5. 문자열 옵션(string): 공백만 있는 문자열 불가.
 * availability: 만남 가능 일정 — 날짜(YYYY-MM-DD) + 1시간 단위 구간(HH:MM-HH:MM).
 * gender: 남성/여성 등 → DB·매칭용 `male` | `female` 정규화(`../lib/genderPolicy`).
 */

const { normalizeTraitGender } = require('./genderPolicy');

const MAX_AVAILABILITY_SLOTS = 100;

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
  'gender',
  'pref_cc',
  'pref_smoking',
  'pref_tattoo',
  'pref_religion',
  'availability',
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

/** @param {string} isoDate `YYYY-MM-DD` */
function isValidCalendarDateOnly(isoDate) {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return false;
  }
  const [y, mo, da] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, da));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === da;
}

/** @param {string} part `HH:MM` (00:00–23:59) */
function parseClockToMinutes(part) {
  const m = part.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * `11:00-12:00` 형태, 종료가 시작보다 정확히 60분 뒤(자정 넘김 23:00–00:00 허용).
 * @param {string} time_slot
 * @returns {{ ok: true, normalized: string } | { ok: false, error: string }}
 */
function validateOneHourTimeSlot(time_slot) {
  if (typeof time_slot !== 'string') {
    return { ok: false, error: 'time_slot은 문자열이어야 합니다.' };
  }
  const trimmed = time_slot.trim();
  const dash = trimmed.indexOf('-');
  if (dash <= 0 || dash >= trimmed.length - 1) {
    return { ok: false, error: 'time_slot은 "11:00-12:00"처럼 HH:MM-HH:MM 형식이어야 합니다.' };
  }
  const a = trimmed.slice(0, dash).trim();
  const b = trimmed.slice(dash + 1).trim();
  const start = parseClockToMinutes(a);
  const end = parseClockToMinutes(b);
  if (start === null || end === null) {
    return { ok: false, error: 'time_slot의 시각은 HH:MM(00:00–23:59)이어야 합니다.' };
  }
  let endM = end;
  if (endM <= start) {
    endM += 24 * 60;
  }
  if (endM - start !== 60) {
    return { ok: false, error: 'time_slot은 정확히 1시간 구간이어야 합니다. (예: 11:00-12:00)' };
  }
  const pad = (n) => String(n).padStart(2, '0');
  const toHHMM = (mins) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  return { ok: true, normalized: `${toHHMM(start)}-${toHHMM(end)}` };
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, data: Array<{ date: string, time_slot: string }> } | { ok: false, error: string }}
 */
function validateAvailabilityField(raw) {
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'availability는 배열이어야 합니다.' };
  }
  if (raw.length === 0) {
    return { ok: false, error: 'availability에 최소 1개의 가능 시간이 필요합니다.' };
  }
  if (raw.length > MAX_AVAILABILITY_SLOTS) {
    return {
      ok: false,
      error: `availability는 최대 ${MAX_AVAILABILITY_SLOTS}개까지 허용됩니다.`,
    };
  }

  /** @type {Array<{ date: string, time_slot: string }>} */
  const out = [];
  const seen = new Set();

  for (let i = 0; i < raw.length; i += 1) {
    const slot = raw[i];
    if (slot === null || typeof slot !== 'object' || Array.isArray(slot)) {
      return { ok: false, error: `availability[${i}]는 객체여야 합니다.` };
    }
    const o = /** @type {Record<string, unknown>} */ (slot);
    if (!Object.prototype.hasOwnProperty.call(o, 'date')) {
      return { ok: false, error: `availability[${i}].date가 필요합니다.` };
    }
    if (!Object.prototype.hasOwnProperty.call(o, 'time_slot')) {
      return { ok: false, error: `availability[${i}].time_slot이 필요합니다.` };
    }
    const date = o.date;
    const time_slot = o.time_slot;
    if (typeof date !== 'string' || !isValidCalendarDateOnly(date.trim())) {
      return { ok: false, error: `availability[${i}].date는 YYYY-MM-DD 형식의 유효한 날짜여야 합니다.` };
    }
    const dateNorm = date.trim();
    const ts = validateOneHourTimeSlot(String(time_slot));
    if (!ts.ok) {
      return { ok: false, error: `availability[${i}]: ${ts.error}` };
    }
    const key = `${dateNorm}|${ts.normalized}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ date: dateNorm, time_slot: ts.normalized });
  }

  if (out.length === 0) {
    return { ok: false, error: 'availability에 유효한 가능 시간이 없습니다.' };
  }

  out.sort((a, b) => {
    const c = a.date.localeCompare(b.date);
    if (c !== 0) return c;
    return a.time_slot.localeCompare(b.time_slot);
  });

  return { ok: true, data: out };
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

  const availabilityResult = validateAvailabilityField(raw.availability);
  if (!availabilityResult.ok) {
    return { ok: false, error: availabilityResult.error };
  }

  /** @type {Record<string, unknown>} */
  const data = {};

  for (const key of ALL_KEYS) {
    if (key === 'availability') {
      data.availability = availabilityResult.data;
      continue;
    }
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

    if (key === 'gender') {
      const value = raw[key];
      const g = normalizeTraitGender(value);
      if (g === null) {
        return {
          ok: false,
          error:
            'gender는 남성(male·남성·남 등) 또는 여성(female·여성·여 등)으로 입력해 주세요.',
        };
      }
      data[key] = g;
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
  validateAvailabilityField,
  ALL_KEYS,
  SCALE_KEYS,
  STRING_KEYS,
  SCALE_MIN,
  SCALE_MAX,
  MAX_AVAILABILITY_SLOTS,
};
