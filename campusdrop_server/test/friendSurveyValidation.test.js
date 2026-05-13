const assert = require('node:assert/strict');
const {
  validateFriendSurveyPayload,
  validateFriendSurveyCoreFields,
} = require('../lib/friendSurveyValidation');

const baseCore = {
  mainHobby: 'GAME_PC',
  mainHobbyDetail: 'LOL_DUO',
  drinking: 'LIGHT_DRINK',
  smoking: 'NON_SMOKER',
  favoriteFood: 'CLEAN_MEAL',
};

assert.equal(validateFriendSurveyCoreFields({}).ok, false);
assert.equal(validateFriendSurveyCoreFields({ ...baseCore, mainHobby: 'INVALID' }).ok, false);
assert.equal(
  validateFriendSurveyCoreFields({ ...baseCore, mainHobbyDetail: 'GYM' }).ok,
  false,
);
assert.equal(validateFriendSurveyCoreFields({ ...baseCore, drinking: 'X' }).ok, false);
assert.equal(validateFriendSurveyCoreFields({ ...baseCore, smoking: 'X' }).ok, false);
assert.equal(validateFriendSurveyCoreFields({ ...baseCore, favoriteFood: 'X' }).ok, false);
assert.equal(validateFriendSurveyCoreFields(baseCore).ok, true);
assert.equal(
  validateFriendSurveyCoreFields({
    ...baseCore,
    mainHobby: 'EXERCISE',
    mainHobbyDetail: 'BALL_SPORTS',
  }).ok,
  true,
);

const withSlot = {
  ...baseCore,
  availability: [{ date: '2030-01-01', time_slot: 'evening' }],
  participantMeta: { profile: { phone: '01012345678' } },
};

assert.equal(validateFriendSurveyPayload({ ...baseCore }).ok, false);
assert.equal(
  validateFriendSurveyPayload({
    ...baseCore,
    availability: [{ date: '2030-01-01', time_slot: 'evening' }],
  }).ok,
  false,
);
assert.equal(validateFriendSurveyPayload(withSlot).ok, true);

const withSlotRootPhone = {
  ...baseCore,
  availability: [{ date: '2030-01-01', time_slot: 'evening' }],
  profile: { phone: '01012345678' },
};
assert.equal(validateFriendSurveyPayload(withSlotRootPhone).ok, true);

console.log('friendSurveyValidation tests ok');
