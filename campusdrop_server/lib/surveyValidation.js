/**
 * 설문 키 및 타입 정의.
 * 척도(scale): 정수 1~5. 문자열 옵션(string): 공백만 있는 문자열 불가.
 * availability: 만남 가능 일정 — 날짜(YYYY-MM-DD) + 1시간 단위 구간(HH:MM-HH:MM).
 * gender: 남성/여성 등 → DB·매칭용 `male` | `female` 정규화(`../lib/genderPolicy`).
 *
 * 프론트 와이어: `alcohol`·`skinship_limit`·`self_care_habit`·`pref_*`는 문자열 "1"~"5" 허용,
 * `date_drinking`은 "마심"|"안 마심"|"상관없음"(및 레거시 한글) 등 — `config/surveySemantics.v1.json` 참고.
 */

const { normalizeTraitGender } = require('./genderPolicy');
const { validateCatalogAndBuildMatchProfile } = require('./surveySemanticsCatalog');

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
  'self_care_habit',
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
  'self_care_habit',
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
 * `surveyAnswers` / `answers` / `matchAvailability` / `participantMeta` 를 처리해
 * ALL_KEYS 검증용 코어 객체를 만듭니다.
 * @param {Record<string, unknown>} surveyData
 * @returns {{ ok: true, core: Record<string, unknown>, matchAvailability: unknown, participantMeta: unknown } | { ok: false, error: string }}
 */
function splitClientSurveyPackage(surveyData) {
  const input = /** @type {Record<string, unknown>} */ ({ ...surveyData });
  const rootProfile = Object.prototype.hasOwnProperty.call(input, 'profile')
    ? input.profile
    : undefined;
  const matchAvailability = Object.prototype.hasOwnProperty.call(input, 'matchAvailability')
    ? input.matchAvailability
    : undefined;
  let participantMeta = Object.prototype.hasOwnProperty.call(input, 'participantMeta')
    ? input.participantMeta
    : undefined;
  const surveyAnswers = input.surveyAnswers;
  const answers = input.answers;
  delete input.matchAvailability;
  delete input.participantMeta;
  delete input.profile;
  delete input.surveyAnswers;
  delete input.answers;

  if (
    rootProfile !== undefined &&
    rootProfile !== null &&
    typeof rootProfile === 'object' &&
    !Array.isArray(rootProfile)
  ) {
    const pmBase =
      participantMeta !== undefined &&
      participantMeta !== null &&
      typeof participantMeta === 'object' &&
      !Array.isArray(participantMeta)
        ? { .../** @type {Record<string, unknown>} */ (participantMeta) }
        : {};
    const existingProfile =
      pmBase.profile && typeof pmBase.profile === 'object' && !Array.isArray(pmBase.profile)
        ? { .../** @type {Record<string, unknown>} */ (pmBase.profile) }
        : {};
    participantMeta = {
      ...pmBase,
      profile: { ...existingProfile, .../** @type {Record<string, unknown>} */ (rootProfile) },
    };
  }

  const core = { ...input };
  if (
    surveyAnswers !== undefined &&
    surveyAnswers !== null &&
    typeof surveyAnswers === 'object' &&
    !Array.isArray(surveyAnswers)
  ) {
    Object.assign(core, /** @type {Record<string, unknown>} */ (surveyAnswers));
  }
  if (answers !== undefined && answers !== null && typeof answers === 'object' && !Array.isArray(answers)) {
    Object.assign(core, /** @type {Record<string, unknown>} */ (answers));
  }

  if (
    participantMeta !== null &&
    participantMeta !== undefined &&
    typeof participantMeta === 'object' &&
    !Array.isArray(participantMeta)
  ) {
    const pro = /** @type {Record<string, unknown>} */ (participantMeta).profile;
    if (pro && typeof pro === 'object' && !Array.isArray(pro) && core.gender == null && pro.gender != null) {
      core.gender = pro.gender;
    }
  }

  const extra = Object.keys(core).filter((k) => !ALL_KEYS_SET.has(k));
  if (extra.length > 0) {
    return {
      ok: false,
      error: `허용되지 않은 필드가 있습니다: ${extra.join(', ')}`,
    };
  }

  return { ok: true, core, matchAvailability, participantMeta };
}

/**
 * 프론트 `matchAvailability.availableSlots` → 기존 `availability` 검증용 `{ date, time_slot }[]`
 * @param {unknown} ma
 * @returns {{ ok: true, slots: Array<{ date: string, time_slot: string }> } | { ok: false, error: string }}
 */
function matchAvailabilityToLegacySlots(ma) {
  if (ma === null || typeof ma !== 'object' || Array.isArray(ma)) {
    return { ok: false, error: 'matchAvailability는 객체여야 합니다.' };
  }
  const o = /** @type {Record<string, unknown>} */ (ma);
  const slots = o.availableSlots;
  if (!Array.isArray(slots) || slots.length === 0) {
    return {
      ok: false,
      error: 'matchAvailability.availableSlots에 최소 1개의 가능 시간이 필요합니다.',
    };
  }
  if (slots.length > MAX_AVAILABILITY_SLOTS) {
    return {
      ok: false,
      error: `가능 시간은 최대 ${MAX_AVAILABILITY_SLOTS}개까지 허용됩니다.`,
    };
  }

  /** @type {Array<{ date: string, time_slot: string }>} */
  const legacy = [];
  for (let i = 0; i < slots.length; i += 1) {
    const s = slots[i];
    if (s === null || typeof s !== 'object' || Array.isArray(s)) {
      return { ok: false, error: `matchAvailability.availableSlots[${i}]는 객체여야 합니다.` };
    }
    const row = /** @type {Record<string, unknown>} */ (s);
    const date = row.date;
    const hs = row.hourStart;
    const he = row.hourEnd;
    if (typeof date !== 'string' || !isValidCalendarDateOnly(date.trim())) {
      return {
        ok: false,
        error: `matchAvailability.availableSlots[${i}].date는 YYYY-MM-DD 형식의 유효한 날짜여야 합니다.`,
      };
    }
    if (typeof hs !== 'number' || !Number.isInteger(hs) || hs < 0 || hs > 23) {
      return {
        ok: false,
        error: `matchAvailability.availableSlots[${i}].hourStart는 0~23 정수여야 합니다.`,
      };
    }
    if (typeof he !== 'number' || !Number.isInteger(he) || he < 0 || he > 23) {
      return {
        ok: false,
        error: `matchAvailability.availableSlots[${i}].hourEnd는 0~23 정수여야 합니다.`,
      };
    }
    const pad = (h) => String(h).padStart(2, '0');
    const timeSlotRaw = `${pad(hs)}:00-${pad(he)}:00`;
    const ts = validateOneHourTimeSlot(timeSlotRaw);
    if (!ts.ok) {
      return { ok: false, error: `matchAvailability.availableSlots[${i}]: ${ts.error}` };
    }
    legacy.push({ date: date.trim(), time_slot: ts.normalized });
  }

  return { ok: true, slots: legacy };
}

/**
 * participantMeta 중 DB에 남길 부분(email·uuid·registrationToken 제외)
 * @param {unknown} pm
 */
function normalizeParticipantMetaForStorage(pm) {
  if (pm === null || pm === undefined || typeof pm !== 'object' || Array.isArray(pm)) {
    return null;
  }
  const o = /** @type {Record<string, unknown>} */ (pm);
  const profileRaw = o.profile;
  const out = {};
  if (profileRaw && typeof profileRaw === 'object' && !Array.isArray(profileRaw)) {
    const p = /** @type {Record<string, unknown>} */ (profileRaw);
    const studentId = p.studentId != null ? String(p.studentId).trim() : '';
    const birthYear = p.birthYear != null ? String(p.birthYear).trim() : '';
    const gender = p.gender != null ? String(p.gender).trim() : '';
    out.profile = {
      ...(studentId ? { studentId } : {}),
      ...(birthYear ? { birthYear } : {}),
      ...(gender ? { gender } : {}),
    };
    if (Object.keys(/** @type {object} */ (out.profile)).length === 0) {
      delete out.profile;
    }
  }
  if (o.verificationMethod != null && String(o.verificationMethod).trim()) {
    out.verificationMethod = String(o.verificationMethod).trim();
  }
  if (typeof o.skippedPreSurveyViaCookie === 'boolean') {
    out.skippedPreSurveyViaCookie = o.skippedPreSurveyViaCookie;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * `validateSurveyPayload` 결과의 `participantMeta.profile` → `Identity` 선택 컬럼
 * @param {Record<string, unknown>} data
 * @returns {{ studentId?: string, birthYear?: string }}
 */
function identityProfileColumnsFromSurveyData(data) {
  const pm = data && typeof data === 'object' ? data.participantMeta : null;
  if (!pm || typeof pm !== 'object' || Array.isArray(pm)) {
    return {};
  }
  const pr = /** @type {Record<string, unknown>} */ (pm).profile;
  if (!pr || typeof pr !== 'object' || Array.isArray(pr)) {
    return {};
  }
  const sid = pr.studentId != null ? String(pr.studentId).trim() : '';
  const by = pr.birthYear != null ? String(pr.birthYear).trim() : '';
  /** @type {{ studentId?: string, birthYear?: string }} */
  const out = {};
  if (sid) out.studentId = sid;
  if (by) out.birthYear = by;
  return out;
}

/** @param {unknown} value */
function coerceScaleInt(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return isScaleValue(value) ? value : null;
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^[1-5]$/.test(t)) {
      return Number(t);
    }
  }
  return null;
}

/**
 * 프론트에서 `{ answers: { energy, ... } }` 처럼 감싸서 보내는 경우를 평탄화합니다.
 * `answers`와 본문에 같은 키가 있으면 `answers` 안의 값이 우선합니다.
 * @param {Record<string, unknown>} surveyData
 * @returns {{ ok: true, raw: Record<string, unknown> } | { ok: false, error: string }}
 */
function unwrapSurveyPayload(surveyData) {
  let raw = { ...surveyData };
  const inner = raw.answers;
  if (
    Object.prototype.hasOwnProperty.call(raw, 'answers') &&
    inner !== null &&
    typeof inner === 'object' &&
    !Array.isArray(inner)
  ) {
    const { answers: _a, ...rest } = raw;
    const extra = Object.keys(rest).filter((k) => !ALL_KEYS_SET.has(k));
    if (extra.length > 0) {
      return {
        ok: false,
        error: `허용되지 않은 필드가 있습니다: ${extra.join(', ')}`,
      };
    }
    raw = { ...rest, .../** @type {Record<string, unknown>} */ (inner) };
  }
  return { ok: true, raw };
}

/**
 * @param {unknown} surveyData
 * @returns {{ ok: true, data: Record<string, unknown> } | { ok: false, error: string }}
 */
function validateSurveyPayload(surveyData) {
  if (surveyData === null || typeof surveyData !== 'object' || Array.isArray(surveyData)) {
    return { ok: false, error: 'surveyData는 JSON 객체여야 합니다.' };
  }

  const split = splitClientSurveyPackage(/** @type {Record<string, unknown>} */ (surveyData));
  if (!split.ok) {
    return { ok: false, error: split.error };
  }

  let raw = { ...split.core };
  const { matchAvailability, participantMeta } = split;

  if (
    matchAvailability !== undefined &&
    matchAvailability !== null &&
    typeof matchAvailability === 'object' &&
    !Array.isArray(matchAvailability)
  ) {
    const conv = matchAvailabilityToLegacySlots(matchAvailability);
    if (!conv.ok) {
      return { ok: false, error: conv.error };
    }
    raw.availability = conv.slots;
  } else if (!Object.prototype.hasOwnProperty.call(raw, 'availability')) {
    return {
      ok: false,
      error: 'matchAvailability 또는 availability(레거시 배열)가 필요합니다.',
    };
  }

  const unwrapped = unwrapSurveyPayload(raw);
  if (!unwrapped.ok) {
    return { ok: false, error: unwrapped.error };
  }
  raw = unwrapped.raw;
  delete raw.matchProfile;
  delete raw.surveySchemaVersion;

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
    const ri = coerceScaleInt(intensityRaw);
    if (ri === null) {
      return {
        ok: false,
        error: 'religion_intensity는 1~5 사이의 정수여야 합니다.',
      };
    }
  } else if (hasIntensityKey && intensityRaw !== undefined && intensityRaw !== null) {
    const ri = coerceScaleInt(intensityRaw);
    if (ri === null) {
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
            ? coerceScaleInt(intensityRaw)
            : null;
      } else {
        data[key] = coerceScaleInt(intensityRaw);
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

    /**
     * - alcohol, skinship_limit: 한글 선택지 또는 UI 척도 1~5(number / "1"~"5")
     * - date_drinking: 프론트 명세상 한글 string; 레거시·시드는 1~5 정수 허용
     * - 프론트가 척도를 문자열 "1"~"5"로 보내는 경우 한글보다 먼저 정수로 해석한다.
     */
    if (key === 'alcohol' || key === 'skinship_limit' || key === 'date_drinking') {
      const likert = coerceScaleInt(value);
      if (likert !== null) {
        data[key] = likert;
        continue;
      }
      if (isNonEmptyString(value)) {
        data[key] = typeof value === 'string' ? value.trim() : value;
        continue;
      }
      return {
        ok: false,
        error: `${key}는 비어 있지 않은 문자열(선택지 문구)이거나 1~5 척도(정수 또는 "1"~"5")여야 합니다.`,
      };
    }

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

    const n = coerceScaleInt(value);
    if (n === null) {
      return {
        ok: false,
        error: `${key}는 ${SCALE_MIN}~${SCALE_MAX} 사이의 정수여야 합니다.`,
      };
    }
    data[key] = n;
  }

  if (
    matchAvailability !== undefined &&
    matchAvailability !== null &&
    typeof matchAvailability === 'object' &&
    !Array.isArray(matchAvailability)
  ) {
    data.matchAvailability = matchAvailability;
  }

  const pmStored = normalizeParticipantMetaForStorage(participantMeta);
  if (pmStored) {
    data.participantMeta = pmStored;
  }

  const sem = validateCatalogAndBuildMatchProfile(data);
  if (!sem.ok) {
    return { ok: false, error: sem.error };
  }
  Object.assign(data, sem.patch);

  return { ok: true, data };
}

module.exports = {
  validateSurveyPayload,
  unwrapSurveyPayload,
  splitClientSurveyPackage,
  matchAvailabilityToLegacySlots,
  normalizeParticipantMetaForStorage,
  identityProfileColumnsFromSurveyData,
  validateAvailabilityField,
  ALL_KEYS,
  SCALE_KEYS,
  STRING_KEYS,
  SCALE_MIN,
  SCALE_MAX,
  MAX_AVAILABILITY_SLOTS,
};
