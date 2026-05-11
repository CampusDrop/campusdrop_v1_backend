const assert = require('node:assert/strict');
const { validateFriendHobbySurvey } = require('../lib/friendSurveySubmission');

assert.equal(validateFriendHobbySurvey(null).ok, false);
assert.equal(validateFriendHobbySurvey({ mainCategory: 1 }).ok, false);
assert.deepEqual(validateFriendHobbySurvey({ mainCategory: 2, detailChoice: 3 }).data, {
  mainCategory: 2,
  detailChoice: 3,
});
assert.equal(validateFriendHobbySurvey({ mainCategory: 5, detailChoice: 1 }).ok, false);
assert.equal(validateFriendHobbySurvey({ main_category: '4', detail_choice: '2' }).ok, true);

console.log('friendSurveySubmission validation tests ok');
