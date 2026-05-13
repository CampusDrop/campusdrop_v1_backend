const { validateSurveyAvailabilityForCurrentWindow } = require('./surveyAvailabilityWindow');
const { surveyDataToAvailabilitySlots } = require('./surveyAvailabilitySlots');
const {
  mergeRootProfileWithParticipantMeta,
  validateParticipantMetaProfilePhone,
} = require('./surveyValidation');

/** @typedef {'GAME_PC'|'EXERCISE'|'CAFE'|'CULTURE'} FriendMainHobby */
/** @typedef {'LOL_DUO'|'STEAM_COOP'|'PUBG'|'OVERWATCH2'} FriendDetailGamePc */
/** @typedef {'GYM'|'RUN_WALK'|'BALL_SPORTS'|'ACTIVE_FUN'} FriendDetailExercise */
/** @typedef {'AESTHETIC_CAFE'|'DESSERT_TOUR'|'LOCAL_EATS'|'CAFE_STUDY'} FriendDetailCafe */
/** @typedef {'MOVIE_OTT'|'EXHIBITION_POPUP'|'LIVE_SHOW'|'ESCAPE_WORKSHOP'} FriendDetailCulture */

/** @type {readonly FriendMainHobby[]} */
const FRIEND_MAIN_HOBBIES = Object.freeze(['GAME_PC', 'EXERCISE', 'CAFE', 'CULTURE']);

/** @type {Record<FriendMainHobby, ReadonlySet<string>>} */
const FRIEND_DETAIL_BY_MAIN = Object.freeze({
  GAME_PC: new Set(['LOL_DUO', 'STEAM_COOP', 'PUBG', 'OVERWATCH2']),
  EXERCISE: new Set(['GYM', 'RUN_WALK', 'BALL_SPORTS', 'ACTIVE_FUN']),
  CAFE: new Set(['AESTHETIC_CAFE', 'DESSERT_TOUR', 'LOCAL_EATS', 'CAFE_STUDY']),
  CULTURE: new Set(['MOVIE_OTT', 'EXHIBITION_POPUP', 'LIVE_SHOW', 'ESCAPE_WORKSHOP']),
});

const FRIEND_DRINKING = Object.freeze(
  new Set(['ALCOHOL_MAX', 'LIGHT_DRINK', 'PARTY_VIBE', 'NON_ALCOHOL']),
);
const FRIEND_SMOKING = Object.freeze(new Set(['SMOKER', 'NON_SMOKER']));
const FRIEND_FAVORITE_FOOD = Object.freeze(
  new Set(['SPICY_BOLD', 'RICE_HEARTY', 'MEAT_GREASY', 'CLEAN_MEAL']),
);

const MAIN_HOBBY_SET = new Set(FRIEND_MAIN_HOBBIES);

/**
 * 친구 설문 고정 스키마: 메인 취미·세부·음주·담배·최애 음식 (문자열 enum).
 * @param {Record<string, unknown>} data
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validateFriendSurveyCoreFields(data) {
  const keys = ['mainHobby', 'mainHobbyDetail', 'drinking', 'smoking', 'favoriteFood'];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      return { ok: false, error: `친구 설문 필드가 없습니다: ${key}` };
    }
    const v = data[key];
    if (typeof v !== 'string') {
      return { ok: false, error: `친구 설문 "${key}"는 문자열이어야 합니다.` };
    }
  }

  const main = /** @type {string} */ (data.mainHobby);
  if (!MAIN_HOBBY_SET.has(main)) {
    return {
      ok: false,
      error:
        'mainHobby는 GAME_PC, EXERCISE, CAFE, CULTURE 중 하나여야 합니다.',
    };
  }

  const detail = /** @type {FriendMainHobby} */ (main);
  const allowedDetails = FRIEND_DETAIL_BY_MAIN[detail];
  const detailVal = /** @type {string} */ (data.mainHobbyDetail);
  if (!allowedDetails.has(detailVal)) {
    return {
      ok: false,
      error: 'mainHobbyDetail이 선택한 mainHobby에 허용된 값이 아닙니다.',
    };
  }

  const drinking = /** @type {string} */ (data.drinking);
  if (!FRIEND_DRINKING.has(drinking)) {
    return {
      ok: false,
      error:
        'drinking는 ALCOHOL_MAX, LIGHT_DRINK, PARTY_VIBE, NON_ALCOHOL 중 하나여야 합니다.',
    };
  }

  const smoking = /** @type {string} */ (data.smoking);
  if (!FRIEND_SMOKING.has(smoking)) {
    return { ok: false, error: 'smoking는 SMOKER 또는 NON_SMOKER 이어야 합니다.' };
  }

  const favoriteFood = /** @type {string} */ (data.favoriteFood);
  if (!FRIEND_FAVORITE_FOOD.has(favoriteFood)) {
    return {
      ok: false,
      error:
        'favoriteFood는 SPICY_BOLD, RICE_HEARTY, MEAT_GREASY, CLEAN_MEAL 중 하나여야 합니다.',
    };
  }

  return { ok: true };
}

/**
 * 친구 매칭 주간 제출용 검증: 고정 설문 필드 + 만남 가능 시간 1개 이상.
 * @param {unknown} surveyData
 * @returns {{ ok: true, data: Record<string, unknown>, availability: Array<{ date: string, time_slot: string }> } | { ok: false, error: string }}
 */
function validateFriendSurveyPayload(surveyData) {
  if (surveyData === undefined || surveyData === null) {
    return { ok: false, error: 'surveyData 본문이 필요합니다.' };
  }
  if (typeof surveyData !== 'object' || Array.isArray(surveyData)) {
    return { ok: false, error: 'surveyData는 객체여야 합니다.' };
  }
  const data = /** @type {Record<string, unknown>} */ (surveyData);

  const core = validateFriendSurveyCoreFields(data);
  if (!core.ok) {
    return core;
  }

  const participantMetaMerged = mergeRootProfileWithParticipantMeta(
    Object.prototype.hasOwnProperty.call(data, 'participantMeta') ? data.participantMeta : undefined,
    Object.prototype.hasOwnProperty.call(data, 'profile') ? data.profile : undefined,
  );
  const phoneErr = validateParticipantMetaProfilePhone(participantMetaMerged);
  if (phoneErr) {
    return { ok: false, error: phoneErr };
  }

  const slots = surveyDataToAvailabilitySlots(data);
  if (!Array.isArray(slots) || slots.length === 0) {
    return {
      ok: false,
      error: '만남 가능 시간이 필요합니다. `availability` 또는 `matchAvailability`를 포함해 주세요.',
    };
  }
  return { ok: true, data, availability: slots };
}

/**
 * @param {Array<{ date: string, time_slot: string }>} availabilitySlots
 * @param {Date} [now]
 */
function validateFriendAvailabilityWindow(availabilitySlots, now = new Date()) {
  const forDates = availabilitySlots.map((s) => ({ date: s.date }));
  return validateSurveyAvailabilityForCurrentWindow(forDates, now);
}

module.exports = {
  validateFriendSurveyPayload,
  validateFriendAvailabilityWindow,
  validateFriendSurveyCoreFields,
  FRIEND_MAIN_HOBBIES,
  FRIEND_DETAIL_BY_MAIN,
  FRIEND_DRINKING,
  FRIEND_SMOKING,
  FRIEND_FAVORITE_FOOD,
};
