/**
 * 설문 검증 v4: `surveyAnswers`는 phase별 중첩 객체, 척도 1~5, Enum은 영문 대문자 스네이크.
 * 시맨틱: `config/surveySemantics.v1.json`, matchProfile: `surveySemanticsCatalog.js`.
 */

const { normalizeTraitGender } = require('./genderPolicy');
const { normalizeDepartment } = require('./departments');
const { normalizePhone01 } = require('./phoneCrypto');
const { loadSemantics, validateCatalogAndBuildMatchProfile } = require('./surveySemanticsCatalog');

const MAX_AVAILABILITY_SLOTS = 100;

const ROOT_KEYS = new Set([
  'surveyAnswers',
  'answers',
  'matchAvailability',
  'participantMeta',
  'profile',
  'gender',
  'availability',
]);

function specFlatSurveyKeys() {
  const s = loadSemantics();
  const ints = Array.isArray(s.integer_scale_keys) ? s.integer_scale_keys : [];
  const enums = s.string_enum_keys && typeof s.string_enum_keys === 'object' ? Object.keys(s.string_enum_keys) : [];
  const multiEnums =
    s.multi_select_enum_keys && typeof s.multi_select_enum_keys === 'object'
      ? Object.keys(s.multi_select_enum_keys)
      : [];
  return [...ints, ...enums, ...multiEnums];
}

const ALL_KEYS = specFlatSurveyKeys();
const ALL_KEYS_SET = new Set(ALL_KEYS);

const s0 = loadSemantics();
const STRING_KEYS = new Set(
  s0.string_enum_keys && typeof s0.string_enum_keys === 'object' ? Object.keys(s0.string_enum_keys) : [],
);
const MULTI_SELECT_KEYS = new Set(
  s0.multi_select_enum_keys && typeof s0.multi_select_enum_keys === 'object'
    ? Object.keys(s0.multi_select_enum_keys)
    : [],
);
const SCALE_KEYS = new Set(Array.isArray(s0.integer_scale_keys) ? s0.integer_scale_keys : []);

const SCALE_MIN = 1;
const SCALE_MAX = 5;

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
 * @param {Record<string, unknown> | null} primary
 * @param {Record<string, unknown> | null} secondary
 */
function mergePhaseSurveyObjects(primary, secondary) {
  const spec = loadSemantics();
  const phases = spec.survey_phases;
  if (!Array.isArray(phases)) {
    return {};
  }
  /** @type {Record<string, Record<string, unknown>>} */
  const out = {};
  for (const ph of phases) {
    const o = {};
    const pa = primary && typeof primary === 'object' && !Array.isArray(primary) ? primary[ph] : undefined;
    const pb = secondary && typeof secondary === 'object' && !Array.isArray(secondary) ? secondary[ph] : undefined;
    if (pa && typeof pa === 'object' && !Array.isArray(pa)) {
      Object.assign(o, pa);
    }
    if (pb && typeof pb === 'object' && !Array.isArray(pb)) {
      Object.assign(o, pb);
    }
    out[ph] = o;
  }
  return out;
}

/**
 * 루트 `profile`을 `participantMeta.profile`와 병합(루트가 우선). 로맨스·친구 설문 공통.
 * @param {unknown} participantMeta
 * @param {unknown} rootProfile
 */
function mergeRootProfileWithParticipantMeta(participantMeta, rootProfile) {
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
    return {
      ...pmBase,
      profile: { ...existingProfile, .../** @type {Record<string, unknown>} */ (rootProfile) },
    };
  }
  return participantMeta;
}

/**
 * @param {Record<string, unknown>} surveyData
 * @returns {{ ok: true, mergedPhases: Record<string, Record<string, unknown>>, matchAvailability: unknown, participantMeta: unknown, gender: unknown, availability: unknown } | { ok: false, error: string }}
 */
function splitClientSurveyPackage(surveyData) {
  const input = /** @type {Record<string, unknown>} */ ({ ...surveyData });
  const rootProfile = Object.prototype.hasOwnProperty.call(input, 'profile') ? input.profile : undefined;
  const matchAvailability = Object.prototype.hasOwnProperty.call(input, 'matchAvailability')
    ? input.matchAvailability
    : undefined;
  let participantMeta = Object.prototype.hasOwnProperty.call(input, 'participantMeta')
    ? input.participantMeta
    : undefined;
  const surveyAnswers = input.surveyAnswers;
  const answers = input.answers;
  const gender = Object.prototype.hasOwnProperty.call(input, 'gender') ? input.gender : undefined;
  const availability = Object.prototype.hasOwnProperty.call(input, 'availability') ? input.availability : undefined;

  delete input.matchAvailability;
  delete input.participantMeta;
  delete input.profile;
  delete input.surveyAnswers;
  delete input.answers;
  delete input.gender;
  delete input.availability;

  const extra = Object.keys(input);
  if (extra.length > 0) {
    return {
      ok: false,
      error: `허용되지 않은 필드가 있습니다: ${extra.join(', ')}`,
    };
  }

  participantMeta = mergeRootProfileWithParticipantMeta(participantMeta, rootProfile);

  const sa =
    surveyAnswers !== undefined && surveyAnswers !== null && typeof surveyAnswers === 'object' && !Array.isArray(surveyAnswers)
      ? /** @type {Record<string, unknown>} */ (surveyAnswers)
      : null;
  const an =
    answers !== undefined && answers !== null && typeof answers === 'object' && !Array.isArray(answers)
      ? /** @type {Record<string, unknown>} */ (answers)
      : null;

  if (!sa && !an) {
    return { ok: false, error: 'surveyAnswers 또는 answers(phase 중첩 객체)가 필요합니다.' };
  }

  const mergedPhases = mergePhaseSurveyObjects(sa, an);

  return { ok: true, mergedPhases, matchAvailability, participantMeta, gender, availability };
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
    const departmentRaw = p.department != null ? String(p.department).trim() : '';
    const department = departmentRaw ? normalizeDepartment(departmentRaw) : null;
    const gender = p.gender != null ? String(p.gender).trim() : '';
    const phone = normalizePhone01(p.phone);
    out.profile = {
      ...(studentId ? { studentId } : {}),
      ...(birthYear ? { birthYear } : {}),
      ...(department ? { department } : {}),
      ...(gender ? { gender } : {}),
      ...(phone ? { phone } : {}),
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

/** @param {unknown} pm */
function validateParticipantMetaProfileDepartment(pm) {
  if (pm === null || pm === undefined || typeof pm !== 'object' || Array.isArray(pm)) {
    return null;
  }
  const profileRaw = /** @type {Record<string, unknown>} */ (pm).profile;
  if (!profileRaw || typeof profileRaw !== 'object' || Array.isArray(profileRaw)) {
    return null;
  }
  const departmentRaw = /** @type {Record<string, unknown>} */ (profileRaw).department;
  if (departmentRaw === undefined || departmentRaw === null || String(departmentRaw).trim() === '') {
    return null;
  }
  return normalizeDepartment(departmentRaw)
    ? null
    : 'participantMeta.profile.department는 등록된 학과 목록 중 하나여야 합니다.';
}

/** @param {unknown} pm */
function validateParticipantMetaProfilePhone(pm) {
  const missingMsg =
    'participantMeta.profile.phone은 필수입니다. 010으로 시작하는 휴대폰 11자리를 입력해 주세요.';
  if (pm === null || pm === undefined || typeof pm !== 'object' || Array.isArray(pm)) {
    return missingMsg;
  }
  const profileRaw = /** @type {Record<string, unknown>} */ (pm).profile;
  if (!profileRaw || typeof profileRaw !== 'object' || Array.isArray(profileRaw)) {
    return missingMsg;
  }
  const phoneRaw = /** @type {Record<string, unknown>} */ (profileRaw).phone;
  if (phoneRaw === undefined || phoneRaw === null || String(phoneRaw).trim() === '') {
    return missingMsg;
  }
  return normalizePhone01(phoneRaw)
    ? null
    : 'participantMeta.profile.phone은 010으로 시작하는 휴대폰 11자리여야 합니다.';
}

/**
 * `validateSurveyPayload` 결과의 `participantMeta.profile` → `Identity` 선택 컬럼
 * @param {Record<string, unknown>} data
 * @returns {{ studentId?: string, birthYear?: string, department?: string, phone?: string }}
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
  const department = normalizeDepartment(pr.department);
  const phone = normalizePhone01(pr.phone);
  /** @type {{ studentId?: string, birthYear?: string, department?: string, phone?: string }} */
  const out = {};
  if (sid) out.studentId = sid;
  if (by) out.birthYear = by;
  if (department) out.department = department;
  if (phone) out.phone = phone;
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
 * @param {unknown} value
 * @param {Set<string>} allowed
 * @param {{ allowDuplicates?: boolean }} [options] — `partner_age_preference` 등 동일 값 중복·순서 유지 저장용
 * @returns {string[] | null}
 */
function normalizeMultiSelectEnum(value, allowed, options = {}) {
  const allowDuplicates = options.allowDuplicates === true;
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const out = [];
  const seen = allowDuplicates ? null : new Set();
  for (const raw of value) {
    const item = typeof raw === 'string' ? raw.trim() : '';
    if (!allowed.has(item)) {
      return null;
    }
    if (!allowDuplicates) {
      if (seen.has(item)) {
        continue;
      }
      seen.add(item);
    }
    out.push(item);
  }
  return out.length ? out : null;
}

/**
 * @param {Record<string, Record<string, unknown>>} nested
 * @returns {{ ok: true, nested: Record<string, Record<string, unknown>>, flat: Record<string, unknown> } | { ok: false, error: string }}
 */
function validateAndNormalizeSurveyAnswers(nested) {
  const spec = loadSemantics();
  const phases = spec.survey_phases;
  const phaseFields = spec.phase_fields;
  const intKeys = new Set(Array.isArray(spec.integer_scale_keys) ? spec.integer_scale_keys : []);
  const enumSpec = spec.string_enum_keys && typeof spec.string_enum_keys === 'object' ? spec.string_enum_keys : {};
  const multiEnumSpec =
    spec.multi_select_enum_keys && typeof spec.multi_select_enum_keys === 'object'
      ? spec.multi_select_enum_keys
      : {};

  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    return { ok: false, error: 'surveyAnswers는 JSON 객체여야 합니다.' };
  }

  if (!Array.isArray(phases) || !phaseFields || typeof phaseFields !== 'object') {
    return { ok: false, error: '설문 시맨틱(survey_phases / phase_fields)이 올바르지 않습니다.' };
  }

  for (const ph of phases) {
    if (!Object.prototype.hasOwnProperty.call(nested, ph)) {
      return { ok: false, error: `surveyAnswers에 단계 키가 누락되었습니다: ${ph}` };
    }
    const block = nested[ph];
    if (block === null || typeof block !== 'object' || Array.isArray(block)) {
      return { ok: false, error: `surveyAnswers.${ph}는 객체여야 합니다.` };
    }
    const expected = phaseFields[ph];
    if (!Array.isArray(expected)) {
      return { ok: false, error: `시맨틱에 ${ph} 필드 정의가 없습니다.` };
    }
    const extra = Object.keys(block).filter((k) => !expected.includes(k));
    if (extra.length > 0) {
      return { ok: false, error: `surveyAnswers.${ph}에 허용되지 않은 필드: ${extra.join(', ')}` };
    }

    /** `religion === NONE`일 때 `faith_depth` 생략 허용 — 루프에서 종교보다 앞에 오는 필드라 선검증한다. */
    /** @type {string | null} */
    let phase4ReligionNorm = null;
    if (ph === 'phase4_beliefs_and_values') {
      if (!Object.prototype.hasOwnProperty.call(block, 'religion')) {
        return {
          ok: false,
          error: 'surveyAnswers.phase4_beliefs_and_values에 필수 항목이 누락되었습니다: religion',
        };
      }
      const rawRel = block.religion;
      if (rawRel === undefined || rawRel === null) {
        return {
          ok: false,
          error: 'surveyAnswers.phase4_beliefs_and_values.religion 값이 필요합니다.',
        };
      }
      if (!Object.prototype.hasOwnProperty.call(enumSpec, 'religion')) {
        return { ok: false, error: '시맨틱에 religion enum 정의가 없습니다.' };
      }
      const allowedRel = new Set(/** @type {string[]} */ (enumSpec.religion));
      const relStr = typeof rawRel === 'string' ? rawRel.trim() : '';
      if (!allowedRel.has(relStr)) {
        return {
          ok: false,
          error: `surveyAnswers.phase4_beliefs_and_values.religion는 다음 중 하나여야 합니다: ${[...allowedRel].join(', ')}`,
        };
      }
      block.religion = relStr;
      phase4ReligionNorm = relStr;
    }

    for (const field of expected) {
      if (ph === 'phase4_beliefs_and_values' && field === 'religion') {
        continue;
      }
      if (ph === 'phase4_beliefs_and_values' && field === 'faith_depth') {
        const hasFd = Object.prototype.hasOwnProperty.call(block, field);
        const v = hasFd ? block[field] : undefined;
        if (phase4ReligionNorm === 'NONE' && (!hasFd || v === null)) {
          delete block.faith_depth;
          continue;
        }
        if (!hasFd) {
          return { ok: false, error: `surveyAnswers.${ph}에 필수 항목이 누락되었습니다: ${field}` };
        }
        if (v === undefined || v === null) {
          return { ok: false, error: `surveyAnswers.${ph}.${field} 값이 필요합니다.` };
        }
        if (!intKeys.has(field)) {
          return { ok: false, error: `시맨틱에 정의되지 않은 필드입니다: ${field}` };
        }
        const n = coerceScaleInt(v);
        if (n === null) {
          return { ok: false, error: `surveyAnswers.${ph}.${field}는 1~5 사이의 정수여야 합니다.` };
        }
        block[field] = n;
        continue;
      }

      if (!Object.prototype.hasOwnProperty.call(block, field)) {
        return { ok: false, error: `surveyAnswers.${ph}에 필수 항목이 누락되었습니다: ${field}` };
      }
      const v = block[field];
      if (v === undefined || v === null) {
        return { ok: false, error: `surveyAnswers.${ph}.${field} 값이 필요합니다.` };
      }
      if (intKeys.has(field)) {
        const n = coerceScaleInt(v);
        if (n === null) {
          return { ok: false, error: `surveyAnswers.${ph}.${field}는 1~5 사이의 정수여야 합니다.` };
        }
        block[field] = n;
      } else if (Object.prototype.hasOwnProperty.call(enumSpec, field)) {
        const allowed = new Set(/** @type {string[]} */ (enumSpec[field]));
        const s = typeof v === 'string' ? v.trim() : '';
        if (!allowed.has(s)) {
          return {
            ok: false,
            error: `surveyAnswers.${ph}.${field}는 다음 중 하나여야 합니다: ${[...allowed].join(', ')}`,
          };
        }
        block[field] = s;
      } else if (Object.prototype.hasOwnProperty.call(multiEnumSpec, field)) {
        const allowed = new Set(/** @type {string[]} */ (multiEnumSpec[field]));
        const allowDuplicates = field === 'partner_age_preference';
        const values = normalizeMultiSelectEnum(v, allowed, { allowDuplicates });
        if (values === null) {
          return {
            ok: false,
            error: allowDuplicates
              ? `surveyAnswers.${ph}.${field}는 비어 있지 않은 배열이어야 하며 각 값은 다음 중 하나여야 합니다: ${[...allowed].join(', ')}`
              : `surveyAnswers.${ph}.${field}는 중복 없는 배열이어야 하며 각 값은 다음 중 하나여야 합니다: ${[...allowed].join(', ')}`,
          };
        }
        block[field] = values;
      } else {
        return { ok: false, error: `시맨틱에 정의되지 않은 필드입니다: ${field}` };
      }
    }
  }

  const unknownPhase = Object.keys(nested).filter((k) => !phases.includes(k));
  if (unknownPhase.length > 0) {
    return { ok: false, error: `허용되지 않은 설문 단계 키: ${unknownPhase.join(', ')}` };
  }

  /** @type {Record<string, unknown>} */
  const flat = {};
  for (const ph of phases) {
    const block = /** @type {Record<string, unknown>} */ (nested[ph]);
    for (const k of Object.keys(block)) {
      flat[k] = block[k];
    }
  }

  const flatKeys = Object.keys(flat);
  const expectedFlat = specFlatSurveyKeys();
  const expSet = new Set(expectedFlat);
  const religionFlat = flat.religion;
  const religionStr =
    typeof religionFlat === 'string' ? religionFlat.trim() : String(religionFlat ?? '').trim();
  const missing = expectedFlat.filter(
    (k) =>
      !flatKeys.includes(k) && !(k === 'faith_depth' && religionStr === 'NONE'),
  );
  if (missing.length) {
    return { ok: false, error: `설문 응답이 불완전합니다(누락): ${missing.join(', ')}` };
  }
  const stray = flatKeys.filter((k) => !expSet.has(k));
  if (stray.length) {
    return { ok: false, error: `내부 검증 오류: 예상 밖 키 ${stray.join(', ')}` };
  }

  return { ok: true, nested: /** @type {Record<string, Record<string, unknown>>} */ (nested), flat };
}

/**
 * `answers`만 중첩으로 온 경우 `surveyAnswers`로 흡수한다.
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
    const extra = Object.keys(rest).filter((k) => !ROOT_KEYS.has(k));
    if (extra.length > 0) {
      return {
        ok: false,
        error: `허용되지 않은 필드가 있습니다: ${extra.join(', ')}`,
      };
    }
    const existing = rest.surveyAnswers;
    const merged = mergePhaseSurveyObjects(
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? /** @type {Record<string, unknown>} */ (existing)
        : {},
      /** @type {Record<string, unknown>} */ (inner),
    );
    raw = { ...rest, surveyAnswers: merged };
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

  const unwrapped = unwrapSurveyPayload({
    surveyAnswers: split.mergedPhases,
    matchAvailability: split.matchAvailability,
    participantMeta: split.participantMeta,
    gender: split.gender,
    availability: split.availability,
  });
  if (!unwrapped.ok) {
    return { ok: false, error: unwrapped.error };
  }

  let { raw } = unwrapped;
  const { matchAvailability, participantMeta } = split;

  const nestedCopy = JSON.parse(JSON.stringify(raw.surveyAnswers));
  const norm = validateAndNormalizeSurveyAnswers(
    /** @type {Record<string, Record<string, unknown>>} */ (nestedCopy),
  );
  if (!norm.ok) {
    return { ok: false, error: norm.error };
  }

  /** @type {Record<string, unknown>} */
  const working = { ...raw };
  delete working.matchProfile;
  delete working.surveySchemaVersion;

  let gender = working.gender;
  if (
    (gender === undefined || gender === null) &&
    participantMeta !== null &&
    participantMeta !== undefined &&
    typeof participantMeta === 'object' &&
    !Array.isArray(participantMeta)
  ) {
    const pro = /** @type {Record<string, unknown>} */ (participantMeta).profile;
    if (pro && typeof pro === 'object' && !Array.isArray(pro) && pro.gender != null) {
      gender = pro.gender;
    }
  }

  if (gender === undefined || gender === null) {
    return { ok: false, error: 'gender(또는 participantMeta.profile.gender)가 필요합니다.' };
  }
  const g = normalizeTraitGender(gender);
  if (g === null) {
    return {
      ok: false,
      error: 'gender는 남성(male·남성·남 등) 또는 여성(female·여성·여 등)으로 입력해 주세요.',
    };
  }

  let availabilityRaw = working.availability;
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
    availabilityRaw = conv.slots;
  } else if (availabilityRaw === undefined || availabilityRaw === null) {
    return {
      ok: false,
      error: 'matchAvailability 또는 availability(레거시 배열)가 필요합니다.',
    };
  }

  const availabilityResult = validateAvailabilityField(availabilityRaw);
  if (!availabilityResult.ok) {
    return { ok: false, error: availabilityResult.error };
  }

  const sem = validateCatalogAndBuildMatchProfile(norm.flat);
  if (!sem.ok) {
    return { ok: false, error: sem.error };
  }

  /** @type {Record<string, unknown>} */
  const data = {
    surveyAnswers: norm.nested,
    gender: g,
    availability: availabilityResult.data,
    ...sem.patch,
  };

  if (
    matchAvailability !== undefined &&
    matchAvailability !== null &&
    typeof matchAvailability === 'object' &&
    !Array.isArray(matchAvailability)
  ) {
    data.matchAvailability = matchAvailability;
  }

  const departmentError = validateParticipantMetaProfileDepartment(participantMeta);
  if (departmentError) {
    return { ok: false, error: departmentError };
  }
  const phoneError = validateParticipantMetaProfilePhone(participantMeta);
  if (phoneError) {
    return { ok: false, error: phoneError };
  }

  const pmStored = normalizeParticipantMetaForStorage(participantMeta);
  if (pmStored) {
    data.participantMeta = pmStored;
  }

  return { ok: true, data };
}

module.exports = {
  validateSurveyPayload,
  unwrapSurveyPayload,
  splitClientSurveyPackage,
  mergeRootProfileWithParticipantMeta,
  validateParticipantMetaProfilePhone,
  matchAvailabilityToLegacySlots,
  normalizeParticipantMetaForStorage,
  identityProfileColumnsFromSurveyData,
  validateAvailabilityField,
  mergePhaseSurveyObjects,
  validateAndNormalizeSurveyAnswers,
  ALL_KEYS,
  SCALE_KEYS,
  STRING_KEYS,
  MULTI_SELECT_KEYS,
  SCALE_MIN,
  SCALE_MAX,
  MAX_AVAILABILITY_SLOTS,
  ROOT_KEYS,
};
